import type { Metadata } from 'next'
import Link from 'next/link'

import { CarteCourse, type CourseAffichee } from '../../../../components/ui/CarteCourse.tsx'
import { exigerEspace } from '../../../../lib/garde.ts'
import { ETATS_TERMINAUX, repartirPlanning } from '../../../../lib/planning-chauffeur.ts'
import { prisma } from '../../../../lib/prisma.ts'

export const metadata: Metadata = {
  title: "Mes courses — Car'in",
}

function ListeCourses({
  identifiant,
  titre,
  courses,
  vide,
}: {
  readonly identifiant: string
  readonly titre: string
  readonly courses: readonly CourseAffichee[]
  readonly vide: string
}) {
  return (
    <section aria-labelledby={identifiant} className="flex flex-col gap-3">
      <h2 id={identifiant} className="text-xl font-semibold text-foreground">
        {titre}
      </h2>
      {courses.length === 0 ? (
        <div className="flex flex-col gap-1 rounded-lg bg-muted p-4 text-foreground">
          <p>{vide}</p>
          <Link
            href="/chauffeur"
            className="inline-flex min-h-cible items-center self-start font-semibold text-accent underline"
          >
            Voir les courses disponibles
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/chauffeur/courses/${encodeURIComponent(course.id)}`}
                // Le retour de survol se pose sur la carte : son fond opaque masquerait
                // celui du lien.
                className="block rounded-lg [&>article]:transition-colors [&>article]:duration-200 hover:[&>article]:border-accent"
              >
                <CarteCourse course={course} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/// Mes courses, côté chauffeur (story 4.3). La garde est refaite ici : chaque page d'espace
/// l'appelle en premier (un test le vérifie).
export default async function MesCoursesChauffeur() {
  const session = await exigerEspace('CHAUFFEUR')

  // Seules les siennes : l'identifiant vient de la session, jamais de la requête.
  const courses = await prisma().course.findMany({
    where: { chauffeurId: session.user.id, etat: { notIn: [...ETATS_TERMINAUX] } },
    select: {
      id: true,
      etat: true,
      departLabel: true,
      arriveeLabel: true,
      departAt: true,
      passagers: true,
      bagages: true,
      siegeEnfant: true,
      prixEstimeCents: true,
    },
  })
  const { aujourdhui, suivantes } = repartirPlanning(courses, new Date())

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace chauffeur
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Mes courses</h1>
      </header>

      <ListeCourses
        identifiant="aujourdhui"
        titre="Aujourd’hui"
        courses={aujourdhui}
        vide="Vous n’avez aucune course à assurer aujourd’hui."
      />
      <ListeCourses
        identifiant="suivantes"
        titre="Les jours suivants"
        courses={suivantes}
        vide="Vous n’avez aucune course prévue les jours suivants."
      />

      <Link
        href="/chauffeur"
        className="inline-flex min-h-cible items-center self-start font-semibold text-accent underline"
      >
        Courses disponibles
      </Link>
    </main>
  )
}
