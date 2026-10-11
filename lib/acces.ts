import { ROLES, type Role } from './domaine/course.ts'

/// Cloisonnement des deux espaces (story 2.3, scénario S12).
///
/// Trois contrôles, qui partagent `ESPACE` et la lecture du rôle (`roleDe`) :
/// - `proxy.ts` redirige un visiteur mal placé d'après le **chemin** demandé
///   (`destination`, ci-dessous) — c'est de l'ergonomie ;
/// - chaque page d'espace revérifie d'après le **rôle** qu'elle exige
///   (`exigerEspace`, lib/garde.ts), parce qu'un `matcher` modifié ou une page
///   déplacée ferait sauter le proxy sans que rien ne le signale ;
/// - chaque action serveur appelle `autoriser` (lib/garde.ts), parce que seule elle
///   protège les données : une requête d'action forgée ne passe ni par une page ni
///   par un lien.

/// Racine de l'espace de chaque rôle.
export const ESPACE: Record<Role, string> = {
  CLIENT: '/client',
  CHAUFFEUR: '/chauffeur',
}

export const CONNEXION = '/connexion'

/// Chemins qui exigent une session, et le rôle qu'ils exigent (`null` : tout compte).
const ZONES: readonly { readonly prefixe: string; readonly role: Role | null }[] = [
  { prefixe: ESPACE.CLIENT, role: 'CLIENT' },
  { prefixe: ESPACE.CHAUFFEUR, role: 'CHAUFFEUR' },
  { prefixe: '/compte', role: null },
]

/// Vrai si `chemin` est `prefixe` ou se trouve dessous — `/chauffeurs` n'est pas sous
/// `/chauffeur`.
function sous(chemin: string, prefixe: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`)
}

/// Où renvoyer un visiteur, ou `null` s'il est à sa place.
///
/// `role` vaut `null` pour un visiteur sans session.
export function destination(chemin: string, role: Role | null): string | null {
  const zone = ZONES.find((candidate) => sous(chemin, candidate.prefixe))
  if (zone === undefined) return null
  if (role === null) return CONNEXION
  if (zone.role !== null && zone.role !== role) return ESPACE[role]
  return null
}

/// Lit le rôle porté par une session. Une valeur hors liste n'est jamais prise pour
/// un rôle : la base stocke l'énumération en texte, sans contrainte (voir le schéma).
export function roleDe(session: { user: { role?: unknown } }): Role {
  const role = session.user.role
  if (typeof role === 'string' && (ROLES as readonly string[]).includes(role)) {
    return role as Role
  }
  throw new Error(`Rôle inconnu dans la session : ${JSON.stringify(role)}.`)
}

/// Même lecture, pour un visiteur qui peut ne pas avoir de session (`null`).
export function roleDeSession(session: { user: { role?: unknown } } | null): Role | null {
  return session === null ? null : roleDe(session)
}

const LIBELLE_ROLE: Record<Role, string> = {
  CLIENT: 'aux clients',
  CHAUFFEUR: 'aux chauffeurs',
}

export const SESSION_EXPIREE = 'Votre session a expiré. Reconnectez-vous pour continuer.'

export function refusRole(attendu: Role): string {
  return `Cette action est réservée ${LIBELLE_ROLE[attendu]}.`
}
