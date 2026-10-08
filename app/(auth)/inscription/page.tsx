import type { Metadata } from 'next'
import Link from 'next/link'

import { FormulaireInscription } from './FormulaireInscription.tsx'

export const metadata: Metadata = {
  title: "Créer un compte — Car'in",
  description: 'Inscription client pour réserver une course de taxi à l’avance.',
}

export default function PageInscription() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Créer un compte</h1>
        <p className="text-secondary">
          Votre compte client vous permet de réserver une course et d’en suivre l’état.
        </p>
      </header>
      <FormulaireInscription />
      <p className="text-secondary">
        Déjà un compte ?{' '}
        <Link href="/connexion" className="font-semibold text-accent underline">
          Se connecter
        </Link>
      </p>
    </main>
  )
}
