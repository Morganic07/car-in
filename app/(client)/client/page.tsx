import type { Metadata } from 'next'
import Link from 'next/link'

import { exigerEspace } from '../../../lib/garde.ts'

export const metadata: Metadata = {
  title: "Mon espace — Car'in",
}

/// Accueil de l'espace client. La garde est refaite ici, et non laissée au seul
/// proxy : chaque page d'espace l'appelle en premier (un test le vérifie).
export default async function EspaceClient() {
  const session = await exigerEspace('CLIENT')

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace client
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bonjour, {session.user.name}
        </h1>
      </header>
      <Link
        href="/client/reserver"
        className="inline-flex min-h-cible items-center justify-center self-start rounded-md bg-accent px-4 font-semibold text-on-primary transition-colors duration-200 hover:bg-accent-survol"
      >
        Réserver une course
      </Link>
      <Link href="/compte" className="self-start font-semibold text-accent underline">
        Mon compte
      </Link>
    </main>
  )
}
