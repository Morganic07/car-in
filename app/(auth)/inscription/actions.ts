'use server'

import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '../../../lib/auth.ts'
import { prisma } from '../../../lib/prisma.ts'
import {
  lireFormulaire,
  validerInscription,
  type ErreursInscription,
  type ValeursInscription,
} from '../../../lib/inscription.ts'

export type EtatInscription = {
  /// Ce qui a été saisi, pour remplir de nouveau le formulaire après un refus. Le mot
  /// de passe n'y figure jamais : il ne repart pas vers le navigateur.
  readonly valeurs: Omit<ValeursInscription, 'motDePasse'>
  readonly erreurs: ErreursInscription
  /// Une panne qui ne tient à aucun champ en particulier.
  readonly erreurGenerale?: string
}

/// Codes de Better Auth pour une adresse déjà enregistrée. Les deux existent selon
/// la configuration de la brique ; les deux reçoivent le même message.
const EMAIL_DEJA_PRIS = new Set(['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'])

/// Vrai si le refus de Better Auth tient à une adresse déjà enregistrée.
///
/// Deux chemins y mènent. Le cas courant : Better Auth trouve l'adresse avant
/// d'écrire, et le dit par son code. Le cas concurrent : deux inscriptions de la même
/// adresse passent ensemble cette vérification, la contrainte d'unicité de la base
/// refuse la seconde, et Better Auth n'en remonte qu'un `FAILED_TO_CREATE_USER` sans
/// la cause. La base a déjà tranché ; relire l'adresse sert seulement à choisir le
/// message — constaté par tests/inscription.test.ts, pas supposé.
async function adressePrise(erreur: APIError, email: string): Promise<boolean> {
  const code = String(erreur.body?.code)
  if (EMAIL_DEJA_PRIS.has(code)) return true
  if (code !== 'FAILED_TO_CREATE_USER') return false
  const existant = await prisma().user.findUnique({ where: { email }, select: { id: true } })
  return existant !== null
}

export async function inscrire(
  _precedent: EtatInscription,
  formulaire: FormData,
): Promise<EtatInscription> {
  // Seuls les quatre champs du formulaire sont lus : un `role` posté à la main n'est
  // jamais transmis. Better Auth l'ignorerait de toute façon (`input: false`), mais
  // la défense ne repose pas sur une seule couche.
  const valeurs = lireFormulaire(formulaire)
  const { motDePasse: _motDePasse, ...rappel } = valeurs

  const validation = validerInscription(valeurs)
  if (!validation.valide) return { valeurs: rappel, erreurs: validation.erreurs }

  const { nom, email, telephone, motDePasse } = validation.donnees
  try {
    await auth().api.signUpEmail({
      body: { name: nom, email, password: motDePasse, telephone },
      headers: await headers(),
    })
  } catch (erreur) {
    if (erreur instanceof APIError && (await adressePrise(erreur, email))) {
      return {
        valeurs: rappel,
        erreurs: { email: 'Un compte existe déjà avec cette adresse e-mail.' },
      }
    }

    // Aucune panne avalée : elle est journalisée côté serveur avec sa cause, et
    // l'utilisateur lit un message en français plutôt qu'un écran d'erreur.
    console.error('Inscription impossible :', erreur)
    return {
      valeurs: rappel,
      erreurs: {},
      erreurGenerale: 'La création du compte a échoué. Réessayez dans un instant.',
    }
  }

  // Hors du `try` : `redirect` signale la navigation en levant une exception, qui ne
  // doit pas être prise pour une panne d'inscription.
  redirect('/inscription/confirmee')
}
