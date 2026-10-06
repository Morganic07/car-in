import type { Etat } from '../../lib/domaine/course.ts'
import { BadgeEtat } from './BadgeEtat.tsx'

/// Type de présentation, délibérément détaché du modèle Prisma : la carte n'a pas
/// besoin des coordonnées ni des horodatages, et ne doit pas obliger ses appelants à
/// charger une ligne entière pour l'afficher.
export type CourseAffichee = {
  readonly id: string
  readonly etat: Etat
  readonly departLabel: string
  readonly arriveeLabel: string
  readonly departAt: Date
  readonly passagers: number
  readonly bagages: number
  readonly siegeEnfant: boolean
  readonly prixEstimeCents: number | null
}

/// Fuseau figé sur Paris, et non celui de la machine : sans cela, le serveur et le
/// navigateur peuvent formater la même date différemment, et React signale une
/// divergence d'hydratation. La compagnie opère en France, le fuseau est une donnée
/// du métier, pas un réglage de l'hôte.
const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})

const FORMAT_PRIX = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

function pluriel(nombre: number, singulier: string, pluriel_: string): string {
  return `${nombre} ${nombre > 1 ? pluriel_ : singulier}`
}

function contraintes(course: CourseAffichee): string {
  const morceaux = [
    pluriel(course.passagers, 'passager', 'passagers'),
    pluriel(course.bagages, 'bagage', 'bagages'),
  ]
  if (course.siegeEnfant) morceaux.push('siège enfant')
  return morceaux.join(' · ')
}

export function CarteCourse({ course }: { readonly course: CourseAffichee }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-foreground">{FORMAT_DATE.format(course.departAt)}</p>
        <BadgeEtat etat={course.etat} />
      </div>

      <dl className="flex flex-col gap-1 text-foreground">
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-secondary">Départ</dt>
          <dd>{course.departLabel}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-secondary">Arrivée</dt>
          <dd>{course.arriveeLabel}</dd>
        </div>
      </dl>

      <p className="text-sm text-secondary">{contraintes(course)}</p>

      {/* Prix absent : l'estimation a échoué. On l'écrit, on ne le remplace pas par un
          calcul approché — scénario S11. */}
      <p className="font-semibold text-foreground">
        {course.prixEstimeCents === null
          ? 'Prix confirmé par la compagnie'
          : `${FORMAT_PRIX.format(course.prixEstimeCents / 100)} estimés`}
      </p>
    </article>
  )
}
