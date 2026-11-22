import type { Metadata } from 'next'
import Link from 'next/link'

import { CarteCourse } from '../../../components/ui/CarteCourse.tsx'
import { exigerEspace } from '../../../lib/garde.ts'
import { enAttenteEnRetard } from '../../../lib/mes-courses.ts'
import { prisma } from '../../../lib/prisma.ts'
import { BoutonAccepter, ZoneAcceptation } from './ZoneAcceptation.tsx'

export const metadata: Metadata = {
  title: "Courses disponibles — Car'in",
}

/// Courses disponibles (story 4.1, scénario S9). La garde est refaite ici, et non laissée
/// au seul proxy : chaque page d'espace l'appelle en premier (un test le vérifie).
export default async function EspaceChauffeur() {
  const session = await exigerEspace('CHAUFFEUR')

  // Le tri par heure de départ suffit à faire remonter une course en retard : son heure
  // est passée, elle précède donc toutes les autres. Rien du compte client n'est lu : son
  // téléphone attend l'acceptation (story 4.3).
  const courses = await prisma().course.findMany({
    where: { etat: 'DEMANDEE' },
    orderBy: [{ departAt: 'asc' }, { id: 'asc' }],
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
  const maintenant = new Date()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace chauffeur
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bonjour, {session.user.name}
        </h1>
      </header>

      <section aria-labelledby="disponibles" className="flex flex-col gap-3">
        <h2 id="disponibles" className="text-xl font-semibold text-foreground">
          Courses disponibles
        </h2>
        {/* Autour de l'état vide aussi : accepter la dernière course vide la liste, et le
            message doit survivre à ce rafraîchissement. */}
        <ZoneAcceptation>
          {courses.length === 0 ? (
            <p className="rounded-lg bg-muted p-4 text-foreground">
              Aucune course n’attend de chauffeur pour le moment. Revenez consulter cette page
              un peu plus tard.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {courses.map((course) => (
                <li key={course.id}>
                  <div className="flex flex-col gap-2">
                    <CarteCourse course={course} enRetard={enAttenteEnRetard(course, maintenant)} />
                    <BoutonAccepter courseId={course.id} depart={course.departLabel} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ZoneAcceptation>
      </section>

      <div className="flex flex-wrap gap-4">
        <Link
          href="/chauffeur/courses"
          className="inline-flex min-h-cible items-center font-semibold text-accent underline"
        >
          Mes courses
        </Link>
        <Link
          href="/compte"
          className="inline-flex min-h-cible items-center font-semibold text-accent underline"
        >
          Mon compte
        </Link>
      </div>
    </main>
  )
}
