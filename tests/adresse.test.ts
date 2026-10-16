import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ADRESSE_MANQUANTE,
  DELAI_FRAPPE_MS,
  MESSAGE_NON_CHOISIE,
  MIN_CARACTERES,
  ServiceAdresseIndisponible,
  URL_RECHERCHE,
  etatInitial,
  evoluer,
  erreurSaisie,
  lireAdresse,
  lireReponse,
  rechercherAdresses,
  urlRecherche,
  type Adresse,
  type EtatSaisie,
} from '../lib/adresse.ts'

// Réponse réelle du service (data.geopf.fr/geocodage, octobre 2026), réduite à deux
// propositions : c'est cette forme que le code doit savoir lire.
const REPONSE_REELLE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.062821, 49.031624] },
      properties: {
        label: '8 Boulevard du Port 95000 Cergy',
        score: 0.49,
        housenumber: '8',
        postcode: '95000',
        city: 'Cergy',
        type: 'housenumber',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.290084, 49.897442] },
      properties: { label: '8 Boulevard du Port 80000 Amiens', type: 'housenumber' },
    },
  ],
  query: '8 bd du port',
}

const CERGY: Adresse = { label: '8 Boulevard du Port 95000 Cergy', lat: 49.031624, lon: 2.062821 }
const AMIENS: Adresse = { label: '8 Boulevard du Port 80000 Amiens', lat: 49.897442, lon: 2.290084 }

function reponseJson(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('constantes du critère', () => {
  it('cherche à partir de trois caractères, 300 ms après la frappe', () => {
    expect(MIN_CARACTERES).toBe(3)
    expect(DELAI_FRAPPE_MS).toBe(300)
  })
})

describe('lecture de la réponse du service', () => {
  it('rend libellé et coordonnées, latitude et longitude dans le bon ordre', () => {
    // GeoJSON range la longitude d'abord : les inverser placerait Cergy dans l'océan
    // Indien.
    expect(lireReponse(REPONSE_REELLE)).toEqual([CERGY, AMIENS])
  })

  it('rend une liste vide quand le service ne trouve rien', () => {
    expect(lireReponse({ type: 'FeatureCollection', features: [] })).toEqual([])
  })

  it.each([
    ['sans features', { type: 'FeatureCollection' }],
    ['nulle', null],
    ['proposition sans libellé', { features: [{ geometry: { coordinates: [2, 49] }, properties: {} }] }],
    ['coordonnées absentes', { features: [{ properties: { label: 'Paris' } }] }],
    [
      'coordonnées hors de la Terre',
      { features: [{ geometry: { coordinates: [200, 49] }, properties: { label: 'Paris' } }] },
    ],
    [
      'coordonnées en texte',
      { features: [{ geometry: { coordinates: ['2', '49'] }, properties: { label: 'Paris' } }] },
    ],
  ])('traite une réponse %s comme une panne, pas comme « aucune adresse »', (_cas, corps) => {
    expect(() => lireReponse(corps)).toThrow(ServiceAdresseIndisponible)
  })
})

describe('recherche', () => {
  it('interroge la Géoplateforme avec la saisie, en mode autocomplétion', () => {
    const url = new URL(urlRecherche('  8 bd du Port  '))
    expect(`${url.origin}${url.pathname}`).toBe(URL_RECHERCHE)
    expect(url.searchParams.get('q')).toBe('8 bd du Port')
    expect(url.searchParams.get('autocomplete')).toBe('1')
    expect(Number(url.searchParams.get('limit'))).toBeGreaterThan(0)
  })

  it('n’interroge pas le service sous trois caractères', async () => {
    const recuperer = vi.fn(async () => reponseJson(REPONSE_REELLE))
    expect(await rechercherAdresses('8b', { recuperer })).toEqual([])
    // Les espaces autour ne comptent pas.
    expect(await rechercherAdresses(' 8b  ', { recuperer })).toEqual([])
    expect(recuperer).not.toHaveBeenCalled()
    // La frontière : trois caractères suffisent.
    await rechercherAdresses('8 b', { recuperer })
    expect(recuperer).toHaveBeenCalledOnce()
  })

  it('rend les propositions du service', async () => {
    const recuperer = vi.fn(async () => reponseJson(REPONSE_REELLE))
    expect(await rechercherAdresses('8 bd du port', { recuperer })).toEqual([CERGY, AMIENS])
    expect(recuperer).toHaveBeenCalledOnce()
  })

  it.each([
    ['réseau coupé', async () => Promise.reject(new TypeError('fetch failed'))],
    ['erreur 503', async () => reponseJson({ message: 'indisponible' }, 503)],
    ['erreur 429', async () => reponseJson({ message: 'trop de requêtes' }, 429)],
    ['corps illisible', async () => new Response('<html>panne</html>', { status: 200 })],
  ])('signale une panne du service : %s', async (_cas, recuperer) => {
    await expect(rechercherAdresses('8 bd du port', { recuperer })).rejects.toBeInstanceOf(
      ServiceAdresseIndisponible,
    )
  })

  it('laisse remonter une annulation telle quelle, pour qu’elle soit ignorée', async () => {
    const controleur = new AbortController()
    const recuperer = vi.fn(async () => {
      controleur.abort()
      throw new DOMException('annulée', 'AbortError')
    })
    const erreur = await rechercherAdresses('8 bd du port', {
      recuperer,
      signal: controleur.signal,
    }).catch((e: unknown) => e)
    expect(erreur).not.toBeInstanceOf(ServiceAdresseIndisponible)
    expect((erreur as DOMException).name).toBe('AbortError')
  })
})

describe('état du champ', () => {
  function apres(...actions: Parameters<typeof evoluer>[1][]): EtatSaisie {
    return actions.reduce(evoluer, etatInitial())
  }

  it('ne lance la recherche qu’à partir de trois caractères', () => {
    expect(apres({ type: 'frappe', saisie: '8b' }).statut).toBe('repos')
    expect(apres({ type: 'frappe', saisie: ' 8b ' }).statut).toBe('repos')
    expect(apres({ type: 'frappe', saisie: '8 b' }).statut).toBe('recherche')
  })

  it('ouvre la liste quand les propositions arrivent', () => {
    const etat = apres(
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'resultats', saisie: '8 bd du port', propositions: [CERGY, AMIENS] },
    )
    expect(etat).toMatchObject({ ouverte: true, statut: 'resultats', active: -1 })
    expect(etat.propositions).toEqual([CERGY, AMIENS])
  })

  it('ignore une réponse arrivée pour une saisie déjà dépassée', () => {
    // La réponse lente de « 8 bd » ne doit pas s'afficher sous « 8 bd du port ».
    const etat = apres(
      { type: 'frappe', saisie: '8 bd' },
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'resultats', saisie: '8 bd', propositions: [AMIENS] },
    )
    expect(etat).toMatchObject({ statut: 'recherche', ouverte: false, propositions: [] })
  })

  it('dit « aucune adresse » quand le service ne trouve rien', () => {
    const etat = apres(
      { type: 'frappe', saisie: 'zzzzzz' },
      { type: 'resultats', saisie: 'zzzzzz', propositions: [] },
    )
    expect(etat.statut).toBe('aucune')
  })

  it('passe en panne sans rien retenir, puis réessaie à la frappe suivante', () => {
    const enPanne = apres(
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'panne', saisie: '8 bd du port' },
    )
    expect(enPanne).toMatchObject({ statut: 'indisponible', retenue: null, ouverte: false })
    expect(evoluer(enPanne, { type: 'frappe', saisie: '8 bd du porta' }).statut).toBe('recherche')
  })

  it('se parcourt au clavier, en boucle, dans les deux sens', () => {
    const ouverte = apres(
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'resultats', saisie: '8 bd du port', propositions: [CERGY, AMIENS] },
    )
    const bas = evoluer(ouverte, { type: 'deplacer', sens: 1 })
    expect(bas.active).toBe(0)
    expect(evoluer(bas, { type: 'deplacer', sens: 1 }).active).toBe(1)
    expect(evoluer(evoluer(bas, { type: 'deplacer', sens: 1 }), { type: 'deplacer', sens: 1 }).active).toBe(0)
    expect(evoluer(ouverte, { type: 'deplacer', sens: -1 }).active).toBe(1)
    expect(evoluer(bas, { type: 'deplacer', sens: -1 }).active).toBe(1)
  })

  it('rouvre la liste fermée à la flèche, sans relancer de recherche', () => {
    const fermee = apres(
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'resultats', saisie: '8 bd du port', propositions: [CERGY, AMIENS] },
      { type: 'fermer' },
    )
    expect(fermee.ouverte).toBe(false)
    expect(evoluer(fermee, { type: 'deplacer', sens: 1 })).toMatchObject({ ouverte: true, active: 0 })
  })

  it('retient l’adresse choisie avec ses coordonnées', () => {
    const etat = apres(
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'resultats', saisie: '8 bd du port', propositions: [CERGY, AMIENS] },
      { type: 'choisir', index: 1 },
    )
    expect(etat).toMatchObject({ retenue: AMIENS, saisie: AMIENS.label, ouverte: false })
    expect(erreurSaisie(etat, ADRESSE_MANQUANTE.depart)).toBeUndefined()
  })

  it('ne choisit rien dans une liste fermée ou hors des bornes', () => {
    const ouverte = apres(
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'resultats', saisie: '8 bd du port', propositions: [CERGY] },
    )
    expect(evoluer(ouverte, { type: 'choisir', index: 3 }).retenue).toBeNull()
    expect(evoluer(evoluer(ouverte, { type: 'fermer' }), { type: 'choisir', index: 0 }).retenue).toBeNull()
  })

  it('défait le choix dès qu’on retape : le texte ne correspond plus aux coordonnées', () => {
    const choisie = apres(
      { type: 'frappe', saisie: '8 bd du port' },
      { type: 'resultats', saisie: '8 bd du port', propositions: [CERGY] },
      { type: 'choisir', index: 0 },
    )
    const retapee = evoluer(choisie, { type: 'frappe', saisie: `${CERGY.label}x` })
    expect(retapee.retenue).toBeNull()
    expect(erreurSaisie(retapee, ADRESSE_MANQUANTE.depart)).toBe(MESSAGE_NON_CHOISIE)
  })
})

describe('verdict du champ (S10)', () => {
  it('demande une adresse quand le champ est vide', () => {
    expect(erreurSaisie({ saisie: '  ', retenue: null }, ADRESSE_MANQUANTE.arrivee)).toBe(
      ADRESSE_MANQUANTE.arrivee,
    )
  })

  it('refuse un texte tapé sans choisir de proposition', () => {
    expect(erreurSaisie({ saisie: '8 bd du port', retenue: null }, ADRESSE_MANQUANTE.depart)).toBe(
      MESSAGE_NON_CHOISIE,
    )
  })
})

describe('lecture côté serveur (S10)', () => {
  function formulaire(valeurs: Record<string, string>): FormData {
    const donnees = new FormData()
    for (const [cle, valeur] of Object.entries(valeurs)) donnees.append(cle, valeur)
    return donnees
  }

  const choisie = {
    depart: CERGY.label,
    departLabel: CERGY.label,
    departLat: String(CERGY.lat),
    departLon: String(CERGY.lon),
  }

  it('accepte une adresse choisie, avec ses coordonnées', () => {
    expect(lireAdresse(formulaire(choisie), 'depart')).toEqual({ valide: true, adresse: CERGY })
  })

  it('refuse un champ vide en demandant l’adresse', () => {
    expect(lireAdresse(formulaire({}), 'arrivee')).toEqual({
      valide: false,
      erreur: ADRESSE_MANQUANTE.arrivee,
    })
  })

  it.each([
    ['texte tapé sans choix', { depart: '8 bd du port' }],
    ['libellé sans coordonnées', { depart: CERGY.label, departLabel: CERGY.label }],
    // `Number('')` vaut 0 : sans garde, deux champs vides deviendraient un point réel.
    ['coordonnées vides', { ...choisie, departLat: '', departLon: '' }],
    ['latitude hors de la Terre', { ...choisie, departLat: '91' }],
    ['longitude non numérique', { ...choisie, departLon: 'est' }],
    ['texte modifié après le choix', { ...choisie, depart: `${CERGY.label} bis` }],
  ])('refuse une adresse non localisée : %s', (_cas, valeurs) => {
    expect(lireAdresse(formulaire(valeurs), 'depart')).toEqual({
      valide: false,
      erreur: MESSAGE_NON_CHOISIE,
    })
  })
})

// L'action, avec une garde simulée : la garde elle-même est éprouvée sur de vraies
// sessions dans tests/acces.test.ts, et sa présence par le test de structure.
const garde = vi.hoisted(() => ({ permis: true }))
vi.mock('../lib/garde.ts', () => ({
  autoriser: async () =>
    garde.permis
      ? { permis: true, session: {} }
      : { permis: false, motif: 'Cette action est réservée aux clients.' },
}))

describe('action verifierTrajet', () => {
  beforeEach(() => {
    garde.permis = true
  })

  async function verifier(valeurs: Record<string, string>) {
    const { verifierTrajet } = await import('../app/(client)/client/reserver/actions.ts')
    const donnees = new FormData()
    for (const [cle, valeur] of Object.entries(valeurs)) donnees.append(cle, valeur)
    return verifierTrajet({ erreurs: {} }, donnees)
  }

  const trajet = {
    depart: CERGY.label,
    departLabel: CERGY.label,
    departLat: String(CERGY.lat),
    departLon: String(CERGY.lon),
    arrivee: AMIENS.label,
    arriveeLabel: AMIENS.label,
    arriveeLat: String(AMIENS.lat),
    arriveeLon: String(AMIENS.lon),
  }

  it('retient deux adresses localisées', async () => {
    expect(await verifier(trajet)).toEqual({
      erreurs: {},
      trajet: { depart: CERGY, arrivee: AMIENS },
    })
  })

  it('refuse, champ par champ, une adresse tapée sans choix', async () => {
    const etat = await verifier({ ...trajet, arriveeLabel: '', arriveeLat: '', arriveeLon: '' })
    expect(etat).toEqual({ erreurs: { arrivee: MESSAGE_NON_CHOISIE } })
  })

  it('refuse un visiteur qui n’est pas client, sans rien lire', async () => {
    garde.permis = false
    expect(await verifier(trajet)).toEqual({
      erreurs: {},
      erreurGenerale: 'Cette action est réservée aux clients.',
    })
  })
})
