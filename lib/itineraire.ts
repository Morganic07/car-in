/// Distance et durée d'un trajet en voiture, par openrouteservice (story 3.2).
///
/// **Côté serveur uniquement** : l'appel porte la clé `ORS_API_KEY`, qui ne doit
/// jamais partir dans le navigateur. Ce module n'est importé que par des actions
/// serveur et par `lib/tarif.ts`, lui-même réservé au serveur.

import type { Adresse } from './adresse.ts'

export const URL_ITINERAIRE = 'https://api.openrouteservice.org/v2/directions/driving-car'
/// Au-delà, on renonce : le client attend son estimation, pas le service.
export const DELAI_ITINERAIRE_MS = 5000

export type Itineraire = {
  readonly distanceM: number
  readonly dureeS: number
}

export class ItineraireIndisponible extends Error {
  override name = 'ItineraireIndisponible'
}

type Recuperer = (url: string, options: RequestInit) => Promise<Response>

function positif(valeur: unknown): valeur is number {
  return typeof valeur === 'number' && Number.isFinite(valeur) && valeur >= 0
}

/// Lit la réponse du service. Toute forme inattendue est une panne : en tirer une
/// distance approchée serait inventer un prix (S11).
export function lireItineraire(reponse: unknown): Itineraire {
  const routes = (reponse as { routes?: unknown } | null)?.routes
  const resume = Array.isArray(routes)
    ? (routes[0] as { summary?: { distance?: unknown; duration?: unknown } } | undefined)?.summary
    : undefined
  // Pour un départ égal à l'arrivée, le service rend un résumé vide : c'est aussi une
  // absence d'estimation, pas un trajet de zéro mètre.
  if (!positif(resume?.distance) || !positif(resume?.duration)) {
    throw new ItineraireIndisponible('Itinéraire sans distance ni durée exploitables.')
  }
  return { distanceM: Math.round(resume.distance), dureeS: Math.round(resume.duration) }
}

export async function calculerItineraire(
  depart: Adresse,
  arrivee: Adresse,
  {
    cle,
    recuperer = fetch,
    delaiMs = DELAI_ITINERAIRE_MS,
  }: { cle: string | undefined; recuperer?: Recuperer; delaiMs?: number },
): Promise<Itineraire> {
  if (cle === undefined || cle.trim() === '') {
    throw new ItineraireIndisponible('Clé ORS_API_KEY absente.')
  }
  let reponse: Response
  try {
    reponse = await recuperer(URL_ITINERAIRE, {
      method: 'POST',
      headers: { Authorization: cle.trim(), 'Content-Type': 'application/json' },
      // L'ordre GeoJSON : longitude, puis latitude.
      body: JSON.stringify({
        coordinates: [
          [depart.lon, depart.lat],
          [arrivee.lon, arrivee.lat],
        ],
      }),
      signal: AbortSignal.timeout(delaiMs),
    })
  } catch (erreur) {
    throw new ItineraireIndisponible('Service d’itinéraire injoignable.', { cause: erreur })
  }
  if (!reponse.ok) {
    throw new ItineraireIndisponible(`Service d’itinéraire : réponse ${reponse.status}.`)
  }
  let corps: unknown
  try {
    corps = await reponse.json()
  } catch (erreur) {
    throw new ItineraireIndisponible('Réponse du service d’itinéraire illisible.', { cause: erreur })
  }
  return lireItineraire(corps)
}
