import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BadgeEtat } from '../../../../../../components/ui/BadgeEtat.tsx'
import { exigerEspace } from '../../../../../../lib/garde.ts'
import { prisma } from '../../../../../../lib/prisma.ts'
import { formaterDepart } from '../../../../../../lib/reservation.ts'
import { formaterDistance, formaterDuree, formaterPrix } from '../../../../../../lib/tarif.ts'

export const metadata: Metadata = {
  title: "Course réservée — Car'in",
}

function pluriel(nombre: number, singulier: string, pluriel_: string): string {
  return `${nombre} ${nombre > 1 ? pluriel_ : singulier}`
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

  const ligne = (terme: string, valeur: string) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 font-semibold text-secondary sm:w-40">{terme}</dt>
      {/* Retours à la ligne du commentaire conservés, et un mot sans espace coupé
          plutôt que de faire défiler l'écran à 375 px. */}
      <dd className="whitespace-pre-line wrap-anywhere text-foreground">{valeur}</dd>
    </div>
  )

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

      <dl className="flex flex-col gap-3">
        {ligne('Départ', course.departLabel)}
        {ligne('Arrivée', course.arriveeLabel)}
        {ligne('Date et heure', formaterDepart(course.departAt))}
        {ligne('Passagers', pluriel(course.passagers, 'passager', 'passagers'))}
        {ligne(
          'Bagages',
          course.bagages === 0 ? 'Aucun' : pluriel(course.bagages, 'bagage', 'bagages'),
        )}
        {ligne('Siège enfant', course.siegeEnfant ? 'Oui' : 'Non')}
        {ligne('Commentaire', course.commentaire ?? 'Aucun')}
        {course.distanceM === null || course.dureeS === null
          ? null
          : ligne(
              'Trajet estimé',
              `${formaterDistance(course.distanceM)} · ${formaterDuree(course.dureeS)}`,
            )}
        {/* Prix absent : l'estimation a échoué. On l'écrit, on ne le remplace pas par
            un calcul approché — scénario S11. */}
        {ligne(
          'Prix',
          course.prixEstimeCents === null
            ? 'Prix confirmé par la compagnie'
            : `${formaterPrix(course.prixEstimeCents)} estimés, le compteur fait foi`,
        )}
      </dl>

      <div className="flex flex-wrap gap-4">
        <Link
          href="/client"
          className="inline-flex min-h-cible items-center justify-center rounded-md bg-accent px-4 font-semibold text-on-primary transition-colors duration-200 hover:bg-accent-survol"
        >
          Retour à mon espace
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
