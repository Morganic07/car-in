/// Grille tarifaire et estimation du prix d'une course (story 3.2, scénario S11).
///
/// Prix estimé = base + km × prix au km + minutes × prix à la minute, d'après la
/// grille lue dans l'environnement (`.env.example`). Quand la grille ou l'itinéraire
/// manque, **aucun prix n'est inventé** : l'écran affiche « prix confirmé par la
/// compagnie », et la réservation reste possible.

import type { Adresse } from './adresse.ts'
import { calculerItineraire, type Itineraire } from './itineraire.ts'

/// Montants en centimes : des euros en virgule flottante finissent en 24,499999 €.
export type Grille = {
  readonly baseCents: number
  readonly parKmCents: number
  readonly parMinCents: number
}

export const VARIABLES_GRILLE = {
  baseCents: 'TARIF_BASE_EUR',
  parKmCents: 'TARIF_PAR_KM_EUR',
  parMinCents: 'TARIF_PAR_MIN_EUR',
} as const

/// « 2.60 », « 2,60 » ou « 2 » → 260. Rien d'autre : une valeur mal saisie dans
/// l'environnement ne doit pas devenir un tarif approximatif.
export function eurosEnCentimes(texte: string | undefined): number | null {
  const valeur = texte?.trim() ?? ''
  const forme = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(valeur)
  if (forme === null) return null
  const [, euros = '0', centimes = ''] = forme
  return Number(euros) * 100 + Number(centimes.padEnd(2, '0'))
}

export type LectureGrille =
  | { readonly complete: true; readonly grille: Grille }
  | { readonly complete: false; readonly manquantes: readonly string[] }

export function lireGrille(env: Record<string, string | undefined>): LectureGrille {
  const manquantes: string[] = []
  const valeurs: Partial<Record<keyof Grille, number>> = {}
  for (const [champ, variable] of Object.entries(VARIABLES_GRILLE) as [keyof Grille, string][]) {
    const centimes = eurosEnCentimes(env[variable])
    if (centimes === null) manquantes.push(variable)
    else valeurs[champ] = centimes
  }
  if (manquantes.length > 0) return { complete: false, manquantes }
  return { complete: true, grille: valeurs as Grille }
}

export function calculerPrixCents({ distanceM, dureeS }: Itineraire, grille: Grille): number {
  return Math.round(
    grille.baseCents + (distanceM / 1000) * grille.parKmCents + (dureeS / 60) * grille.parMinCents,
  )
}

/// Ce que l'écran affiche. `null` partout où l'information manque — jamais une valeur
/// de repli.
export type Estimation = {
  readonly itineraire: Itineraire | null
  readonly prixCents: number | null
}

export const ESTIMATION_INDISPONIBLE: Estimation = { itineraire: null, prixCents: null }

export async function estimer(
  depart: Adresse,
  arrivee: Adresse,
  {
    env = process.env,
    recuperer,
  }: {
    env?: Record<string, string | undefined>
    recuperer?: Parameters<typeof calculerItineraire>[2]['recuperer']
  } = {},
): Promise<Estimation> {
  let itineraire: Itineraire
  try {
    itineraire = await calculerItineraire(depart, arrivee, { cle: env.ORS_API_KEY, recuperer })
  } catch (erreur) {
    // Journalisé, pas avalé : l'écran dit « prix confirmé », la trace dit pourquoi.
    console.error('Estimation indisponible :', erreur)
    return ESTIMATION_INDISPONIBLE
  }

  const grille = lireGrille(env)
  if (!grille.complete) {
    console.error(`Estimation sans prix : grille incomplète (${grille.manquantes.join(', ')}).`)
    return { itineraire, prixCents: null }
  }
  return { itineraire, prixCents: calculerPrixCents(itineraire, grille.grille) }
}

// ---------------------------------------------------------------------------
// Affichage, en français.
// ---------------------------------------------------------------------------

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const KILOMETRES = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })

export function formaterPrix(cents: number): string {
  return EUROS.format(cents / 100)
}

export function formaterDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${KILOMETRES.format(metres / 1000)} km`
}

export function formaterDuree(secondes: number): string {
  const minutes = Math.max(1, Math.round(secondes / 60))
  if (minutes < 60) return `${minutes} min`
  const heures = Math.floor(minutes / 60)
  const reste = minutes % 60
  return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, '0')}`
}
