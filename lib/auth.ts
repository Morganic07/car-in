import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'

import type { PrismaClient } from '../prisma/generated/client/index.js'
import { MOT_DE_PASSE_MAX, MOT_DE_PASSE_MIN } from './inscription.ts'
import { prisma } from './prisma.ts'

/// Configuration de Better Auth (choix et justification : PLAN.md). Le secret et
/// l'adresse publique viennent de BETTER_AUTH_SECRET et BETTER_AUTH_URL, lus par la
/// brique elle-même ; en production, elle refuse de démarrer sans secret.
export function creerAuth(client: PrismaClient) {
  return betterAuth({
    database: prismaAdapter(client, { provider: 'sqlite' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MOT_DE_PASSE_MIN,
      maxPasswordLength: MOT_DE_PASSE_MAX,
    },
    user: {
      // Le modèle garde le vocabulaire du projet ; Better Auth parle de `name`.
      fields: { name: 'nom' },
      additionalFields: {
        telephone: { type: 'string', required: true },
        // `input: false` : le rôle n'est jamais lu dans la requête d'inscription.
        // Avec une valeur par défaut, Better Auth la pose à la place de ce qui a été
        // envoyé — un `role=CHAUFFEUR` posté devient `CLIENT` (story 2.1, testé).
        role: { type: 'string', required: false, input: false, defaultValue: 'CLIENT' },
      },
    },
    // Écrit le cookie de session quand une action serveur appelle l'API. Doit rester
    // le dernier plugin de la liste.
    plugins: [nextCookies()],
  })
}

export type Auth = ReturnType<typeof creerAuth>

type Reserve = { auth?: { client: PrismaClient; instance: Auth } }

const reserve = globalThis as unknown as Reserve

/// Accès paresseux, sur le même modèle que `prisma()` : l'instance est construite au
/// premier appel, sur le client Prisma de ce moment. `prisma()` est rappelé à chaque
/// fois, pour hériter de son refus de changer de base en cours de processus.
export function auth(): Auth {
  const client = prisma()
  const memorise = reserve.auth
  if (memorise && memorise.client === client) return memorise.instance

  const instance = creerAuth(client)
  reserve.auth = { client, instance }
  return instance
}
