import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
// L'analyseur de TypeScript, déjà présent pour le typage : vérifier la garde action
// par action demande la syntaxe, qu'une expression régulière ne sait pas découper.
import ts from 'typescript'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONNEXION, ESPACE, destination, refusRole, roleDeSession } from '../lib/acces.ts'
import type { Role } from '../lib/domaine/course.ts'
import { auth } from '../lib/auth.ts'
import { autoriser, exigerEspace } from '../lib/garde.ts'
import { prisma } from '../lib/prisma.ts'
import { semer } from '../prisma/semence.mts'
import { config, proxy } from '../proxy.ts'

// Les gardes lisent les en-têtes de la requête en cours et redirigent : hors de Next,
// les en-têtes sont ceux du test, et la redirection est enregistrée puis interrompt
// la fonction, comme le ferait la vraie.
const requete = vi.hoisted(() => ({ entetes: new Headers(), redirections: [] as string[] }))
vi.mock('next/headers', () => ({
  headers: async () => requete.entetes,
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.')
  },
}))
vi.mock('next/navigation', () => ({
  redirect: (chemin: string) => {
    requete.redirections.push(chemin)
    throw new Error('NEXT_REDIRECT')
  },
}))

const racine = join(import.meta.dirname, '..')
const MOT_DE_PASSE = 'demo-mot-de-passe-2026' // pragma: allowlist secret — compte de test fictif

describe('règle de redirection', () => {
  it.each([
    // [chemin, rôle, destination attendue]
    ['/chauffeur', null, CONNEXION],
    ['/client', null, CONNEXION],
    ['/compte', null, CONNEXION],
    ['/chauffeur', 'CLIENT', ESPACE.CLIENT],
    ['/chauffeur/courses/42', 'CLIENT', ESPACE.CLIENT],
    ['/client', 'CHAUFFEUR', ESPACE.CHAUFFEUR],
    ['/client/reserver', 'CHAUFFEUR', ESPACE.CHAUFFEUR],
    ['/chauffeur', 'CHAUFFEUR', null],
    ['/client/reserver', 'CLIENT', null],
    ['/compte', 'CLIENT', null],
    ['/compte', 'CHAUFFEUR', null],
    // Hors des espaces : jamais de redirection.
    ['/', null, null],
    ['/connexion', null, null],
    ['/inscription', 'CLIENT', null],
    // Un préfixe n'est pas un espace : `/chauffeurs` n'est pas sous `/chauffeur`.
    ['/chauffeurs', 'CLIENT', null],
    ['/clientele', 'CHAUFFEUR', null],
  ] as const)('%s pour %s → %s', (chemin, role, attendu) => {
    expect(destination(chemin, role)).toBe(attendu)
  })

  it('ne prend jamais une valeur inconnue pour un rôle', () => {
    expect(roleDeSession(null)).toBeNull()
    expect(roleDeSession({ user: { role: 'CHAUFFEUR' } })).toBe('CHAUFFEUR')
    expect(() => roleDeSession({ user: { role: 'ADMIN' } })).toThrow(/Rôle inconnu/)
    expect(() => roleDeSession({ user: {} })).toThrow(/Rôle inconnu/)
  })
})

describe('cohérence du proxy avec la règle', () => {
  it('couvre chaque espace et le compte dans son matcher', () => {
    // Un espace absent du matcher serait servi sans redirection. Les pages
    // revérifient, mais l'oubli doit se voir ici d'abord.
    expect(config.matcher).toEqual(
      expect.arrayContaining([`${ESPACE.CLIENT}/:path*`, `${ESPACE.CHAUFFEUR}/:path*`, '/compte']),
    )
  })
})

/// Fichiers source d'un dossier, s'il existe.
function sources(dossier: string): string[] {
  const chemin = join(racine, dossier)
  if (!existsSync(chemin)) return []
  return readdirSync(chemin, { recursive: true, encoding: 'utf8' })
    .filter((fichier) => /\.tsx?$/.test(fichier))
    .map((fichier) => join(chemin, fichier))
}

/// Toute exportation qui n'est ni un type ni une interface. On ne cherche pas à
/// reconnaître les formes d'une action — une liste de formes en oublie toujours une
/// (annotation de type fonction, `let`, action enveloppée…). Dans un fichier
/// « use server », Next n'accepte à l'export que des fonctions asynchrones : toute
/// exportation de valeur est donc une action.
const ACTION_EXPORTEE = /^export\s+(?!type\b|interface\b)/gm

/// Une réexportation (`export { … }`, `export * from …`) : le corps des actions n'est
/// pas dans le fichier, on ne peut pas y vérifier la garde.
const REEXPORTATION = /^export\s*(?:\{|\*)/m

describe('chaque page et chaque action d’espace porte sa garde', () => {
  // Le proxy ne protège que son matcher, et rien de ce qui passe par une requête
  // d'action forgée : la garde doit être dans le code de chaque page et de chaque
  // action. Ce test vaut pour les pages et actions que les epics 3 et 4 ajouteront.
  const fichiers = [...sources('app/(client)'), ...sources('app/(chauffeur)')]

  it('trouve les pages d’accueil des deux espaces', () => {
    const pages = fichiers.filter((f) => f.endsWith('page.tsx'))
    expect(pages.some((f) => f.includes('(client)'))).toBe(true)
    expect(pages.some((f) => f.includes('(chauffeur)'))).toBe(true)
  })

  it.each(fichiers.filter((f) => f.endsWith('page.tsx')))(
    '%s appelle exigerEspace avec le rôle de son espace',
    (fichier) => {
      // Le rôle, pas seulement l'appel : une page de l'espace client qui exigerait le
      // rôle chauffeur — un copier-coller — passerait sinon le test.
      const role = fichier.includes(`${join('app', '(chauffeur)')}`) ? 'CHAUFFEUR' : 'CLIENT'
      expect(readFileSync(fichier, 'utf8')).toContain(`await exigerEspace('${role}')`)
    },
  )

  it('chaque action exportée d’un fichier « use server » appelle autoriser', () => {
    for (const fichier of fichiers) {
      const contenu = readFileSync(fichier, 'utf8')
      if (!/^\s*['"]use server['"]/m.test(contenu)) continue
      const nom = fichier.replace(racine, '')

      expect(contenu, `${nom} : réexportation interdite`).not.toMatch(REEXPORTATION)

      // Le décompte vérifie qu'il y a au moins autant d'appels à la garde que
      // d'actions, pas que chaque action a le sien : c'est `fautesDActions`, plus
      // bas, qui le vérifie action par action, rôle et verdict compris.
      const actions = contenu.match(ACTION_EXPORTEE)?.length ?? 0
      const gardes = contenu.match(/await autoriser\(/g)?.length ?? 0
      expect(gardes, nom).toBeGreaterThanOrEqual(actions)
    }
  })

  it('chaque page appelle exigerEspace en premier, avec le rôle de son espace', () => {
    // Plus strict que le `toContain` ci-dessus : l'appel doit ouvrir la page exportée
    // par défaut, et aucun autre rôle ne doit y être exigé.
    for (const fichier of fichiers.filter((f) => f.endsWith('page.tsx'))) {
      expect(fautesDePage(readFileSync(fichier, 'utf8'), roleDeZone(fichier)), fichier).toEqual([])
    }
  })

  it('chaque action exportée ouvre sur autoriser(rôle de son espace) et en teste le verdict', () => {
    for (const fichier of fichiers) {
      const contenu = readFileSync(fichier, 'utf8')
      if (!estFichierServeur(contenu)) continue
      expect(fautesDActions(contenu, roleDeZone(fichier)), fichier.replace(racine, '')).toEqual([])
    }
  })

  it('reconnaît toutes les formes d’action exportée', () => {
    // Le test ci-dessus ne vaut que si son décompte voit chaque forme. On l'éprouve
    // sur des exemples, puisqu'aucun fichier d'actions n'existe encore dans les espaces.
    const actions = [
      'export async function accepter() {}',
      'export default async function accepter() {}',
      'export const accepter = async () => {}',
      'export const accepter: Action = async (id: string) => {}',
      // L'annotation de type fonction contient un `=>` : la forme qui avait échappé
      // à la première version de ce décompte.
      'export const accepter: (id: string) => Promise<void> = async (id) => {}',
      'export let accepter = async () => {}',
      'export const accepter = avecJournal(async () => {})',
    ]
    for (const forme of actions) {
      expect(forme.match(ACTION_EXPORTEE), forme).toHaveLength(1)
    }

    // Les types ne sont pas des actions : ils ne doivent pas exiger de garde.
    for (const forme of ['export type Etat = { erreur?: string }', 'export interface Etat {}']) {
      expect(forme.match(ACTION_EXPORTEE), forme).toBeNull()
    }

    for (const forme of ["export { accepter } from './interne'", "export * from './interne'"]) {
      expect(forme, forme).toMatch(REEXPORTATION)
    }
    expect('export type { Etat } from "./interne"').not.toMatch(REEXPORTATION)
  })
})

/// Rôle d'une zone, déduit du chemin du fichier.
function roleDeZone(fichier: string): Role {
  return fichier.includes(join('app', '(chauffeur)')) ? 'CHAUFFEUR' : 'CLIENT'
}

/// La directive en tête de fichier — et non une chaîne citée plus bas.
function estFichierServeur(contenu: string): boolean {
  return /^\s*['"]use server['"]/m.test(contenu)
}

function analyser(contenu: string): ts.SourceFile {
  return ts.createSourceFile('source.tsx', contenu, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function exporte(noeud: ts.Node): boolean {
  return (
    ts.canHaveModifiers(noeud) &&
    (ts.getModifiers(noeud) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  )
}

type Fonction = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

/// La fonction qui porte le corps d'une action : la valeur elle-même, ou — pour une
/// action enveloppée, `avecJournal(async () => {…})` — le premier argument fonction.
function fonctionDe(noeud: ts.Node | undefined): Fonction | undefined {
  if (noeud === undefined) return undefined
  if (ts.isFunctionDeclaration(noeud) || ts.isArrowFunction(noeud) || ts.isFunctionExpression(noeud)) {
    return noeud
  }
  if (ts.isParenthesizedExpression(noeud) || ts.isAsExpression(noeud) || ts.isSatisfiesExpression(noeud)) {
    return fonctionDe(noeud.expression)
  }
  if (ts.isCallExpression(noeud)) {
    for (const argument of noeud.arguments) {
      const fonction = fonctionDe(argument)
      if (fonction) return fonction
    }
  }
  return undefined
}

function appelA(noeud: ts.Node | undefined, nom: string): ts.CallExpression | undefined {
  if (noeud === undefined) return undefined
  const appel = ts.isAwaitExpression(noeud) ? noeud.expression : noeud
  return ts.isCallExpression(appel) && ts.isIdentifier(appel.expression) && appel.expression.text === nom
    ? appel
    : undefined
}

/// Le rôle littéral passé à une garde, ou ce qui a été écrit à sa place.
function roleLitteral(appel: ts.CallExpression): string {
  const [argument, ...reste] = appel.arguments
  if (argument && reste.length === 0 && ts.isStringLiteralLike(argument)) return argument.text
  return appel.arguments.map((a) => a.getText()).join(', ') || '(aucun argument)'
}

function terminePar(instruction: ts.Statement): boolean {
  if (ts.isReturnStatement(instruction) || ts.isThrowStatement(instruction)) return true
  const derniere = ts.isBlock(instruction) ? instruction.statements.at(-1) : undefined
  return derniere !== undefined && terminePar(derniere)
}

/// Le motif exigé de toute action, et rien d'autre :
///
///     const autorisation = await autoriser('CHAUFFEUR')
///     if (!autorisation.permis) return { erreur: autorisation.motif }   // ou throw
///
/// - en **première** instruction : `autoriser` se lit avant toute lecture ou écriture ;
/// - avec le rôle de la zone, en **littéral** : une variable cacherait le rôle au test ;
/// - affecté à une `const` nommée, dont `.permis` est testé **juste après**, par un
///   `if (!x.permis)` qui sort (`return` ou `throw`). Une forme inversée ou décalée
///   serait peut-être correcte, mais le test ne saurait plus le prouver : elle est refusée.
function fautesDuCorps(fonction: Fonction, role: Role): string[] {
  if (fonction.body === undefined || !ts.isBlock(fonction.body)) {
    return ['corps sans bloc : la garde ne peut pas y ouvrir la fonction']
  }
  const [premiere, seconde] = fonction.body.statements
  const liste = premiere && ts.isVariableStatement(premiere) ? premiere.declarationList : undefined
  const declaration = liste?.declarations.length === 1 ? liste.declarations[0] : undefined
  const appel = appelA(declaration?.initializer, 'autoriser')
  if (!liste || !declaration || !appel || !ts.isAwaitExpression(declaration.initializer!)) {
    return ['n’ouvre pas sur `const … = await autoriser(…)`']
  }
  const fautes: string[] = []
  const recu = roleLitteral(appel)
  if (recu !== role) fautes.push(`autoriser(${recu}) au lieu de autoriser('${role}')`)
  if (!(liste.flags & ts.NodeFlags.Const)) {
    fautes.push('le verdict doit être une `const` : réaffecté, il ne prouverait plus rien')
  }
  if (!ts.isIdentifier(declaration.name)) {
    fautes.push('le verdict doit être affecté à un nom, pas déstructuré')
    return fautes
  }
  const verdict = declaration.name.text
  const condition = seconde && ts.isIfStatement(seconde) ? seconde.expression : undefined
  const testePermis =
    condition !== undefined &&
    ts.isPrefixUnaryExpression(condition) &&
    condition.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isPropertyAccessExpression(condition.operand) &&
    ts.isIdentifier(condition.operand.expression) &&
    condition.operand.expression.text === verdict &&
    condition.operand.name.text === 'permis'
  if (!testePermis || !terminePar((seconde as ts.IfStatement).thenStatement)) {
    fautes.push(`verdict ignoré : attendu \`if (!${verdict}.permis) return …\` juste après la garde`)
  }
  return fautes
}

/// Fautes de garde des actions d'un fichier « use server » d'une zone. Pure : elle
/// s'applique au vrai code comme aux exemples fautifs ci-dessous.
function fautesDActions(contenu: string, role: Role): string[] {
  const source = analyser(contenu)
  const fautes: string[] = []
  let analysees = 0

  for (const instruction of source.statements) {
    if (ts.isExportDeclaration(instruction)) {
      if (!instruction.isTypeOnly) fautes.push('réexportation interdite : le corps n’est pas vérifiable')
      continue
    }
    if (ts.isTypeAliasDeclaration(instruction) || ts.isInterfaceDeclaration(instruction)) continue

    let actions: Array<[string, Fonction | undefined]>
    if (ts.isExportAssignment(instruction)) {
      actions = [['export default', fonctionDe(instruction.expression)]]
    } else if (!exporte(instruction)) {
      continue
    } else if (ts.isFunctionDeclaration(instruction)) {
      actions = [[instruction.name?.text ?? 'export default', instruction]]
    } else if (ts.isVariableStatement(instruction)) {
      actions = instruction.declarationList.declarations.map((d) => [d.name.getText(), fonctionDe(d.initializer)])
    } else {
      actions = [[instruction.getText().split('\n')[0]!, undefined]]
    }
    analysees += 1

    for (const [nom, fonction] of actions) {
      if (fonction === undefined) fautes.push(`${nom} : exportation sans fonction reconnaissable`)
      else fautes.push(...fautesDuCorps(fonction, role).map((f) => `${nom} : ${f}`))
    }
  }

  // Filet : toute exportation vue par l'expression du décompte doit l'avoir été ici.
  const vues = contenu.match(ACTION_EXPORTEE)?.length ?? 0
  if (vues !== analysees) fautes.push(`${vues} exportation(s) vue(s), ${analysees} analysée(s)`)
  return fautes
}

/// Fautes de garde d'une page d'espace : son export par défaut ouvre sur
/// `exigerEspace('<rôle>')`, et aucun autre rôle n'y est exigé.
function fautesDePage(contenu: string, role: Role): string[] {
  const source = analyser(contenu)
  const fautes: string[] = []
  let page: Fonction | undefined
  for (const instruction of source.statements) {
    if (ts.isExportAssignment(instruction)) page = fonctionDe(instruction.expression)
    if (
      ts.isFunctionDeclaration(instruction) &&
      (ts.getModifiers(instruction) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      page = instruction
    }
  }
  if (page?.body === undefined || !ts.isBlock(page.body)) return ['aucune page exportée par défaut']

  const premiere = page.body.statements[0]
  const expression =
    premiere && ts.isVariableStatement(premiere)
      ? premiere.declarationList.declarations[0]?.initializer
      : premiere && ts.isExpressionStatement(premiere)
        ? premiere.expression
        : undefined
  const appel = appelA(expression, 'exigerEspace')
  if (!appel || !ts.isAwaitExpression(expression!)) {
    fautes.push('n’ouvre pas sur `await exigerEspace(…)`')
  }

  const appels: ts.CallExpression[] = []
  const visiter = (noeud: ts.Node): void => {
    const trouve = appelA(noeud, 'exigerEspace')
    if (trouve && !ts.isAwaitExpression(noeud)) appels.push(trouve)
    ts.forEachChild(noeud, visiter)
  }
  visiter(source)
  for (const autre of appels) {
    const recu = roleLitteral(autre)
    if (recu !== role) fautes.push(`exigerEspace(${recu}) au lieu de exigerEspace('${role}')`)
  }
  return fautes
}

describe('la vérification des gardes refuse ce qu’elle doit refuser', () => {
  // Aucune action n'existe encore dans les espaces (epics 3 et 4) : la vérification
  // appliquée au vrai code ne mord sur rien. Elle est donc éprouvée ici, sur des
  // fichiers d'exemple, un correct et chacun des défauts qu'elle doit voir.
  const ENTETE = `'use server'\n\nimport { autoriser } from '../../../lib/garde.ts'\n\nexport type Etat = { erreur?: string }\n\n`
  const correcte = (nom: string, role: string) =>
    `export async function ${nom}(id: string): Promise<Etat> {\n` +
    `  const autorisation = await autoriser('${role}')\n` +
    `  if (!autorisation.permis) return { erreur: autorisation.motif }\n` +
    `  return { erreur: id }\n}\n`

  it('accepte une action correcte, sous toutes ses formes', () => {
    const fichier =
      ENTETE +
      correcte('accepter', 'CHAUFFEUR') +
      `export const terminer = async (): Promise<Etat> => {\n` +
      `  const verdict = await autoriser('CHAUFFEUR')\n` +
      `  if (!verdict.permis) {\n    throw new Error(verdict.motif)\n  }\n  return {}\n}\n` +
      `export const demarrer = avecJournal(async () => {\n` +
      `  const a = await autoriser('CHAUFFEUR')\n  if (!a.permis) return { erreur: a.motif }\n  return {}\n})\n` +
      `export default async function annuler() {\n` +
      `  const a = await autoriser('CHAUFFEUR')\n  if (!a.permis) return { erreur: a.motif }\n}\n`
    expect(fautesDActions(fichier, 'CHAUFFEUR')).toEqual([])
  })

  it.each([
    [
      'le rôle de l’autre espace, copié-collé',
      correcte('accepter', 'CLIENT'),
      /accepter : autoriser\(CLIENT\) au lieu de autoriser\('CHAUFFEUR'\)/,
    ],
    [
      'un rôle qui n’est pas un littéral',
      correcte('accepter', 'CHAUFFEUR').replace(`'CHAUFFEUR'`, 'ROLE'),
      /autoriser\(ROLE\) au lieu de/,
    ],
    [
      'le verdict ignoré',
      `export async function accepter() {\n  const a = await autoriser('CHAUFFEUR')\n  return {}\n}\n`,
      /accepter : verdict ignoré/,
    ],
    [
      'l’appel sans affectation',
      `export async function accepter() {\n  await autoriser('CHAUFFEUR')\n  return {}\n}\n`,
      /accepter : n’ouvre pas sur/,
    ],
    [
      'le verdict testé à l’envers',
      `export async function accepter() {\n  const a = await autoriser('CHAUFFEUR')\n  if (a.permis) return {}\n  return {}\n}\n`,
      /verdict ignoré/,
    ],
    [
      'le verdict testé sans sortir',
      `export async function accepter() {\n  const a = await autoriser('CHAUFFEUR')\n  if (!a.permis) console.warn(a.motif)\n  return {}\n}\n`,
      /verdict ignoré/,
    ],
    [
      'la garde après une écriture',
      `export async function accepter() {\n  await prisma().course.update({})\n  const a = await autoriser('CHAUFFEUR')\n  if (!a.permis) return {}\n}\n`,
      /n’ouvre pas sur/,
    ],
    [
      'aucune garde',
      `export async function accepter() {\n  return {}\n}\n`,
      /accepter : n’ouvre pas sur/,
    ],
    [
      // Le décompte de la première version passait ce fichier : deux appels, deux actions.
      'deux gardes dans une action, aucune dans l’autre',
      `export async function accepter() {\n  const a = await autoriser('CHAUFFEUR')\n  if (!a.permis) return {}\n  await autoriser('CHAUFFEUR')\n}\n` +
        `export async function terminer() {\n  return {}\n}\n`,
      /terminer : n’ouvre pas sur/,
    ],
    [
      'un verdict réaffectable',
      correcte('accepter', 'CHAUFFEUR').replace('const autorisation', 'let autorisation'),
      /doit être une `const`/,
    ],
    [
      'une action sans corps en bloc',
      `export const accepter = async () => autoriser('CHAUFFEUR')\n`,
      /corps sans bloc/,
    ],
    [
      'une action enveloppée non reconnaissable',
      `export const accepter = avecJournal(autreAction)\n`,
      /exportation sans fonction reconnaissable/,
    ],
    ['une réexportation', `export { accepter } from './interne'\n`, /réexportation interdite/],
  ])('refuse %s', (_cas, corps, faute) => {
    const fautes = fautesDActions(ENTETE + corps, 'CHAUFFEUR')
    expect(fautes.join('\n')).toMatch(faute)
  })

  const page = (garde: string) =>
    `import { exigerEspace } from '../../../lib/garde.ts'\n\n` +
    `export default async function Espace() {\n${garde}  return null\n}\n`

  it('accepte une page qui ouvre sur la garde de son espace', () => {
    expect(fautesDePage(page(`  const session = await exigerEspace('CLIENT')\n`), 'CLIENT')).toEqual([])
    expect(fautesDePage(page(`  await exigerEspace('CLIENT')\n`), 'CLIENT')).toEqual([])
  })

  it.each([
    ['le rôle de l’autre espace', page(`  await exigerEspace('CHAUFFEUR')\n`), /exigerEspace\(CHAUFFEUR\) au lieu de/],
    ['aucune garde', page(''), /n’ouvre pas sur/],
    ['tout compte au lieu du rôle', page(`  await exigerEspace(null)\n`), /exigerEspace\(null\) au lieu de/],
    [
      'la garde après une lecture',
      page(`  const courses = await lister()\n  await exigerEspace('CLIENT')\n`),
      /n’ouvre pas sur/,
    ],
    [
      'une seconde garde d’un autre rôle',
      page(`  await exigerEspace('CLIENT')\n  if (x) await exigerEspace('CHAUFFEUR')\n`),
      /exigerEspace\(CHAUFFEUR\) au lieu de/,
    ],
    ['aucune page par défaut', `export async function Espace() {}\n`, /aucune page exportée/],
  ])('refuse une page avec %s', (_cas, contenu, faute) => {
    expect(fautesDePage(contenu, 'CLIENT').join('\n')).toMatch(faute)
  })
})

describe('sur de vraies sessions', () => {
  let dossier: string
  const cookies: Record<'client' | 'chauffeur', string> = { client: '', chauffeur: '' }

  /// Connexion par l'API, pour obtenir le cookie de session qu'aurait le navigateur.
  async function cookieDe(email: string): Promise<string> {
    const { headers } = await auth().api.signInEmail({
      body: { email, password: MOT_DE_PASSE },
      returnHeaders: true,
    })
    return (headers.get('set-cookie') ?? '')
      .split(/,(?=\s*[^;=]+=)/)
      .map((morceau) => morceau.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ')
  }

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), 'carin-acces-'))
    const url = `file:${join(dossier, 'acces.db')}`
    execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    vi.stubEnv('DATABASE_URL', url)
    vi.stubEnv('BETTER_AUTH_SECRET', 'secret-de-test-uniquement-0123456789abcdef') // pragma: allowlist secret
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')

    await semer(prisma(), new Date(), MOT_DE_PASSE)
    cookies.client = await cookieDe('camille.besson@exemple.fr')
    cookies.chauffeur = await cookieDe('hakim.diallo@carin.fr')
  }, 120_000)

  afterAll(async () => {
    await prisma().$disconnect()
    vi.unstubAllEnvs()
    rmSync(dossier, { recursive: true, force: true })
  })

  beforeEach(() => {
    requete.redirections.length = 0
  })

  describe('action chauffeur (S12)', () => {
    it('refuse explicitement une session client', async () => {
      // Le critère de la story 2.3 : la garde que toute action chauffeur appelle en
      // premier, sollicitée avec une session client, comme une requête forgée.
      requete.entetes = new Headers({ cookie: cookies.client })
      expect(await autoriser('CHAUFFEUR')).toEqual({
        permis: false,
        motif: 'Cette action est réservée aux chauffeurs.',
      })
      expect(requete.redirections).toEqual([])
    })

    it('laisse passer une session chauffeur, avec sa session', async () => {
      requete.entetes = new Headers({ cookie: cookies.chauffeur })
      const resultat = await autoriser('CHAUFFEUR')
      expect(resultat.permis).toBe(true)
      expect(resultat.permis && resultat.session.user.email).toBe('hakim.diallo@carin.fr')
    })

    it('refuse sans session, avec un message qui dit quoi faire', async () => {
      requete.entetes = new Headers()
      expect(await autoriser('CHAUFFEUR')).toEqual({
        permis: false,
        motif: 'Votre session a expiré. Reconnectez-vous pour continuer.',
      })
    })

    it('refuse aussi une action client à un chauffeur', async () => {
      requete.entetes = new Headers({ cookie: cookies.chauffeur })
      expect(await autoriser('CLIENT')).toEqual({ permis: false, motif: refusRole('CLIENT') })
    })
  })

  describe('pages d’espace', () => {
    async function visiter(role: Role | null, cookie: string): Promise<string | 'affichée'> {
      requete.entetes = new Headers(cookie === '' ? {} : { cookie })
      try {
        await exigerEspace(role)
        return 'affichée'
      } catch (erreur) {
        if (erreur instanceof Error && erreur.message === 'NEXT_REDIRECT') {
          return requete.redirections.at(-1) ?? 'redirection sans cible'
        }
        throw erreur
      }
    }

    it('renvoie un client de l’espace chauffeur vers le sien', async () => {
      expect(await visiter('CHAUFFEUR', cookies.client)).toBe('/client')
    })

    it('renvoie un chauffeur de l’espace client vers le sien', async () => {
      expect(await visiter('CLIENT', cookies.chauffeur)).toBe('/chauffeur')
    })

    it('envoie un visiteur sans session vers la connexion', async () => {
      expect(await visiter('CHAUFFEUR', '')).toBe('/connexion')
      expect(await visiter('CLIENT', '')).toBe('/connexion')
      expect(await visiter(null, '')).toBe('/connexion')
    })

    it('affiche à chacun son propre espace, et le compte à tous', async () => {
      expect(await visiter('CLIENT', cookies.client)).toBe('affichée')
      expect(await visiter('CHAUFFEUR', cookies.chauffeur)).toBe('affichée')
      expect(await visiter(null, cookies.client)).toBe('affichée')
      expect(await visiter(null, cookies.chauffeur)).toBe('affichée')
    })
  })

  describe('proxy', () => {
    async function passer(chemin: string, cookie: string): Promise<string | null> {
      const reponse = await proxy(
        new NextRequest(`http://localhost:3000${chemin}`, {
          headers: cookie === '' ? {} : { cookie },
        }),
      )
      const cible = reponse.headers.get('location')
      return cible === null ? null : new URL(cible).pathname
    }

    it('redirige comme la règle, sur la vraie session', async () => {
      expect(await passer('/chauffeur', cookies.client)).toBe('/client')
      expect(await passer('/client/reserver', cookies.chauffeur)).toBe('/chauffeur')
      expect(await passer('/chauffeur', '')).toBe('/connexion')
      expect(await passer('/compte', '')).toBe('/connexion')
    })

    it('laisse passer chacun dans son espace', async () => {
      expect(await passer('/chauffeur', cookies.chauffeur)).toBeNull()
      expect(await passer('/client', cookies.client)).toBeNull()
      expect(await passer('/compte', cookies.client)).toBeNull()
    })

    it('laisse la page répondre quand la session est illisible, sans page 500', async () => {
      const panne = vi
        .spyOn(auth().api, 'getSession')
        .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const reponse = await proxy(new NextRequest('http://localhost:3000/chauffeur'))
        expect(reponse.status).toBe(200)
        expect(reponse.headers.get('location')).toBeNull()
        expect(reponse.headers.get('x-middleware-next')).toBe('1')
        expect(journal).toHaveBeenCalledOnce()
      } finally {
        panne.mockRestore()
        journal.mockRestore()
      }
    })
  })
})
