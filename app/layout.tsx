import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: "Car'in — réservation de taxi",
  description:
    "Réservez une course auprès de la compagnie de taxi Car'in, et suivez son état jusqu'à la prise en charge.",
}

export default function MiseEnPageRacine({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  )
}
