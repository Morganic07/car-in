'use server'

import { revalidatePath } from 'next/cache'

import { autoriser } from '../../../lib/garde.ts'
import { prisma } from '../../../lib/prisma.ts'
import {
  COURSE_INTROUVABLE,
  executerTransition,
  type IssueTransition,
} from '../../../lib/transitions.ts'

export type EtatAcceptation = {
  readonly acceptee?: boolean
  readonly erreur?: string
}

const ACCEPTATION_IMPOSSIBLE =
  'L’acceptation n’a pas pu être enregistrée. Réessayez dans un instant, ou appelez la compagnie.'

/// Attribue une course au chauffeur connecté (story 4.2, scénarios S2 et S3).
///
/// C'est l'écriture conditionnée qui départage deux chauffeurs : le second ne touche
/// aucune ligne, et le premier garde sa course.
export async function accepterCourse(
  _precedent: EtatAcceptation,
  formulaire: FormData,
): Promise<EtatAcceptation> {
  const autorisation = await autoriser('CHAUFFEUR')
  if (!autorisation.permis) return { erreur: autorisation.motif }

  const courseId = formulaire.get('courseId')
  if (typeof courseId !== 'string') return { erreur: COURSE_INTROUVABLE }

  let issue: IssueTransition
  try {
    issue = await executerTransition(prisma(), 'accepter', courseId, autorisation.session.user.id)
  } catch (panne) {
    console.error(`Acceptation impossible de la course ${courseId} :`, panne)
    return { erreur: ACCEPTATION_IMPOSSIBLE }
  }

  // Après un refus aussi : S3 veut que la liste du perdant se rafraîchisse.
  revalidatePath('/chauffeur', 'layout')

  return issue.effectuee ? { acceptee: true } : { erreur: issue.motif }
}
