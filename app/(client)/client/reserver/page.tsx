import type { Metadata } from 'next'
import Link from 'next/link'

import { exigerEspace } from '../../../../lib/garde.ts'
import { FormulaireTrajet } from './FormulaireTrajet.tsx'

export const metadata: Metadata = {
  title: "Réserver une course — Car'in",
}

export default async function PageReserver() {
  await exigerEspace('CLIENT')

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
      <FormulaireTrajet />
      <Link href="/client" className="self-start font-semibold text-accent underline">
        Retour à mon espace
      </Link>
    </main>
  )
}
