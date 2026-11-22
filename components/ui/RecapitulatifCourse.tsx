import { formaterDepart } from '../../lib/reservation.ts'
import { formaterDistance, formaterDuree, formaterPrix } from '../../lib/tarif.ts'

/// Ce que le récapitulatif lit d'une course : le client et le chauffeur le partagent, pour
/// ne jamais lire deux versions de la même.
export type CourseRecapitulee = {
  readonly departLabel: string
  readonly arriveeLabel: string
  readonly departAt: Date
  readonly passagers: number
  readonly bagages: number
  readonly siegeEnfant: boolean
  readonly commentaire: string | null
  readonly distanceM: number | null
  readonly dureeS: number | null
  readonly prixEstimeCents: number | null
}

function pluriel(nombre: number, singulier: string, pluriel_: string): string {
  return `${nombre} ${nombre > 1 ? pluriel_ : singulier}`
}

function Ligne({ terme, valeur }: { readonly terme: string; readonly valeur: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 font-semibold text-secondary sm:w-40">{terme}</dt>
      {/* Retours à la ligne du commentaire conservés, et un mot sans espace coupé
          plutôt que de faire défiler l'écran à 375 px. */}
      <dd className="whitespace-pre-line wrap-anywhere text-foreground">{valeur}</dd>
    </div>
  )
}

export function RecapitulatifCourse({ course }: { readonly course: CourseRecapitulee }) {
  return (
    <dl className="flex flex-col gap-3">
      <Ligne terme="Départ" valeur={course.departLabel} />
      <Ligne terme="Arrivée" valeur={course.arriveeLabel} />
      <Ligne terme="Date et heure" valeur={formaterDepart(course.departAt)} />
      <Ligne terme="Passagers" valeur={pluriel(course.passagers, 'passager', 'passagers')} />
      <Ligne
        terme="Bagages"
        valeur={course.bagages === 0 ? 'Aucun' : pluriel(course.bagages, 'bagage', 'bagages')}
      />
      <Ligne terme="Siège enfant" valeur={course.siegeEnfant ? 'Oui' : 'Non'} />
      <Ligne terme="Commentaire" valeur={course.commentaire ?? 'Aucun'} />
      {course.distanceM === null || course.dureeS === null ? null : (
        <Ligne
          terme="Trajet estimé"
          valeur={`${formaterDistance(course.distanceM)} · ${formaterDuree(course.dureeS)}`}
        />
      )}
      {/* Prix absent : l'estimation a échoué. On l'écrit, on ne le remplace pas par
          un calcul approché — scénario S11. */}
      <Ligne
        terme="Prix"
        valeur={
          course.prixEstimeCents === null
            ? 'Prix confirmé par la compagnie'
            : `${formaterPrix(course.prixEstimeCents)} estimés, le compteur fait foi`
        }
      />
    </dl>
  )
}
