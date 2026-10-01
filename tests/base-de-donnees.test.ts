import { afterEach, describe, expect, it, vi } from 'vitest'

import { urlBaseDeDonnees, urlBaseDeDonneesSiDisponible } from '../lib/base-de-donnees.ts'

// `vi.stubEnv` plutôt qu'une affectation directe : les types de Next déclarent
// `process.env.NODE_ENV` en lecture seule, et la restauration est garantie même si
// une assertion échoue en cours de test.
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('résolution de l’adresse de la base', () => {
  it('rend la variable déclarée quand elle existe', () => {
    vi.stubEnv('DATABASE_URL', 'file:/ailleurs/base.db')
    expect(urlBaseDeDonneesSiDisponible()).toBe('file:/ailleurs/base.db')
    expect(urlBaseDeDonnees()).toBe('file:/ailleurs/base.db')
  })

  it('rend la variable déclarée même en production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DATABASE_URL', 'file:/prod/base.db')
    expect(urlBaseDeDonnees()).toBe('file:/prod/base.db')
  })

  it('se replie sur la base de développement hors production', () => {
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('NODE_ENV', 'development')
    expect(urlBaseDeDonneesSiDisponible()).toBe('file:./dev.db')
    expect(urlBaseDeDonnees()).toBe('file:./dev.db')
  })

  it('ne devine aucune base en production', () => {
    // C'est ce qui permet à `prisma generate` d'aboutir au postinstall d'une
    // installation de production, sans qu'une commande de migration puisse pour
    // autant partir en silence sur un fichier SQLite local.
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    expect(urlBaseDeDonneesSiDisponible()).toBeUndefined()
    expect(() => urlBaseDeDonnees()).toThrow(/obligatoire en production/)
  })
})
