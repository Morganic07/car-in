/// Formulaire de réservation : lecture et validation de ce que le client envoie
/// (story 3.3, scénario S1). Sans dépendance à Next ni à la base, pour se tester seul
/// et servir aussi bien au navigateur (verdict au `blur`) qu'à l'action serveur, qui
/// revalide tout.

import { lireAdresse, type Adresse, type ChampAdresse } from './adresse.ts'

// ---------------------------------------------------------------------------
// Heure de départ, en heure de Paris.
// ---------------------------------------------------------------------------

/// La compagnie opère en France : l'heure saisie est celle de Paris, quel que soit le
/// fuseau de la machine qui fait tourner le serveur. Lue comme une heure UTC, une
/// course de 14 h partirait à 15 h ou 16 h selon la saison.
export const FUSEAU = 'Europe/Paris'

/// Une course se réserve au moins une heure à l'avance (S1).
export const DELAI_MIN_MS = 60 * 60_000
/// Au-delà d'un an, c'est une faute de frappe sur l'année, pas une réservation.
export const HORIZON_MAX_MS = 366 * 24 * 60 * 60_000

const PARTIES = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSEAU,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

type HeureMurale = {
  readonly annee: number
  readonly mois: number
  readonly jour: number
  readonly heure: number
  readonly minute: number
}

function heureMurale(instant: number): HeureMurale {
  const valeurs = Object.fromEntries(
    PARTIES.formatToParts(new Date(instant)).map((partie) => [partie.type, Number(partie.value)]),
  )
  return {
    annee: valeurs.year ?? Number.NaN,
    mois: valeurs.month ?? Number.NaN,
    jour: valeurs.day ?? Number.NaN,
    heure: valeurs.hour ?? Number.NaN,
    minute: valeurs.minute ?? Number.NaN,
  }
}

function commeSiUtc({ annee, mois, jour, heure, minute }: HeureMurale): number {
  return Date.UTC(annee, mois - 1, jour, heure, minute)
}

/// Décalage de Paris sur UTC à un instant donné, en millisecondes (+1 h ou +2 h).
function decalageMs(instant: number): number {
  const auMinutePres = instant - (((instant % 60_000) + 60_000) % 60_000)
  return commeSiUtc(heureMurale(auMinutePres)) - auMinutePres
}

const FORME_SAISIE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/

export type LectureHeure =
  | { readonly valide: true; readonly instant: Date }
  | { readonly valide: false; readonly motif: 'illisible' | 'inexistante' }

/// « 2026-11-03T14:30 », la valeur d'un champ `datetime-local`, lue comme une heure de
/// Paris.
///
/// Deux cas que le changement d'heure rend réels : à 2 h 30 le dernier dimanche de
/// mars, l'heure **n'existe pas** — refusée, plutôt que décalée en silence ; à 2 h 30
/// le dernier dimanche d'octobre, elle existe **deux fois** — la première est retenue,
/// un chauffeur en avance valant mieux qu'un chauffeur en retard.
export function lireHeureDeParis(saisie: string): LectureHeure {
  const forme = FORME_SAISIE.exec(saisie.trim())
  if (forme === null) return { valide: false, motif: 'illisible' }
  const [annee, mois, jour, heure, minute] = forme.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const voulue: HeureMurale = { annee, mois, jour, heure, minute }
  const mur = commeSiUtc(voulue)

  // `Date.UTC` accepte le 31 février et le reporte au 3 mars : on refuse ce qu'il a
  // dû corriger.
  const relue = new Date(mur)
  if (
    relue.getUTCFullYear() !== annee ||
    relue.getUTCMonth() !== mois - 1 ||
    relue.getUTCDate() !== jour ||
    relue.getUTCHours() !== heure ||
    relue.getUTCMinutes() !== minute
  ) {
    return { valide: false, motif: 'illisible' }
  }

  // Les décalages possibles sont ceux de la veille et du lendemain : Paris ne change
  // jamais deux fois d'heure en deux jours. Un candidat n'est retenu que si, relu à
  // Paris, il redonne exactement l'heure voulue.
  const candidats = [...new Set([decalageMs(mur - 86_400_000), decalageMs(mur + 86_400_000)])]
    .map((decalage) => mur - decalage)
    .filter((instant) => commeSiUtc(heureMurale(instant)) === mur)
    .sort((a, b) => a - b)

  const premier = candidats[0]
  if (premier === undefined) return { valide: false, motif: 'inexistante' }
  return { valide: true, instant: new Date(premier) }
}

/// L'inverse : un instant écrit comme la valeur d'un champ `datetime-local`, à Paris.
export function heureDeParisEnSaisie(instant: Date): string {
  const { annee, mois, jour, heure, minute } = heureMurale(instant.getTime())
  const deux = (n: number) => String(n).padStart(2, '0')
  return `${annee}-${deux(mois)}-${deux(jour)}T${deux(heure)}:${deux(minute)}`
}

/// Le départ le plus proche permis, comme valeur `min` d'un champ `datetime-local`.
export function premierDepartEnSaisie(maintenant: Date = new Date()): string {
  return heureDeParisEnSaisie(new Date(maintenant.getTime() + DELAI_MIN_MS))
}

const FORMAT_DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: FUSEAU,
})

/// « mardi 3 novembre 2026 à 14:30 », à l'heure de Paris.
export function formaterDepart(instant: Date): string {
  return FORMAT_DATE_LONGUE.format(instant)
}

export const MESSAGES_DEPART = {
  manquant: 'Indiquez la date et l’heure de départ.',
  illisible: 'Cette date n’est pas valide. Choisissez une date et une heure.',
  inexistante:
    'Cette heure n’existe pas ce jour-là, à cause du passage à l’heure d’été. Choisissez une autre heure.',
  tropTot: 'Réservez au moins une heure à l’avance. Pour un départ plus proche, appelez la compagnie.',
  tropTard: 'Les réservations ouvrent un an à l’avance au plus. Vérifiez l’année.',
} as const

export type LectureDepart =
  | { readonly valide: true; readonly departAt: Date }
  | { readonly valide: false; readonly erreur: string }

/// Verdict sur l'heure de départ, au `blur` comme à l'envoi. `maintenant` est passé
/// par l'appelant : le serveur juge sur son horloge, pas sur celle du navigateur.
export function lireDepart(saisie: string, maintenant: Date): LectureDepart {
  if (saisie.trim() === '') return { valide: false, erreur: MESSAGES_DEPART.manquant }
  const lecture = lireHeureDeParis(saisie)
  if (!lecture.valide) return { valide: false, erreur: MESSAGES_DEPART[lecture.motif] }
  const avance = lecture.instant.getTime() - maintenant.getTime()
  if (avance < DELAI_MIN_MS) return { valide: false, erreur: MESSAGES_DEPART.tropTot }
  if (avance > HORIZON_MAX_MS) return { valide: false, erreur: MESSAGES_DEPART.tropTard }
  return { valide: true, departAt: lecture.instant }
}

// ---------------------------------------------------------------------------
// Passagers, bagages, siège enfant, commentaire.
// ---------------------------------------------------------------------------

export const PASSAGERS_MIN = 1
export const PASSAGERS_MAX = 6
export const BAGAGES_MAX = 10
export const COMMENTAIRE_MAX = 500

export const MESSAGES_CONTRAINTES = {
  passagers: `Indiquez un nombre de passagers entre ${PASSAGERS_MIN} et ${PASSAGERS_MAX}.`,
  bagages: `Indiquez un nombre de bagages entre 0 et ${BAGAGES_MAX}.`,
  commentaire: `Le commentaire ne peut pas dépasser ${COMMENTAIRE_MAX} caractères.`,
} as const

/// Un entier écrit en chiffres, et rien d'autre : `Number` lirait « 1e1 », « 0x2 » ou
/// « 2.0 », et `parseInt` « 3 valises ».
function entierEntre(saisie: string, min: number, max: number): number | null {
  const texte = saisie.trim()
  if (!/^\d{1,3}$/.test(texte)) return null
  const valeur = Number(texte)
  return valeur >= min && valeur <= max ? valeur : null
}

export function lirePassagers(saisie: string): number | null {
  return entierEntre(saisie, PASSAGERS_MIN, PASSAGERS_MAX)
}

export function lireBagages(saisie: string): number | null {
  return entierEntre(saisie, 0, BAGAGES_MAX)
}

/// Longueur comptée en caractères, pas en unités UTF-16 : un émoji compte pour un,
/// comme le client le voit.
export function longueurCommentaire(saisie: string): number {
  return [...saisie.trim()].length
}

// ---------------------------------------------------------------------------
// Le formulaire entier, côté serveur.
// ---------------------------------------------------------------------------

export type ChampReservation = ChampAdresse | 'departAt' | 'passagers' | 'bagages' | 'commentaire'

export type Reservation = {
  readonly depart: Adresse
  readonly arrivee: Adresse
  readonly departAt: Date
  readonly passagers: number
  readonly bagages: number
  readonly siegeEnfant: boolean
  /// `null` plutôt qu'une chaîne vide : rien à lire pour le chauffeur.
  readonly commentaire: string | null
}

export type ValidationReservation =
  | { readonly valide: true; readonly reservation: Reservation }
  | { readonly valide: false; readonly erreurs: Partial<Record<ChampReservation, string>> }

function texte(formulaire: FormData, cle: string): string {
  const valeur = formulaire.get(cle)
  return typeof valeur === 'string' ? valeur : ''
}

/// Relit tout le formulaire et rend toutes les erreurs d'un coup, champ par champ.
/// Rien de ce que le navigateur a déjà vérifié n'est cru sur parole.
export function validerReservation(formulaire: FormData, maintenant: Date): ValidationReservation {
  const erreurs: Partial<Record<ChampReservation, string>> = {}

  const depart = lireAdresse(formulaire, 'depart')
  if (!depart.valide) erreurs.depart = depart.erreur
  const arrivee = lireAdresse(formulaire, 'arrivee')
  if (!arrivee.valide) erreurs.arrivee = arrivee.erreur

  const heure = lireDepart(texte(formulaire, 'departAt'), maintenant)
  if (!heure.valide) erreurs.departAt = heure.erreur

  const passagers = lirePassagers(texte(formulaire, 'passagers'))
  if (passagers === null) erreurs.passagers = MESSAGES_CONTRAINTES.passagers
  const bagages = lireBagages(texte(formulaire, 'bagages'))
  if (bagages === null) erreurs.bagages = MESSAGES_CONTRAINTES.bagages

  // Un envoi multipart écrit chaque retour à la ligne `\r\n` : ramené à `\n`, il pèse
  // un caractère, comme dans le compteur que le client a sous les yeux.
  const commentaire = texte(formulaire, 'commentaire').replace(/\r\n?/g, '\n').trim()
  if (longueurCommentaire(commentaire) > COMMENTAIRE_MAX) {
    erreurs.commentaire = MESSAGES_CONTRAINTES.commentaire
  }

  if (
    !depart.valide ||
    !arrivee.valide ||
    !heure.valide ||
    passagers === null ||
    bagages === null ||
    erreurs.commentaire !== undefined
  ) {
    return { valide: false, erreurs }
  }

  return {
    valide: true,
    reservation: {
      depart: depart.adresse,
      arrivee: arrivee.adresse,
      departAt: heure.departAt,
      passagers,
      bagages,
      // Une case cochée envoie « on » ; décochée, elle n'envoie rien du tout.
      siegeEnfant: formulaire.get('siegeEnfant') === 'on',
      commentaire: commentaire === '' ? null : commentaire,
    },
  }
}
