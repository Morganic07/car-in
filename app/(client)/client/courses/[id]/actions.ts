'use server'

import { revalidatePath } from 'next/cache'

import { autoriser } from '../../../../../lib/garde.ts'
import { prisma } from '../../../../../lib/prisma.ts'
import {
  COURSE_INTROUVABLE,
  executerTransition,
  type IssueTransition,
} from '../../../../../lib/transitions.ts'

export type EtatAnnulation = {
  readonly annulee?: boolean
  readonly erreur?: string
}

const ANNULATION_IMPOSSIBLE =
  'L’annulation n’a pas pu être enregistrée. Réessayez dans un instant, ou appelez la compagnie.'

/// Annule une course du client connecté (story 3.5, scénario S4).
///
/// Rien de ce que l'écran affichait n'est cru : une course terminée entre-temps, celle
/// d'un autre client ou un identifiant inventé sont refusés par l'écriture elle-même.
export async function annulerCourse(
  _precedent: EtatAnnulation,
  formulaire: FormData,
): Promise<EtatAnnulation> {
  const autorisation = await autoriser('CLIENT')
  if (!autorisation.permis) return { erreur: autorisation.motif }

  const courseId = formulaire.get('courseId')
  if (typeof courseId !== 'string') return { erreur: COURSE_INTROUVABLE }

  let issue: IssueTransition
  try {
    issue = await executerTransition(prisma(), 'annuler', courseId, autorisation.session.user.id)
  } catch (panne) {
    console.error(`Annulation impossible de la course ${courseId} :`, panne)
    return { erreur: ANNULATION_IMPOSSIBLE }
  }

  // Après un refus aussi : l'écran montrait un état périmé, il doit afficher le vrai.
  // Tout l'espace client : le détail, et la liste où la course change de section.
  revalidatePath('/client', 'layout')

  return issue.effectuee ? { annulee: true } : { erreur: issue.motif }
}
