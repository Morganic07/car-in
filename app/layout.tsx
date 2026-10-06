import type { Metadata } from 'next'
import { Lexend, Source_Sans_3 } from 'next/font/google'
import type { ReactNode } from 'react'

import './globals.css'

/// Lexend pour les titres, dessinée pour la lisibilité ; Source Sans 3 pour le corps.
/// Chargées par next/font : les fichiers sont servis depuis le domaine du site, sans
/// requête vers Google au moment où la page s'affiche.
const titres = Lexend({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-titres',
  display: 'swap',
})

const corps = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-corps',
  display: 'swap',
})

export const metadata: Metadata = {
  title: "Car'in — réservation de taxi",
  description:
    "Réservez une course auprès de la compagnie de taxi Car'in, et suivez son état jusqu'à la prise en charge.",
}

export default function MiseEnPageRacine({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${titres.variable} ${corps.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
