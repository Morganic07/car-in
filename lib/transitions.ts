/// Écriture d'une transition d'état (`PLAN.md` §4) : **une** mise à jour conditionnée
/// sur les états d'origine et sur la propriété, dont on vérifie le nombre de lignes.
///
/// `lib/domaine/course.ts` dit ce qui est permis, ce module garantit que c'est encore
/// vrai au moment d'écrire. Le rôle de l'auteur est vérifié avant, par `autoriser`,
/// dans l'action serveur.

import type { PrismaClient } from '../prisma/generated/client/index.js'
import {
  TRANSITIONS,
  appliquerTransition,
  estTerminal,
  type Action,
  type Propriete,
} from './domaine/course.ts'

/// Même message pour une course d'un autre et pour un identifiant inventé : rien ne dit
/// à un curieux qu'un identifiant existe.
export const COURSE_INTROUVABLE = 'Cette course est introuvable.'

export type IssueTransition =
  | { readonly effectuee: true }
  | { readonly effectuee: false; readonly motif: string }

function conditionDePropriete(propriete: Propriete, auteurId: string) {
  switch (propriete) {
    case 'chauffeurAbsent':
      return { chauffeurId: null }
    case 'chauffeurEstLAuteur':
      return { chauffeurId: auteurId }
    case 'clientEstLAuteur':
      return { clientId: auteurId }
  }
}

/// Courses dont l'auteur peut connaître l'état après un refus. Une course sans chauffeur
/// est visible de tous les chauffeurs : une course déjà prise n'est donc pas un secret,
/// et `accepter` ne filtre rien ici.
function conditionDeLecture(propriete: Propriete, auteurId: string) {
  return propriete === 'chauffeurAbsent' ? {} : conditionDePropriete(propriete, auteurId)
}

/// Applique `action` à la course, si elle est encore possible à cet instant. Une panne
/// de la base remonte telle quelle : à l'action serveur de la dire à l'utilisateur.
///
/// La lecture qui suit un refus n'écrit rien : elle reconnaît le chauffeur qui réessaie
/// une course déjà à lui, et sinon dit « déjà terminée » plutôt qu'un message générique.
export async function executerTransition(
  client: PrismaClient,
  action: Action,
  courseId: string,
  auteurId: string,
  maintenant: Date = new Date(),
): Promise<IssueTransition> {
  const transition = TRANSITIONS[action]

  const { count } = await client.course.updateMany({
    where: {
      id: courseId,
      etat: { in: [...transition.origines] },
      ...conditionDePropriete(transition.propriete, auteurId),
    },
    data: {
      etat: transition.cible,
      ...(transition.horodatage === null ? {} : { [transition.horodatage]: maintenant }),
      ...Object.fromEntries(transition.remiseANul.map((champ) => [champ, null])),
      ...(transition.propriete === 'chauffeurAbsent' ? { chauffeurId: auteurId } : {}),
    },
  })
  if (count === 1) return { effectuee: true }

  const course = await client.course.findFirst({
    where: { id: courseId, ...conditionDeLecture(transition.propriete, auteurId) },
    select: { etat: true, chauffeurId: true },
  })
  if (course === null) return { effectuee: false, motif: COURSE_INTROUVABLE }

  // Une réponse perdue sur le réseau, et le chauffeur réessaie : la course est bien la
  // sienne, et c'est ce qu'il doit lire. « Prise par un autre » la lui ferait abandonner,
  // et le client attendrait un chauffeur qui ne viendra pas.
  if (
    transition.propriete === 'chauffeurAbsent' &&
    course.chauffeurId === auteurId &&
    // Encore dans un état d'origine, elle n'a pas été acceptée : l'écriture vient d'échouer
    // sur une ligne incohérente, que la base n'interdit pas.
    !transition.origines.includes(course.etat) &&
    !estTerminal(course.etat)
  ) {
    return { effectuee: true }
  }

  const verdict = appliquerTransition(course.etat, action, transition.role)
  return { effectuee: false, motif: verdict.permis ? transition.refus : verdict.motif }
}
