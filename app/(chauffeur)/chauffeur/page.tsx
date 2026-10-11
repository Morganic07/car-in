import type { Metadata } from 'next'
import Link from 'next/link'

import { exigerEspace } from '../../../lib/garde.ts'

export const metadata: Metadata = {
  title: "Espace chauffeur — Car'in",
}

/// Accueil de l'espace chauffeur. La garde est refaite ici, et non laissée au seul
/// proxy : chaque page d'espace l'appelle en premier (un test le vérifie).
export default async function EspaceChauffeur() {
  const session = await exigerEspace('CHAUFFEUR')

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace chauffeur
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bonjour, {session.user.name}
        </h1>
      </header>
      <p className="text-secondary">
        Les courses disponibles et votre planning arrivent ici très bientôt.
      </p>
      <Link href="/compte" className="self-start font-semibold text-accent underline">
        Mon compte
      </Link>
    </main>
  )
}
