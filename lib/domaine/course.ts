/// Machine à états d'une course.
///
/// Aucune dépendance à la base, et aucun accès au réseau : ce module dit ce qui est
/// **permis**, il n'écrit rien. C'est volontaire et ce n'est pas suffisant — la
/// garantie que l'état lu est encore l'état réel au moment de l'écriture vient de la
/// condition portée dans la requête (`PLAN.md` §4). Les deux sont nécessaires : cette
/// machine seule validerait une décision prise sur une information périmée.
///
/// Les appelants côté serveur lisent `origines`, `propriete`, `horodatage` et
/// `remiseANul` pour construire leur écriture conditionnée. Ces données vivent ici et
/// nulle part ailleurs : dupliquer la table dans les actions serveur rouvrirait la
/// porte à deux règles divergentes.

export const ETATS = ['DEMANDEE', 'ACCEPTEE', 'EN_COURSE', 'TERMINEE', 'ANNULEE'] as const
export type Etat = (typeof ETATS)[number]

export const ROLES = ['CLIENT', 'CHAUFFEUR'] as const
export type Role = (typeof ROLES)[number]

export const ACTIONS = ['accepter', 'seDesengager', 'demarrer', 'terminer', 'annuler'] as const
export type Action = (typeof ACTIONS)[number]

/// Champs d'horodatage de `Course`, posés par la transition qui les concerne.
export type ChampHorodatage = 'accepteeAt' | 'demarreeAt' | 'termineeAt' | 'annuleeAt'

/// Contrainte de propriété à porter dans la **même** requête que le changement d'état.
/// - `chauffeurAbsent` : la course ne doit encore appartenir à personne ;
/// - `chauffeurEstLAuteur` : seul le chauffeur engagé peut agir ;
/// - `clientEstLAuteur` : seul le client qui a réservé peut agir.
export type Propriete = 'chauffeurAbsent' | 'chauffeurEstLAuteur' | 'clientEstLAuteur'

export type Transition = {
  readonly role: Role
  readonly origines: readonly Etat[]
  readonly cible: Etat
  readonly propriete: Propriete
  readonly horodatage: ChampHorodatage | null
  readonly remiseANul: readonly ('chauffeurId' | ChampHorodatage)[]
  /// Rendu à l'utilisateur quand l'écriture conditionnée ne touche aucune ligne,
  /// c'est-à-dire quand quelqu'un d'autre a changé l'état entre-temps.
  readonly refus: string
}

export const TRANSITIONS: Record<Action, Transition> = {
  accepter: {
    role: 'CHAUFFEUR',
    origines: ['DEMANDEE'],
    cible: 'ACCEPTEE',
    propriete: 'chauffeurAbsent',
    horodatage: 'accepteeAt',
    remiseANul: [],
    refus: 'Cette course vient d’être prise par un autre chauffeur.',
  },
  seDesengager: {
    role: 'CHAUFFEUR',
    origines: ['ACCEPTEE'],
    cible: 'DEMANDEE',
    propriete: 'chauffeurEstLAuteur',
    horodatage: null,
    // L'invariant de PLAN.md §4 : une course DEMANDEE n'a jamais de chauffeur. Sans
    // cette remise à nul, la course libérée resterait inacceptable par les autres,
    // puisque `accepter` exige `chauffeurId IS NULL`.
    remiseANul: ['chauffeurId', 'accepteeAt'],
    refus: 'Cette course a changé d’état, vous ne pouvez plus vous en désengager.',
  },
  demarrer: {
    role: 'CHAUFFEUR',
    origines: ['ACCEPTEE'],
    cible: 'EN_COURSE',
    propriete: 'chauffeurEstLAuteur',
    horodatage: 'demarreeAt',
    remiseANul: [],
    refus: 'Cette course a changé d’état, elle ne peut plus être démarrée.',
  },
  terminer: {
    role: 'CHAUFFEUR',
    origines: ['EN_COURSE'],
    cible: 'TERMINEE',
    propriete: 'chauffeurEstLAuteur',
    horodatage: 'termineeAt',
    remiseANul: [],
    refus: 'Cette course a changé d’état, elle ne peut plus être terminée.',
  },
  annuler: {
    role: 'CLIENT',
    origines: ['DEMANDEE', 'ACCEPTEE', 'EN_COURSE'],
    cible: 'ANNULEE',
    propriete: 'clientEstLAuteur',
    horodatage: 'annuleeAt',
    // Les horodatages déjà posés sont conservés : une course annulée en pleine route
    // a bien été acceptée et démarrée, et l'historique n'a pas à le cacher.
    remiseANul: [],
    refus: 'Cette course a changé d’état, rafraîchissez la page.',
  },
}

/// Déduit des transitions plutôt que listé à part : un état est terminal exactement
/// quand aucune action ne part de lui. Une sixième action rendrait automatiquement
/// faux un `['TERMINEE', 'ANNULEE']` écrit en dur ici.
export function estTerminal(etat: Etat): boolean {
  return ACTIONS.every((action) => !TRANSITIONS[action].origines.includes(etat))
}

export function transitionsPossibles(etat: Etat, role: Role): Action[] {
  return ACTIONS.filter((action) => {
    const transition = TRANSITIONS[action]
    return transition.role === role && transition.origines.includes(etat)
  })
}

export type Resultat =
  | { readonly permis: true; readonly transition: Transition; readonly etatCible: Etat }
  | { readonly permis: false; readonly motif: string }

function libelleRole(role: Role): string {
  return role === 'CHAUFFEUR' ? 'aux chauffeurs' : 'aux clients'
}

/// Quand l'état connu est terminal, on dit lequel plutôt que de rendre le `refus` de
/// l'action : celui d'`accepter` annoncerait « prise par un autre chauffeur » pour une
/// course que le client a en réalité annulée.
const MOTIFS_ETAT_TERMINAL: Partial<Record<Etat, string>> = {
  TERMINEE: 'Cette course est déjà terminée.',
  ANNULEE: 'Cette course a été annulée.',
}

/// Ne change rien et n'écrit rien : rend le verdict, et la transition à appliquer
/// quand il est favorable. Un refus porte toujours un motif lisible par l'utilisateur,
/// jamais un simple `false`.
export function appliquerTransition(etat: Etat, action: Action, role: Role): Resultat {
  const transition = TRANSITIONS[action]

  if (transition.role !== role) {
    return { permis: false, motif: `Cette action est réservée ${libelleRole(transition.role)}.` }
  }

  if (!transition.origines.includes(etat)) {
    return { permis: false, motif: MOTIFS_ETAT_TERMINAL[etat] ?? transition.refus }
  }

  return { permis: true, transition, etatCible: transition.cible }
}
