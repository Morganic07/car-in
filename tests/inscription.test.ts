import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { inscrire, type EtatInscription } from '../app/(auth)/inscription/actions.ts'
import { auth, type Auth } from '../lib/auth.ts'
import {
  erreurChamp,
  lireFormulaire,
  validerInscription,
  type ValeursInscription,
} from '../lib/inscription.ts'
import { REGLES } from '../lib/limite-debit.ts'
import { prisma } from '../lib/prisma.ts'

// L'action serveur appelle `headers()` et `redirect()`, qui n'existent que dans une
// requête Next. On les remplace ici par leur plus simple expression : des en-têtes
// vides, et une redirection qu'on enregistre au lieu de la suivre.
const requete = vi.hoisted(() => ({ entetes: new Headers() }))
vi.mock('next/headers', () => ({
  headers: async () => requete.entetes,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.')
  },
}))
const redirections = vi.hoisted(() => [] as string[])
vi.mock('next/navigation', () => ({
  redirect: (chemin: string) => {
    redirections.push(chemin)
  },
}))

const VALIDE: ValeursInscription = {
  nom: '  Inès Moreau ',
  email: ' Ines.Moreau@Exemple.fr ',
  telephone: '06 98 76 54 32',
  motDePasse: 'correct-horse-battery',
}

const ETAT_INITIAL: EtatInscription = {
  valeurs: { nom: '', email: '', telephone: '' },
  erreurs: {},
}

function formulaire(valeurs: Record<string, string>): FormData {
  const donnees = new FormData()
  for (const [cle, valeur] of Object.entries(valeurs)) donnees.append(cle, valeur)
  return donnees
}

describe('validation des champs', () => {
  it('accepte une saisie complète et la normalise', () => {
    const resultat = validerInscription(VALIDE)
    expect(resultat).toEqual({
      valide: true,
      donnees: {
        nom: 'Inès Moreau',
        email: 'ines.moreau@exemple.fr',
        telephone: '0698765432',
        motDePasse: 'correct-horse-battery',
      },
    })
  })

  it('refuse un mot de passe de moins de huit caractères', () => {
    expect(erreurChamp('motDePasse', '1234567')).toMatch(/au moins 8 caractères/)
    expect(erreurChamp('motDePasse', '12345678')).toBeUndefined()
  })

  it('ne retire pas les espaces d’un mot de passe', () => {
    // Huit caractères dont des espaces : valide, et transmis tel quel.
    const resultat = validerInscription({ ...VALIDE, motDePasse: '  abc  d' })
    expect(resultat.valide && resultat.donnees.motDePasse).toBe('  abc  d')
  })

  it.each([
    ['nom', '   ', /Indiquez votre nom/],
    ['email', 'pas-une-adresse', /n’est pas valide/],
    ['email', '', /Indiquez votre adresse/],
    ['telephone', '12 34', /numéro français/],
    ['telephone', '', /Indiquez votre numéro/],
  ] as const)('refuse %s = %j avec un message en français', (champ, valeur, attendu) => {
    expect(erreurChamp(champ, valeur)).toMatch(attendu)
  })

  it.each(['+33 6 12 34 56 78', '0033612345678', '01.23.45.67.89', '06-12-34-56-78'])(
    'accepte le numéro %s',
    (numero) => {
      expect(erreurChamp('telephone', numero)).toBeUndefined()
    },
  )

  it('enregistre un même numéro sous une seule forme, quel que soit l’indicatif', () => {
    for (const numero of ['+33 6 12 34 56 78', '0033612345678', '06.12.34.56.78']) {
      const resultat = validerInscription({ ...VALIDE, telephone: numero })
      expect(resultat.valide && resultat.donnees.telephone, numero).toBe('0612345678')
    }
    expect(erreurChamp('telephone', '+33 06 12 34 56 78')).toMatch(/numéro français/)
  })

  it('rend toutes les erreurs d’un coup, champ par champ', () => {
    const resultat = validerInscription({ nom: '', email: '', telephone: '', motDePasse: '' })
    expect(resultat.valide).toBe(false)
    if (!resultat.valide) {
      expect(Object.keys(resultat.erreurs).sort()).toEqual(
        ['email', 'motDePasse', 'nom', 'telephone'].sort(),
      )
    }
  })

  it('ne lit que les quatre champs du formulaire', () => {
    const lu = lireFormulaire(formulaire({ ...VALIDE, role: 'CHAUFFEUR', emailVerified: 'true' }))
    expect(Object.keys(lu).sort()).toEqual(['email', 'motDePasse', 'nom', 'telephone'])
  })
})

describe('inscription d’un client, sur une vraie base', () => {
  let dossier: string

  beforeAll(() => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-inscription-'))
    const url = `file:${join(dossier, 'inscription.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
    // Valeurs de test, sans rapport avec un secret réel.
    vi.stubEnv('BETTER_AUTH_SECRET', 'secret-de-test-uniquement-0123456789abcdef') // pragma: allowlist secret
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  }, 120_000)

  afterAll(async () => {
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  beforeEach(() => {
    redirections.length = 0
    requete.entetes = new Headers()
  })

  it('limite le nombre d’inscriptions depuis une même origine', async () => {
    // Sans limite, l'inscription — qui dit si une adresse est prise — permettrait de
    // tester une liste d'adresses à la chaîne. Une origine dédiée à ce test, lue
    // parce qu'un proxy est déclaré.
    vi.stubEnv('CONFIANCE_PROXY', '1')
    requete.entetes = new Headers({ 'x-forwarded-for': '198.51.100.99' })
    const { maximum } = REGLES.inscriptionParIp
    for (let i = 0; i < maximum; i += 1) {
      const etat = await inscrire(
        ETAT_INITIAL,
        formulaire({ ...VALIDE, email: `serie-${i}@exemple.fr` }),
      )
      expect(etat, `inscription ${i + 1}`).toBeUndefined()
    }

    const refus = await inscrire(ETAT_INITIAL, formulaire({ ...VALIDE, email: 'de-trop@exemple.fr' }))
    expect(refus.erreurGenerale).toBe('Trop de tentatives. Réessayez dans 60 minutes.')
    expect(await prisma().user.count({ where: { email: 'de-trop@exemple.fr' } })).toBe(0)
  }, 60_000)

  it('crée un compte CLIENT même quand le formulaire poste role=CHAUFFEUR', async () => {
    // Le critère de la story 2.1, au mot près : on poste le rôle, on lit ce qui est
    // enregistré.
    const etat = await inscrire(ETAT_INITIAL, formulaire({ ...VALIDE, role: 'CHAUFFEUR' }))

    expect(etat, 'aucun refus attendu').toBeUndefined()
    expect(redirections).toEqual(['/inscription/confirmee'])

    const compte = await prisma().user.findUniqueOrThrow({
      where: { email: 'ines.moreau@exemple.fr' },
      include: { accounts: true },
    })
    expect(compte.role).toBe('CLIENT')
    expect(compte.nom).toBe('Inès Moreau')
    expect(compte.telephone).toBe('0698765432')

    // Le mot de passe est enregistré haché, jamais en clair.
    expect(compte.accounts).toHaveLength(1)
    const hache = compte.accounts[0]?.password
    expect(hache).toBeTruthy()
    expect(hache).not.toContain(VALIDE.motDePasse)
  })

  it('affiche un message à côté de l’e-mail quand l’adresse est déjà prise', async () => {
    // Même adresse, autre casse : la normalisation doit la reconnaître.
    const etat = await inscrire(
      ETAT_INITIAL,
      formulaire({ ...VALIDE, nom: 'Autre Personne', email: 'INES.moreau@exemple.fr' }),
    )

    expect(etat.erreurs).toEqual({ email: 'Un compte existe déjà avec cette adresse e-mail.' })
    expect(etat.erreurGenerale).toBeUndefined()
    expect(redirections).toEqual([])
    expect(await prisma().user.count({ where: { email: 'ines.moreau@exemple.fr' } })).toBe(1)
  })

  it('ne crée qu’un compte quand deux inscriptions de la même adresse se croisent', async () => {
    // Better Auth vérifie l'adresse, puis crée : entre les deux, l'autre requête peut
    // passer. La contrainte d'unicité de la base tranche ; le perdant doit lire le
    // même message que pour une adresse déjà prise, pas une panne générique.
    const donnees = { ...VALIDE, email: 'simultane@exemple.fr' }
    const etats = await Promise.all([
      inscrire(ETAT_INITIAL, formulaire(donnees)),
      inscrire(ETAT_INITIAL, formulaire(donnees)),
    ])

    expect(await prisma().user.count({ where: { email: 'simultane@exemple.fr' } })).toBe(1)
    const refus = etats.filter((etat) => etat !== undefined)
    expect(refus).toHaveLength(1)
    expect(refus[0]?.erreurs).toEqual({ email: 'Un compte existe déjà avec cette adresse e-mail.' })
  })

  it('refuse un mot de passe trop court sans rien créer', async () => {
    const etat = await inscrire(
      ETAT_INITIAL,
      formulaire({ ...VALIDE, email: 'court@exemple.fr', motDePasse: '1234567' }),
    )

    expect(etat.erreurs.motDePasse).toMatch(/au moins 8 caractères/)
    expect(redirections).toEqual([])
    expect(await prisma().user.count({ where: { email: 'court@exemple.fr' } })).toBe(0)
  })

  it('rend la saisie pour la réafficher, sans jamais le mot de passe', async () => {
    const etat = await inscrire(
      ETAT_INITIAL,
      formulaire({ ...VALIDE, email: 'pas-une-adresse' }),
    )

    expect(etat.valeurs).toEqual({
      nom: VALIDE.nom,
      email: 'pas-une-adresse',
      telephone: VALIDE.telephone,
    })
    expect(JSON.stringify(etat)).not.toContain(VALIDE.motDePasse)
  })

  it('ignore aussi un rôle envoyé directement à Better Auth', async () => {
    // Seconde couche, indépendante du formulaire : même si l'action transmettait le
    // rôle, la configuration `input: false` le remplacerait par CLIENT.
    await auth().api.signUpEmail({
      body: {
        name: 'Requête Forgée',
        email: 'forgee@exemple.fr',
        password: 'mot-de-passe-solide', // pragma: allowlist secret — compte de test fictif
        telephone: '0612345678',
        role: 'CHAUFFEUR',
        // Le typage de Better Auth refuse déjà `role` : le cast simule une requête
        // forgée à la main, qui ne passe par aucun typage.
      } as NonNullable<Parameters<Auth['api']['signUpEmail']>[0]>['body'],
    })

    const compte = await prisma().user.findUniqueOrThrow({ where: { email: 'forgee@exemple.fr' } })
    expect(compte.role).toBe('CLIENT')
  })
})
