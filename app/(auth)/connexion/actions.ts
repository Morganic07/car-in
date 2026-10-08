'use server'

import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '../../../lib/auth.ts'
import {
  REFUS_IDENTIFIANTS,
  lireConnexion,
  validerConnexion,
  type ErreursConnexion,
} from '../../../lib/connexion.ts'
import {
  REGLES,
  consommer,
  limiteOrigine,
  messageLimite,
  oublier,
} from '../../../lib/limite-debit.ts'
import { prisma } from '../../../lib/prisma.ts'

export type EtatConnexion = {
  /// L'adresse saisie, pour la réafficher. Jamais le mot de passe.
  readonly email: string
  readonly erreurs: ErreursConnexion
  readonly erreurGenerale?: string
}

/// Refus de Better Auth qui veulent tous dire « ces identifiants ne conviennent
/// pas ». Ils reçoivent le même message, pour ne rien laisser deviner.
const REFUS_DE_LA_BRIQUE = new Set([
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_EMAIL',
  'PASSWORD_TOO_LONG',
])

export async function connecter(
  _precedent: EtatConnexion,
  formulaire: FormData,
): Promise<EtatConnexion> {
  const valeurs = lireConnexion(formulaire)
  const validation = validerConnexion(valeurs)
  if (!validation.valide) return { email: valeurs.email, erreurs: validation.erreurs }

  const { email, motDePasse } = validation
  const entetes = await headers()

  // Les deux compteurs avancent **avant** l'essai, en une instruction atomique :
  // vérifier sans compter laisserait cent essais simultanés passer ensemble. L'un ou
  // l'autre suffit à bloquer, avec un message identique que l'adresse ait un compte
  // ou non.
  const cleEmail = `connexion:email:${email}`
  for (const [cle, regle] of [
    [cleEmail, REGLES.connexionParEmail],
    limiteOrigine('connexion', entetes),
  ] as const) {
    const verdict = await consommer(prisma(), cle, regle)
    if (!verdict.permis) {
      return {
        email: valeurs.email,
        erreurs: {},
        erreurGenerale: messageLimite(verdict.reessayerDansMs),
      }
    }
  }

  try {
    await auth().api.signInEmail({ body: { email, password: motDePasse }, headers: entetes })
  } catch (erreur) {
    if (erreur instanceof APIError && REFUS_DE_LA_BRIQUE.has(String(erreur.body?.code))) {
      return { email: valeurs.email, erreurs: {}, erreurGenerale: REFUS_IDENTIFIANTS }
    }
    console.error('Connexion impossible :', erreur)
    return {
      email: valeurs.email,
      erreurs: {},
      erreurGenerale: 'La connexion a échoué. Réessayez dans un instant.',
    }
  }

  // Réussite : le compteur de l'adresse repart de zéro, sans quoi cinq connexions
  // normales d'affilée bloqueraient leur titulaire. Celui de l'origine n'est pas remis
  // à zéro : sans proxy, il est commun à tous, et un attaquant l'effacerait en se
  // connectant à son propre compte.
  await oublier(prisma(), cleEmail)

  // Hors du `try` : `redirect` lève une exception qui n'est pas une panne.
  redirect('/compte')
}
