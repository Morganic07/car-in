import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { CONNEXION, ESPACE, SESSION_EXPIREE, refusRole, roleDe } from './acces.ts'
import { auth, type Auth } from './auth.ts'
import type { Role } from './domaine/course.ts'

/// Les gardes côté serveur : elles lisent la session de la requête en cours. Ce qui
/// ne dépend pas de Next — les espaces, la lecture du rôle, les messages — vit dans
/// `acces.ts`, pour se tester seul.

export type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

async function sessionCourante(): Promise<Session | null> {
  return auth().api.getSession({ headers: await headers() })
}

/// Pour une page d'espace : redirige le visiteur mal placé, et rend sa session s'il
/// est à sa place. Refait ici ce que fait `proxy.ts`, qui ne protège que les chemins
/// de son `matcher`.
///
/// Reçoit le **rôle** exigé (`null` : tout compte), et non le chemin de la page : un
/// chemin mal recopié, absent des zones connues, aurait désactivé le contrôle de rôle
/// sans aucun bruit. Un rôle ne peut pas être mal écrit — le typage le refuse.
export async function exigerEspace(role: Role | null): Promise<Session> {
  const session = await sessionCourante()
  if (session === null) redirect(CONNEXION)
  const sien = roleDe(session)
  if (role !== null && sien !== role) redirect(ESPACE[sien])
  return session
}

export type Autorisation =
  | { readonly permis: true; readonly session: Session }
  | { readonly permis: false; readonly motif: string }

/// Pour une action serveur : à appeler **en premier**, avant toute lecture ou
/// écriture. Ne redirige pas — une action rend un refus lisible à son formulaire, et
/// une requête forgée reçoit un refus explicite plutôt qu'une page (scénario S12).
export async function autoriser(role: Role): Promise<Autorisation> {
  const session = await sessionCourante()
  if (session === null) return { permis: false, motif: SESSION_EXPIREE }
  if (roleDe(session) !== role) return { permis: false, motif: refusRole(role) }
  return { permis: true, session }
}
