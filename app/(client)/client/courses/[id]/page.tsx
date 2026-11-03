import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CarteTrajet } from '../../../../../components/carte/CarteTrajet.tsx'
import { BadgeEtat } from '../../../../../components/ui/BadgeEtat.tsx'
import { transitionsPossibles } from '../../../../../lib/domaine/course.ts'
import { exigerEspace } from '../../../../../lib/garde.ts'
import {
  CHAUFFEUR_INCONNU,
  MESSAGE_EN_ATTENTE,
  MESSAGE_EN_RETARD,
  enAttenteEnRetard,
} from '../../../../../lib/mes-courses.ts'
import { prisma } from '../../../../../lib/prisma.ts'
import { formaterDepart } from '../../../../../lib/reservation.ts'
import { RecapitulatifCourse } from '../../RecapitulatifCourse.tsx'
import { AnnulationCourse } from './AnnulationCourse.tsx'

export const metadata: Metadata = {
  title: "Ma course — Car'in",
}

/// `tel:` sans espaces ni points : certains téléphones refusent de composer sinon.
function lienTelephone(telephone: string): string {
  return `tel:${telephone.replace(/[\s.-]/g, '')}`
}

/// Détail d'une course du client (story 3.4) : état, chauffeur dès l'acceptation,
/// carte du trajet et contraintes.
///
/// La course est cherchée **avec** son client : une course d'un autre client, ou un
/// identifiant inventé, donnent la même page introuvable — rien ne dit à un curieux
/// qu'un identifiant existe.
export default async function PageCourse({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerEspace('CLIENT')
  const { id } = await params

  const course = await prisma().course.findFirst({
    where: { id, clientId: session.user.id },
    // Le nom et le téléphone seulement : rien d'autre du compte du chauffeur ne sort.
    include: { chauffeur: { select: { nom: true, telephone: true } } },
  })
  if (course === null) notFound()

  const maintenant = new Date()
  // Le chauffeur s'affiche dès l'acceptation. Une course annulée garde son chauffeur
  // en base (l'historique ne le cache pas), mais le client n'a plus à l'appeler.
  const chauffeurAttendu =
    course.etat === 'ACCEPTEE' || course.etat === 'EN_COURSE' || course.etat === 'TERMINEE'
  if (chauffeurAttendu && course.chauffeur === null) {
    console.error(`Course ${course.id} en ${course.etat} sans chauffeur.`)
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Espace client
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Ma course</h1>
      </header>

      <section
        role="status"
        className="flex flex-col gap-3 rounded-md bg-muted p-4 text-foreground"
      >
        {/* Enveloppé : dans une colonne flexible, le badge s'étirerait sur toute la largeur. */}
        <div>
          <BadgeEtat etat={course.etat} />
        </div>

        {course.etat === 'DEMANDEE' ? <p>{MESSAGE_EN_ATTENTE}</p> : null}
        {enAttenteEnRetard(course, maintenant) ? (
          <p className="font-semibold text-etat-demandee-texte">{MESSAGE_EN_RETARD}</p>
        ) : null}

        {course.etat === 'ANNULEE' ? (
          <p>
            Cette course a été annulée
            {course.annuleeAt === null ? '' : ` le ${formaterDepart(course.annuleeAt)}`}.
          </p>
        ) : null}

        {chauffeurAttendu && course.chauffeur !== null ? (
          <dl className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-secondary">Votre chauffeur</dt>
              <dd>{course.chauffeur.nom}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-x-2">
              <dt className="font-semibold text-secondary">Téléphone</dt>
              <dd>
                <a
                  href={lienTelephone(course.chauffeur.telephone)}
                  className="inline-flex min-h-cible items-center font-semibold text-accent underline"
                >
                  {course.chauffeur.telephone}
                </a>
              </dd>
            </div>
          </dl>
        ) : null}
        {chauffeurAttendu && course.chauffeur === null ? <p>{CHAUFFEUR_INCONNU}</p> : null}
      </section>

      <CarteTrajet
        depart={{ label: course.departLabel, lat: course.departLat, lon: course.departLon }}
        arrivee={{ label: course.arriveeLabel, lat: course.arriveeLat, lon: course.arriveeLon }}
      />

      <RecapitulatifCourse course={course} />

      <AnnulationCourse
        courseId={course.id}
        annulable={transitionsPossibles(course.etat, 'CLIENT').includes('annuler')}
      />

      <Link
        href="/client"
        className="inline-flex min-h-cible items-center self-start font-semibold text-accent underline"
      >
        Retour à mes courses
      </Link>
    </main>
  )
}
