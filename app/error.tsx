'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { Bouton } from '../components/ui/Bouton.tsx'

/// Ce que Next passe à une limite d'erreur. Dans cette version, `retry` refait la
/// requête et le rendu du segment — c'est ce qu'il faut après une panne passagère
/// (base verrouillée, session illisible). `reset` n'efface que l'état local, sans
/// rien recharger : il réafficherait la même erreur.
export type ProprietesErreur = {
  readonly error: Error & { digest?: string }
  readonly retry: () => void
}

/// Page affichée quand un rendu ou une action lève hors de tout `try`. Le message
/// technique n'est jamais montré : en production, Next le remplace déjà pour une
/// erreur serveur, et celui d'une erreur côté navigateur n'a rien à dire à un client.
/// Seul le `digest` est affiché, pour retrouver la trace dans les journaux du serveur.
export default function Erreur({ error, retry }: ProprietesErreur) {
  useEffect(() => {
    // Côté navigateur, la trace part dans la console : l'erreur n'est pas avalée.
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-semibold tracking-widest text-destructive uppercase">
        Erreur
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">
        Une erreur est survenue
      </h1>
      <p className="text-secondary">
        Le service n&rsquo;a pas pu répondre. Réessayez dans un instant ; si le problème
        persiste, revenez à l&rsquo;accueil.
      </p>
      {error.digest ? (
        <p className="text-sm text-secondary">
          Référence de l&rsquo;erreur : <code>{error.digest}</code>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Bouton onClick={() => retry()}>Réessayer</Bouton>
        <Link
          href="/"
          className="inline-flex min-h-cible items-center justify-center rounded-md border border-border bg-background px-4 font-semibold text-foreground transition-colors duration-200 hover:bg-muted"
        >
          Revenir à l&rsquo;accueil
        </Link>
      </div>
    </main>
  )
}
