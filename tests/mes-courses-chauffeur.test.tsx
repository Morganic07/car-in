import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isHTTPAccessFallbackError } from 'next/dist/client/components/http-access-fallback/http-access-fallback.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { repartirPlanning } from '../lib/planning-chauffeur.ts'
import type { Etat } from '../lib/domaine/course.ts'
import { prisma } from '../lib/prisma.ts'
import { executerTransition } from '../lib/transitions.ts'
import { semer } from '../prisma/semence.mts'

const HEURE = 60 * 60_000
const JOUR = 24 * HEURE

// ---------------------------------------------------------------------------
// La répartition, seule.
// ---------------------------------------------------------------------------

describe('repartirPlanning', () => {
  const course = (id: string, departAt: string) => ({ id, departAt: new Date(departAt) })
  const ids = (liste: readonly { id: string }[]) => liste.map((c) => c.id)

  it('coupe à minuit à Paris, pas à minuit UTC', () => {
    // 23 h 30 à Paris en hiver : il est 22 h 30 UTC.
    const maintenant = new Date('2026-11-03T22:30:00Z')
    const { aujourdhui, suivantes } = repartirPlanning(
      [course('dernier-instant', '2026-11-03T22:59:00Z'), course('minuit', '2026-11-03T23:00:00Z')],
      maintenant,
    )
    expect(ids(aujourdhui)).toEqual(['dernier-instant'])
    expect(ids(suivantes)).toEqual(['minuit'])
  })

  it('compte le jour de Paris juste après minuit, encore la veille en UTC', () => {
    // 00 h 30 le 4 novembre à Paris, 23 h 30 le 3 en UTC.
    const maintenant = new Date('2026-11-03T23:30:00Z')
    const { aujourdhui, suivantes } = repartirPlanning(
      [course('hier-soir', '2026-11-03T22:00:00Z'), course('ce-matin', '2026-11-04T07:00:00Z')],
      maintenant,
    )
    expect(ids(aujourdhui)).toEqual(['hier-soir', 'ce-matin'])
    expect(suivantes).toEqual([])
  })

  it('suit l’heure d’été', () => {
    // Minuit à Paris en été : 22 h UTC la veille.
    const maintenant = new Date('2027-07-01T10:00:00Z')
    const { aujourdhui, suivantes } = repartirPlanning(
      [course('avant', '2027-07-01T21:59:00Z'), course('apres', '2027-07-01T22:00:00Z')],
      maintenant,
    )
    expect(ids(aujourdhui)).toEqual(['avant'])
    expect(ids(suivantes)).toEqual(['apres'])
  })

  it('garde en tête une course d’un jour passé encore ouverte', () => {
    const { aujourdhui } = repartirPlanning(
      [course('ce-soir', '2026-11-03T18:00:00Z'), course('oubliee', '2026-11-01T08:00:00Z')],
      new Date('2026-11-03T10:00:00Z'),
    )
    expect(ids(aujourdhui)).toEqual(['oubliee', 'ce-soir'])
  })

  it('trie chaque liste par heure de départ, sans modifier la liste reçue', () => {
    const recue = [
      course('apres-demain', '2026-11-05T08:00:00Z'),
      course('demain', '2026-11-04T08:00:00Z'),
      course('tard', '2026-11-03T18:00:00Z'),
      course('tot', '2026-11-03T09:00:00Z'),
    ]
    const { aujourdhui, suivantes } = repartirPlanning(recue, new Date('2026-11-03T08:00:00Z'))
    expect(ids(aujourdhui)).toEqual(['tot', 'tard'])
    expect(ids(suivantes)).toEqual(['demain', 'apres-demain'])
    expect(recue[0]?.id).toBe('apres-demain')
  })
})

// ---------------------------------------------------------------------------
// Les deux pages, sur une vraie base semée.
// ---------------------------------------------------------------------------

// La garde est simulée : elle est éprouvée sur de vraies sessions dans
// tests/acces.test.ts, et sa présence dans chaque page par le test de structure.
const garde = vi.hoisted(() => ({ chauffeurId: 'demo-chauffeur-1' }))
vi.mock('../lib/garde.ts', () => ({
  exigerEspace: async () => ({ user: { id: garde.chauffeurId, name: 'Hakim Diallo' } }),
}))

vi.mock('next/navigation', async () => {
  const { notFound } = await import('next/dist/client/components/not-found.js')
  return { notFound }
})

/// Midi à Paris : une heure fixe, pour que « aujourd'hui » ne dépende pas de l'heure à
/// laquelle les tests tournent. Seul `Date` est simulé : la base garde ses vrais délais.
const MIDI = new Date('2026-11-03T11:00:00Z')

async function liste(): Promise<string> {
  const { default: Page } = await import('../app/(chauffeur)/chauffeur/courses/page.tsx')
  return renderToStaticMarkup(await Page())
}

async function detail(id: string): Promise<string> {
  const { default: Page } = await import('../app/(chauffeur)/chauffeur/courses/[id]/page.tsx')
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }))
}

function coursesDe(page: string, section: string): string[] {
  const debut = page.indexOf(`id="${section}"`)
  expect(debut, `section ${section}`).toBeGreaterThan(-1)
  const contenu = page.slice(debut, page.indexOf('</section>', debut))
  return [...contenu.matchAll(/href="\/chauffeur\/courses\/([^"]+)"/g)].map(([, id]) => id!)
}

let numero = 0

async function creerCourse(etat: Etat, decalage: number, chauffeurId = 'demo-chauffeur-1') {
  numero += 1
  const id = `planning-${numero}`
  await prisma().course.create({
    data: {
      id,
      clientId: 'demo-client',
      chauffeurId,
      etat,
      departLabel: 'Place du Capitole, 31000 Toulouse',
      departLat: 43.6045,
      departLon: 1.444,
      arriveeLabel: 'Aéroport Toulouse-Blagnac, 31700 Blagnac',
      arriveeLat: 43.6293,
      arriveeLon: 1.3638,
      departAt: new Date(MIDI.getTime() + decalage),
    },
  })
  return id
}

describe('sur une vraie base', () => {
  let dossier: string

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: MIDI })
    dossier = mkdtempSync(join(tmpdir(), 'carin-planning-'))
    const url = `file:${join(dossier, 'planning.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
  }, 120_000)

  afterAll(async () => {
    vi.useRealTimers()
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  // Chaque test repart de la semence, sans ce que les précédents ont ajouté.
  beforeEach(async () => {
    garde.chauffeurId = 'demo-chauffeur-1'
    await prisma().course.deleteMany()
    await semer(prisma(), new Date())
  })

  describe('Mes courses', () => {
    it('montre celles du jour d’abord, puis les suivantes, chacune avec son lien', async () => {
      // Semence : demo-course-3 (ACCEPTEE, +3 h) est la seule d'Hakim.
      const demain = await creerCourse('ACCEPTEE', JOUR)
      const ceSoir = await creerCourse('ACCEPTEE', 6 * HEURE)
      const oubliee = await creerCourse('EN_COURSE', -2 * JOUR)

      const page = await liste()

      expect(coursesDe(page, 'aujourdhui')).toEqual([oubliee, 'demo-course-3', ceSoir])
      expect(coursesDe(page, 'suivantes')).toEqual([demain])
      expect(page.indexOf('id="aujourdhui"')).toBeLessThan(page.indexOf('id="suivantes"'))
    })

    it('ne montre jamais les courses d’un collègue ni les disponibles', async () => {
      const page = await liste()
      expect(page).not.toContain('demo-course-4') // Sophie
      expect(page).not.toContain('demo-course-1') // disponible
      expect(page).not.toContain('demo-course-2') // disponible
    })

    it.each(['annuler', 'terminer'] as const)('retire une course après « %s »', async (action) => {
      const id = await creerCourse(action === 'terminer' ? 'EN_COURSE' : 'ACCEPTEE', HEURE)
      expect(await liste()).toContain(id)

      const auteur = action === 'terminer' ? 'demo-chauffeur-1' : 'demo-client'
      expect(await executerTransition(prisma(), action, id, auteur)).toEqual({ effectuee: true })

      expect(await liste()).not.toContain(id)
    })

    it('fait apparaître une course dès qu’elle est acceptée', async () => {
      // demo-course-1 part dans deux jours.
      expect(await liste()).not.toContain('demo-course-1')
      await executerTransition(prisma(), 'accepter', 'demo-course-1', 'demo-chauffeur-1')
      expect(coursesDe(await liste(), 'suivantes')).toEqual(['demo-course-1'])
    })

    it('dit quoi faire quand les deux listes sont vides', async () => {
      garde.chauffeurId = 'demo-chauffeur-3' // sa seule course est terminée
      const page = await liste()
      expect(page).not.toContain('<ul')
      expect(page).toContain('Vous n’avez aucune course à assurer aujourd’hui.')
      expect(page).toContain('Vous n’avez aucune course prévue les jours suivants.')
      expect(page).toContain('Voir les courses disponibles')
    })
  })

  describe('détail d’une course', () => {
    it('affiche le téléphone du client, cliquable, et son nom', async () => {
      const page = await detail('demo-course-3')
      expect(page).toContain('Camille Besson')
      expect(page).toContain('href="tel:0612345678"')
    })

    it('affiche la carte, les deux adresses complètes et les contraintes', async () => {
      const page = await detail('demo-course-3')
      const depart = 'Gare de Toulouse Matabiau, 64 Boulevard Pierre Sémard, 31000 Toulouse'
      const arrivee = 'Hôpital Purpan, Place du Docteur Baylac, 31300 Toulouse'
      expect(page).toContain(`Carte du trajet, de ${depart} à ${arrivee}</figcaption>`)
      expect(page).toMatch(new RegExp(`Départ</dt><dd[^>]*>${depart}`))
      expect(page).toMatch(new RegExp(`Arrivée</dt><dd[^>]*>${arrivee}`))
      expect(page).toContain('3 passagers')
      expect(page).toContain('1 bagage')
      expect(page).toMatch(/Siège enfant<\/dt><dd[^>]*>Oui/)
      expect(page).toContain('Siège enfant pour un enfant de 3 ans.')
    })

    it('ne laisse sortir du compte client que son nom et son téléphone', async () => {
      expect(await detail('demo-course-3')).not.toContain('camille.besson@exemple.fr')
    })

    it('dit qu’une course annulée l’est, sans téléphone à appeler', async () => {
      await executerTransition(prisma(), 'annuler', 'demo-course-3', 'demo-client')
      const page = await detail('demo-course-3')
      expect(page).toContain('Le client a annulé cette course le ')
      expect(page).not.toContain('href="tel:')
      expect(page).not.toContain('0612345678')
    })

    it.each([
      ['la course d’un collègue', 'demo-course-4'],
      ['une course encore disponible', 'demo-course-1'],
      ['un identifiant inventé', 'inexistante'],
    ])('rend la page introuvable pour %s', async (_cas, id) => {
      const erreur = await detail(id).catch((e: unknown) => e)
      expect(isHTTPAccessFallbackError(erreur)).toBe(true)
    })

    it('la ferme à un chauffeur après son désengagement', async () => {
      expect(await detail('demo-course-3')).toContain('0612345678')
      await executerTransition(prisma(), 'seDesengager', 'demo-course-3', 'demo-chauffeur-1')
      const erreur = await detail('demo-course-3').catch((e: unknown) => e)
      expect(isHTTPAccessFallbackError(erreur)).toBe(true)
    })
  })
})
