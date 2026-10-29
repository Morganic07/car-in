import type { Metadata } from 'next'
import Link from 'next/link'

import { CarteCourse, type CourseAffichee } from '../../../components/ui/CarteCourse.tsx'
import { exigerEspace } from '../../../lib/garde.ts'
import { MESSAGE_EN_RETARD, enAttenteEnRetard, repartirCourses } from '../../../lib/mes-courses.ts'
import { prisma } from '../../../lib/prisma.ts'

export const metadata: Metadata = {
  title: "Mes courses — Car'in",
}

const LIEN_RESERVER =
  'inline-flex min-h-cible items-center justify-center self-start rounded-md bg-accent px-4 font-semibold text-on-primary transition-colors duration-200 hover:bg-accent-survol'

function ListeCourses({
  identifiant,
  titre,
  courses,
  vide,
  maintenant,
}: {
  readonly identifiant: string
  readonly titre: string
  readonly courses: readonly CourseAffichee[]
  readonly vide: string
  readonly maintenant: Date
}) {
  return (
    <section aria-labelledby={identifiant} className="flex flex-col gap-3">
      <h2 id={identifiant} className="text-xl font-semibold text-foreground">
        {titre}
      </h2>
      {courses.length === 0 ? (
        // Une liste vide dit quoi faire, elle ne laisse pas un blanc (règle 7).
        <div className="flex flex-col gap-3 rounded-lg bg-muted p-4 text-foreground">
          <p>{vide}</p>
          <Link href="/client/reserver" className="self-start font-semibold text-accent underline">
            Réserver une course
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/client/courses/${course.id}`}
                // Le retour de survol se pose sur la carte elle-même : son fond opaque
                // masquerait celui du lien.
                className="flex flex-col gap-2 rounded-lg [&>article]:transition-colors [&>article]:duration-200 hover:[&>article]:border-accent"
              >
                <CarteCourse course={course} />
                {/* S9 : une course que personne n'a prise ne doit jamais passer pour
                    faite, même une fois son heure dépassée. */}
                {enAttenteEnRetard(course, maintenant) ? (
                  <p className="rounded-lg bg-etat-demandee px-4 py-2 font-semibold text-etat-demandee-texte">
                    {MESSAGE_EN_RETARD}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/// Mes courses (story 3.4, scénarios S8 et S9). La garde est refaite ici, et non
/// laissée au seul proxy : chaque page d'espace l'appelle en premier (un test le
/// vérifie).
export default async function EspaceClient() {
  const session = await exigerEspace('CLIENT')

  // Seules les courses du client connecté : l'identifiant vient de la session, jamais
  // d'un paramètre de la requête.
  const courses = await prisma().course.findMany({
    where: { clientId: session.user.id },
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
  const { aVenir, passees } = repartirCourses(courses)
  const maintenant = new Date()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace client
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bonjour, {session.user.name}
        </h1>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/client/reserver" className={LIEN_RESERVER}>
          Réserver une course
        </Link>
        <Link
          href="/compte"
          className="inline-flex min-h-cible items-center font-semibold text-accent underline"
        >
          Mon compte
        </Link>
      </div>

      <ListeCourses
        identifiant="a-venir"
        titre="À venir"
        courses={aVenir}
        vide="Vous n’avez aucune course à venir. Réservez votre prochain trajet en quelques instants."
        maintenant={maintenant}
      />
      <ListeCourses
        identifiant="passees"
        titre="Passées"
        courses={passees}
        vide="Vos courses terminées ou annulées s’afficheront ici. Commencez par réserver une course."
        maintenant={maintenant}
      />
    </main>
  )
}
