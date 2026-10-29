import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BadgeEtat } from '../../../../../../components/ui/BadgeEtat.tsx'
import { exigerEspace } from '../../../../../../lib/garde.ts'
import { prisma } from '../../../../../../lib/prisma.ts'
import { RecapitulatifCourse } from '../../../RecapitulatifCourse.tsx'

export const metadata: Metadata = {
  title: "Course réservée — Car'in",
}

/// Récapitulatif d'une réservation qui vient d'aboutir (story 3.3, scénario S1).
///
/// La course est cherchée **avec** son client : une course d'un autre client, ou un
/// identifiant inventé, donnent la même page introuvable — rien ne dit à un curieux
/// qu'un identifiant existe.
export default async function PageCourseReservee({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await exigerEspace('CLIENT')
  const { id } = await params

  const course = await prisma().course.findFirst({
    where: { id, clientId: session.user.id },
  })
  if (course === null) notFound()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace client
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Course réservée</h1>
      </header>

      <section
        role="status"
        className="flex flex-col gap-2 rounded-md bg-muted p-4 text-foreground"
      >
        {/* Enveloppé : dans une colonne flexible, le badge s'étirerait sur toute la largeur. */}
        <div>
          <BadgeEtat etat={course.etat} />
        </div>
        {/* S9 : une course réservée n'est pas encore une course assurée. */}
        <p>
          Votre demande est transmise aux chauffeurs de la compagnie. Elle sera assurée dès
          qu’un chauffeur l’aura acceptée : son nom et son téléphone s’afficheront alors
          dans votre espace.
        </p>
      </section>

      <RecapitulatifCourse course={course} />

      <div className="flex flex-wrap gap-4">
        <Link
          href={`/client/courses/${course.id}`}
          className="inline-flex min-h-cible items-center justify-center rounded-md bg-accent px-4 font-semibold text-on-primary transition-colors duration-200 hover:bg-accent-survol"
        >
          Suivre ma course
        </Link>
        <Link
          href="/client"
          className="inline-flex min-h-cible items-center font-semibold text-accent underline"
        >
          Mes courses
        </Link>
        <Link
          href="/client/reserver"
          className="inline-flex min-h-cible items-center font-semibold text-accent underline"
        >
          Réserver une autre course
        </Link>
      </div>
    </main>
  )
}
