/// Les courses d'un chauffeur (story 4.3) : la répartition en deux listes, sans dépendance
/// à Next ni à la base, pour se tester seule.

import { ETATS, estTerminal, type Etat } from './domaine/course.ts'
import { heureDeParisEnSaisie } from './reservation.ts'

/// Terminées et annulées quittent la liste (S4) : elle dit ce qu'il reste à conduire.
export const ETATS_TERMINAUX: readonly Etat[] = ETATS.filter(estTerminal)

type Planifiable = { readonly departAt: Date }

export type Planning<T extends Planifiable> = {
  readonly aujourdhui: readonly T[]
  readonly suivantes: readonly T[]
}

/// « 2026-11-03 » : le jour à Paris. Le jour de la machine ferait basculer une course de
/// 23 h 30 au lendemain sur un serveur à l'heure UTC.
function jourDeParis(instant: Date): string {
  return heureDeParisEnSaisie(instant).slice(0, 10)
}

/// « Aujourd'hui » tient aussi les courses d'un jour passé encore ouvertes : un chauffeur
/// qui a oublié de terminer doit les voir d'abord, pas les perdre de vue. Le format
/// année-mois-jour se compare comme du texte.
export function repartirPlanning<T extends Planifiable>(
  courses: readonly T[],
  maintenant: Date,
): Planning<T> {
  const aujourdhui = jourDeParis(maintenant)
  const parDepart = (a: T, b: T) => a.departAt.getTime() - b.departAt.getTime()
  return {
    aujourdhui: courses.filter((c) => jourDeParis(c.departAt) <= aujourdhui).sort(parDepart),
    suivantes: courses.filter((c) => jourDeParis(c.departAt) > aujourdhui).sort(parDepart),
  }
}
