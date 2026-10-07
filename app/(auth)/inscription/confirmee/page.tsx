import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '../../../../lib/auth.ts'

export const metadata: Metadata = {
  title: "Compte créé — Car'in",
}

/// Retour visible après l'inscription, qui ouvre la session dans la foulée. Sans
/// session, rien ne prouve qu'un compte vient d'être créé : un visiteur arrivé ici
/// directement lirait une confirmation fausse. Il est renvoyé vers l'inscription.
export default async function PageInscriptionConfirmee() {
  const session = await auth().api.getSession({ headers: await headers() })
  if (session === null) redirect('/inscription')

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Compte créé</h1>
      <p className="text-lg text-secondary">
        {`Bienvenue, ${session.user.name}. Votre compte client est prêt.`}
      </p>
      <p className="text-secondary">
        La réservation de courses arrive très bientôt dans votre espace.
      </p>
    </main>
  )
}
