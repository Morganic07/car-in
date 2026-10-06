import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type VarianteBouton = 'principal' | 'secondaire' | 'destructif'

/// Les couleurs passent toujours par une utilitaire adossée à un jeton. Écrire
/// `var(--color-accent)` à la main ne marcherait pas : Tailwind n'émet un jeton de
/// `@theme` que si une utilitaire l'emploie, et la variable resterait introuvable.
const VARIANTES: Record<VarianteBouton, string> = {
  principal: 'bg-accent text-on-primary hover:bg-accent-survol',
  secondaire: 'border border-border bg-background text-foreground hover:bg-muted',
  destructif: 'bg-destructive text-on-primary hover:bg-destructive-survol',
}

type ProprietesBouton = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variante?: VarianteBouton
  readonly children: ReactNode
}

/// `min-h-cible` et `px-4` tiennent la cible tactile à 44 px de haut et laissent de
/// quoi viser en largeur. Le focus clavier est pris en charge globalement par le
/// `:focus-visible` de app/globals.css — ne pas le neutraliser ici.
export function Bouton({
  variante = 'principal',
  className = '',
  children,
  ...reste
}: ProprietesBouton) {
  return (
    <button
      // Avant la diffusion des propriétés, pour qu'un formulaire puisse imposer
      // `type="submit"` sans avoir à contourner le composant.
      type="button"
      className={[
        'inline-flex min-h-cible cursor-pointer items-center justify-center gap-2',
        'rounded-md px-4 font-semibold transition-colors duration-200',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTES[variante],
        className,
      ].join(' ')}
      {...reste}
    >
      {children}
    </button>
  )
}
