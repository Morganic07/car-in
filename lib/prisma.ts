import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from '../prisma/generated/client/index.js'
import { urlBaseDeDonnees } from './base-de-donnees.ts'

/// Prisma 7 n'ouvre plus la base depuis le schéma : il faut lui passer un
/// adaptateur de pilote. Ce fichier est le seul endroit qui en construit un.
export function creerClientPrisma(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
}

type Reserve = { clientPrisma?: { url: string; client: PrismaClient } }

const reserve = globalThis as unknown as Reserve

/// Accès paresseux, et non une constante exportée : une constante se construirait
/// à l'import, donc avant qu'un test ait pu désigner sa propre base — et avant que
/// l'on sache si DATABASE_URL est définie. Une erreur au moment de l'import casse
/// la compilation entière au lieu de la seule requête fautive.
///
/// L'instance est mémorisée sur l'objet global : en développement, Next recharge
/// les modules à chaque modification, et une nouvelle instance par rechargement
/// finirait par épuiser les connexions.
/// L'adresse est retenue avec l'instance : si elle changeait en cours de processus,
/// rendre le client mémorisé donnerait **en silence** accès à une autre base que
/// celle demandée. On refuse plutôt que de servir la mauvaise.
export function prisma(): PrismaClient {
  const url = urlBaseDeDonnees()
  const memorise = reserve.clientPrisma

  if (memorise) {
    if (memorise.url !== url) {
      throw new Error(
        'Le client Prisma est déjà ouvert sur une autre base dans ce processus ' +
          `(${memorise.url} au lieu de ${url}). Pour travailler sur une base ` +
          'distincte, passer par creerClientPrisma().',
      )
    }
    return memorise.client
  }

  const client = creerClientPrisma(url)
  reserve.clientPrisma = { url, client }
  return client
}
