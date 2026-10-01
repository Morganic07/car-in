import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { prisma } from '../lib/prisma.ts'

/// Ce fichier existe parce que `prisma()` n'était appelé par aucun code : défini,
/// jamais exécuté. Les stories suivantes en feront leur unique point d'accès, il
/// n'a donc pas à attendre la première page pour être éprouvé.

let dossier: string
let adresse: string

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'carin-client-'))
  adresse = `file:${join(dossier, 'client.db')}`

  execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: adresse },
    stdio: 'pipe',
  })
}, 120_000)

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  const reserve = globalThis as unknown as { clientPrisma?: { client: { $disconnect(): unknown } } }
  await reserve.clientPrisma?.client.$disconnect()
  delete reserve.clientPrisma
  rmSync(dossier, { recursive: true, force: true })
})

describe('client Prisma de l’application', () => {
  it('ouvre réellement la base et sait l’interroger', async () => {
    vi.stubEnv('DATABASE_URL', adresse)

    await expect(prisma().course.count()).resolves.toBe(0)
  })

  it('rend la même instance d’un appel à l’autre', () => {
    vi.stubEnv('DATABASE_URL', adresse)

    expect(prisma()).toBe(prisma())
  })

  it('refuse de servir un client ouvert sur une autre base', () => {
    vi.stubEnv('DATABASE_URL', adresse)
    prisma()

    vi.stubEnv('DATABASE_URL', 'file:/ailleurs/autre.db')
    expect(() => prisma()).toThrow(/déjà ouvert sur une autre base/)
  })
})
