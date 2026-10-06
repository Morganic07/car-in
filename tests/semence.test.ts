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
    // La machine à états de la story 1.3 s'appuie sur ces horodatages : un jeu de
    // démonstration incohérent la ferait travailler sur des cas impossibles.
    //
    // La règle a été corrigée en écrivant cette machine à états. La première version
    // exigeait qu'une course ANNULEE ne porte *que* `annuleeAt` — ce qui est faux :
    // le périmètre autorise l'annulation depuis DEMANDEE, ACCEPTEE et EN_COURSE, et
    // annuler n'efface pas une acceptation ni un départ qui ont eu lieu. Le test
    // passait seulement parce que la semence n'annule qu'une course DEMANDEE : il
    // interdisait un état que le domaine permet.
    //
    // Rendre ces deux champs facultatifs retirait en revanche une contrainte réelle :
    // une course annulée pouvait alors porter `demarreeAt` sans `accepteeAt`, que la
    // machine à états ne sait pas produire. D'où la règle d'antériorité ci-dessous,
    // appliquée à **tous** les états : elle réduit les profils admis d'une course
    // ANNULEE à exactement trois — aucun jalon, l'acceptation seule, ou l'acceptation
    // puis le départ.
    const regles = {
      DEMANDEE: { requis: [], interdits: ['accepteeAt', 'demarreeAt', 'termineeAt', 'annuleeAt'] },
      ACCEPTEE: { requis: ['accepteeAt'], interdits: ['demarreeAt', 'termineeAt', 'annuleeAt'] },
      EN_COURSE: {
        requis: ['accepteeAt', 'demarreeAt'],
        interdits: ['termineeAt', 'annuleeAt'],
      },
      TERMINEE: {
        requis: ['accepteeAt', 'demarreeAt', 'termineeAt'],
        interdits: ['annuleeAt'],
      },
      // `accepteeAt` et `demarreeAt` sont facultatifs : ils dépendent de l'état depuis
      // lequel le client a annulé. `termineeAt` reste interdit — une course annulée
      // n'a pas été effectuée.
      ANNULEE: { requis: ['annuleeAt'], interdits: ['termineeAt'] },
    } as const

    for (const course of await client.course.findMany()) {
      const { requis, interdits } = regles[course.etat]
      for (const champ of ['accepteeAt', 'demarreeAt', 'termineeAt', 'annuleeAt'] as const) {
        const message = `${course.id} (${course.etat}) — ${champ}`
        if ((requis as readonly string[]).includes(champ)) {
          expect(course[champ], message).not.toBeNull()
        } else if ((interdits as readonly string[]).includes(champ)) {
          expect(course[champ], message).toBeNull()
        }
      }
    }
  })

  it('ne pose aucun jalon sans celui qui le précède', async () => {
    // Antériorité : on ne démarre pas une course qu'on n'a pas acceptée, on ne
    // termine pas une course qu'on n'a pas démarrée. Vrai quel que soit l'état, et
    // c'est ce qui borne les profils admis d'une course ANNULEE.
    for (const course of await client.course.findMany()) {
      if (course.demarreeAt !== null) {
        expect(course.accepteeAt, `${course.id} — démarrée sans acceptation`).not.toBeNull()
      }
      if (course.termineeAt !== null) {
        expect(course.demarreeAt, `${course.id} — terminée sans départ`).not.toBeNull()
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

      if (course.annuleeAt === null) continue

      // L'annulation vient après ce qui a déjà eu lieu : sans cette comparaison, une
      // course annulée avant même d'avoir été acceptée passerait, puisque la chaîne
      // ci-dessus écarte les valeurs nulles sans jamais regarder `annuleeAt`.
      const dernierJalon = jalons.at(-1)
      if (dernierJalon) {
        expect(
          course.annuleeAt.getTime(),
          `${course.id} — annulation antérieure à son dernier jalon`,
        ).toBeGreaterThanOrEqual(dernierJalon.getTime())
      }

      expect(course.annuleeAt.getTime(), `${course.id} — annulation`).toBeLessThanOrEqual(
        Date.now(),
      )
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

describe('commande `npm run seed`', () => {
  // Le critère de la story 1.2 porte sur la commande, pas sur la fonction : les tests
  // ci-dessus n'exécutent ni le script npm (`--env-file-if-exists`) ni le bloc
  // `import.meta.main`. Une base neuve, à elle seule : si la commande écrivait
  // ailleurs — dans la base de `.env`, par exemple —, celle-ci resterait vide.
  let dossierCommande: string
  let fichierCommande: string

  beforeAll(() => {
    dossierCommande = mkdtempSync(join(tmpdir(), 'carin-seed-cli-'))
    fichierCommande = join(dossierCommande, 'cli.db')
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: `file:${fichierCommande}` },
      stdio: 'pipe',
    })
  }, 120_000)

  afterAll(() => {
    rmSync(dossierCommande, { recursive: true, force: true })
  })

  it('remplit la base désignée, et relancée ne duplique rien', async () => {
    const lancer = () =>
      execFileSync('npm', ['run', '--silent', 'seed'], {
        env: { ...process.env, DATABASE_URL: `file:${fichierCommande}` },
        encoding: 'utf8',
        stdio: 'pipe',
      })

    const verif = creerClientPrisma(`file:${fichierCommande}`)
    try {
      expect(lancer()).toContain('Semence appliquée')
      const comptes = await verif.user.count()
      const courses = await verif.course.count()
      expect(await verif.user.count({ where: { role: 'CHAUFFEUR' } })).toBe(3)
      expect(await verif.user.count({ where: { role: 'CLIENT' } })).toBe(1)
      expect(courses).toBeGreaterThanOrEqual(6)

      expect(lancer()).toContain('Semence appliquée')
      expect(await verif.user.count()).toBe(comptes)
      expect(await verif.course.count()).toBe(courses)
    } finally {
      await verif.$disconnect()
    }
  }, 120_000)
})
