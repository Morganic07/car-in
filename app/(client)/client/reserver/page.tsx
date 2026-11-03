import type { Metadata } from 'next'
import Link from 'next/link'

import { exigerEspace } from '../../../../lib/garde.ts'
import { premierDepartEnSaisie } from '../../../../lib/reservation.ts'
import { FormulaireReservation } from './FormulaireReservation.tsx'

export const metadata: Metadata = {
  title: "Réserver une course — Car'in",
}

export default async function PageReserver() {
  await exigerEspace('CLIENT')

  // Calculée ici, à chaque requête : la page dépend de la session, elle n'est jamais
  // servie depuis un cache.
  const minimum = premierDepartEnSaisie()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace client
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Réserver une course
        </h1>
      </header>
      <FormulaireReservation minimum={minimum} />
      <Link href="/client" className="self-start font-semibold text-accent underline">
        Retour à mon espace
      </Link>
    </main>
  )
}
