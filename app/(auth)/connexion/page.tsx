import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { auth } from '../../../lib/auth.ts'
import { FormulaireConnexion } from './FormulaireConnexion.tsx'

export const metadata: Metadata = {
  title: "Se connecter — Car'in",
}

export default async function PageConnexion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Déjà connecté : le formulaire n'a rien à faire, le compte est la destination.
  const session = await auth().api.getSession({ headers: await headers() })
  if (session !== null) redirect('/compte')

  const { deconnecte } = await searchParams

  return (
    <main className="mx-auto flex max-w-md flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Se connecter</h1>
        {deconnecte === '1' ? (
          <p role="status" className="font-semibold text-secondary">
            Vous êtes déconnecté.
          </p>
        ) : null}
      </header>
      <FormulaireConnexion />
      <p className="text-secondary">
        Pas encore de compte ?{' '}
        <Link href="/inscription" className="font-semibold text-accent underline">
          Créer un compte client
        </Link>
      </p>
    </main>
  )
}
