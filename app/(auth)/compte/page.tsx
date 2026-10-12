import type { Metadata } from 'next'
import Link from 'next/link'

import { ESPACE, roleDe } from '../../../lib/acces.ts'
import { exigerEspace } from '../../../lib/garde.ts'
import { BoutonDeconnexion } from './BoutonDeconnexion.tsx'

export const metadata: Metadata = {
  title: "Mon compte — Car'in",
}

/// Page réservée à une personne connectée, quel que soit son rôle. La session est
/// relue côté serveur à chaque affichage : c'est ce qui fait qu'après une
/// déconnexion, revenir en arrière ne redonne pas accès.
export default async function PageCompte() {
  const session = await exigerEspace(null)
  const role = roleDe(session)

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Mon compte</h1>
      <dl className="flex flex-col gap-2">
        <div className="flex gap-2">
          <dt className="font-semibold text-secondary">Nom</dt>
          <dd className="text-foreground">{session.user.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold text-secondary">E-mail</dt>
          <dd className="break-all text-foreground">{session.user.email}</dd>
        </div>
      </dl>
      <Link href={ESPACE[role]} className="self-start font-semibold text-accent underline">
        {role === 'CHAUFFEUR' ? 'Mon espace chauffeur' : 'Mon espace client'}
      </Link>
      <BoutonDeconnexion />
    </main>
  )
}
