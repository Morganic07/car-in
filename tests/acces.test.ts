import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONNEXION, ESPACE, destination, refusRole, roleDeSession } from '../lib/acces.ts'
import type { Role } from '../lib/domaine/course.ts'
import { auth } from '../lib/auth.ts'
import { autoriser, exigerEspace } from '../lib/garde.ts'
import { prisma } from '../lib/prisma.ts'
import { semer } from '../prisma/semence.mts'
import { config, proxy } from '../proxy.ts'

// Les gardes lisent les en-têtes de la requête en cours et redirigent : hors de Next,
// les en-têtes sont ceux du test, et la redirection est enregistrée puis interrompt
// la fonction, comme le ferait la vraie.
const requete = vi.hoisted(() => ({ entetes: new Headers(), redirections: [] as string[] }))
vi.mock('next/headers', () => ({
  headers: async () => requete.entetes,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.')
  },
}))
vi.mock('next/navigation', () => ({
  redirect: (chemin: string) => {
    requete.redirections.push(chemin)
    throw new Error('NEXT_REDIRECT')
  },
}))

const racine = join(import.meta.dirname, '..')
const MOT_DE_PASSE = 'demo-mot-de-passe-2026' // pragma: allowlist secret — compte de test fictif

describe('règle de redirection', () => {
  it.each([
    // [chemin, rôle, destination attendue]
    ['/chauffeur', null, CONNEXION],
    ['/client', null, CONNEXION],
    ['/compte', null, CONNEXION],
    ['/chauffeur', 'CLIENT', ESPACE.CLIENT],
    ['/chauffeur/courses/42', 'CLIENT', ESPACE.CLIENT],
    ['/client', 'CHAUFFEUR', ESPACE.CHAUFFEUR],
    ['/client/reserver', 'CHAUFFEUR', ESPACE.CHAUFFEUR],
    ['/chauffeur', 'CHAUFFEUR', null],
    ['/client/reserver', 'CLIENT', null],
    ['/compte', 'CLIENT', null],
    ['/compte', 'CHAUFFEUR', null],
    // Hors des espaces : jamais de redirection.
    ['/', null, null],
    ['/connexion', null, null],
    ['/inscription', 'CLIENT', null],
    // Un préfixe n'est pas un espace : `/chauffeurs` n'est pas sous `/chauffeur`.
    ['/chauffeurs', 'CLIENT', null],
    ['/clientele', 'CHAUFFEUR', null],
  ] as const)('%s pour %s → %s', (chemin, role, attendu) => {
    expect(destination(chemin, role)).toBe(attendu)
  })

  it('ne prend jamais une valeur inconnue pour un rôle', () => {
    expect(roleDeSession(null)).toBeNull()
    expect(roleDeSession({ user: { role: 'CHAUFFEUR' } })).toBe('CHAUFFEUR')
    expect(() => roleDeSession({ user: { role: 'ADMIN' } })).toThrow(/Rôle inconnu/)
    expect(() => roleDeSession({ user: {} })).toThrow(/Rôle inconnu/)
  })
})

describe('cohérence du proxy avec la règle', () => {
  it('couvre chaque espace et le compte dans son matcher', () => {
    // Un espace absent du matcher serait servi sans redirection. Les pages
    // revérifient, mais l'oubli doit se voir ici d'abord.
    expect(config.matcher).toEqual(
      expect.arrayContaining([`${ESPACE.CLIENT}/:path*`, `${ESPACE.CHAUFFEUR}/:path*`, '/compte']),
    )
  })
})

/// Fichiers source d'un dossier, s'il existe.
function sources(dossier: string): string[] {
  const chemin = join(racine, dossier)
  if (!existsSync(chemin)) return []
  return readdirSync(chemin, { recursive: true, encoding: 'utf8' })
    .filter((fichier) => /\.tsx?$/.test(fichier))
    .map((fichier) => join(chemin, fichier))
}

/// Toute exportation qui n'est ni un type ni une interface. On ne cherche pas à
/// reconnaître les formes d'une action — une liste de formes en oublie toujours une
/// (annotation de type fonction, `let`, action enveloppée…). Dans un fichier
/// « use server », Next n'accepte à l'export que des fonctions asynchrones : toute
/// exportation de valeur est donc une action.
const ACTION_EXPORTEE = /^export\s+(?!type\b|interface\b)/gm

/// Une réexportation (`export { … }`, `export * from …`) : le corps des actions n'est
/// pas dans le fichier, on ne peut pas y vérifier la garde.
const REEXPORTATION = /^export\s*(?:\{|\*)/m

describe('chaque page et chaque action d’espace porte sa garde', () => {
  // Le proxy ne protège que son matcher, et rien de ce qui passe par une requête
  // d'action forgée : la garde doit être dans le code de chaque page et de chaque
  // action. Ce test vaut pour les pages et actions que les epics 3 et 4 ajouteront.
  const fichiers = [...sources('app/(client)'), ...sources('app/(chauffeur)')]

  it('trouve les pages d’accueil des deux espaces', () => {
    const pages = fichiers.filter((f) => f.endsWith('page.tsx'))
    expect(pages.some((f) => f.includes('(client)'))).toBe(true)
    expect(pages.some((f) => f.includes('(chauffeur)'))).toBe(true)
  })

  it.each(fichiers.filter((f) => f.endsWith('page.tsx')))(
    '%s appelle exigerEspace avec le rôle de son espace',
    (fichier) => {
      // Le rôle, pas seulement l'appel : une page de l'espace client qui exigerait le
      // rôle chauffeur — un copier-coller — passerait sinon le test.
      const role = fichier.includes(`${join('app', '(chauffeur)')}`) ? 'CHAUFFEUR' : 'CLIENT'
      expect(readFileSync(fichier, 'utf8')).toContain(`await exigerEspace('${role}')`)
    },
  )

  it('chaque action exportée d’un fichier « use server » appelle autoriser', () => {
    for (const fichier of fichiers) {
      const contenu = readFileSync(fichier, 'utf8')
      if (!/^\s*['"]use server['"]/m.test(contenu)) continue
      const nom = fichier.replace(racine, '')

      expect(contenu, `${nom} : réexportation interdite`).not.toMatch(REEXPORTATION)

      // Limite assumée : le décompte vérifie qu'il y a au moins autant d'appels à la
      // garde que d'actions, pas que chaque action a le sien. Le vérifier action par
      // action demanderait d'analyser la syntaxe ; la relecture couvre ce reste.
      const actions = contenu.match(ACTION_EXPORTEE)?.length ?? 0
      const gardes = contenu.match(/await autoriser\(/g)?.length ?? 0
      expect(gardes, nom).toBeGreaterThanOrEqual(actions)
    }
  })

  it('reconnaît toutes les formes d’action exportée', () => {
    // Le test ci-dessus ne vaut que si son décompte voit chaque forme. On l'éprouve
    // sur des exemples, puisqu'aucun fichier d'actions n'existe encore dans les espaces.
    const actions = [
      'export async function accepter() {}',
      'export default async function accepter() {}',
      'export const accepter = async () => {}',
      'export const accepter: Action = async (id: string) => {}',
      // L'annotation de type fonction contient un `=>` : la forme qui avait échappé
      // à la première version de ce décompte.
      'export const accepter: (id: string) => Promise<void> = async (id) => {}',
      'export let accepter = async () => {}',
      'export const accepter = avecJournal(async () => {})',
    ]
    for (const forme of actions) {
      expect(forme.match(ACTION_EXPORTEE), forme).toHaveLength(1)
    }

    // Les types ne sont pas des actions : ils ne doivent pas exiger de garde.
    for (const forme of ['export type Etat = { erreur?: string }', 'export interface Etat {}']) {
      expect(forme.match(ACTION_EXPORTEE), forme).toBeNull()
    }

    for (const forme of ["export { accepter } from './interne'", "export * from './interne'"]) {
      expect(forme, forme).toMatch(REEXPORTATION)
    }
    expect('export type { Etat } from "./interne"').not.toMatch(REEXPORTATION)
  })
})

describe('sur de vraies sessions', () => {
  let dossier: string
  const cookies: Record<'client' | 'chauffeur', string> = { client: '', chauffeur: '' }

  /// Connexion par l'API, pour obtenir le cookie de session qu'aurait le navigateur.
  async function cookieDe(email: string): Promise<string> {
    const { headers } = await auth().api.signInEmail({
      body: { email, password: MOT_DE_PASSE },
      returnHeaders: true,
    })
    return (headers.get('set-cookie') ?? '')
      .split(/,(?=\s*[^;=]+=)/)
      .map((morceau) => morceau.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ')
  }

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-acces-'))
    const url = `file:${join(dossier, 'acces.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
    vi.stubEnv('BETTER_AUTH_SECRET', 'secret-de-test-uniquement-0123456789abcdef') // pragma: allowlist secret
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')

    await semer(prisma(), new Date(), MOT_DE_PASSE)
    cookies.client = await cookieDe('camille.besson@exemple.fr')
    cookies.chauffeur = await cookieDe('hakim.diallo@carin.fr')
  }, 120_000)

  afterAll(async () => {
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  beforeEach(() => {
    requete.redirections.length = 0
  })

  describe('action chauffeur (S12)', () => {
    it('refuse explicitement une session client', async () => {
      // Le critère de la story 2.3 : la garde que toute action chauffeur appelle en
      // premier, sollicitée avec une session client, comme une requête forgée.
      requete.entetes = new Headers({ cookie: cookies.client })
      expect(await autoriser('CHAUFFEUR')).toEqual({
        permis: false,
        motif: 'Cette action est réservée aux chauffeurs.',
      })
      expect(requete.redirections).toEqual([])
    })

    it('laisse passer une session chauffeur, avec sa session', async () => {
      requete.entetes = new Headers({ cookie: cookies.chauffeur })
      const resultat = await autoriser('CHAUFFEUR')
      expect(resultat.permis).toBe(true)
      expect(resultat.permis && resultat.session.user.email).toBe('hakim.diallo@carin.fr')
    })

    it('refuse sans session, avec un message qui dit quoi faire', async () => {
      requete.entetes = new Headers()
      expect(await autoriser('CHAUFFEUR')).toEqual({
        permis: false,
        motif: 'Votre session a expiré. Reconnectez-vous pour continuer.',
      })
    })

    it('refuse aussi une action client à un chauffeur', async () => {
      requete.entetes = new Headers({ cookie: cookies.chauffeur })
      expect(await autoriser('CLIENT')).toEqual({ permis: false, motif: refusRole('CLIENT') })
    })
  })

  describe('pages d’espace', () => {
    async function visiter(role: Role | null, cookie: string): Promise<string | 'affichée'> {
      requete.entetes = new Headers(cookie === '' ? {} : { cookie })
      try {
        await exigerEspace(role)
        return 'affichée'
      } catch (erreur) {
        if (erreur instanceof Error && erreur.message === 'NEXT_REDIRECT') {
          return requete.redirections.at(-1) ?? 'redirection sans cible'
        }
        throw erreur
      }
    }

    it('renvoie un client de l’espace chauffeur vers le sien', async () => {
      expect(await visiter('CHAUFFEUR', cookies.client)).toBe('/client')
    })

    it('renvoie un chauffeur de l’espace client vers le sien', async () => {
      expect(await visiter('CLIENT', cookies.chauffeur)).toBe('/chauffeur')
    })

    it('envoie un visiteur sans session vers la connexion', async () => {
      expect(await visiter('CHAUFFEUR', '')).toBe('/connexion')
      expect(await visiter('CLIENT', '')).toBe('/connexion')
      expect(await visiter(null, '')).toBe('/connexion')
    })

    it('affiche à chacun son propre espace, et le compte à tous', async () => {
      expect(await visiter('CLIENT', cookies.client)).toBe('affichée')
      expect(await visiter('CHAUFFEUR', cookies.chauffeur)).toBe('affichée')
      expect(await visiter(null, cookies.client)).toBe('affichée')
      expect(await visiter(null, cookies.chauffeur)).toBe('affichée')
    })
  })

  describe('proxy', () => {
    async function passer(chemin: string, cookie: string): Promise<string | null> {
      const reponse = await proxy(
        new NextRequest(`http://localhost:3000${chemin}`, {
          headers: cookie === '' ? {} : { cookie },
        }),
      )
      const cible = reponse.headers.get('location')
      return cible === null ? null : new URL(cible).pathname
    }

    it('redirige comme la règle, sur la vraie session', async () => {
      expect(await passer('/chauffeur', cookies.client)).toBe('/client')
      expect(await passer('/client/reserver', cookies.chauffeur)).toBe('/chauffeur')
      expect(await passer('/chauffeur', '')).toBe('/connexion')
      expect(await passer('/compte', '')).toBe('/connexion')
    })

    it('laisse passer chacun dans son espace', async () => {
      expect(await passer('/chauffeur', cookies.chauffeur)).toBeNull()
      expect(await passer('/client', cookies.client)).toBeNull()
      expect(await passer('/compte', cookies.client)).toBeNull()
    })
  })
})
