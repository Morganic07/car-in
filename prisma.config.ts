import { existsSync } from 'node:fs'

// Depuis `prisma/config` et non `@prisma/config` : le second n'est présent que
// remonté comme dépendance transitive de `prisma`, donc sans garantie d'être là.
// `prisma/config` est le point d'entrée exposé par le paquet que l'on déclare.
import { defineConfig } from 'prisma/config'

import { urlBaseDeDonneesSiDisponible } from './lib/base-de-donnees.ts'

// Prisma 7 ne lit plus `.env` de lui-même : sans ce chargement, toute commande
// prisma échoue sur « Cannot resolve environment variable: DATABASE_URL ».
// Next, lui, charge `.env` tout seul, et la semence passe par
// `node --env-file-if-exists` : ce chargement ne sert qu'aux commandes prisma.
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

// L'adresse de la base n'est fournie que si elle est connue. En production sans
// DATABASE_URL, la clé est absente : `prisma generate` — qui tourne au
// `postinstall` et n'a pas besoin de base — aboutit, tandis qu'une commande de
// migration échoue sur l'absence de source de données plutôt que de migrer en
// silence un fichier SQLite local.
const url = urlBaseDeDonneesSiDisponible()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(url ? { datasource: { url } } : {}),
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --env-file-if-exists=.env prisma/semence.mts',
  },
})
