import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BadgeEtat, LIBELLES_ETAT } from '../components/ui/BadgeEtat.tsx'
import { Bouton, type VarianteBouton } from '../components/ui/Bouton.tsx'
import { Champ, descriptionsAssociees } from '../components/ui/Champ.tsx'
import { ETATS } from '../lib/domaine/course.ts'

const racine = join(import.meta.dirname, '..')

/// Commentaires retirés avant toute analyse : les règles portent sur les
/// déclarations, pas sur la prose. Sans ce retrait, l'assertion « aucun
/// `outline: none` » tombait sur le commentaire qui dit de ne jamais en écrire.
const FEUILLE = readFileSync(join(racine, 'app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/// Les jetons tels qu'ils sont réellement écrits dans la feuille, et non recopiés
/// ici : un test qui compare une copie à elle-même ne prouve rien.
const JETONS = new Map<string, string>(
  [...FEUILLE.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)].map(([, nom, valeur]) => [
    nom!.toLowerCase(),
    valeur!.toLowerCase(),
  ]),
)

/// Jetons dérivés, écrits `color-mix(in srgb, var(--a) N%, var(--b))`. Lus eux aussi
/// dans la feuille : leur contraste se mesure sur la couleur que le navigateur
/// calculera, pas sur une valeur recopiée à la main.
const MELANGES = new Map<string, { a: string; part: number; b: string }>(
  [
    ...FEUILLE.matchAll(
      /--([a-z0-9-]+):\s*color-mix\(\s*in srgb,\s*var\(--([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\(--([a-z0-9-]+)\)\s*\)\s*;/gi,
    ),
  ].map(([, nom, a, part, b]) => [
    nom!.toLowerCase(),
    { a: a!.toLowerCase(), part: Number(part) / 100, b: b!.toLowerCase() },
  ]),
)

type Rvb = readonly [number, number, number]

/// Seule la forme `#rrggbb` est mesurable ici. Une forme courte se lirait de travers,
/// et une transparence `#rrggbbaa` serait ignorée : la mesure serait fausse sans
/// rien signaler. On lève donc une erreur qui nomme le format.
function hexVersRvb(hex: string): Rvb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Jeton au format non mesurable (attendu #rrggbb) : ${hex}`)
  }
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as unknown as Rvb
}

/// Le mélange `in srgb` se fait canal par canal sur les valeurs encodées, sans
/// passer en linéaire — c'est ce que spécifie CSS Color 5.
function jeton(nom: string): Rvb {
  const hex = JETONS.get(nom)
  if (hex) return hexVersRvb(hex)
  const melange = MELANGES.get(nom)
  if (!melange) throw new Error(`Jeton absent de app/globals.css : --${nom}`)
  const a = jeton(melange.a)
  const b = jeton(melange.b)
  return [0, 1, 2].map((i) => a[i]! * melange.part + b[i]! * (1 - melange.part)) as unknown as Rvb
}

// --- Contraste WCAG 2.1 -------------------------------------------------------
// Implémenté ici plutôt qu'estimé : « ça a l'air lisible » n'est pas une mesure.

function canalLineaire(octet: number): number {
  const v = octet / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Rvb): number {
  return 0.2126 * canalLineaire(r) + 0.7152 * canalLineaire(g) + 0.0722 * canalLineaire(b)
}

function contraste(a: Rvb, b: Rvb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const clair = Math.max(la, lb)
  const sombre = Math.min(la, lb)
  return (clair + 0.05) / (sombre + 0.05)
}

function fichiersSources(dossier: string): string[] {
  return readdirSync(join(racine, dossier), { recursive: true, encoding: 'utf8' })
    .filter((chemin) => /\.(ts|tsx)$/.test(chemin))
    .map((chemin) => join(racine, dossier, chemin))
}

const SOURCES_INTERFACE = [...fichiersSources('components'), ...fichiersSources('app')]

/// Classes de la première balise `balise` du rendu, découpées en mots. Lire le rendu
/// plutôt que la source : une chaîne présente dans un commentaire du composant
/// satisferait un `toContain` sur le fichier sans jamais atteindre le navigateur.
function classesRendues(rendu: string, balise: string): string[] {
  const classe = new RegExp(`<${balise}\\b[^>]*\\bclass="([^"]*)"`).exec(rendu)?.[1]
  if (classe === undefined) throw new Error(`Aucune balise <${balise}> avec une classe dans : ${rendu}`)
  return classe.split(/\s+/).filter((mot) => mot !== '')
}

describe('jetons du design system', () => {
  it('définit les neuf jetons de base', () => {
    for (const nom of [
      'color-primary',
      'color-on-primary',
      'color-secondary',
      'color-accent',
      'color-background',
      'color-foreground',
      'color-muted',
      'color-border',
      'color-destructive',
    ]) {
      expect(JETONS.get(nom), nom).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('résout les jetons de survol comme un mélange des jetons de base', () => {
    // Sans cette assertion, une syntaxe `color-mix` que l'expression ne reconnaît
    // plus ferait lever `jeton()` — mais seulement dans le test de contraste, avec
    // un message qui accuserait un jeton absent plutôt qu'un format mal lu.
    for (const nom of ['color-accent-survol', 'color-destructive-survol']) {
      expect(MELANGES.has(nom), nom).toBe(true)
    }
  })

  it('tient la cible tactile à 44 px', () => {
    // 2.75rem × 16 px = 44 px. Le jeton existe pour que les composants écrivent
    // `min-h-cible` au lieu de recopier la valeur. Il doit vivre dans `@theme` :
    // déclaré dans un `:root` ordinaire, il existerait comme variable CSS mais
    // Tailwind ne générerait pas l'utilitaire, et `min-h-cible` ne ferait rien.
    const theme = /@theme\s*\{([^}]*)\}/.exec(FEUILLE)?.[1]
    expect(theme, 'bloc @theme introuvable dans app/globals.css').toBeDefined()
    expect(theme).toMatch(/--spacing-cible:\s*2\.75rem\s*;/)
  })

  it('rend le focus clavier visible sans le neutraliser', () => {
    expect(FEUILLE).toMatch(/:focus-visible\s*\{[^}]*outline:/)
    expect(FEUILLE).not.toMatch(/outline:\s*none/)
  })

  it('respecte prefers-reduced-motion', () => {
    expect(FEUILLE).toContain('prefers-reduced-motion')
  })
})

describe('contraste des cinq états, mesuré', () => {
  it.each(ETATS)('%s atteint au moins 4.5:1', (etat) => {
    const cle = etat.toLowerCase().replace('_', '-')
    const fond = jeton(`color-etat-${cle}`)
    const texte = jeton(`color-etat-${cle}-texte`)

    expect(contraste(fond, texte)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('contraste des couleurs de texte', () => {
  const paires: readonly (readonly [string, string, string])[] = [
    ['texte courant sur fond de page', 'color-foreground', 'color-background'],
    ['texte secondaire sur fond de page', 'color-secondary', 'color-background'],
    ['texte sur fond primaire', 'color-on-primary', 'color-primary'],
    ['texte sur bouton principal', 'color-on-primary', 'color-accent'],
    ['texte sur bouton destructif', 'color-on-primary', 'color-destructive'],
    ['texte sur bouton principal survolé', 'color-on-primary', 'color-accent-survol'],
    ['texte sur bouton destructif survolé', 'color-on-primary', 'color-destructive-survol'],
    ['lien sur fond de page', 'color-accent', 'color-background'],
    ['message d’erreur sur fond de page', 'color-destructive', 'color-background'],
  ]

  it.each(paires)('%s atteint au moins 4.5:1', (_libelle, texte, fond) => {
    expect(contraste(jeton(texte), jeton(fond))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('aucune couleur codée en dur', () => {
  it('ne laisse aucune valeur hexadécimale dans un composant ou une page', () => {
    // Le critère de la story 1.4. Une couleur écrite dans un composant échappe au
    // design system : elle ne change pas quand le jeton change, et son contraste
    // n'est mesuré par rien.
    for (const chemin of SOURCES_INTERFACE) {
      const contenu = readFileSync(chemin, 'utf8')
      const trouvees = contenu.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
      expect(trouvees, chemin.replace(racine, '')).toHaveLength(0)
    }
  })

  it('n’emploie aucune couleur hors du design system', () => {
    // Les palettes livrées avec Tailwind (slate, sky, amber…) ne sont pas fausses,
    // elles sont simplement hors jetons : elles rouvriraient la porte à deux
    // référentiels de couleur. Ce test a attrapé les deux classes de palette que la
    // story 1.1 avait laissées sur la page d'accueil.
    const palettesTailwind =
      /\b(?:bg|text|border|ring|from|to|via|outline|decoration|divide|shadow|accent|caret|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g

    for (const chemin of SOURCES_INTERFACE) {
      const contenu = readFileSync(chemin, 'utf8')
      expect(contenu.match(palettesTailwind) ?? [], chemin.replace(racine, '')).toHaveLength(0)
    }
  })

  it('ne référence que des classes de couleur adossées à un jeton existant', () => {
    // Une classe `bg-etat-encourse` mal orthographiée ne produit aucune couleur et
    // aucune erreur : le badge s'affiche transparent. Seul ce test le voit.
    for (const chemin of SOURCES_INTERFACE) {
      const contenu = readFileSync(chemin, 'utf8')
      for (const [, suffixe] of contenu.matchAll(/\b(?:bg|text|border)-(etat-[a-z-]+)\b/g)) {
        expect(JETONS.has(`color-${suffixe}`), `${chemin.replace(racine, '')} → ${suffixe}`).toBe(
          true,
        )
      }
    }
  })
})

describe('composants d’interface', () => {
  it('existent tous les quatre', () => {
    for (const nom of ['Bouton', 'Champ', 'BadgeEtat', 'CarteCourse']) {
      expect(
        SOURCES_INTERFACE.some((chemin) => chemin.endsWith(`components/ui/${nom}.tsx`)),
        nom,
      ).toBe(true)
    }
  })

  it('sont tous employés par la page de démonstration', () => {
    const page = readFileSync(join(racine, 'app/design/page.tsx'), 'utf8')
    for (const nom of ['Bouton', 'Champ', 'BadgeEtat', 'CarteCourse']) {
      expect(page, nom).toContain(`<${nom}`)
    }
  })

  it('tiennent la cible tactile sur tout ce qui se touche', () => {
    // Vérifié sur le rendu, mot entier : la chaîne figure aussi dans le commentaire
    // de Bouton.tsx, et une recherche dans la source restait verte une fois la
    // classe retirée du `className`. Chaque variante est rendue, pour qu'une
    // variante qui écraserait la hauteur ne passe pas inaperçue.
    const variantes = [
      'principal',
      'secondaire',
      'destructif',
    ] as const satisfies readonly VarianteBouton[]
    for (const variante of variantes) {
      const rendu = renderToStaticMarkup(<Bouton variante={variante}>Réserver</Bouton>)
      expect(classesRendues(rendu, 'button'), `Bouton ${variante}`).toContain('min-h-cible')
    }

    const champ = renderToStaticMarkup(<Champ id="nom" libelle="Votre nom" />)
    expect(classesRendues(champ, 'input'), 'Champ').toContain('min-h-cible')
  })

  it.each(ETATS)('associe au badge %s le fond et le texte de ce même état', (etat) => {
    // Le contraste est mesuré par paire d'un même état. Un badge qui mêlerait le
    // fond d'un état et le texte d'un autre afficherait une paire que rien ne mesure,
    // et annoncerait par la couleur un état qui n'est pas le sien.
    const cle = etat.toLowerCase().replace('_', '-')
    const classes = classesRendues(renderToStaticMarkup(<BadgeEtat etat={etat} />), 'span')

    expect(classes.filter((c) => c.startsWith('bg-etat-'))).toEqual([`bg-etat-${cle}`])
    expect(classes.filter((c) => c.startsWith('text-etat-'))).toEqual([`text-etat-${cle}-texte`])
  })

  it('branche réellement la fusion sur le champ rendu', () => {
    // Le test précédent ne couvre que la fonction pure. Celui-ci rend le composant :
    // retirer `'aria-describedby'` de la déstructuration ferait de nouveau écraser
    // l'attribut calculé par `{...reste}`, sans qu'aucune autre assertion ne bouge.
    const rendu = renderToStaticMarkup(
      <Champ
        id="adresse"
        libelle="Adresse de départ"
        aide="Trois caractères minimum."
        erreur="Choisissez une adresse dans la liste."
        aria-describedby="note-externe"
      />,
    )

    const decrit = /aria-describedby="([^"]*)"/.exec(rendu)?.[1] ?? ''
    expect(decrit.split(' ')).toEqual(['note-externe', 'adresse-aide', 'adresse-erreur'])
    expect(rendu).toContain('aria-invalid="true"')
    expect(rendu).toContain('border-destructive')
  })

  it('donne au texte indicatif une couleur mesurée, pas celle du preflight', () => {
    // Sans classe explicite, Tailwind affiche le texte indicatif à 50 % de la couleur
    // du texte : 3.77:1, sous le seuil. La paire `secondary` sur `background` est
    // mesurée plus haut ; ce test garde le lien entre le champ rendu et cette mesure.
    const rendu = renderToStaticMarkup(
      <Champ id="nom" libelle="Votre nom" placeholder="Camille Besson" />,
    )
    expect(rendu).toContain('placeholder:text-secondary')
  })

  it('traite une chaîne vide comme une absence de message', () => {
    // `erreur={erreurs.adresse ?? ''}` ne doit ni peindre le champ en rouge ni
    // l'annoncer invalide : il n'y a pas de message à lire.
    const rendu = renderToStaticMarkup(<Champ id="nom" libelle="Votre nom" erreur="" aide="" />)

    expect(rendu).not.toContain('aria-invalid')
    expect(rendu).not.toContain('aria-describedby')
    expect(rendu).not.toContain('border-destructive')
    expect(rendu).toContain('border-border')
  })

  it('n’efface jamais le lien vers le message d’erreur', () => {
    // Un appelant qui passe son propre `aria-describedby` ne doit pas faire
    // disparaître l'erreur de ce que lit un lecteur d'écran : le message resterait
    // affiché sans être annoncé, et rien ne le signalerait.
    expect(descriptionsAssociees('adresse', { erreur: 'Adresse inconnue.' })).toBe(
      'adresse-erreur',
    )
    expect(
      descriptionsAssociees('adresse', { erreur: 'Adresse inconnue.', fournie: 'note' }),
    ).toBe('note adresse-erreur')
    expect(
      descriptionsAssociees('adresse', { aide: 'Trois caractères minimum.', fournie: 'note' }),
    ).toBe('note adresse-aide')
    expect(descriptionsAssociees('adresse', {})).toBeUndefined()
  })

  it('nomment chaque état en français, sans identifiant technique', () => {
    expect(Object.keys(LIBELLES_ETAT).sort()).toEqual([...ETATS].sort())
    for (const etat of ETATS) {
      const libelle = LIBELLES_ETAT[etat]
      expect(libelle, etat).not.toHaveLength(0)
      expect(libelle, etat).not.toContain('_')
      expect(libelle, etat).not.toBe(etat)
    }
  })
})
