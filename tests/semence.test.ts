import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { creerClientPrisma } from '../lib/prisma.ts'
import type { PrismaClient } from '../prisma/generated/client/index.js'
import { semer } from '../prisma/semence.mts'

let dossier: string
let client: PrismaClient

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'carin-semence-'))
  const fichier = join(dossier, 'test.db')

  execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${fichier}` },
    stdio: 'pipe',
  })

  // Garde-fou utile : la migration a-t-elle atterri dans *ce* fichier ?
  // `prisma.config.ts` charge `.env`, qui contient une autre DATABASE_URL. Si ce
  // chargement se mettait à écraser la variable passée au sous-processus, les
  // migrations partiraient dans la base de développement et ce fichier resterait
  // inexistant ou vide — ce que les deux assertions ci-dessous détectent. Vérifier
  // que le chemin est sous /tmp ne prouverait rien : il l'est par construction.
  expect(existsSync(fichier), `base temporaire absente : ${fichier}`).toBe(true)
  expect(statSync(fichier).size).toBeGreaterThan(0)

  client = creerClientPrisma(`file:${fichier}`)
}, 120_000)

afterAll(async () => {
  await client?.$disconnect()
  rmSync(dossier, { recursive: true, force: true })
})

describe('jeu de démonstration', () => {
  it('la migration crée les tables User et Course', async () => {
    await expect(client.user.count()).resolves.toBe(0)
    await expect(client.course.count()).resolves.toBe(0)
  })

  it('insère trois chauffeurs et un client', async () => {
    await semer(client)

    expect(await client.user.count({ where: { role: 'CHAUFFEUR' } })).toBe(3)
    expect(await client.user.count({ where: { role: 'CLIENT' } })).toBe(1)
  })

  it('insère au moins six courses couvrant les cinq états', async () => {
    expect(await client.course.count()).toBeGreaterThanOrEqual(6)

    for (const etat of ['DEMANDEE', 'ACCEPTEE', 'EN_COURSE', 'TERMINEE', 'ANNULEE'] as const) {
      expect(await client.course.count({ where: { etat } }), `état ${etat}`).toBeGreaterThan(0)
    }
  })

  it('comporte une course DEMANDEE dont l’heure de départ est passée (S9)', async () => {
    const enRetard = await client.course.count({
      where: { etat: 'DEMANDEE', departAt: { lt: new Date() } },
    })
    expect(enRetard).toBeGreaterThan(0)
  })

  it('comporte une course sans prix estimé (S11)', async () => {
    expect(await client.course.count({ where: { prixEstimeCents: null } })).toBeGreaterThan(0)
  })

  it('ne laisse aucune course DEMANDEE avec un chauffeur assigné', async () => {
    // Invariant de PLAN.md §4, que SQLite ne sait pas exprimer : le jeu de
    // démonstration ne doit pas être le premier à le violer.
    const incoherentes = await client.course.count({
      where: { etat: 'DEMANDEE', chauffeurId: { not: null } },
    })
    expect(incoherentes).toBe(0)
  })

  it('horodate chaque course conformément à son état', async () => {
    // La story 1.3 bâtira la machine à états sur ces horodatages : un jeu de
    // démonstration incohérent la ferait travailler sur des cas impossibles.
    const attendus = {
      DEMANDEE: [],
      ACCEPTEE: ['accepteeAt'],
      EN_COURSE: ['accepteeAt', 'demarreeAt'],
      TERMINEE: ['accepteeAt', 'demarreeAt', 'termineeAt'],
      ANNULEE: ['annuleeAt'],
    } as const

    for (const course of await client.course.findMany()) {
      const requis: readonly string[] = attendus[course.etat]
      for (const champ of ['accepteeAt', 'demarreeAt', 'termineeAt', 'annuleeAt'] as const) {
        const message = `${course.id} (${course.etat}) — ${champ}`
        if (requis.includes(champ)) {
          expect(course[champ], message).not.toBeNull()
        } else {
          expect(course[champ], message).toBeNull()
        }
      }
    }
  })

  it('ordonne les horodatages dans le temps', async () => {
    for (const course of await client.course.findMany()) {
      const jalons = [course.accepteeAt, course.demarreeAt, course.termineeAt].filter(
        (date): date is Date => date !== null,
      )
      for (let i = 1; i < jalons.length; i += 1) {
        expect(jalons[i]!.getTime(), `${course.id} — jalon ${i}`).toBeGreaterThanOrEqual(
          jalons[i - 1]!.getTime(),
        )
      }
      if (course.etat === 'ANNULEE' && course.annuleeAt) {
        expect(course.annuleeAt.getTime(), `${course.id} — annulation`).toBeLessThanOrEqual(
          Date.now(),
        )
      }
    }
  })

  it('relancée deux fois, ne duplique rien', async () => {
    const comptesAvant = await client.user.count()
    const coursesAvant = await client.course.count()

    await semer(client)
    await semer(client)

    expect(await client.user.count()).toBe(comptesAvant)
    expect(await client.course.count()).toBe(coursesAvant)
  })

  it('relancée, met à jour sans casser les relations', async () => {
    await semer(client)

    const course = await client.course.findUniqueOrThrow({
      where: { id: 'demo-course-3' },
      include: { client: true, chauffeur: true },
    })

    expect(course.client.role).toBe('CLIENT')
    expect(course.chauffeur?.role).toBe('CHAUFFEUR')
    expect(course.etat).toBe('ACCEPTEE')
  })
})
