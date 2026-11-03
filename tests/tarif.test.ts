import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Adresse } from '../lib/adresse.ts'
import {
  ItineraireIndisponible,
  URL_ITINERAIRE,
  calculerItineraire,
  lireItineraire,
} from '../lib/itineraire.ts'
import {
  ESTIMATION_INDISPONIBLE,
  calculerPrixCents,
  estimer,
  eurosEnCentimes,
  formaterDistance,
  formaterDuree,
  formaterPrix,
  lireGrille,
} from '../lib/tarif.ts'

const AMIENS: Adresse = { label: '8 Boulevard du Port 80000 Amiens', lat: 49.897442, lon: 2.290084 }
const PARIS: Adresse = { label: '10 Rue de Rivoli 75004 Paris', lat: 48.855, lon: 2.36 }

const CLE = 'cle-de-test' // pragma: allowlist secret — clé fictive
const GRILLE_ENV = { TARIF_BASE_EUR: '2.60', TARIF_PAR_KM_EUR: '1,20', TARIF_PAR_MIN_EUR: '0.5' }

/// Réponse d'openrouteservice réduite à ce que le code lit : 136,4 km en 1 h 42.
const REPONSE_ORS = {
  routes: [{ summary: { distance: 136_412.3, duration: 6_118.6 }, geometry: '…' }],
}

function reponseJson(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Les pannes sont journalisées exprès : on les fait taire, et l'on vérifie qu'elles
// ont bien été dites.
let journal: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  journal = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  journal.mockRestore()
})

describe('grille tarifaire', () => {
  it.each([
    ['2.60', 260],
    ['2,60', 260],
    ['2,6', 260],
    ['2', 200],
    [' 0.05 ', 5],
    ['0', 0],
  ])('lit « %s » comme %i centimes', (texte, centimes) => {
    expect(eurosEnCentimes(texte)).toBe(centimes)
  })

  it.each([undefined, '', '  ', '-1', '2.605', 'deux', '2 €', '1e3', '2.'])(
    'refuse « %s » plutôt que d’en tirer un tarif approximatif',
    (texte) => {
      expect(eurosEnCentimes(texte)).toBeNull()
    },
  )

  it('rend la grille complète en centimes', () => {
    expect(lireGrille(GRILLE_ENV)).toEqual({
      complete: true,
      grille: { baseCents: 260, parKmCents: 120, parMinCents: 50 },
    })
  })

  it('nomme les variables manquantes ou mal saisies', () => {
    expect(lireGrille({ TARIF_BASE_EUR: '2.60', TARIF_PAR_KM_EUR: 'abc' })).toEqual({
      complete: false,
      manquantes: ['TARIF_PAR_KM_EUR', 'TARIF_PAR_MIN_EUR'],
    })
  })

  it('calcule base + km × prix au km + minutes × prix à la minute', () => {
    const grille = { baseCents: 260, parKmCents: 120, parMinCents: 50 }
    // 2,60 + 10 × 1,20 + 15 × 0,50 = 22,10 €
    expect(calculerPrixCents({ distanceM: 10_000, dureeS: 900 }, grille)).toBe(2210)
    // Arrondi au centime : 2,60 + 1,2345 × 1,20 + 0 = 4,0814 → 4,08 €
    expect(calculerPrixCents({ distanceM: 1234.5, dureeS: 0 }, grille)).toBe(408)
  })
})

describe('mise en forme française', () => {
  it('écrit le prix en euros, virgule décimale', () => {
    expect(formaterPrix(2210)).toMatch(/^22,10\s€$/)
  })

  it('écrit la distance en mètres sous un kilomètre, en kilomètres au-delà', () => {
    expect(formaterDistance(850)).toBe('850 m')
    expect(formaterDistance(136_412)).toBe('136,4 km')
    expect(formaterDistance(12_000)).toBe('12 km')
  })

  it('écrit la durée en minutes, puis en heures et minutes', () => {
    expect(formaterDuree(20)).toBe('1 min')
    expect(formaterDuree(1080)).toBe('18 min')
    expect(formaterDuree(3600)).toBe('1 h')
    expect(formaterDuree(6119)).toBe('1 h 42')
    expect(formaterDuree(3900)).toBe('1 h 05')
  })
})

describe('itinéraire', () => {
  it('lit distance et durée du premier itinéraire', () => {
    expect(lireItineraire(REPONSE_ORS)).toEqual({ distanceM: 136_412, dureeS: 6_119 })
  })

  it.each([
    ['sans routes', {}],
    ['routes vides', { routes: [] }],
    // Départ égal à l'arrivée : le service rend un résumé vide.
    ['résumé vide', { routes: [{ summary: {} }] }],
    ['distance négative', { routes: [{ summary: { distance: -1, duration: 10 } }] }],
    ['distance en texte', { routes: [{ summary: { distance: '12', duration: 10 } }] }],
  ])('traite une réponse %s comme une panne', (_cas, corps) => {
    expect(() => lireItineraire(corps)).toThrow(ItineraireIndisponible)
  })

  it('appelle le service avec la clé en en-tête et les coordonnées longitude d’abord', async () => {
    const recuperer = vi.fn(async (_url: string, _options: RequestInit) => reponseJson(REPONSE_ORS))
    await calculerItineraire(AMIENS, PARIS, { cle: CLE, recuperer })
    const [url, options] = recuperer.mock.calls[0] ?? []
    expect(url).toBe(URL_ITINERAIRE)
    expect(options?.method).toBe('POST')
    expect(new Headers(options?.headers).get('Authorization')).toBe(CLE)
    expect(JSON.parse(String(options?.body))).toEqual({
      coordinates: [
        [AMIENS.lon, AMIENS.lat],
        [PARIS.lon, PARIS.lat],
      ],
    })
    // Pas de clé dans l'adresse : elle finirait dans les journaux des intermédiaires.
    expect(String(url)).not.toContain(CLE)
  })

  it('n’appelle pas le service sans clé', async () => {
    const recuperer = vi.fn()
    for (const cle of [undefined, '', '   ']) {
      await expect(calculerItineraire(AMIENS, PARIS, { cle, recuperer })).rejects.toBeInstanceOf(
        ItineraireIndisponible,
      )
    }
    expect(recuperer).not.toHaveBeenCalled()
  })

  it('abandonne un service trop lent', async () => {
    const recuperer = (_url: string, { signal }: RequestInit) =>
      new Promise<Response>((_resoudre, rejeter) => {
        signal?.addEventListener('abort', () => rejeter(signal.reason))
      })
    await expect(
      calculerItineraire(AMIENS, PARIS, { cle: CLE, recuperer, delaiMs: 20 }),
    ).rejects.toBeInstanceOf(ItineraireIndisponible)
  })
})

describe('estimation (S11)', () => {
  const env = { ORS_API_KEY: CLE, ...GRILLE_ENV }

  it('rend distance, durée et prix calculé depuis la grille', async () => {
    const recuperer = vi.fn(async () => reponseJson(REPONSE_ORS))
    const estimation = await estimer(AMIENS, PARIS, { env, recuperer })
    // En centimes : 260 + 136,412 × 120 + (6 119 / 60) × 50
    //             = 260 + 16 369,44 + 5 099,17 = 21 728,61 → 21 729, soit 217,29 €.
    expect(estimation).toEqual({
      itineraire: { distanceM: 136_412, dureeS: 6_119 },
      prixCents: 21_729,
    })
  })

  it.each([
    ['réseau coupé', async () => Promise.reject(new TypeError('fetch failed'))],
    ['clé refusée', async () => reponseJson({ error: 'Access to this API has been disallowed' }, 403)],
    ['quota épuisé', async () => reponseJson({ error: 'Rate limit exceeded' }, 429)],
    ['service en panne', async () => reponseJson({ error: 'internal' }, 500)],
    ['réponse illisible', async () => new Response('<html>panne</html>')],
  ])('n’invente ni distance ni prix quand le service échoue : %s', async (_cas, recuperer) => {
    const estimation = await estimer(AMIENS, PARIS, { env, recuperer })
    // Aucune distance de repli — à vol d'oiseau, Amiens-Paris ferait ~115 km — et
    // donc aucun prix : exactement « indisponible ».
    expect(estimation).toEqual(ESTIMATION_INDISPONIBLE)
    expect(estimation).toEqual({ itineraire: null, prixCents: null })
    expect(journal).toHaveBeenCalled()
  })

  it('n’invente rien et n’appelle pas le service quand la clé est absente', async () => {
    const recuperer = vi.fn()
    const estimation = await estimer(AMIENS, PARIS, { env: { ...GRILLE_ENV }, recuperer })
    expect(estimation).toEqual(ESTIMATION_INDISPONIBLE)
    expect(recuperer).not.toHaveBeenCalled()
    expect(journal).toHaveBeenCalled()
  })

  it('montre distance et durée mais aucun prix quand la grille est incomplète', async () => {
    const recuperer = vi.fn(async () => reponseJson(REPONSE_ORS))
    const estimation = await estimer(AMIENS, PARIS, {
      env: { ORS_API_KEY: CLE, TARIF_BASE_EUR: '2.60' },
      recuperer,
    })
    expect(estimation).toEqual({ itineraire: { distanceM: 136_412, dureeS: 6_119 }, prixCents: null })
    expect(String(journal.mock.calls[0]?.[0])).toContain('TARIF_PAR_KM_EUR')
  })
})

// ---------------------------------------------------------------------------
// L'action serveur : garde et limite simulées, éprouvées ailleurs sur une vraie base
// (tests/acces.test.ts, tests/connexion.test.ts).
// ---------------------------------------------------------------------------

const simulation = vi.hoisted(() => ({ permis: true, limiteAtteinte: false, cles: [] as string[] }))
vi.mock('../lib/garde.ts', () => ({
  autoriser: async () =>
    simulation.permis
      ? { permis: true, session: { user: { id: 'demo-client' } } }
      : { permis: false, motif: 'Cette action est réservée aux clients.' },
}))
vi.mock('../lib/limite-debit.ts', async (original) => ({
  ...(await original<typeof import('../lib/limite-debit.ts')>()),
  consommer: async (_client: unknown, cle: string) => {
    simulation.cles.push(cle)
    return simulation.limiteAtteinte ? { permis: false, reessayerDansMs: 1000 } : { permis: true }
  },
}))
vi.mock('../lib/prisma.ts', () => ({ prisma: () => ({}) }))

describe('action estimerTrajet', () => {
  const service = vi.fn(async () => reponseJson(REPONSE_ORS))

  beforeEach(() => {
    simulation.permis = true
    simulation.limiteAtteinte = false
    simulation.cles = []
    service.mockClear()
    vi.stubGlobal('fetch', service)
    vi.stubEnv('ORS_API_KEY', CLE)
    for (const [cle, valeur] of Object.entries(GRILLE_ENV)) vi.stubEnv(cle, valeur)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  async function estimerTrajet(depart: unknown, arrivee: unknown) {
    const actions = await import('../app/(client)/client/reserver/actions.ts')
    return actions.estimerTrajet(depart, arrivee)
  }

  const AUCUNE = { distance: null, duree: null, prix: null }

  it('rend distance, durée et prix mis en forme', async () => {
    const estimation = await estimerTrajet(AMIENS, PARIS)
    expect(estimation.distance).toBe('136,4 km')
    expect(estimation.duree).toBe('1 h 42')
    expect(estimation.prix).toMatch(/^217,29\s€$/)
    expect(simulation.cles).toEqual([
      'estimation:demo-client',
      `estimation:globale:${new Date().toISOString().slice(0, 10)}`,
    ])
  })

  it('compte le plafond commun par jour UTC, le jour du quota du service', async () => {
    const { cleEstimationGlobale } = await import('../lib/limite-debit.ts')
    const soir = Date.UTC(2026, 9, 16, 23, 59)
    const lendemain = Date.UTC(2026, 9, 17, 0, 1)
    expect(cleEstimationGlobale(soir)).toBe('estimation:globale:2026-10-16')
    expect(cleEstimationGlobale(lendemain)).toBe('estimation:globale:2026-10-17')
  })

  it('ne touche pas au plafond commun quand la part du client est épuisée', async () => {
    simulation.limiteAtteinte = true
    expect(await estimerTrajet(AMIENS, PARIS)).toEqual(AUCUNE)
    expect(simulation.cles).toEqual(['estimation:demo-client'])
  })

  it('garde le plafond commun sous le quota quotidien d’openrouteservice', async () => {
    const { REGLES } = await import('../lib/limite-debit.ts')
    // Sous la plus basse des valeurs annoncées pour le quota « directions » (2 000).
    expect(REGLES.estimationGlobale.maximum).toBeLessThan(2000)
    expect(REGLES.estimationGlobale.fenetreMs).toBe(24 * 60 * 60_000)
  })

  it('rend « indisponible » quand le service tombe, sans aucun chiffre (S11)', async () => {
    service.mockImplementation(async () => Promise.reject(new TypeError('fetch failed')))
    expect(await estimerTrajet(AMIENS, PARIS)).toEqual(AUCUNE)
  })

  it('rend « indisponible » sans clé, sans appeler le service (S11)', async () => {
    vi.stubEnv('ORS_API_KEY', '')
    expect(await estimerTrajet(AMIENS, PARIS)).toEqual(AUCUNE)
    expect(service).not.toHaveBeenCalled()
  })

  it.each([
    ['sans coordonnées', { label: 'Paris' }],
    ['coordonnées hors de la Terre', { label: 'Paris', lat: 95, lon: 2 }],
    ['valeur nulle', null],
    ['texte', 'Paris'],
  ])('refuse une adresse forgée (%s) sans appeler le service', async (_cas, depart) => {
    expect(await estimerTrajet(depart, PARIS)).toEqual(AUCUNE)
    expect(service).not.toHaveBeenCalled()
    expect(simulation.cles).toEqual([])
  })

  it('n’appelle plus le service une fois la limite du client atteinte', async () => {
    simulation.limiteAtteinte = true
    expect(await estimerTrajet(AMIENS, PARIS)).toEqual(AUCUNE)
    expect(service).not.toHaveBeenCalled()
  })

  it('refuse un visiteur qui n’est pas client, sans rien consommer', async () => {
    simulation.permis = false
    expect(await estimerTrajet(AMIENS, PARIS)).toEqual(AUCUNE)
    expect(service).not.toHaveBeenCalled()
    expect(simulation.cles).toEqual([])
  })
})
