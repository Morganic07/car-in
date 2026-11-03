import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getURLFromRedirectError } from 'next/dist/client/components/redirect.js'
import { isRedirectError } from 'next/dist/client/components/redirect-error.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { annulerCourse } from '../app/(client)/client/courses/[id]/actions.ts'
import { repartirCourses } from '../lib/mes-courses.ts'
import type { Etat } from '../lib/domaine/course.ts'
import { prisma } from '../lib/prisma.ts'
import { COURSE_INTROUVABLE, executerTransition } from '../lib/transitions.ts'
import { semer } from '../prisma/semence.mts'

// La garde est simulée : elle est éprouvée sur de vraies sessions dans
// tests/acces.test.ts, et sa présence en tête de l'action par le test de structure du
// même fichier. Le verdict reste réglable, pour vérifier que l'action s'y arrête.
const CLIENT = 'demo-client'
const CHAUFFEUR = 'demo-chauffeur-1'

const garde = vi.hoisted(() => ({
  verdict: { permis: true, session: { user: { id: 'demo-client' } } } as
    | { permis: true; session: { user: { id: string } } }
    | { permis: false; motif: string },
}))
vi.mock('../lib/garde.ts', () => ({
  autoriser: async () => garde.verdict,
  exigerEspace: async () => ({ user: { id: 'demo-client', name: 'Camille Besson' } }),
}))

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)

vi.mock('next/navigation', async () => {
  const { redirect } = await import('next/dist/client/components/redirect.js')
  const { notFound } = await import('next/dist/client/components/not-found.js')
  return { redirect, notFound }
})

let numero = 0

/// Une course neuve par test : aucun ne dépend de ce qu'un autre a transité. Le jalon
/// de chaque état est posé pour que l'historique reste celui d'une vraie course.
async function creerCourse(etat: Etat, clientId: string = CLIENT): Promise<string> {
  numero += 1
  const id = `annulation-${numero}`
  const jalon = new Date('2026-11-03T08:00:00Z')
  const avecChauffeur = etat === 'ACCEPTEE' || etat === 'EN_COURSE' || etat === 'TERMINEE'
  await prisma().course.create({
    data: {
      id,
      clientId,
      etat,
      chauffeurId: avecChauffeur ? CHAUFFEUR : null,
      departLabel: 'Place du Capitole, 31000 Toulouse',
      departLat: 43.6045,
      departLon: 1.444,
      arriveeLabel: 'Aéroport Toulouse-Blagnac, 31700 Blagnac',
      arriveeLat: 43.6293,
      arriveeLon: 1.3638,
      departAt: new Date('2026-11-03T09:00:00Z'),
      accepteeAt: avecChauffeur ? jalon : null,
      demarreeAt: etat === 'EN_COURSE' || etat === 'TERMINEE' ? jalon : null,
      termineeAt: etat === 'TERMINEE' ? jalon : null,
      annuleeAt: etat === 'ANNULEE' ? jalon : null,
    },
  })
  return id
}

function relire(id: string) {
  return prisma().course.findUniqueOrThrow({ where: { id } })
}

function demande(courseId: string): FormData {
  const formulaire = new FormData()
  formulaire.append('courseId', courseId)
  return formulaire
}

const annuler = (courseId: string) => annulerCourse({}, demande(courseId))

async function detail(id: string): Promise<string> {
  const { default: Page } = await import('../app/(client)/client/courses/[id]/page.tsx')
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }))
}

describe('annulation par le client', () => {
  let dossier: string

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-annulation-'))
    const url = `file:${join(dossier, 'annulation.db')}`
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
    garde.verdict = { permis: true, session: { user: { id: CLIENT } } }
    cache.revalidatePath.mockClear()
  })

  describe('le bouton', () => {
    it.each(['DEMANDEE', 'ACCEPTEE', 'EN_COURSE'] as const)(
      'est présent sur une course %s, derrière une confirmation',
      async (etat) => {
        const page = await detail(await creerCourse(etat))
        expect(page).toContain('Annuler la course')

        // L'envoi n'est possible que depuis le dialogue : le premier bouton ne soumet rien.
        const debut = page.indexOf('<dialog')
        const fin = page.indexOf('</dialog>')
        expect(debut).toBeGreaterThan(-1)
        const dialogue = page.slice(debut, fin)
        expect(dialogue).toContain('Annuler cette course ?')
        expect(dialogue).toContain('Non, garder ma course')
        expect(dialogue).toMatch(/<button type="submit"[^>]*>Oui, annuler la course/)
        expect(page.match(/type="submit"/g)).toHaveLength(1)

        // `showModal` donne le focus au premier bouton du dialogue : ce doit être le refus,
        // sinon un double appui sur Entrée annule la course.
        expect(dialogue.match(/<button[^>]*>([^<]+)/)?.[1]).toBe('Non, garder ma course')
      },
    )

    it.each(['TERMINEE', 'ANNULEE'] as const)('est absent d’une course %s', async (etat) => {
      const page = await detail(await creerCourse(etat))
      expect(page).not.toContain('Annuler la course')
      expect(page).not.toContain('<dialog')
    })
  })

  describe('l’action', () => {
    it.each(['DEMANDEE', 'ACCEPTEE', 'EN_COURSE'] as const)('annule une course %s', async (etat) => {
      const id = await creerCourse(etat)
      const avant = await relire(id)

      expect(await annuler(id)).toEqual({ annulee: true })

      const apres = await relire(id)
      expect(apres.etat).toBe('ANNULEE')
      expect(apres.annuleeAt).toBeInstanceOf(Date)
      // Ce qui a eu lieu reste écrit : une course annulée en route a bien été acceptée.
      expect(apres.chauffeurId).toBe(avant.chauffeurId)
      expect(apres.accepteeAt).toEqual(avant.accepteeAt)
      expect(apres.demarreeAt).toEqual(avant.demarreeAt)
      expect(apres.termineeAt).toBeNull()
      expect(cache.revalidatePath).toHaveBeenCalledWith('/client', 'layout')
    })

    it.each([
      ['TERMINEE', 'Cette course est déjà terminée.'],
      ['ANNULEE', 'Cette course a été annulée.'],
    ] as const)('refuse une requête forgée sur une course %s', async (etat, message) => {
      const id = await creerCourse(etat)
      const avant = await relire(id)

      expect(await annuler(id)).toEqual({ erreur: message })

      expect(await relire(id)).toEqual(avant)
      // L'écran montrait un état périmé : il est rafraîchi, refus compris.
      expect(cache.revalidatePath).toHaveBeenCalledWith('/client', 'layout')
    })

    it('refuse la course d’un autre client comme un identifiant inventé', async () => {
      const id = await creerCourse('DEMANDEE', 'autre-client')
      const avant = await relire(id)

      expect(await annuler(id)).toEqual({ erreur: COURSE_INTROUVABLE })
      expect(await annuler('inexistante')).toEqual({ erreur: COURSE_INTROUVABLE })

      expect(await relire(id)).toEqual(avant)
    })

    it('refuse une requête sans identifiant', async () => {
      expect(await annulerCourse({}, new FormData())).toEqual({ erreur: COURSE_INTROUVABLE })
    })

    it('s’arrête au verdict de la garde, sans rien écrire', async () => {
      const id = await creerCourse('DEMANDEE')
      const motif = 'Cette action est réservée aux clients.'
      garde.verdict = { permis: false, motif }

      expect(await annuler(id)).toEqual({ erreur: motif })

      expect((await relire(id)).etat).toBe('DEMANDEE')
    })

    it('dit la panne de la base, sans prétendre avoir annulé', async () => {
      const id = await creerCourse('DEMANDEE')
      const panne = new Error('SQLITE_BUSY: database is locked')
      const ecriture = vi.spyOn(prisma().course, 'updateMany').mockRejectedValueOnce(panne)
      const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { erreur, annulee } = await annuler(id)
        expect(annulee).toBeUndefined()
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

  describe('après l’annulation (S4)', () => {
    it('la course quitte les disponibles des chauffeurs', async () => {
      const id = await creerCourse('DEMANDEE')
      const disponibles = () => prisma().course.findMany({ where: { etat: 'DEMANDEE', chauffeurId: null } })
      expect((await disponibles()).map((c) => c.id)).toContain(id)

      await annuler(id)

      expect((await disponibles()).map((c) => c.id)).not.toContain(id)
    })

    it('la course reste dans l’historique du client, avec la mention annulée', async () => {
      const id = await creerCourse('ACCEPTEE')
      await annuler(id)

      const courses = await prisma().course.findMany({ where: { clientId: CLIENT } })
      const { aVenir, passees } = repartirCourses(courses)
      expect(passees.map((c) => c.id)).toContain(id)
      expect(aVenir.map((c) => c.id)).not.toContain(id)

      const page = await detail(id)
      expect(page).toContain('Cette course a été annulée le ')
      expect(page).not.toContain('Annuler la course')
    })

    it('le retour arrière sur la confirmation mène au détail, pas à « Course réservée »', async () => {
      const { default: Page } = await import('../app/(client)/client/reserver/confirmee/[id]/page.tsx')
      const confirmation = (id: string) => Page({ params: Promise.resolve({ id }) })

      const id = await creerCourse('DEMANDEE')
      expect(renderToStaticMarkup(await confirmation(id))).toContain('Course réservée')

      await annuler(id)

      const erreur = await confirmation(id).catch((e: unknown) => e)
      expect(isRedirectError(erreur)).toBe(true)
      expect(getURLFromRedirectError(erreur as never)).toBe(`/client/courses/${id}`)
    })
  })

  describe('concurrence', () => {
    const TOURS = 20

    // Les deux ordres d'appel : `Promise.all` lance dans l'ordre du tableau. Éprouvé sur
    // une version « je lis, je décide, j'écris » de `executerTransition` : ce test rougit.
    //
    // Au niveau de `executerTransition`, à égalité : l'action passe d'abord par sa garde,
    // et `terminer` arriverait toujours le premier à l'écriture, quel que soit l'ordre.
    it('annuler et terminer en même temps : une seule aboutit, l’autre a un message', async () => {
      const gagnants = new Set<string>()

      for (let tour = 0; tour < TOURS; tour += 1) {
        const id = await creerCourse('EN_COURSE')
        const annulation = () => executerTransition(prisma(), 'annuler', id, CLIENT)
        const fin = () => executerTransition(prisma(), 'terminer', id, CHAUFFEUR)

        const [parAnnulation, parFin] =
          tour % 2 === 0
            ? await Promise.all([annulation(), fin()])
            : (await Promise.all([fin(), annulation()])).toReversed()

        const course = await relire(id)
        if (parAnnulation?.effectuee === true) {
          expect(parFin).toEqual({ effectuee: false, motif: 'Cette course a été annulée.' })
          expect(course.etat).toBe('ANNULEE')
          expect(course.termineeAt).toBeNull()
          gagnants.add('annuler')
        } else {
          expect(parFin).toEqual({ effectuee: true })
          expect(parAnnulation).toEqual({
            effectuee: false,
            motif: 'Cette course est déjà terminée.',
          })
          expect(course.etat).toBe('TERMINEE')
          expect(course.annuleeAt).toBeNull()
          gagnants.add('terminer')
        }
      }

      // Sans quoi l'une des deux branches ci-dessus n'aurait jamais été vérifiée.
      expect([...gagnants].sort()).toEqual(['annuler', 'terminer'])
    })

    it('l’action annuler, en course contre terminer, rend le refus à l’écran', async () => {
      const id = await creerCourse('EN_COURSE')

      const [parAnnulation, parFin] = await Promise.all([
        annuler(id),
        executerTransition(prisma(), 'terminer', id, CHAUFFEUR),
      ])

      expect(parFin).toEqual({ effectuee: true })
      expect(parAnnulation).toEqual({ erreur: 'Cette course est déjà terminée.' })
      expect((await relire(id)).etat).toBe('TERMINEE')
    })

    it('ne réécrit jamais une course TERMINEE en ANNULEE', async () => {
      const id = await creerCourse('EN_COURSE')
      expect(await executerTransition(prisma(), 'terminer', id, CHAUFFEUR)).toEqual({ effectuee: true })
      const terminee = await relire(id)

      expect(await annuler(id)).toEqual({ erreur: 'Cette course est déjà terminée.' })

      expect(await relire(id)).toEqual(terminee)
    })

    // PLAN.md §4 : asymétrique, et c'est normal — jamais « une seule des deux aboutit ».
    it('refuse le démarrage d’une course annulée', async () => {
      const id = await creerCourse('ACCEPTEE')
      await annuler(id)
      expect(await executerTransition(prisma(), 'demarrer', id, CHAUFFEUR)).toEqual({
        effectuee: false,
        motif: 'Cette course a été annulée.',
      })
      expect((await relire(id)).demarreeAt).toBeNull()
    })

    it('accepte l’annulation d’une course qui vient de démarrer', async () => {
      const id = await creerCourse('ACCEPTEE')
      expect(await executerTransition(prisma(), 'demarrer', id, CHAUFFEUR)).toEqual({ effectuee: true })
      expect(await annuler(id)).toEqual({ annulee: true })

      const course = await relire(id)
      expect(course.etat).toBe('ANNULEE')
      expect(course.demarreeAt).toBeInstanceOf(Date)
    })
  })

  describe('executerTransition, pour les actions chauffeur à venir', () => {
    it('accepter pose le chauffeur et refuse le suivant', async () => {
      const id = await creerCourse('DEMANDEE')
      expect(await executerTransition(prisma(), 'accepter', id, CHAUFFEUR)).toEqual({ effectuee: true })
      expect(await executerTransition(prisma(), 'accepter', id, 'demo-chauffeur-2')).toEqual({
        effectuee: false,
        motif: 'Cette course vient d’être prise par un autre chauffeur.',
      })

      const course = await relire(id)
      expect(course.etat).toBe('ACCEPTEE')
      expect(course.chauffeurId).toBe(CHAUFFEUR)
      expect(course.accepteeAt).toBeInstanceOf(Date)
    })

    it('se désengager remet la course sans chauffeur ni acceptation', async () => {
      const id = await creerCourse('ACCEPTEE')
      expect(await executerTransition(prisma(), 'seDesengager', id, CHAUFFEUR)).toEqual({ effectuee: true })

      const course = await relire(id)
      expect(course.etat).toBe('DEMANDEE')
      expect(course.chauffeurId).toBeNull()
      expect(course.accepteeAt).toBeNull()
    })

    it('refuse à un chauffeur la course d’un autre, sans rien écrire', async () => {
      const id = await creerCourse('EN_COURSE')
      const avant = await relire(id)

      expect(await executerTransition(prisma(), 'terminer', id, 'demo-chauffeur-2')).toEqual({
        effectuee: false,
        motif: COURSE_INTROUVABLE,
      })

      expect(await relire(id)).toEqual(avant)
    })
  })
})
