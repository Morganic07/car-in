/// Validation du formulaire de connexion.
///
/// Volontairement minimale : l'adresse doit avoir la forme d'une adresse, le mot de
/// passe doit être rempli. Juger ici de la forme du mot de passe dirait quelque chose
/// des règles d'inscription sans rien protéger ; le vrai contrôle est celui de Better
/// Auth, dont le refus est le même que l'adresse existe ou non.

import { erreurChamp } from './inscription.ts'

export const CHAMPS_CONNEXION = ['email', 'motDePasse'] as const
export type ChampConnexion = (typeof CHAMPS_CONNEXION)[number]

export type ValeursConnexion = Record<ChampConnexion, string>
export type ErreursConnexion = Partial<Record<ChampConnexion, string>>

/// Le seul message rendu quand l'adresse ou le mot de passe est faux. Il ne distingue
/// jamais les deux cas : dire « adresse inconnue » révélerait qui a un compte.
export const REFUS_IDENTIFIANTS = 'Adresse e-mail ou mot de passe incorrect.'

export function erreurChampConnexion(champ: ChampConnexion, valeur: string): string | undefined {
  // La forme de l'adresse est vérifiée comme à l'inscription : une chaîne qui ne peut
  // pas être une adresse est refusée avant d'ouvrir un compteur de limite de débit.
  // Ce refus ne dit rien de l'existence d'un compte.
  if (champ === 'email') return erreurChamp('email', valeur)
  return valeur === '' ? 'Indiquez votre mot de passe.' : undefined
}

export function validerConnexion(valeurs: ValeursConnexion):
  | { readonly valide: true; readonly email: string; readonly motDePasse: string }
  | { readonly valide: false; readonly erreurs: ErreursConnexion } {
  const erreurs: ErreursConnexion = {}
  for (const champ of CHAMPS_CONNEXION) {
    const erreur = erreurChampConnexion(champ, valeurs[champ])
    if (erreur !== undefined) erreurs[champ] = erreur
  }
  if (Object.keys(erreurs).length > 0) return { valide: false, erreurs }
  return {
    valide: true,
    email: valeurs.email.trim().toLowerCase(),
    motDePasse: valeurs.motDePasse,
  }
}

/// Ne lit que les deux champs attendus ; une valeur absente ou non textuelle devient
/// une chaîne vide, que la validation refuse.
export function lireConnexion(formulaire: FormData): ValeursConnexion {
  const lire = (champ: ChampConnexion) => {
    const valeur = formulaire.get(champ)
    return typeof valeur === 'string' ? valeur : ''
  }
  return { email: lire('email'), motDePasse: lire('motDePasse') }
}
