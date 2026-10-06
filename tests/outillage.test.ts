import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const racine = join(import.meta.dirname, '..')

function lireJson(chemin: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(racine, chemin), 'utf8')) as Record<string, unknown>
}

const paquet = lireJson('package.json')
const dependances = paquet.dependencies as Record<string, string>
const dependancesDev = paquet.devDependencies as Record<string, string>

/// Les trois paquets Prisma doivent avancer ensemble. L'adaptateur de pilote en fait
/// partie : monté seul, l'incompatibilité n'apparaîtrait qu'à l'exécution, au moment
/// du `new PrismaClient({ adapter })`.
const PAQUETS_PRISMA = {
  prisma: 'devDependencies',
  '@prisma/client': 'dependencies',
  '@prisma/adapter-better-sqlite3': 'dependencies',
} as const

describe('épinglage de Prisma', () => {
  const demandes = Object.entries(PAQUETS_PRISMA).map(([nom, emplacement]) => ({
    nom,
    demande: (emplacement === 'dependencies' ? dependances : dependancesDev)[nom],
  }))

  it('déclare les trois paquets Prisma', () => {
    for (const { nom, demande } of demandes) {
      expect(demande, nom).toBeDefined()
    }
  })

  it('les épingle sur une version exacte, sans intervalle', () => {
    // Un `^` laisserait npm monter de version tout seul : les paquets dériveraient
    // l'un de l'autre au premier `npm install` sur une autre machine.
    for (const { nom, demande } of demandes) {
      expect(demande, nom).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('les épingle tous sur la même version', () => {
    const versions = new Set(demandes.map(({ demande }) => demande))
    expect([...versions]).toHaveLength(1)
  })

  it("n'utilise pas une préversion", () => {
    // L'étiquette `latest` de prisma a pointé sur une 8.0.0-rc pendant le cadrage.
    for (const { nom, demande } of demandes) {
      expect(demande, nom).not.toContain('-')
    }
  })

  it('a bien installé les versions demandées', () => {
    for (const { nom, demande } of demandes) {
      expect(lireJson(`node_modules/${nom}/package.json`).version, nom).toBe(demande)
    }
  })
})
