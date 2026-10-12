'use server'

import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '../../../lib/auth.ts'
import { consommer, limiteOrigine, messageLimite } from '../../../lib/limite-debit.ts'
import { prisma } from '../../../lib/prisma.ts'
import {
  EMAIL_INVALIDE,
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
  const entetes = await headers()

  // Après la validation : une faute de frappe ne consomme pas d'essai. Sans cette
  // limite, l'inscription permettrait de tester des adresses à la chaîne, puisqu'elle
  // dit si une adresse est déjà prise.
  const [cle, regle] = limiteOrigine('inscription', entetes)
  const verdict = await consommer(prisma(), cle, regle)
  if (!verdict.permis) {
    return { valeurs: rappel, erreurs: {}, erreurGenerale: messageLimite(verdict.reessayerDansMs) }
  }

  try {
    await auth().api.signUpEmail({
      body: { name: nom, email, password: motDePasse, telephone },
      headers: entetes,
    })
  } catch (erreur) {
    // Filet : notre validation suit la règle de Better Auth (lib/inscription.ts), donc
    // ce refus ne devrait pas arriver. Si une montée de version les faisait diverger,
    // l'utilisateur lit au moins l'erreur à côté du champ, pas une panne qu'aucun
    // nouvel essai ne corrige. Journalisé : c'est le signe d'une divergence à réparer.
    if (erreur instanceof APIError && String(erreur.body?.code) === 'INVALID_EMAIL') {
      console.error('Adresse refusée par Better Auth malgré notre validation :', erreur)
      return { valeurs: rappel, erreurs: { email: EMAIL_INVALIDE } }
    }
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
