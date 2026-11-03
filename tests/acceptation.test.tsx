import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { accepterCourse } from '../app/(chauffeur)/chauffeur/actions.ts'
import { prisma } from '../lib/prisma.ts'
import { COURSE_INTROUVABLE } from '../lib/transitions.ts'
import { semer } from '../prisma/semence.mts'

const CHAUFFEURS = ['demo-chauffeur-1', 'demo-chauffeur-2', 'demo-chauffeur-3']
const PRISE = 'Cette course vient d’être prise par un autre chauffeur.'

type Verdict =
  | { permis: true; session: { user: { id: string } } }
  | { permis: false; motif: string }

// La garde est simulée : elle est éprouvée sur de vraies sessions dans
// tests/acces.test.ts, et sa présence en tête de l'action par le test de structure du
// même fichier. Une file de verdicts, pour que des appels simultanés aient chacun leur
// chauffeur.
const garde = vi.hoisted(() => ({ verdicts: [] as Verdict[] }))
vi.mock('../lib/garde.ts', () => ({
  autoriser: async () => {
    const verdict = garde.verdicts.shift()
    if (verdict === undefined) throw new Error('Aucun verdict préparé pour ce test.')
    return verdict
  },
  exigerEspace: async () => ({ user: { id: 'demo-chauffeur-1', name: 'Hakim Diallo' } }),
}))

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)

let numero = 0

async function creerDemandee(): Promise<string> {
  numero += 1
  const id = `acceptation-${numero}`
  await prisma().course.create({
    data: {
      id,
      clientId: 'demo-client',
      etat: 'DEMANDEE',
      departLabel: `Départ de ${id}`,
      departLat: 43.6045,
      departLon: 1.444,
      arriveeLabel: 'Aéroport Toulouse-Blagnac, 31700 Blagnac',
      arriveeLat: 43.6293,
      arriveeLon: 1.3638,
      departAt: new Date(Date.now() + 3 * 60 * 60_000),
    },
  })
  return id
}

function relire(id: string) {
  return prisma().course.findUniqueOrThrow({ where: { id } })
}

function accepter(courseId: string, chauffeurId: string) {
  garde.verdicts.push({ permis: true, session: { user: { id: chauffeurId } } })
  const formulaire = new FormData()
  formulaire.append('courseId', courseId)
  return accepterCourse({}, formulaire)
}

async function page(): Promise<string> {
  const { default: Page } = await import('../app/(chauffeur)/chauffeur/page.tsx')
  return renderToStaticMarkup(await Page())
}

describe('accepter une course', () => {
  let dossier: string

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-acceptation-'))
    const url = `file:${join(dossier, 'acceptation.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
    await semer(prisma(), new Date())
  }, 120_000)

  afterAll(async () => {
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  beforeEach(() => {
    garde.verdicts.length = 0
    cache.revalidatePath.mockClear()
  })

  describe('l’écran', () => {
    it('propose un bouton par course, qui envoie son identifiant', async () => {
      const id = await creerDemandee()
      const html = await page()
      // Chaque attribut à part : React ne garantit pas leur ordre.
      const bouton = /<button[^>]*>Accepter</g
      const siens = [...html.matchAll(bouton)].filter(([balise]) => balise.includes(`value="${id}"`))
      expect(siens).toHaveLength(1)
      expect(siens[0]![0]).toContain('type="submit"')
      expect(siens[0]![0]).toContain('name="courseId"')
      expect(html.match(/<form/g)).toHaveLength(1)
      await prisma().course.delete({ where: { id } })
    })

    it('garde le formulaire autour de l’état vide, pour que le message y survive', async () => {
      const courses = await prisma().course.findMany({ where: { etat: 'DEMANDEE' } })
      await prisma().course.updateMany({
        where: { etat: 'DEMANDEE' },
        data: { etat: 'ANNULEE', annuleeAt: new Date() },
      })
      try {
        const html = await page()
        const debut = html.indexOf('<form')
        const fin = html.indexOf('</form>')
        expect(debut).toBeGreaterThan(-1)
        expect(html.slice(debut, fin)).toContain('Aucune course n’attend de chauffeur')
      } finally {
        for (const course of courses) {
          await prisma().course.update({
            where: { id: course.id },
            data: { etat: 'DEMANDEE', annuleeAt: null },
          })
        }
      }
    })
  })

  describe('l’action', () => {
    it('attribue la course au chauffeur et la retire des disponibles (S2)', async () => {
      const id = await creerDemandee()
      expect(await page()).toContain(`Départ de ${id}`)

      expect(await accepter(id, CHAUFFEURS[0]!)).toEqual({ acceptee: true })

      const course = await relire(id)
      expect(course.etat).toBe('ACCEPTEE')
      expect(course.chauffeurId).toBe(CHAUFFEURS[0])
      expect(course.accepteeAt).toBeInstanceOf(Date)
      expect(cache.revalidatePath).toHaveBeenCalledWith('/chauffeur', 'layout')
      expect(await page()).not.toContain(`Départ de ${id}`)
    })

    it('refuse le suivant, garde le premier chauffeur et son heure (S3)', async () => {
      const id = await creerDemandee()
      await accepter(id, CHAUFFEURS[0]!)
      const avant = await relire(id)

      expect(await accepter(id, CHAUFFEURS[1]!)).toEqual({ erreur: PRISE })

      expect(await relire(id)).toEqual(avant)
      // S3 : la liste du perdant se rafraîchit aussi.
      expect(cache.revalidatePath).toHaveBeenCalledTimes(2)
    })

    it('dit à celui qui réessaie que la course est bien la sienne', async () => {
      const id = await creerDemandee()
      await accepter(id, CHAUFFEURS[0]!)
      const avant = await relire(id)

      expect(await accepter(id, CHAUFFEURS[0]!)).toEqual({ acceptee: true })

      expect(await relire(id)).toEqual(avant)
    })

    it('ne prétend pas avoir accepté une course restée DEMANDEE, même incohérente', async () => {
      // État que les transitions interdisent, et que la base n'empêche pas : aucune
      // contrainte ne relie `etat` et `chauffeurId`.
      const id = await creerDemandee()
      await prisma().course.update({ where: { id }, data: { chauffeurId: CHAUFFEURS[0]! } })

      expect((await accepter(id, CHAUFFEURS[0]!)).acceptee).toBeUndefined()

      expect((await relire(id)).etat).toBe('DEMANDEE')
      await prisma().course.delete({ where: { id } })
    })

    it('dit qu’une course annulée l’est, même à son ancien chauffeur', async () => {
      const id = await creerDemandee()
      await accepter(id, CHAUFFEURS[0]!)
      await prisma().course.update({
        where: { id },
        data: { etat: 'ANNULEE', annuleeAt: new Date() },
      })

      expect(await accepter(id, CHAUFFEURS[0]!)).toEqual({ erreur: 'Cette course a été annulée.' })
      expect(await accepter(id, CHAUFFEURS[1]!)).toEqual({ erreur: 'Cette course a été annulée.' })
      expect((await relire(id)).chauffeurId).toBe(CHAUFFEURS[0])
    })

    it('refuse un identifiant inventé, ou une requête sans identifiant', async () => {
      expect(await accepter('inexistante', CHAUFFEURS[0]!)).toEqual({ erreur: COURSE_INTROUVABLE })
      garde.verdicts.push({ permis: true, session: { user: { id: CHAUFFEURS[0]! } } })
      expect(await accepterCourse({}, new FormData())).toEqual({ erreur: COURSE_INTROUVABLE })
    })

    it('s’arrête au verdict de la garde, sans rien écrire', async () => {
      const id = await creerDemandee()
      const motif = 'Cette action est réservée aux chauffeurs.'
      garde.verdicts.push({ permis: false, motif })
      const formulaire = new FormData()
      formulaire.append('courseId', id)

      expect(await accepterCourse({}, formulaire)).toEqual({ erreur: motif })

      const course = await relire(id)
      expect(course.etat).toBe('DEMANDEE')
      expect(course.chauffeurId).toBeNull()
    })

    it('dit la panne de la base, sans prétendre avoir accepté', async () => {
      const id = await creerDemandee()
      const ecriture = vi
        .spyOn(prisma().course, 'updateMany')
        .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { erreur, acceptee } = await accepter(id, CHAUFFEURS[0]!)
        expect(acceptee).toBeUndefined()
        expect(erreur).toContain('n’a pas pu être enregistrée')
        expect(erreur).not.toContain('SQLITE')
        expect(journal).toHaveBeenCalledOnce()
      } finally {
        ecriture.mockRestore()
        journal.mockRestore()
      }
      expect((await relire(id)).etat).toBe('DEMANDEE')
    })
  })

  describe('concurrence (S3)', () => {
    const TOURS = 21

    // Par l'action complète, à égalité : chaque appel passe par la même garde. L'ordre
    // de lancement tourne, pour que chacun des trois chauffeurs gagne à son tour.
    it('trois acceptations simultanées : une seule réussit, les autres ont le message', async () => {
      const gagnants = new Set<string>()

      for (let tour = 0; tour < TOURS; tour += 1) {
        const id = await creerDemandee()
        const decalage = tour % CHAUFFEURS.length
        const ordre = [...CHAUFFEURS.slice(decalage), ...CHAUFFEURS.slice(0, decalage)]

        const issues = await Promise.all(ordre.map((chauffeur) => accepter(id, chauffeur)))

        const reussies = ordre.filter((_, i) => issues[i]?.acceptee === true)
        expect(reussies).toHaveLength(1)
        expect(issues.filter((issue) => issue.erreur === PRISE)).toHaveLength(2)

        const course = await relire(id)
        expect(course.etat).toBe('ACCEPTEE')
        expect(course.chauffeurId).toBe(reussies[0])
        gagnants.add(reussies[0]!)
      }

      // Sans quoi le test n'aurait éprouvé qu'un seul ordre.
      expect([...gagnants].sort()).toEqual(CHAUFFEURS)
    })
  })
})
