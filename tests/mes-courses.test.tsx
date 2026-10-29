import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isHTTPAccessFallbackError } from 'next/dist/client/components/http-access-fallback/http-access-fallback.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { LIBELLES_ETAT } from '../components/ui/BadgeEtat.tsx'
import { ETATS, type Etat } from '../lib/domaine/course.ts'
import {
  CHAUFFEUR_INCONNU,
  MESSAGE_EN_ATTENTE,
  MESSAGE_EN_RETARD,
  enAttenteEnRetard,
  repartirCourses,
} from '../lib/mes-courses.ts'
import { prisma } from '../lib/prisma.ts'
import { semer } from '../prisma/semence.mts'

const HEURE = 60 * 60_000

// ---------------------------------------------------------------------------
// La répartition, seule.
// ---------------------------------------------------------------------------

describe('repartirCourses', () => {
  const maintenant = new Date('2026-11-03T12:00:00Z')
  const course = (id: string, etat: Etat, decalage: number) => ({
    id,
    etat,
    departAt: new Date(maintenant.getTime() + decalage),
  })

  it('sépare par état, jamais par date', () => {
    // Un départ passé encore vivant reste à venir ; un départ futur annulé est passé.
    const { aVenir, passees } = repartirCourses([
      course('demandee-passee', 'DEMANDEE', -5 * HEURE),
      course('annulee-future', 'ANNULEE', 48 * HEURE),
      course('en-course', 'EN_COURSE', -1 * HEURE),
      course('terminee', 'TERMINEE', -24 * HEURE),
      course('acceptee', 'ACCEPTEE', 2 * HEURE),
    ])
    expect(aVenir.map((c) => c.id).sort()).toEqual(['acceptee', 'demandee-passee', 'en-course'])
    expect(passees.map((c) => c.id).sort()).toEqual(['annulee-future', 'terminee'])
  })

  it.each(ETATS)('range chaque course %s dans une et une seule liste', (etat) => {
    const { aVenir, passees } = repartirCourses([course('c', etat, 0)])
    expect(aVenir.length + passees.length).toBe(1)
    const attendue = etat === 'TERMINEE' || etat === 'ANNULEE' ? passees : aVenir
    expect(attendue).toHaveLength(1)
  })

  it('met la plus proche d’abord à venir, la plus récente d’abord dans les passées', () => {
    const { aVenir, passees } = repartirCourses([
      course('dans-2j', 'DEMANDEE', 48 * HEURE),
      course('il-y-a-1h', 'DEMANDEE', -1 * HEURE),
      course('dans-3h', 'ACCEPTEE', 3 * HEURE),
      course('il-y-a-2j', 'TERMINEE', -48 * HEURE),
      course('il-y-a-1j', 'ANNULEE', -24 * HEURE),
      course('dans-1j', 'ANNULEE', 24 * HEURE),
    ])
    expect(aVenir.map((c) => c.id)).toEqual(['il-y-a-1h', 'dans-3h', 'dans-2j'])
    expect(passees.map((c) => c.id)).toEqual(['dans-1j', 'il-y-a-1j', 'il-y-a-2j'])
  })

  it('ne modifie pas la liste reçue', () => {
    const recue = [course('b', 'DEMANDEE', 2 * HEURE), course('a', 'DEMANDEE', HEURE)]
    repartirCourses(recue)
    expect(recue.map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('signale en retard une course DEMANDEE dont l’heure est passée, et elle seule', () => {
    expect(enAttenteEnRetard(course('c', 'DEMANDEE', -1), maintenant)).toBe(true)
    expect(enAttenteEnRetard(course('c', 'DEMANDEE', 0), maintenant)).toBe(true)
    expect(enAttenteEnRetard(course('c', 'DEMANDEE', 1), maintenant)).toBe(false)
    for (const etat of ETATS.filter((e) => e !== 'DEMANDEE')) {
      expect(enAttenteEnRetard(course('c', etat, -HEURE), maintenant), etat).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Les deux pages, sur une vraie base semée.
// ---------------------------------------------------------------------------

// La garde est simulée : elle est éprouvée sur de vraies sessions dans
// tests/acces.test.ts, et sa présence dans chaque page par le test de structure du
// même fichier.
const garde = vi.hoisted(() => ({ clientId: 'demo-client' }))
vi.mock('../lib/garde.ts', () => ({
  exigerEspace: async () => ({ user: { id: garde.clientId, name: 'Camille Besson' } }),
}))

vi.mock('next/navigation', async () => {
  const { notFound } = await import('next/dist/client/components/not-found.js')
  return { notFound }
})

/// Identifiants des courses, dans l'ordre où la section les affiche.
function ordreDansSection(page: string, identifiant: string): string[] {
  const debut = page.indexOf(`id="${identifiant}"`)
  expect(debut, `section ${identifiant}`).toBeGreaterThan(-1)
  const fin = page.indexOf('</section>', debut)
  const section = page.slice(debut, fin)
  return [...section.matchAll(/href="\/client\/courses\/([^"]+)"/g)].map(([, id]) => id!)
}

function sectionDe(page: string, identifiant: string): string {
  const debut = page.indexOf(`id="${identifiant}"`)
  return page.slice(debut, page.indexOf('</section>', debut))
}

/// Les messages se cherchent tels quels dans le rendu : ils emploient l'apostrophe
/// typographique, que React n'échappe pas.
async function mesCourses(): Promise<string> {
  const { default: Page } = await import('../app/(client)/client/page.tsx')
  return renderToStaticMarkup(await Page())
}

async function detail(id: string): Promise<string> {
  const { default: Page } = await import('../app/(client)/client/courses/[id]/page.tsx')
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }))
}

describe('sur une vraie base', () => {
  let dossier: string

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-mes-courses-'))
    const url = `file:${join(dossier, 'mes-courses.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
    await semer(prisma(), new Date())
    await prisma().user.create({
      data: { id: 'autre-client', email: 'autre@exemple.fr', nom: 'Autre', telephone: '0600000000' },
    })
  }, 120_000)

  afterAll(async () => {
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  beforeEach(() => {
    garde.clientId = 'demo-client'
  })

  describe('Mes courses', () => {
    it('range les courses semées par état, dans l’ordre attendu', async () => {
      const page = await mesCourses()
      // Semence : 2 (DEMANDEE, -1 h), 4 (EN_COURSE, -25 min), 3 (ACCEPTEE, +3 h),
      // 1 (DEMANDEE, +2 j) ; 6 (ANNULEE, -1 j), 5 (TERMINEE, -2 j).
      expect(ordreDansSection(page, 'a-venir')).toEqual([
        'demo-course-2',
        'demo-course-4',
        'demo-course-3',
        'demo-course-1',
      ])
      expect(ordreDansSection(page, 'passees')).toEqual(['demo-course-6', 'demo-course-5'])
    })

    it('garde à venir la course DEMANDEE dont l’heure est passée, signalée (S8, S9)', async () => {
      const aVenir = sectionDe(await mesCourses(), 'a-venir')
      expect(aVenir).toContain('demo-course-2')
      // Une seule course de la semence est en attente et en retard : le message
      // apparaît une fois, pas sur la course DEMANDEE à venir dans deux jours.
      expect(aVenir.split(MESSAGE_EN_RETARD)).toHaveLength(2)
      const ligne = aVenir.slice(aVenir.indexOf('demo-course-2'), aVenir.indexOf('demo-course-4'))
      expect(ligne).toContain(MESSAGE_EN_RETARD)
    })

    it('affiche l’état sur chaque ligne', async () => {
      const page = await mesCourses()
      const lignes = page.split('<li>').slice(1)
      expect(lignes).toHaveLength(6)
      for (const ligne of lignes) {
        expect(ETATS.some((etat) => ligne.includes(LIBELLES_ETAT[etat])), ligne).toBe(true)
      }
      expect(sectionDe(page, 'passees')).toContain(LIBELLES_ETAT.ANNULEE)
      expect(sectionDe(page, 'passees')).toContain(LIBELLES_ETAT.TERMINEE)
    })

    it('écrit « aucun bagage » plutôt que « 0 bagage »', async () => {
      // demo-course-2 part sans bagage.
      const page = await mesCourses()
      expect(page).toContain('1 passager · aucun bagage')
      expect(page).not.toContain('0 bagage')
    })

    it('ne montre jamais les courses d’un autre client', async () => {
      garde.clientId = 'autre-client'
      const page = await mesCourses()
      expect(page).not.toContain('demo-course-')
    })

    it('invite à réserver quand les deux listes sont vides', async () => {
      garde.clientId = 'autre-client'
      const page = await mesCourses()
      for (const section of ['a-venir', 'passees']) {
        const contenu = sectionDe(page, section)
        expect(contenu).not.toContain('<ul')
        expect(contenu).toContain('href="/client/reserver"')
        expect(contenu).toMatch(/[Rr]éserve/)
      }
    })
  })

  describe('détail d’une course', () => {
    it('affiche le nom et le téléphone du chauffeur dès l’acceptation', async () => {
      const page = await detail('demo-course-3')
      expect(page).toContain('Hakim Diallo')
      expect(page).toContain('href="tel:0623456789"')
      expect(page).toContain(LIBELLES_ETAT.ACCEPTEE)
    })

    it('les affiche encore pendant la course', async () => {
      const page = await detail('demo-course-4')
      expect(page).toContain('Sophie Marchand')
      expect(page).toContain('href="tel:0634567890"')
    })

    it('n’affiche aucun chauffeur tant que personne n’a accepté, et dit pourquoi (S9)', async () => {
      const page = await detail('demo-course-1')
      expect(page).not.toContain('Votre chauffeur')
      expect(page).not.toContain('href="tel:')
      expect(page).toContain(MESSAGE_EN_ATTENTE)
      expect(page).not.toContain(MESSAGE_EN_RETARD)
    })

    it('signale la course en attente dont l’heure est passée', async () => {
      const page = await detail('demo-course-2')
      expect(page).toContain(MESSAGE_EN_ATTENTE)
      expect(page).toContain(MESSAGE_EN_RETARD)
    })

    it('dit qu’une course annulée l’est, sans chauffeur à appeler', async () => {
      const page = await detail('demo-course-6')
      expect(page).toContain(LIBELLES_ETAT.ANNULEE)
      expect(page).toContain('Cette course a été annulée le ')
      expect(page).not.toContain('href="tel:')
      // S11 : estimation échouée, aucun prix inventé.
      expect(page).toContain('Prix confirmé par la compagnie')
    })

    it('affiche les contraintes et la carte des deux points', async () => {
      const page = await detail('demo-course-3')
      expect(page).toContain('3 passagers')
      expect(page).toContain('1 bagage')
      expect(page).toMatch(/Siège enfant<\/dt><dd[^>]*>Oui/)
      expect(page).toContain('Siège enfant pour un enfant de 3 ans.')
      expect(page).toContain(
        'Carte du trajet, de Gare de Toulouse Matabiau, 64 Boulevard Pierre Sémard, 31000 Toulouse ' +
          'à Hôpital Purpan, Place du Docteur Baylac, 31300 Toulouse</figcaption>',
      )
    })

    it('signale une course acceptée sans chauffeur au lieu de la montrer assurée', async () => {
      // État que les transitions interdisent, forcé ici pour voir la page y tenir.
      const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {})
      await prisma().course.update({ where: { id: 'demo-course-3' }, data: { chauffeurId: null } })
      try {
        const page = await detail('demo-course-3')
        expect(page).toContain(CHAUFFEUR_INCONNU)
        expect(erreurs).toHaveBeenCalled()
      } finally {
        await prisma().course.update({
          where: { id: 'demo-course-3' },
          data: { chauffeurId: 'demo-chauffeur-1' },
        })
        erreurs.mockRestore()
      }
    })

    it.each([
      ['la course d’un autre client', 'autre-client', 'demo-course-3'],
      ['un identifiant inventé', 'demo-client', 'inexistante'],
    ])('rend la page introuvable pour %s', async (_cas, client, id) => {
      garde.clientId = client
      const erreur = await detail(id).catch((e: unknown) => e)
      expect(isHTTPAccessFallbackError(erreur)).toBe(true)
    })
  })
})
