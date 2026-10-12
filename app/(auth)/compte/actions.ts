'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '../../../lib/auth.ts'
import { prisma } from '../../../lib/prisma.ts'

export type EtatDeconnexion = { readonly erreur?: string }

const ECHEC = 'La déconnexion a échoué. Réessayez dans un instant.'

/// Déconnecte : la session disparaît de la base **avant** que le cookie soit effacé.
///
/// Better Auth (`signOut`, 1.7.7) efface le cookie même quand la suppression de la
/// session en base échoue : il journalise l'erreur et continue (constaté dans son
/// code). Le navigateur se croirait déconnecté, et un second clic, sans cookie,
/// renverrait à la connexion sans un mot — alors que le jeton resterait valide pour
/// quiconque l'aurait copié, jusqu'à son expiration.
///
/// On supprime donc la session nous-mêmes d'abord. Si la base refuse, `signOut`
/// n'est pas appelé : le cookie reste, l'échec est dit, et le bouton peut être
/// réessayé sur la même session.
export async function deconnecter(): Promise<EtatDeconnexion> {
  const entetes = await headers()
  const session = await auth().api.getSession({ headers: entetes })
  // Déjà sans session : il n'y a rien à fermer.
  if (session === null) redirect('/connexion')

  try {
    await prisma().session.deleteMany({ where: { id: session.session.id } })
  } catch (erreur) {
    console.error(`Déconnexion : la session ${session.session.id} n'a pas pu être supprimée.`, erreur)
    return { erreur: ECHEC }
  }

  // La session n'existe plus : le cookie restant ne donne plus accès à rien. Il ne
  // reste qu'à l'effacer, ce que fait `signOut`. S'il échoue, la déconnexion est
  // tout de même acquise — on le journalise sans la présenter comme un échec, qui
  // inviterait à réessayer une opération déjà faite.
  try {
    await auth().api.signOut({ headers: entetes })
  } catch (erreur) {
    console.error('Déconnexion : session supprimée, mais cookie non effacé :', erreur)
  }

  redirect('/connexion?deconnecte=1')
}
