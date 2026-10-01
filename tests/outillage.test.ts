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

describe('épinglage de Prisma', () => {
  const demande = dependancesDev.prisma
  const demandeClient = dependances['@prisma/client']

  it('déclare les deux paquets Prisma', () => {
    expect(demande).toBeDefined()
    expect(demandeClient).toBeDefined()
  })

  it('les épingle sur une version exacte, sans intervalle', () => {
    // Un `^` laisserait npm monter de version tout seul : les deux paquets
    // dériveraient l'un de l'autre au premier `npm install` sur une autre machine.
    expect(demande).toMatch(/^\d+\.\d+\.\d+$/)
    expect(demandeClient).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('les épingle sur la même version', () => {
    expect(demandeClient).toBe(demande)
  })

  it("n'utilise pas une préversion", () => {
    // L'étiquette `latest` de prisma a pointé sur une 8.0.0-rc pendant le cadrage.
    expect(demande).not.toContain('-')
  })

  it('a bien installé la version demandée', () => {
    expect(lireJson('node_modules/prisma/package.json').version).toBe(demande)
    expect(lireJson('node_modules/@prisma/client/package.json').version).toBe(demandeClient)
  })
})
