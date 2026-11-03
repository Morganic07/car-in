import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { LIBELLES_ETAT } from '../components/ui/BadgeEtat.tsx'
import { prisma } from '../lib/prisma.ts'
import { executerTransition } from '../lib/transitions.ts'
import { semer } from '../prisma/semence.mts'

// La garde est simulée : elle est éprouvée sur de vraies sessions dans
// tests/acces.test.ts, et sa présence en tête de la page par le test de structure.
vi.mock('../lib/garde.ts', () => ({
  exigerEspace: async () => ({ user: { id: 'demo-chauffeur-1', name: 'Hakim Diallo' } }),
}))

const HEURE = 60 * 60_000
const BADGE_RETARD = '>En retard</span>'

async function page(): Promise<string> {
  const { default: Page } = await import('../app/(chauffeur)/chauffeur/page.tsx')
  return renderToStaticMarkup(await Page())
}

/// Les lignes de la liste, dans l'ordre d'affichage.
function lignes(html: string): string[] {
  return html.split('<li>').slice(1)
}

describe('courses disponibles', () => {
  let dossier: string

  /// Rend l'heure de départ posée : recalculée après coup, elle changerait de minute.
  async function creerDemandee(id: string, decalage: number): Promise<Date> {
    const departAt = new Date(Date.now() + decalage)
    await prisma().course.create({
      data: {
        id,
        clientId: 'demo-client',
        etat: 'DEMANDEE',
        departLabel: `Départ de ${id}`,
        departLat: 43.6045,
        departLon: 1.444,
        arriveeLabel: `Arrivée de ${id}`,
        arriveeLat: 43.6293,
        arriveeLon: 1.3638,
        departAt,
        passagers: 4,
        bagages: 3,
      },
    })
    return departAt
  }

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-disponibles-'))
    const url = `file:${join(dossier, 'disponibles.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
  }, 120_000)

  afterAll(async () => {
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  // Chaque test repart de la semence, sans ce que les précédents ont ajouté.
  beforeEach(async () => {
    await prisma().course.deleteMany()
    await semer(prisma(), new Date())
  })

  it('ne montre que les courses DEMANDEE', async () => {
    const html = await page()
    // Semence : 2 (DEMANDEE, -1 h) et 1 (DEMANDEE, +2 j) ; les quatre autres sont prises
    // ou closes.
    expect(lignes(html)).toHaveLength(2)
    for (const etat of ['ACCEPTEE', 'EN_COURSE', 'TERMINEE', 'ANNULEE'] as const) {
      expect(html, etat).not.toContain(LIBELLES_ETAT[etat])
    }
  })

  it('trie par heure de départ, quel que soit l’ordre de création', async () => {
    await creerDemandee('dans-5h', 5 * HEURE)
    await creerDemandee('dans-2h', 2 * HEURE)
    await creerDemandee('il-y-a-3h', -3 * HEURE)

    const ordre = lignes(await page()).map((ligne) => /Départ de ([\w-]+)/.exec(ligne)?.[1])

    // Dans l'ordre : -3 h, -1 h (semence), +2 h, +5 h, +2 j (semence).
    expect(ordre).toEqual(['il-y-a-3h', undefined, 'dans-2h', 'dans-5h', undefined])
  })

  it('fait remonter en tête la course en retard, avec son badge, et elle seule (S9)', async () => {
    const [premiere, seconde] = lignes(await page())
    expect(premiere).toContain('Place du Capitole') // demo-course-2, partie il y a une heure
    expect(premiere).toContain(BADGE_RETARD)
    expect(seconde).not.toContain(BADGE_RETARD)
  })

  it('laisse la course en retard DEMANDEE : c’est un signal, pas un traitement (S9)', async () => {
    await page()
    expect((await prisma().course.findUniqueOrThrow({ where: { id: 'demo-course-2' } })).etat).toBe(
      'DEMANDEE',
    )
  })

  it('affiche adresses, heure, passagers et bagages sur la ligne elle-même', async () => {
    const departAt = await creerDemandee('complete', 3 * HEURE)
    const ligne = lignes(await page()).find((l) => l.includes('Départ de complete'))
    expect(ligne).toContain('Arrivée de complete')
    expect(ligne).toContain('4 passagers')
    expect(ligne).toContain('3 bagages')
    // L'heure de Paris, jamais celle de la machine.
    const heure = new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    }).format(departAt)
    expect(ligne).toContain(heure)
  })

  it('ne révèle rien du client', async () => {
    const html = await page()
    expect(html).not.toContain('Camille Besson')
    expect(html).not.toContain('0612345678')
    expect(html).not.toContain('camille.besson@exemple.fr')
  })

  it('retire une course annulée par le client (S4)', async () => {
    expect(await page()).toContain('Place du Capitole')

    await executerTransition(prisma(), 'annuler', 'demo-course-2', 'demo-client')

    const html = await page()
    expect(html).not.toContain('Place du Capitole')
    expect(lignes(html)).toHaveLength(1)
  })

  it('dit clairement qu’il n’y a rien, sans liste vide', async () => {
    await prisma().course.deleteMany({ where: { etat: 'DEMANDEE' } })
    const html = await page()
    expect(html).not.toContain('<ul')
    expect(html).toContain('Aucune course n’attend de chauffeur')
  })
})
