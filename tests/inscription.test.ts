import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APIError } from 'better-auth/api'
import { getURLFromRedirectError } from 'next/dist/client/components/redirect.js'
import { isRedirectError } from 'next/dist/client/components/redirect-error.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { inscrire, type EtatInscription } from '../app/(auth)/inscription/actions.ts'
import { auth, type Auth } from '../lib/auth.ts'
import { validerConnexion } from '../lib/connexion.ts'
import {
  EMAIL_INVALIDE,
  erreurChamp,
  lireFormulaire,
  validerInscription,
  type ValeursInscription,
} from '../lib/inscription.ts'
import { REGLES } from '../lib/limite-debit.ts'
import { prisma } from '../lib/prisma.ts'

// L'action serveur appelle `headers()`, qui n'existe que dans une requête Next : on
// le remplace par des en-têtes choisis par chaque test.
const requete = vi.hoisted(() => ({ entetes: new Headers() }))
vi.mock('next/headers', () => ({
  headers: async () => requete.entetes,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.')
  },
}))

// `redirect`, lui, n'est pas simulé : c'est **la vraie fonction de Next**, celle que
// `next/navigation` réexporte. Elle signale la navigation en levant une erreur
// `NEXT_REDIRECT`, et c'est précisément ce qui compte : un `redirect` déplacé dans le
// `try` d'`inscrire` y serait attrapé et pris pour une panne. Un simulacre qui
// n'enregistre que la cible laisserait ce défaut passer.
vi.mock('next/navigation', async () => {
  const { redirect } = await import('next/dist/client/components/redirect.js')
  return { redirect }
})

/// Attend la fin d'`inscrire` en exigeant une redirection, et rend sa cible. Échoue
/// si l'action rend un état (un refus) ou lève autre chose qu'une redirection.
async function cibleRedirection(promesse: Promise<EtatInscription>): Promise<string> {
  let etat: EtatInscription
  try {
    etat = await promesse
  } catch (erreur) {
    if (!isRedirectError(erreur)) throw erreur
    const cible = getURLFromRedirectError(erreur)
    if (cible === null) throw erreur
    return cible
  }
  throw new Error(`Redirection attendue, état rendu à la place : ${JSON.stringify(etat)}`)
}

/// Charge la zod **que résout better-auth**, celle dont `z.email()` refuse
/// l'inscription — pas une autre copie qu'on aurait pu installer à côté.
function zodDeBetterAuth(): { email(): { safeParse(valeur: unknown): { success: boolean } } } {
  const depuisLeProjet = createRequire(import.meta.url)
  const depuisBetterAuth = createRequire(depuisLeProjet.resolve('better-auth'))
  return depuisBetterAuth('zod')
}

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

describe('forme de l’adresse e-mail, alignée sur Better Auth', () => {
  // Trois adresses que l'ancienne règle acceptait et que Better Auth refuse : leur
  // inscription finissait en « La création du compte a échoué. Réessayez », qu'aucun
  // nouvel essai ne pouvait corriger.
  it.each(['élodie.martin@exemple.fr', 'jean..d@exemple.fr', 'a@b.c'])(
    'refuse %s à côté du champ',
    (email) => {
      const resultat = validerInscription({ ...VALIDE, email })
      expect(resultat).toEqual({ valide: false, erreurs: { email: EMAIL_INVALIDE } })
    },
  )

  // Adresses limites, des deux côtés de la règle. La liste ne prouve rien par
  // elle-même : c'est la comparaison au verdict de `z.email()` qui compte.
  const LIMITES = [
    'ines.moreau@exemple.fr',
    'prenom+tri@exemple.fr',
    "o'neil@exemple.ie",
    'a_b-c@sous.domaine-x.exemple.fr',
    'x@exemple.co',
    '1@2.fr',
    'élodie.martin@exemple.fr',
    'jean..d@exemple.fr',
    '.jean@exemple.fr',
    'jean.@exemple.fr',
    'jean-@exemple.fr',
    'a@b.c',
    'a@b',
    'a@-b.fr',
    'a@b-.fr',
    'a@b..fr',
    'a@b.f1',
    'a@xn--bcher-kva.fr',
    'a@exemple.fr.',
    'a b@exemple.fr',
    'a@@exemple.fr',
    'a@exemple.français',
    'pas-une-adresse',
  ]

  it.each(LIMITES)('rend le même verdict que Better Auth pour %j', (email) => {
    // Comparaison sur la forme que l'action transmet réellement : normalisée.
    const normalisee = email.trim().toLowerCase()
    const selonBetterAuth = zodDeBetterAuth().email().safeParse(normalisee).success
    expect(erreurChamp('email', email) === undefined).toBe(selonBetterAuth)
  })

  it('la liste couvre les deux verdicts', () => {
    // Sans cette garde, une liste entièrement refusée des deux côtés passerait.
    const verdicts = new Set(LIMITES.map((email) => erreurChamp('email', email) === undefined))
    expect(verdicts).toEqual(new Set([true, false]))
  })

  it('applique la même règle à la connexion', () => {
    expect(validerConnexion({ email: 'élodie.martin@exemple.fr', motDePasse: 'x' })).toEqual({
      valide: false,
      erreurs: { email: EMAIL_INVALIDE },
    })
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
    requete.entetes = new Headers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Un `inscrire` qui redirige lève l'erreur de Next : les tests qui attendent un refus
  // font `await inscrire(…)` directement, et échoueraient sur cette exception si une
  // redirection avait lieu. C'est ce qui remplace l'ancien « aucune redirection
  // enregistrée ».

  it('limite le nombre d’inscriptions depuis une même origine', async () => {
    // Sans limite, l'inscription — qui dit si une adresse est prise — permettrait de
    // tester une liste d'adresses à la chaîne. Une origine dédiée à ce test, lue
    // parce qu'un proxy est déclaré.
    vi.stubEnv('CONFIANCE_PROXY', '1')
    requete.entetes = new Headers({ 'x-forwarded-for': '198.51.100.99' })
    const { maximum } = REGLES.inscriptionParIp
    for (let i = 0; i < maximum; i += 1) {
      const cible = await cibleRedirection(
        inscrire(ETAT_INITIAL, formulaire({ ...VALIDE, email: `serie-${i}@exemple.fr` })),
      )
      expect(cible, `inscription ${i + 1}`).toBe('/inscription/confirmee')
    }

    const refus = await inscrire(ETAT_INITIAL, formulaire({ ...VALIDE, email: 'de-trop@exemple.fr' }))
    expect(refus.erreurGenerale).toBe('Trop de tentatives. Réessayez dans 60 minutes.')
    expect(await prisma().user.count({ where: { email: 'de-trop@exemple.fr' } })).toBe(0)
  }, 60_000)

  it('crée un compte CLIENT même quand le formulaire poste role=CHAUFFEUR', async () => {
    // Le critère de la story 2.1, au mot près : on poste le rôle, on lit ce qui est
    // enregistré.
    const cible = await cibleRedirection(
      inscrire(ETAT_INITIAL, formulaire({ ...VALIDE, role: 'CHAUFFEUR' })),
    )
    expect(cible).toBe('/inscription/confirmee')

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
    expect(await prisma().user.count({ where: { email: 'ines.moreau@exemple.fr' } })).toBe(1)
  })

  it('ne crée qu’un compte quand deux inscriptions de la même adresse se croisent', async () => {
    // Better Auth vérifie l'adresse, puis crée : entre les deux, l'autre requête peut
    // passer. La contrainte d'unicité de la base tranche ; le perdant doit lire le
    // même message que pour une adresse déjà prise, pas une panne générique.
    const donnees = { ...VALIDE, email: 'simultane@exemple.fr' }
    const issues = await Promise.allSettled([
      inscrire(ETAT_INITIAL, formulaire(donnees)),
      inscrire(ETAT_INITIAL, formulaire(donnees)),
    ])

    expect(await prisma().user.count({ where: { email: 'simultane@exemple.fr' } })).toBe(1)

    // L'une redirige — par la vraie erreur de Next —, l'autre rend un refus.
    const redirigees = issues.filter((issue) => issue.status === 'rejected')
    expect(redirigees).toHaveLength(1)
    const raison: unknown = redirigees[0]?.reason
    expect(isRedirectError(raison) && getURLFromRedirectError(raison)).toBe(
      '/inscription/confirmee',
    )
    const refus = issues.filter((issue) => issue.status === 'fulfilled')
    expect(refus).toHaveLength(1)
    expect(refus[0]?.value.erreurs).toEqual({
      email: 'Un compte existe déjà avec cette adresse e-mail.',
    })
  })

  it('refuse un mot de passe trop court sans rien créer', async () => {
    const etat = await inscrire(
      ETAT_INITIAL,
      formulaire({ ...VALIDE, email: 'court@exemple.fr', motDePasse: '1234567' }),
    )

    expect(etat.erreurs.motDePasse).toMatch(/au moins 8 caractères/)
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

  it('rend l’erreur à côté du champ si Better Auth refuse une adresse que nous acceptons', async () => {
    // Filet pour une divergence future (montée de zod ou de Better Auth) : notre
    // validation suit la règle actuelle, donc on simule le refus de la brique. Il ne
    // doit ni tomber dans la panne générique, ni rien créer.
    const signUpEmail = vi
      .spyOn(auth().api, 'signUpEmail')
      .mockRejectedValueOnce(
        new APIError('BAD_REQUEST', { code: 'INVALID_EMAIL', message: 'Invalid email' }),
      )
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})

    const etat = await inscrire(
      ETAT_INITIAL,
      formulaire({ ...VALIDE, email: 'divergente@exemple.fr' }),
    )

    expect(signUpEmail).toHaveBeenCalledOnce()
    expect(etat.erreurs).toEqual({ email: EMAIL_INVALIDE })
    expect(etat.erreurGenerale).toBeUndefined()
    // Journalisé : une divergence doit se voir côté serveur.
    expect(journal).toHaveBeenCalledOnce()
    expect(await prisma().user.count({ where: { email: 'divergente@exemple.fr' } })).toBe(0)
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
