import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CarteTrajet } from '../../../../../components/carte/CarteTrajet.tsx'
import { BadgeEtat } from '../../../../../components/ui/BadgeEtat.tsx'
import { RecapitulatifCourse } from '../../../../../components/ui/RecapitulatifCourse.tsx'
import { exigerEspace } from '../../../../../lib/garde.ts'
import { prisma } from '../../../../../lib/prisma.ts'
import { formaterDepart } from '../../../../../lib/reservation.ts'
import { lienTelephone } from '../../../../../lib/telephone.ts'

export const metadata: Metadata = {
  title: "Ma course — Car'in",
}

/// Détail d'une course du chauffeur (story 4.3) : carte, adresses complètes, téléphone du
/// client et contraintes.
///
/// La course est cherchée **avec** son chauffeur : celle d'un collègue, une course encore
/// disponible ou un identifiant inventé donnent la même page introuvable. Le téléphone
/// d'un client ne sort que pour le chauffeur qui s'est engagé.
export default async function PageCourseChauffeur({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await exigerEspace('CHAUFFEUR')
  const { id } = await params

  const course = await prisma().course.findFirst({
    where: { id, chauffeurId: session.user.id },
    // Le nom et le téléphone seulement : rien d'autre du compte du client ne sort.
    include: { client: { select: { nom: true, telephone: true } } },
  })
  if (course === null) notFound()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace chauffeur
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Ma course</h1>
      </header>

      <section role="status" className="flex flex-col gap-3 rounded-md bg-muted p-4 text-foreground">
        {/* Enveloppé : dans une colonne flexible, le badge s'étirerait sur toute la largeur. */}
        <div>
          <BadgeEtat etat={course.etat} />
        </div>

        {/* Une course annulée reste consultable depuis un écran déjà ouvert, mais son
            client n'a plus à être appelé. */}
        {course.etat === 'ANNULEE' ? (
          <p className="font-semibold">
            Le client a annulé cette course
            {course.annuleeAt === null ? '' : ` le ${formaterDepart(course.annuleeAt)}`}. Vous
            n’avez plus à l’assurer.
          </p>
        ) : (
          <dl className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-secondary">Client</dt>
              <dd>{course.client.nom}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-x-2">
              <dt className="font-semibold text-secondary">Téléphone</dt>
              <dd>
                <a
                  href={lienTelephone(course.client.telephone)}
                  className="inline-flex min-h-cible items-center font-semibold text-accent underline"
                >
                  {course.client.telephone}
                </a>
              </dd>
            </div>
          </dl>
        )}
      </section>

      <CarteTrajet
        depart={{ label: course.departLabel, lat: course.departLat, lon: course.departLon }}
        arrivee={{ label: course.arriveeLabel, lat: course.arriveeLat, lon: course.arriveeLon }}
      />

      <RecapitulatifCourse course={course} />

      <Link
        href="/chauffeur/courses"
        className="inline-flex min-h-cible items-center self-start font-semibold text-accent underline"
      >
        Retour à mes courses
      </Link>
    </main>
  )
}
