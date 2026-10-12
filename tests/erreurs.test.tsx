import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Erreur from '../app/error.tsx'
import ErreurGlobale from '../app/global-error.tsx'

/// `renderToStaticMarkup` ne sait pas cliquer. Le vrai `Bouton` est conservé — son
/// balisage est rendu tel quel — mais les propriétés qu'il reçoit sont relevées, pour
/// appeler le gestionnaire de clic comme le ferait le navigateur.
const boutons = vi.hoisted(() => [] as Array<{ children: unknown; onClick?: () => void }>)
vi.mock('../components/ui/Bouton.tsx', async (original) => {
  const reel = await original<typeof import('../components/ui/Bouton.tsx')>()
  return {
    ...reel,
    Bouton: (proprietes: ComponentProps<typeof reel.Bouton>) => {
      boutons.push(proprietes as (typeof boutons)[number])
      return reel.Bouton(proprietes)
    },
  }
})

const MESSAGE_TECHNIQUE = 'SQLITE_BUSY: database is locked'

function panne(digest?: string): Error & { digest?: string } {
  return Object.assign(new Error(MESSAGE_TECHNIQUE), digest ? { digest } : {})
}

beforeEach(() => {
  boutons.length = 0
})

describe.each([
  ['app/error.tsx', Erreur],
  ['app/global-error.tsx', ErreurGlobale],
] as const)('%s', (_fichier, Composant) => {
  it('parle français et propose de réessayer ou de revenir à l’accueil', () => {
    const html = renderToStaticMarkup(<Composant error={panne()} retry={() => {}} />)
    expect(html).toContain('Une erreur est survenue')
    expect(html).toContain('Réessayer')
    expect(html).toMatch(/<a [^>]*\bhref="\/"[^>]*>Revenir à l’accueil<\/a>/)
    // Rien de la page par défaut de Next, en anglais.
    expect(html).not.toMatch(/Application error|Something went wrong|Try again/i)
  })

  it('ne montre jamais le message technique, seulement la référence', () => {
    const html = renderToStaticMarkup(<Composant error={panne('1234567890')} retry={() => {}} />)
    expect(html).not.toContain(MESSAGE_TECHNIQUE)
    expect(html).toContain('Référence de l’erreur : <code>1234567890</code>')

    const sansReference = renderToStaticMarkup(<Composant error={panne()} retry={() => {}} />)
    expect(sansReference).not.toContain('Référence')
  })

  it('appelle `retry` au clic sur « Réessayer »', () => {
    const retry = vi.fn()
    renderToStaticMarkup(<Composant error={panne()} retry={retry} />)

    const reessayer = boutons.find((b) => b.children === 'Réessayer')
    expect(reessayer?.onClick).toBeTypeOf('function')
    expect(retry).not.toHaveBeenCalled()
    reessayer!.onClick!()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('rend un bouton à la hauteur de cible tactile', () => {
    const html = renderToStaticMarkup(<Composant error={panne()} retry={() => {}} />)
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-cible[^"]*">Réessayer<\/button>/)
  })
})

describe('app/global-error.tsx', () => {
  it('pose son propre document, en français', () => {
    // Il remplace le layout racine : sans `<html lang="fr">` ni `<body>`, la page
    // serait un fragment, et un lecteur d'écran la lirait avec la mauvaise langue.
    const html = renderToStaticMarkup(<ErreurGlobale error={panne()} retry={() => {}} />)
    // React remonte le `<title>` dans un `<head>` qu'il crée lui-même.
    expect(html).toMatch(/^<html lang="fr"><head><title>Erreur — Car&#x27;in<\/title><\/head><body[^>]*>/)
    expect(html).toMatch(/<\/body><\/html>$/)
  })
})
