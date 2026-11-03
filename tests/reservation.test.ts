import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getURLFromRedirectError } from 'next/dist/client/components/redirect.js'
import { isRedirectError } from 'next/dist/client/components/redirect-error.js'
import { isHTTPAccessFallbackError } from 'next/dist/client/components/http-access-fallback/http-access-fallback.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EtatReservation } from '../app/(client)/client/reserver/actions.ts'
import { MESSAGE_NON_CHOISIE, type Adresse } from '../lib/adresse.ts'
import { prisma } from '../lib/prisma.ts'
import {
  COMMENTAIRE_MAX,
  DELAI_MIN_MS,
  MESSAGES_CONTRAINTES,
  MESSAGES_DEPART,
  formaterDepart,
  heureDeParisEnSaisie,
  lireBagages,
  lireDepart,
  lireHeureDeParis,
  lirePassagers,
  premierDepartEnSaisie,
  validerReservation,
} from '../lib/reservation.ts'
import { semer } from '../prisma/semence.mts'

const CERGY: Adresse = { label: '8 Boulevard du Port 95000 Cergy', lat: 49.031624, lon: 2.062821 }
const AMIENS: Adresse = { label: '8 Boulevard du Port 80000 Amiens', lat: 49.897442, lon: 2.290084 }

function formulaire(valeurs: Record<string, string>): FormData {
  const donnees = new FormData()
  for (const [cle, valeur] of Object.entries(valeurs)) donnees.append(cle, valeur)
  return donnees
}

/// Une heure de départ dans `heures` heures, telle que le champ l'enverrait.
function dans(heures: number): string {
  return heureDeParisEnSaisie(new Date(Date.now() + heures * 60 * 60_000))
}

function saisieComplete(departAt = dans(3)): Record<string, string> {
  return {
    depart: CERGY.label,
    departLabel: CERGY.label,
    departLat: String(CERGY.lat),
    departLon: String(CERGY.lon),
    arrivee: AMIENS.label,
    arriveeLabel: AMIENS.label,
    arriveeLat: String(AMIENS.lat),
    arriveeLon: String(AMIENS.lon),
    departAt,
    passagers: '3',
    bagages: '2',
    siegeEnfant: 'on',
    commentaire: '  Digicode 4521B, sonner chez Besson.  ',
  }
}

// ---------------------------------------------------------------------------
// Heure de départ, à l'heure de Paris.
// ---------------------------------------------------------------------------

describe('heure de Paris', () => {
  it.each([
    ['en hiver, UTC+1', '2026-12-15T14:30', '2026-12-15T13:30:00.000Z'],
    ['en été, UTC+2', '2027-07-01T14:30', '2027-07-01T12:30:00.000Z'],
    ['à minuit', '2027-01-01T00:00', '2026-12-31T23:00:00.000Z'],
    ['avec des secondes nulles', '2026-12-15T14:30:00', '2026-12-15T13:30:00.000Z'],
  ])('lit l’heure saisie comme celle de Paris, %s', (_cas, saisie, attendu) => {
    const lecture = lireHeureDeParis(saisie)
    expect(lecture.valide && lecture.instant.toISOString()).toBe(attendu)
  })

  it('refuse 2 h 30 le jour du passage à l’heure d’été : elle n’existe pas', () => {
    expect(lireHeureDeParis('2027-03-28T02:30')).toEqual({ valide: false, motif: 'inexistante' })
    // Les heures qui l'encadrent existent, elles.
    const avant = lireHeureDeParis('2027-03-28T01:59')
    const apres = lireHeureDeParis('2027-03-28T03:00')
    expect(avant.valide && avant.instant.toISOString()).toBe('2027-03-28T00:59:00.000Z')
    expect(apres.valide && apres.instant.toISOString()).toBe('2027-03-28T01:00:00.000Z')
  })

  it('retient la première des deux 2 h 30 du passage à l’heure d’hiver', () => {
    const lecture = lireHeureDeParis('2026-10-25T02:30')
    // Première occurrence, encore à l'heure d'été (UTC+2).
    expect(lecture.valide && lecture.instant.toISOString()).toBe('2026-10-25T00:30:00.000Z')
  })

  it.each(['', 'demain', '2026-02-31T10:00', '2026-12-15T24:00', '2026-13-01T10:00', '15/12/2026 14:30'])(
    'refuse « %s » comme illisible',
    (saisie) => {
      expect(lireHeureDeParis(saisie)).toEqual({ valide: false, motif: 'illisible' })
    },
  )

  it('ne dépend pas du fuseau de la machine', () => {
    const avant = process.env.TZ
    try {
      for (const fuseau of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = fuseau
        const lecture = lireHeureDeParis('2026-12-15T14:30')
        expect(lecture.valide && lecture.instant.toISOString(), fuseau).toBe('2026-12-15T13:30:00.000Z')
        expect(heureDeParisEnSaisie(new Date('2027-07-01T12:30:00Z')), fuseau).toBe('2027-07-01T14:30')
      }
    } finally {
      if (avant === undefined) delete process.env.TZ
      else process.env.TZ = avant
    }
  })

  it('réécrit un instant comme la valeur du champ, aller et retour', () => {
    for (const saisie of ['2026-12-15T14:30', '2027-07-01T09:05', '2026-10-25T01:59']) {
      const lecture = lireHeureDeParis(saisie)
      expect(lecture.valide && heureDeParisEnSaisie(lecture.instant)).toBe(saisie)
    }
  })

  it('donne une heure au moins comme premier départ permis', () => {
    const maintenant = new Date('2026-12-15T13:30:00Z')
    expect(premierDepartEnSaisie(maintenant)).toBe('2026-12-15T15:30')
  })

  it('formate le départ en français, à l’heure de Paris', () => {
    expect(formaterDepart(new Date('2026-12-15T13:30:00Z'))).toBe('mardi 15 décembre 2026 à 14:30')
  })
})

describe('délai de réservation (S1)', () => {
  const maintenant = new Date('2026-12-15T13:30:00Z') // 14 h 30 à Paris

  it.each([
    ['vide', '', MESSAGES_DEPART.manquant],
    ['passée', '2026-12-15T10:00', MESSAGES_DEPART.tropTot],
    ['dans 59 minutes', '2026-12-15T15:29', MESSAGES_DEPART.tropTot],
    ['dans plus d’un an', '2028-01-01T10:00', MESSAGES_DEPART.tropTard],
    ['illisible', '2026-12-32T10:00', MESSAGES_DEPART.illisible],
    ['inexistante', '2027-03-28T02:30', MESSAGES_DEPART.inexistante],
  ])('refuse une heure %s, avec un message', (_cas, saisie, message) => {
    expect(lireDepart(saisie, maintenant)).toEqual({ valide: false, erreur: message })
  })

  it('accepte une heure exactement une heure plus tard', () => {
    const lecture = lireDepart('2026-12-15T15:30', maintenant)
    expect(lecture.valide && lecture.departAt.getTime() - maintenant.getTime()).toBe(DELAI_MIN_MS)
  })
})

describe('passagers, bagages, commentaire', () => {
  it.each(['1', '6', ' 3 '])('accepte %j passagers', (saisie) => {
    expect(lirePassagers(saisie)).toBe(Number(saisie))
  })

  it.each(['0', '7', '', '1e0', '2.0', '0x2', '3 adultes', '-1'])('refuse %j passagers', (saisie) => {
    expect(lirePassagers(saisie)).toBeNull()
  })

  it('accepte de 0 à 10 bagages, et rien d’autre', () => {
    expect(lireBagages('0')).toBe(0)
    expect(lireBagages('10')).toBe(10)
    expect(lireBagages('11')).toBeNull()
    expect(lireBagages('')).toBeNull()
  })
})

describe('validation du formulaire entier', () => {
  const maintenant = new Date()

  it('rend la réservation, normalisée', () => {
    const saisie = saisieComplete()
    const lecture = lireHeureDeParis(saisie.departAt!)
    expect(validerReservation(formulaire(saisie), maintenant)).toEqual({
      valide: true,
      reservation: {
        depart: CERGY,
        arrivee: AMIENS,
        departAt: lecture.valide ? lecture.instant : null,
        passagers: 3,
        bagages: 2,
        siegeEnfant: true,
        commentaire: 'Digicode 4521B, sonner chez Besson.',
      },
    })
  })

  it('lit une case décochée, qui n’envoie rien, comme « pas de siège enfant »', () => {
    const { siegeEnfant: _absent, ...sans } = saisieComplete()
    const resultat = validerReservation(formulaire(sans), maintenant)
    expect(resultat.valide && resultat.reservation.siegeEnfant).toBe(false)
  })

  it('enregistre un commentaire vide comme une absence', () => {
    const resultat = validerReservation(formulaire({ ...saisieComplete(), commentaire: '   ' }), maintenant)
    expect(resultat.valide && resultat.reservation.commentaire).toBeNull()
  })

  it('compte le commentaire en caractères, comme le client les voit', () => {
    const emojis = '🚕'.repeat(COMMENTAIRE_MAX)
    expect(validerReservation(formulaire({ ...saisieComplete(), commentaire: emojis }), maintenant).valide).toBe(true)
    const resultat = validerReservation(
      formulaire({ ...saisieComplete(), commentaire: `${emojis}x` }),
      maintenant,
    )
    expect(resultat).toEqual({ valide: false, erreurs: { commentaire: MESSAGES_CONTRAINTES.commentaire } })
  })

  it('compte un retour à la ligne pour un caractère, même envoyé en \\r\\n', () => {
    // Le navigateur envoie `\r\n` ; le compteur du client, lui, voit `\n`.
    const lignes = `${'a'.repeat(COMMENTAIRE_MAX - 2)}\r\nb`
    const resultat = validerReservation(formulaire({ ...saisieComplete(), commentaire: lignes }), maintenant)
    expect(resultat.valide && resultat.reservation.commentaire).toBe(`${'a'.repeat(COMMENTAIRE_MAX - 2)}\nb`)
  })

  it('rend toutes les erreurs d’un coup, champ par champ', () => {
    const resultat = validerReservation(formulaire({}), maintenant)
    expect(resultat.valide).toBe(false)
    expect(!resultat.valide && Object.keys(resultat.erreurs).sort()).toEqual(
      ['arrivee', 'bagages', 'depart', 'departAt', 'passagers'].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// L'action et la page de confirmation, sur une vraie base.
// ---------------------------------------------------------------------------

// La garde est simulée : elle est éprouvée sur de vraies sessions dans
// tests/acces.test.ts, et sa présence dans chaque action et chaque page par le test
// de structure du même fichier.
const garde = vi.hoisted(() => ({ clientId: null as string | null }))
vi.mock('../lib/garde.ts', () => ({
  autoriser: async () =>
    garde.clientId === null
      ? { permis: false, motif: 'Cette action est réservée aux clients.' }
      : { permis: true, session: { user: { id: garde.clientId } } },
  exigerEspace: async () => {
    if (garde.clientId === null) throw new Error('exigerEspace appelée sans client')
    return { user: { id: garde.clientId } }
  },
}))

// Les vraies fonctions de Next : `redirect` et `notFound` signalent par une exception,
// et un `redirect` déplacé dans un `try` y serait pris pour une panne.
vi.mock('next/navigation', async () => {
  const { redirect } = await import('next/dist/client/components/redirect.js')
  const { notFound } = await import('next/dist/client/components/not-found.js')
  return { redirect, notFound }
})

/// Réponse d'openrouteservice réduite à ce que le code lit : 136,4 km en 1 h 42.
const REPONSE_ORS = {
  routes: [{ summary: { distance: 136_412.3, duration: 6_118.6 }, geometry: '…' }],
}

async function cibleRedirection(promesse: Promise<EtatReservation>): Promise<string> {
  let etat: EtatReservation
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

describe('sur une vraie base', () => {
  let dossier: string
  const service = vi.fn(
    async () =>
      new Response(JSON.stringify(REPONSE_ORS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  let journal: ReturnType<typeof vi.spyOn>

  async function reserver(valeurs: Record<string, string>) {
    const { reserverCourse } = await import('../app/(client)/client/reserver/actions.ts')
    return reserverCourse({ erreurs: {} }, formulaire(valeurs))
  }

  async function confirmation(id: string): Promise<string> {
    const { default: Page } = await import('../app/(client)/client/reserver/confirmee/[id]/page.tsx')
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }))
  }

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-reservation-'))
    const url = `file:${join(dossier, 'reservation.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
    await semer(prisma(), new Date())
    await prisma().user.create({
      data: { id: 'autre-client', email: 'autre@exemple.fr', nom: 'Autre', telephone: '0600000000' },
    })
  }, 120_000)

  afterAll(async () => {
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  beforeEach(async () => {
    // Chaque test part d'une limite de réservations intacte : sinon les courses créées
    // par les tests précédents finiraient par l'épuiser, selon leur ordre.
    await prisma().limiteDebit.deleteMany({ where: { cle: { startsWith: 'reservation:' } } })
    garde.clientId = 'demo-client'
    service.mockClear()
    service.mockImplementation(
      async () =>
        new Response(JSON.stringify(REPONSE_ORS), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', service)
    vi.stubEnv('ORS_API_KEY', 'cle-de-test') // pragma: allowlist secret — clé fictive
    vi.stubEnv('TARIF_BASE_EUR', '2.60')
    vi.stubEnv('TARIF_PAR_KM_EUR', '1,20')
    vi.stubEnv('TARIF_PAR_MIN_EUR', '0.5')
    journal = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    journal.mockRestore()
  })

  it('crée une course DEMANDEE au nom du client et mène à sa confirmation (S1)', async () => {
    const saisie = saisieComplete()
    const cible = await cibleRedirection(reserver(saisie))

    const id = /^\/client\/reserver\/confirmee\/([^/]+)$/.exec(cible)?.[1]
    expect(id, cible).toBeDefined()
    const course = await prisma().course.findUniqueOrThrow({ where: { id: id! } })
    const heure = lireHeureDeParis(saisie.departAt!)
    expect(course).toMatchObject({
      clientId: 'demo-client',
      chauffeurId: null,
      etat: 'DEMANDEE',
      departLabel: CERGY.label,
      departLat: CERGY.lat,
      departLon: CERGY.lon,
      arriveeLabel: AMIENS.label,
      arriveeLat: AMIENS.lat,
      arriveeLon: AMIENS.lon,
      departAt: heure.valide ? heure.instant : null,
      passagers: 3,
      bagages: 2,
      siegeEnfant: true,
      commentaire: 'Digicode 4521B, sonner chez Besson.',
      distanceM: 136_412,
      dureeS: 6_119,
      prixEstimeCents: 21_729,
    })
  })

  it('ignore ce que le formulaire prétend sur le client, l’état ou le prix', async () => {
    const cible = await cibleRedirection(
      reserver({
        ...saisieComplete(),
        clientId: 'autre-client',
        etat: 'TERMINEE',
        chauffeurId: 'demo-chauffeur-1',
        prixEstimeCents: '1',
      }),
    )
    const id = cible.split('/').at(-1)!
    expect(await prisma().course.findUniqueOrThrow({ where: { id } })).toMatchObject({
      clientId: 'demo-client',
      etat: 'DEMANDEE',
      chauffeurId: null,
      prixEstimeCents: 21_729,
    })
  })

  it('crée la course sans aucun chiffre quand l’itinéraire est indisponible (S11)', async () => {
    service.mockImplementation(async () => Promise.reject(new TypeError('fetch failed')))
    const cible = await cibleRedirection(reserver(saisieComplete()))
    const id = cible.split('/').at(-1)!
    expect(await prisma().course.findUniqueOrThrow({ where: { id } })).toMatchObject({
      etat: 'DEMANDEE',
      distanceM: null,
      dureeS: null,
      prixEstimeCents: null,
    })
    expect(await confirmation(id)).toContain('Prix confirmé par la compagnie')
  })

  it('garde le prix d’une course réservée par un client qui a épuisé sa part d’estimations', async () => {
    // Sa dernière estimation a servi à afficher le prix dans le formulaire : la course
    // ne doit pas être enregistrée sans.
    const cle = 'estimation:demo-client'
    await prisma().limiteDebit.upsert({
      where: { cle },
      create: { cle, tentatives: 60, debutMs: BigInt(Date.now()) },
      update: { tentatives: 60, debutMs: BigInt(Date.now()) },
    })
    try {
      const { estimerTrajet } = await import('../app/(client)/client/reserver/actions.ts')
      expect((await estimerTrajet(CERGY, AMIENS)).prix).toBeNull()

      const cible = await cibleRedirection(reserver(saisieComplete()))
      const id = cible.split('/').at(-1)!
      expect(await prisma().course.findUniqueOrThrow({ where: { id } })).toMatchObject({
        prixEstimeCents: 21_729,
      })
    } finally {
      await prisma().limiteDebit.delete({ where: { cle } })
    }
  })

  it('refuse la réservation au-delà de la limite du client, sans créer ni entamer le plafond commun', async () => {
    const { REGLES, cleEstimationGlobale } = await import('../lib/limite-debit.ts')
    await prisma().limiteDebit.create({
      data: {
        cle: 'reservation:demo-client',
        tentatives: REGLES.reservationParClient.maximum,
        debutMs: BigInt(Date.now()),
      },
    })
    const commun = async () =>
      (await prisma().limiteDebit.findUnique({ where: { cle: cleEstimationGlobale() } }))?.tentatives ?? 0
    const avant = { courses: await prisma().course.count(), commun: await commun() }

    const etat = await reserver(saisieComplete())
    expect(etat.erreurs).toEqual({})
    expect(etat.erreurGenerale).toMatch(/^Vous avez réservé beaucoup de courses en peu de temps\. Réessayez dans 60 minutes, ou appelez la compagnie\.$/)
    expect(await prisma().course.count()).toBe(avant.courses)
    expect(await commun()).toBe(avant.commun)
    expect(service).not.toHaveBeenCalled()

    // Un autre client n'en est pas gêné.
    garde.clientId = 'autre-client'
    await cibleRedirection(reserver(saisieComplete()))
  })

  it('refuse une heure à moins d’une heure, à côté du champ, sans rien créer', async () => {
    const avant = await prisma().course.count()
    expect(await reserver(saisieComplete(dans(0.5)))).toEqual({
      erreurs: { departAt: MESSAGES_DEPART.tropTot },
    })
    expect(await prisma().course.count()).toBe(avant)
    expect(service).not.toHaveBeenCalled()
  })

  it('refuse, champ par champ, une adresse tapée sans choix (S10)', async () => {
    const avant = await prisma().course.count()
    const etat = await reserver({ ...saisieComplete(), arriveeLabel: '', arriveeLat: '', arriveeLon: '' })
    expect(etat).toEqual({ erreurs: { arrivee: MESSAGE_NON_CHOISIE } })
    expect(await prisma().course.count()).toBe(avant)
  })

  it('refuse un visiteur qui n’est pas client, sans rien créer ni estimer', async () => {
    garde.clientId = null
    const avant = await prisma().course.count()
    expect(await reserver(saisieComplete())).toEqual({
      erreurs: {},
      erreurGenerale: 'Cette action est réservée aux clients.',
    })
    expect(await prisma().course.count()).toBe(avant)
    expect(service).not.toHaveBeenCalled()
  })

  it('récapitule tout sur la confirmation, prix compris', async () => {
    const cible = await cibleRedirection(reserver(saisieComplete('2027-07-01T14:30')))
    const page = await confirmation(cible.split('/').at(-1)!)
    for (const attendu of [
      'Course réservée',
      'En attente d’un chauffeur',
      CERGY.label,
      AMIENS.label,
      'jeudi 1 juillet 2027 à 14:30',
      '3 passagers',
      '2 bagages',
      'Digicode 4521B, sonner chez Besson.',
      '136,4 km · 1 h 42',
      'estimés, le compteur fait foi',
    ]) {
      expect(page).toContain(attendu)
    }
    expect(page).toMatch(/217,29\s€/)
    expect(page).toMatch(/Siège enfant<\/dt><dd[^>]*>Oui</)
  })

  it('ne montre jamais la course d’un autre client : page introuvable, en français', async () => {
    const cible = await cibleRedirection(reserver(saisieComplete()))
    garde.clientId = 'autre-client'
    const erreur = await confirmation(cible.split('/').at(-1)!).catch((e: unknown) => e)
    expect(isHTTPAccessFallbackError(erreur)).toBe(true)

    // Sans app/not-found.tsx, Next répond par sa page anglaise.
    const { default: Introuvable } = await import('../app/not-found.tsx')
    expect(renderToStaticMarkup(createElement(Introuvable))).toContain('Page introuvable')
  })

  it('garde les retours à la ligne du commentaire sur la confirmation', async () => {
    const cible = await cibleRedirection(
      reserver({ ...saisieComplete(), commentaire: 'Digicode 4521B.\r\nSonner chez Besson.' }),
    )
    const page = await confirmation(cible.split('/').at(-1)!)
    expect(page).toMatch(/<dd class="[^"]*whitespace-pre-line[^"]*">Digicode 4521B\.\nSonner chez Besson\.<\/dd>/)
  })
})
