import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../prisma/generated/client/index.js'
import { creerAuth } from '../lib/auth.ts'
import { creerClientPrisma } from '../lib/prisma.ts'

const MOT_DE_PASSE = 'mot-de-passe-de-test-2026' // pragma: allowlist secret — compte de test fictif

let dossier: string
let client: PrismaClient

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'carin-auth-'))
  const url = `file:${join(dossier, 'auth.db')}`
  execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  vi.stubEnv('BETTER_AUTH_SECRET', 'secret-de-test-uniquement-0123456789abcdef') // pragma: allowlist secret
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  client = creerClientPrisma(url)
}, 120_000)

afterAll(async () => {
  await client.$disconnect()
  vi.unstubAllEnvs()
  rmSync(dossier, { recursive: true, force: true })
})

describe('inscription par Better Auth', () => {
  it('ne laisse aucun compte sans mot de passe quand l’enregistrement du mot de passe échoue', async () => {
    // L'inscription écrit trois lignes : l'utilisateur, son « Account » (qui porte le
    // mot de passe), puis la session. Hors transaction, un échec sur la deuxième
    // laisserait un utilisateur sans mot de passe, et son adresse prise pour toujours.
    // Une vraie panne de la base : SQLite refuse toute insertion dans « Account ».
    await client.$executeRawUnsafe(
      `CREATE TRIGGER "panne_insertion_account" BEFORE INSERT ON "Account"
       BEGIN SELECT RAISE(ABORT, 'insertion de compte refusée'); END`,
    )
    const email = 'transaction@exemple.fr'
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        creerAuth(client).api.signUpEmail({
          body: { email, password: MOT_DE_PASSE, name: 'Test Transaction', telephone: '0600000000' },
        }),
      ).rejects.toThrow()
    } finally {
      journal.mockRestore()
      await client.$executeRawUnsafe('DROP TRIGGER "panne_insertion_account"')
    }

    expect(await client.user.count({ where: { email } })).toBe(0)
    expect(await client.session.count()).toBe(0)

    // La panne levée, la même adresse s'inscrit normalement : rien n'est resté coincé.
    const reponse = await creerAuth(client).api.signUpEmail({
      body: { email, password: MOT_DE_PASSE, name: 'Test Transaction', telephone: '0600000000' },
    })
    expect(reponse.user.email).toBe(email)
    expect(
      await client.account.count({ where: { userId: reponse.user.id, providerId: 'credential' } }),
    ).toBe(1)
  })
})
