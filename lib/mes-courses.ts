/// Mes courses, côté client (story 3.4, scénarios S8 et S9) : la répartition en deux
/// listes, sans dépendance à Next ni à la base, pour se tester seule.

import { estTerminal, type Etat } from './domaine/course.ts'

type Rangeable = { readonly etat: Etat; readonly departAt: Date }

export type MesCourses<T extends Rangeable> = {
  readonly aVenir: readonly T[]
  readonly passees: readonly T[]
}

/// Deux listes séparées **par état, jamais par date** (S8) : « à venir » tient toute
/// course encore vivante, la plus proche d'abord ; « passées » les états terminaux, la
/// plus récente d'abord.
///
/// Une course `DEMANDEE` dont l'heure est dépassée reste donc à venir : la ranger dans
/// l'historique laisserait croire au client qu'elle a eu lieu (S9).
///
/// Le partage s'appuie sur `estTerminal`, et non sur une liste d'états recopiée : un
/// état ajouté à la machine tomberait sinon dans la mauvaise liste sans bruit.
export function repartirCourses<T extends Rangeable>(courses: readonly T[]): MesCourses<T> {
  const parDepart = (a: T, b: T) => a.departAt.getTime() - b.departAt.getTime()
  return {
    aVenir: courses.filter((course) => !estTerminal(course.etat)).sort(parDepart),
    passees: courses
      .filter((course) => estTerminal(course.etat))
      .sort((a, b) => parDepart(b, a)),
  }
}

/// Vrai pour une course que personne n'a prise et dont l'heure de départ est passée :
/// le signal de S9. Aucun traitement automatique n'en découle, seulement un message.
export function enAttenteEnRetard(course: Rangeable, maintenant: Date): boolean {
  return course.etat === 'DEMANDEE' && course.departAt.getTime() <= maintenant.getTime()
}

export const MESSAGE_EN_RETARD =
  'L’heure de départ est passée et aucun chauffeur n’a encore accepté cette course. ' +
  'Appelez la compagnie pour savoir si elle peut être assurée.'

/// Une course acceptée sans chauffeur viole l'invariant des transitions : on le dit au
/// client plutôt que de lui afficher une course assurée sans personne derrière.
export const CHAUFFEUR_INCONNU =
  'Un chauffeur a accepté cette course, mais ses coordonnées sont introuvables. ' +
  'Appelez la compagnie.'

/// S9 : le MVP ne promet pas qu'une course réservée est une course assurée.
export const MESSAGE_EN_ATTENTE =
  'Votre demande est transmise aux chauffeurs de la compagnie. Elle ne sera assurée ' +
  'qu’une fois acceptée : le nom et le téléphone du chauffeur s’afficheront alors ici.'
