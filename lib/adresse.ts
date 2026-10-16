/// Adresses : recherche dans la Base Adresse Nationale, choix d'une proposition, et
/// validation côté serveur (story 3.1, scénario S10).
///
/// Le service est l'API Adresse, servie depuis 2025 par la Géoplateforme de l'IGN
/// (`data.geopf.fr/geocodage`) : l'ancienne adresse `api-adresse.data.gouv.fr` est en
/// fin de vie. Même format GeoJSON, sans clé, CORS ouvert — la recherche part donc du
/// navigateur, et la limite de 50 requêtes par seconde s'applique à l'IP de chaque
/// client, pas à celle du serveur.

export const URL_RECHERCHE = 'https://data.geopf.fr/geocodage/search'
export const MIN_CARACTERES = 3
export const DELAI_FRAPPE_MS = 300
export const NOMBRE_PROPOSITIONS = 5
/// Au-delà, le service répond 400 : le champ ne laisse pas taper plus long.
export const LONGUEUR_MAX = 200

/// Une adresse **retenue** : choisie parmi les propositions, donc localisée. Un texte
/// tapé sans choix n'en est pas une — c'est tout l'objet de S10 : le chauffeur ne doit
/// jamais recevoir une adresse qu'aucune carte ne sait situer.
export type Adresse = {
  readonly label: string
  readonly lat: number
  readonly lon: number
}

export class ServiceAdresseIndisponible extends Error {
  override name = 'ServiceAdresseIndisponible'
}

export const MESSAGE_INDISPONIBLE =
  'La recherche d’adresse ne répond pas pour le moment. Réessayez dans un instant.'
export const MESSAGE_NON_CHOISIE = 'Choisissez une adresse dans la liste des propositions.'

export function requeteSuffisante(saisie: string): boolean {
  return saisie.trim().length >= MIN_CARACTERES
}

export function urlRecherche(saisie: string): string {
  const url = new URL(URL_RECHERCHE)
  url.searchParams.set('q', saisie.trim())
  url.searchParams.set('limit', String(NOMBRE_PROPOSITIONS))
  url.searchParams.set('autocomplete', '1')
  return url.toString()
}

function coordonneesValides(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  )
}

/// Lit la réponse GeoJSON du service. Une forme inattendue est une panne, pas une
/// liste vide : se taire ferait croire à l'utilisateur que son adresse n'existe pas.
export function lireReponse(reponse: unknown): Adresse[] {
  const features = (reponse as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) {
    throw new ServiceAdresseIndisponible('Réponse du service d’adresses sans « features ».')
  }
  return features.map((feature: unknown) => {
    const { geometry, properties } = (feature ?? {}) as {
      geometry?: { coordinates?: unknown }
      properties?: { label?: unknown }
    }
    const coordonnees = geometry?.coordinates
    // GeoJSON range la longitude **avant** la latitude.
    const [lon, lat] = Array.isArray(coordonnees) ? coordonnees : []
    const label = properties?.label
    if (typeof label !== 'string' || label.trim() === '' || !coordonneesValides(lat, lon)) {
      throw new ServiceAdresseIndisponible('Proposition d’adresse mal formée.')
    }
    return { label, lat, lon: lon as number }
  })
}

type Recuperer = (url: string, options: { signal?: AbortSignal }) => Promise<Response>

/// Interroge le service. Une requête annulée (frappe suivante) remonte telle quelle,
/// pour que l'appelant l'ignore ; toute autre défaillance devient
/// `ServiceAdresseIndisponible`.
export async function rechercherAdresses(
  saisie: string,
  { signal, recuperer = fetch }: { signal?: AbortSignal; recuperer?: Recuperer } = {},
): Promise<Adresse[]> {
  if (!requeteSuffisante(saisie)) return []
  let reponse: Response
  try {
    reponse = await recuperer(urlRecherche(saisie), { signal })
  } catch (erreur) {
    if (signal?.aborted) throw erreur
    throw new ServiceAdresseIndisponible('Service d’adresses injoignable.', { cause: erreur })
  }
  if (!reponse.ok) {
    throw new ServiceAdresseIndisponible(`Service d’adresses : réponse ${reponse.status}.`)
  }
  let corps: unknown
  try {
    corps = await reponse.json()
  } catch (erreur) {
    if (signal?.aborted) throw erreur
    throw new ServiceAdresseIndisponible('Réponse du service d’adresses illisible.', {
      cause: erreur,
    })
  }
  return lireReponse(corps)
}

// ---------------------------------------------------------------------------
// État du champ : la logique du composant, sans React, pour être testée seule.
// ---------------------------------------------------------------------------

export type StatutRecherche = 'repos' | 'recherche' | 'resultats' | 'aucune' | 'indisponible'

export type EtatSaisie = {
  readonly saisie: string
  readonly retenue: Adresse | null
  readonly propositions: readonly Adresse[]
  readonly ouverte: boolean
  /// Index de la proposition surlignée au clavier, -1 si aucune.
  readonly active: number
  readonly statut: StatutRecherche
}

export type ActionSaisie =
  | { readonly type: 'frappe'; readonly saisie: string }
  | { readonly type: 'resultats'; readonly saisie: string; readonly propositions: readonly Adresse[] }
  | { readonly type: 'panne'; readonly saisie: string }
  | { readonly type: 'deplacer'; readonly sens: 1 | -1 }
  | { readonly type: 'choisir'; readonly index: number }
  | { readonly type: 'fermer' }

export function etatInitial(retenue: Adresse | null = null): EtatSaisie {
  return {
    saisie: retenue?.label ?? '',
    retenue,
    propositions: [],
    ouverte: false,
    active: -1,
    statut: 'repos',
  }
}

export function evoluer(etat: EtatSaisie, action: ActionSaisie): EtatSaisie {
  switch (action.type) {
    case 'frappe':
      // Toute frappe défait le choix précédent : le texte ne correspond plus aux
      // coordonnées retenues.
      return {
        saisie: action.saisie,
        retenue: null,
        propositions: [],
        ouverte: false,
        active: -1,
        statut: requeteSuffisante(action.saisie) ? 'recherche' : 'repos',
      }
    case 'resultats':
      // Une réponse arrivée pour une saisie déjà dépassée est ignorée : sans cela, une
      // réponse lente afficherait les propositions d'un texte qui n'est plus là.
      if (action.saisie !== etat.saisie || etat.statut !== 'recherche') return etat
      return {
        ...etat,
        propositions: action.propositions,
        ouverte: true,
        active: -1,
        statut: action.propositions.length === 0 ? 'aucune' : 'resultats',
      }
    case 'panne':
      if (action.saisie !== etat.saisie || etat.statut !== 'recherche') return etat
      return { ...etat, propositions: [], ouverte: false, active: -1, statut: 'indisponible' }
    case 'deplacer': {
      const nombre = etat.propositions.length
      if (nombre === 0) return etat
      if (!etat.ouverte) {
        return { ...etat, ouverte: true, active: action.sens === 1 ? 0 : nombre - 1 }
      }
      const depart = etat.active === -1 && action.sens === -1 ? 0 : etat.active
      return { ...etat, active: (depart + action.sens + nombre) % nombre }
    }
    case 'choisir': {
      const choisie = etat.ouverte ? etat.propositions[action.index] : undefined
      if (choisie === undefined) return etat
      return {
        saisie: choisie.label,
        retenue: choisie,
        propositions: [],
        ouverte: false,
        active: -1,
        statut: 'repos',
      }
    }
    case 'fermer':
      return { ...etat, ouverte: false, active: -1 }
  }
}

/// Verdict du champ, au `blur` comme à l'envoi. `undefined` : rien à redire.
export function erreurSaisie(
  etat: Pick<EtatSaisie, 'saisie' | 'retenue'>,
  manquante: string,
): string | undefined {
  if (etat.saisie.trim() === '') return manquante
  if (etat.retenue === null || etat.retenue.label !== etat.saisie) return MESSAGE_NON_CHOISIE
  return undefined
}

// ---------------------------------------------------------------------------
// Côté serveur : relire l'adresse envoyée par le formulaire.
// ---------------------------------------------------------------------------

export type ChampAdresse = 'depart' | 'arrivee'

export const ADRESSE_MANQUANTE: Record<ChampAdresse, string> = {
  depart: 'Indiquez l’adresse de départ.',
  arrivee: 'Indiquez l’adresse d’arrivée.',
}

export type LectureAdresse =
  | { readonly valide: true; readonly adresse: Adresse }
  | { readonly valide: false; readonly erreur: string }

function texte(formulaire: FormData, cle: string): string {
  const valeur = formulaire.get(cle)
  return typeof valeur === 'string' ? valeur : ''
}

/// Le serveur ne croit pas le navigateur sur parole : un texte sans coordonnées, ou des
/// coordonnées hors de la Terre, sont refusés comme une adresse non choisie (S10).
/// Le champ visible s'appelle `<champ>`, les trois cachés `<champ>Label`, `<champ>Lat`
/// et `<champ>Lon` ; ils ne sont remplis que lorsqu'une proposition a été choisie.
export function lireAdresse(formulaire: FormData, champ: ChampAdresse): LectureAdresse {
  const saisie = texte(formulaire, champ).trim()
  const label = texte(formulaire, `${champ}Label`).trim()
  const latTexte = texte(formulaire, `${champ}Lat`).trim()
  const lonTexte = texte(formulaire, `${champ}Lon`).trim()

  if (saisie === '' && label === '') return { valide: false, erreur: ADRESSE_MANQUANTE[champ] }

  // `Number('')` vaut 0 : un champ vide doit rester une absence, pas l'île Null.
  const lat = latTexte === '' ? Number.NaN : Number(latTexte)
  const lon = lonTexte === '' ? Number.NaN : Number(lonTexte)
  if (
    label === '' ||
    label.length > LONGUEUR_MAX ||
    label !== saisie ||
    !coordonneesValides(lat, lon)
  ) {
    return { valide: false, erreur: MESSAGE_NON_CHOISIE }
  }
  return { valide: true, adresse: { label, lat, lon } }
}
