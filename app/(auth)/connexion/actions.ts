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

/// Une connexion postée alors qu'une session est déjà ouverte en crée une seconde :
/// le nouveau cookie remplace l'ancien dans le navigateur, mais l'ancienne session
/// resterait valide en base, pour quiconque aurait copié son jeton. Les en-têtes de
/// la requête portent encore l'ancien cookie : on retrouve la session qu'il désigne
/// et on la supprime.
///
/// La lecture se fait **avant** la connexion, par précaution : le plugin
/// `nextCookies` recopie dans le navigateur tout cookie que renvoie un appel à Better
/// Auth, `getSession` compris. Placée avant, une lecture ne peut rien écrire que
/// `signInEmail` ne réécrive ensuite. (Placée après, elle n'écrit rien aujourd'hui —
/// essayé —, mais rien ne garantit qu'une version suivante s'en abstienne.)
///
/// Un échec de lecture ou de suppression ne défait pas la connexion : il est
/// journalisé, et l'ancienne session expire d'elle-même.
async function lireSessionPrecedente(entetes: Headers): Promise<string | null> {
  try {
    const precedente = await auth().api.getSession({
      headers: entetes,
      query: { disableRefresh: true },
    })
    return precedente?.session.id ?? null
  } catch (erreur) {
    console.error('Connexion : la session précédente n’a pas pu être lue.', erreur)
    return null
  }
}

async function fermerSession(id: string): Promise<void> {
  try {
    await prisma().session.deleteMany({ where: { id } })
  } catch (erreur) {
    console.error(`Connexion : la session précédente ${id} n’a pas pu être fermée.`, erreur)
  }
}

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

  const precedente = await lireSessionPrecedente(entetes)

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

  if (precedente !== null) await fermerSession(precedente)

  // Hors du `try` : `redirect` lève une exception qui n'est pas une panne.
  redirect('/compte')
}
