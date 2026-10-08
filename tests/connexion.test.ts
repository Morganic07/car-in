import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { deconnecter } from '../app/(auth)/compte/actions.ts'
import { connecter, type EtatConnexion } from '../app/(auth)/connexion/actions.ts'
import { auth } from '../lib/auth.ts'
import { REFUS_IDENTIFIANTS } from '../lib/connexion.ts'
import { REGLES, consommer, limiteOrigine, messageLimite, origine } from '../lib/limite-debit.ts'
import { prisma } from '../lib/prisma.ts'
import { semer } from '../prisma/semence.mts'

// Les actions serveur lisent les en-têtes de la requête et redirigent : hors de Next,
// les en-têtes sont ceux que le test choisit, et la redirection est enregistrée.
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
    // Comme le vrai `redirect`, on interrompt l'action : la suite ne s'exécute pas.
    throw Object.assign(new Error('NEXT_REDIRECT'), { redirection: chemin })
  },
}))

/// Lance une action et rend son état, ou `undefined` si elle a redirigé.
async function executer<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action()
  } catch (erreur) {
    if (erreur instanceof Error && erreur.message === 'NEXT_REDIRECT') return undefined
    throw erreur
  }
}

const ETAT_INITIAL: EtatConnexion = { email: '', erreurs: {} }
const MOT_DE_PASSE = 'demo-mot-de-passe-2026' // pragma: allowlist secret — compte de test fictif
const CLIENT_DEMO = 'camille.besson@exemple.fr'

function formulaire(valeurs: Record<string, string>): FormData {
  const donnees = new FormData()
  for (const [cle, valeur] of Object.entries(valeurs)) donnees.append(cle, valeur)
  return donnees
}

/// Une origine propre à chaque test : la limite par IP ne déborde pas d'un test à
/// l'autre.
let compteurOrigine = 0
function nouvelleOrigine(): Headers {
  compteurOrigine += 1
  return new Headers({ 'x-forwarded-for': `203.0.113.${compteurOrigine}` })
}

let dossier: string

beforeAll(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'carin-connexion-'))
  const url = `file:${join(dossier, 'connexion.db')}`
  execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  vi.stubEnv('DATABASE_URL', url)
  vi.stubEnv('BETTER_AUTH_SECRET', 'secret-de-test-uniquement-0123456789abcdef') // pragma: allowlist secret
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  // Une origine par test (voir `nouvelleOrigine`) : il faut que l'en-tête soit lu.
  vi.stubEnv('CONFIANCE_PROXY', '1')

  // Les comptes de démonstration, avec le mot de passe que la semence sait poser.
  await semer(prisma(), new Date(), MOT_DE_PASSE)
}, 120_000)

afterAll(async () => {
  await prisma().$disconnect()
  vi.unstubAllEnvs()
  rmSync(dossier, { recursive: true, force: true })
})

beforeEach(() => {
  requete.entetes = nouvelleOrigine()
  requete.redirections.length = 0
})

describe('limite de débit', () => {
  const regle = { maximum: 3, fenetreMs: 60_000 }

  it('laisse passer le maximum, puis refuse avec le délai restant', async () => {
    const debut = 1_000_000
    for (let i = 0; i < 3; i += 1) {
      expect(await consommer(prisma(), 'essai:simple', regle, debut + i)).toEqual({ permis: true })
    }
    expect(await consommer(prisma(), 'essai:simple', regle, debut + 10_000)).toEqual({
      permis: false,
      reessayerDansMs: 50_000,
    })
  })

  it('rouvre la porte une fois la fenêtre écoulée', async () => {
    const debut = 5_000_000
    for (let i = 0; i < 4; i += 1) await consommer(prisma(), 'essai:fenetre', regle, debut)
    expect((await consommer(prisma(), 'essai:fenetre', regle, debut + 59_999)).permis).toBe(false)
    expect((await consommer(prisma(), 'essai:fenetre', regle, debut + 60_000)).permis).toBe(true)
  })

  it('ne laisse pas passer plus que le maximum quand les essais arrivent ensemble', async () => {
    // Lire puis écrire laisserait plusieurs requêtes lire le même compteur : c'est
    // l'instruction unique qui tient la limite.
    const verdicts = await Promise.all(
      Array.from({ length: 20 }, () => consommer(prisma(), 'essai:simultane', regle, 9_000_000)),
    )
    expect(verdicts.filter((v) => v.permis)).toHaveLength(3)
  })

  it('tient les clés séparées', async () => {
    for (let i = 0; i < 4; i += 1) await consommer(prisma(), 'essai:a', regle, 1)
    expect((await consommer(prisma(), 'essai:b', regle, 1)).permis).toBe(true)
  })

  it('lit l’origine dans les en-têtes du proxy, seulement si un proxy est déclaré', () => {
    const transmise = new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })
    expect(origine(transmise)).toBe('198.51.100.7')
    expect(origine(new Headers())).toBeNull()

    // Sans proxy déclaré, l'en-tête est écrit par le client : il n'est pas lu, et la
    // limite retombe sur le compteur global plutôt que sur une clé falsifiable.
    vi.stubEnv('CONFIANCE_PROXY', '')
    try {
      expect(origine(transmise)).toBeNull()
      expect(limiteOrigine('connexion', transmise)).toEqual([
        'connexion:globale',
        REGLES.connexionGlobale,
      ])
      expect(limiteOrigine('inscription', transmise)).toEqual([
        'inscription:globale',
        REGLES.inscriptionGlobale,
      ])
    } finally {
      vi.stubEnv('CONFIANCE_PROXY', '1')
    }
  })

  it('purge les compteurs expirés', async () => {
    await consommer(prisma(), 'essai:ancien', regle, 1_000)
    // Bien plus tard que la plus longue fenêtre : la ligne doit avoir disparu.
    await consommer(prisma(), 'essai:recent', regle, 1_000 + 2 * 60 * 60_000)
    expect(await prisma().limiteDebit.count({ where: { cle: 'essai:ancien' } })).toBe(0)
    expect(await prisma().limiteDebit.count({ where: { cle: 'essai:recent' } })).toBe(1)
  })

  it('écrit un délai lisible, jamais « 0 minute »', () => {
    expect(messageLimite(500)).toBe('Trop de tentatives. Réessayez dans 1 minute.')
    expect(messageLimite(14 * 60_000 + 1)).toBe('Trop de tentatives. Réessayez dans 15 minutes.')
  })
})

describe('connexion', () => {
  it('connecte un compte de démonstration et mène à son compte', async () => {
    const etat = await executer(() =>
      connecter(ETAT_INITIAL, formulaire({ email: CLIENT_DEMO, motDePasse: MOT_DE_PASSE })),
    )
    expect(etat).toBeUndefined()
    expect(requete.redirections).toEqual(['/compte'])
    expect(await prisma().session.count({ where: { userId: 'demo-client' } })).toBeGreaterThan(0)
  })

  it('accepte l’adresse quelle que soit sa casse', async () => {
    const etat = await executer(() =>
      connecter(
        ETAT_INITIAL,
        formulaire({ email: '  Camille.BESSON@exemple.fr ', motDePasse: MOT_DE_PASSE }),
      ),
    )
    expect(etat).toBeUndefined()
  })

  it('rend exactement le même refus pour un mauvais mot de passe et une adresse inconnue', async () => {
    // Le critère de la story 2.2 : rien ne doit révéler si l'adresse existe.
    const mauvaisMotDePasse = await executer(() =>
      connecter(ETAT_INITIAL, formulaire({ email: CLIENT_DEMO, motDePasse: 'pas-le-bon-mot' })),
    )
    requete.entetes = nouvelleOrigine()
    const adresseInconnue = await executer(() =>
      connecter(
        ETAT_INITIAL,
        formulaire({ email: 'personne@exemple.fr', motDePasse: 'pas-le-bon-mot' }),
      ),
    )

    expect(mauvaisMotDePasse?.erreurGenerale).toBe(REFUS_IDENTIFIANTS)
    expect(adresseInconnue?.erreurGenerale).toBe(REFUS_IDENTIFIANTS)
    expect({ ...mauvaisMotDePasse, email: '' }).toEqual({ ...adresseInconnue, email: '' })
    expect(requete.redirections).toEqual([])
  })

  it('laisse passer six connexions réussies d’affilée', async () => {
    // Un usage normal — se connecter, se déconnecter, recommencer pour une
    // démonstration — ne doit jamais buter sur la limite : la réussite la remet à zéro.
    for (let i = 0; i < REGLES.connexionParEmail.maximum + 1; i += 1) {
      requete.redirections.length = 0
      const etat = await executer(() =>
        connecter(
          ETAT_INITIAL,
          formulaire({ email: 'sophie.marchand@carin.fr', motDePasse: MOT_DE_PASSE }),
        ),
      )
      expect(etat, `connexion ${i + 1}`).toBeUndefined()
      expect(requete.redirections).toEqual(['/compte'])
    }
  })

  it('refuse une adresse mal formée sans ouvrir de compteur', async () => {
    const etat = await executer(() =>
      connecter(ETAT_INITIAL, formulaire({ email: 'pas-une-adresse', motDePasse: 'x' })),
    )
    expect(etat?.erreurs.email).toBe('Cette adresse e-mail n’est pas valide.')
    expect(
      await prisma().limiteDebit.count({ where: { cle: 'connexion:email:pas-une-adresse' } }),
    ).toBe(0)
  })

  it('demande les deux champs, à côté de chacun', async () => {
    const etat = await executer(() =>
      connecter(ETAT_INITIAL, formulaire({ email: '  ', motDePasse: '' })),
    )
    expect(etat?.erreurs).toEqual({
      email: 'Indiquez votre adresse e-mail.',
      motDePasse: 'Indiquez votre mot de passe.',
    })
  })

  it('bloque une adresse après cinq essais, même avec le bon mot de passe ensuite', async () => {
    const email = 'hakim.diallo@carin.fr'
    for (let i = 0; i < REGLES.connexionParEmail.maximum; i += 1) {
      requete.entetes = nouvelleOrigine() // une origine différente à chaque essai
      const etat = await executer(() =>
        connecter(ETAT_INITIAL, formulaire({ email, motDePasse: `essai-${i}-faux` })),
      )
      expect(etat?.erreurGenerale).toBe(REFUS_IDENTIFIANTS)
    }

    requete.entetes = nouvelleOrigine()
    const etat = await executer(() =>
      connecter(ETAT_INITIAL, formulaire({ email, motDePasse: MOT_DE_PASSE })),
    )
    expect(etat?.erreurGenerale).toMatch(/^Trop de tentatives\. Réessayez dans 15 minutes\.$/)
    expect(requete.redirections).toEqual([])
  })
})

describe('session et déconnexion', () => {
  /// Connexion par l'API, pour récupérer le cookie de session tel que le navigateur le
  /// recevrait.
  async function ouvrirSession(email: string): Promise<{ cookie: string; setCookie: string }> {
    const { headers } = await auth().api.signInEmail({
      body: { email, password: MOT_DE_PASSE },
      returnHeaders: true,
    })
    const setCookie = headers.get('set-cookie') ?? ''
    const cookie = setCookie
      .split(/,(?=\s*[^;=]+=)/)
      .map((morceau) => morceau.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ')
    return { cookie, setCookie }
  }

  it('pose un cookie persistant, qui survit à la fermeture de l’onglet', async () => {
    // Un cookie sans Max-Age ni Expires disparaît avec la session du navigateur.
    const { setCookie } = await ouvrirSession(CLIENT_DEMO)
    const sessionToken = setCookie.split(/,(?=\s*[^;=]+=)/).find((c) => c.includes('session_token'))
    expect(sessionToken).toBeDefined()
    expect(sessionToken).toMatch(/Max-Age=\d+|Expires=/i)
  })

  it('invalide la session en base : le cookie ne redonne plus accès', async () => {
    const { cookie } = await ouvrirSession(CLIENT_DEMO)
    const avecCookie = new Headers({ cookie })
    expect(await auth().api.getSession({ headers: avecCookie })).not.toBeNull()

    requete.entetes = avecCookie
    const etat = await executer(() => deconnecter())
    expect(etat).toBeUndefined()
    expect(requete.redirections).toEqual(['/connexion?deconnecte=1'])

    // Le même cookie, rejoué comme le ferait le bouton « précédent » ou un vol de
    // jeton : la session n'existe plus.
    expect(await auth().api.getSession({ headers: avecCookie })).toBeNull()
  })

  it('renvoie vers la connexion sans session à fermer', async () => {
    requete.entetes = new Headers()
    expect(await executer(() => deconnecter())).toBeUndefined()
    expect(requete.redirections).toEqual(['/connexion'])
  })
})
