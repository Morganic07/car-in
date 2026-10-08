'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '../../../lib/auth.ts'
import { prisma } from '../../../lib/prisma.ts'

export type EtatDeconnexion = { readonly erreur?: string }

const ECHEC = 'La déconnexion a échoué. Réessayez dans un instant.'

/// Déconnecte et **vérifie** que la session n'existe plus.
///
/// Better Auth efface le cookie même quand la suppression de la session en base
/// échoue : il journalise l'erreur et continue (constaté dans son code, 1.7.7). Le
/// navigateur se croirait alors déconnecté, alors que le jeton resterait valide pour
/// quiconque l'aurait copié. On relit donc la base après coup.
export async function deconnecter(): Promise<EtatDeconnexion> {
  const entetes = await headers()
  const session = await auth().api.getSession({ headers: entetes })
  // Déjà sans session : il n'y a rien à fermer.
  if (session === null) redirect('/connexion')

  try {
    await auth().api.signOut({ headers: entetes })
  } catch (erreur) {
    console.error('Déconnexion impossible :', erreur)
    return { erreur: ECHEC }
  }

  const restante = await prisma().session.findUnique({
    where: { id: session.session.id },
    select: { id: true },
  })
  if (restante !== null) {
    console.error(`Déconnexion : la session ${session.session.id} existe toujours en base.`)
    return { erreur: ECHEC }
  }

  redirect('/connexion?deconnecte=1')
}
