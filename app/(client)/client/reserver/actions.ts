'use server'

import { redirect } from 'next/navigation'

import { adresseDepuis, type Adresse } from '../../../../lib/adresse.ts'
import { autoriser } from '../../../../lib/garde.ts'
import { REGLES, cleEstimationGlobale, consommer } from '../../../../lib/limite-debit.ts'
import { prisma } from '../../../../lib/prisma.ts'
import { validerReservation, type ChampReservation } from '../../../../lib/reservation.ts'
import {
  ESTIMATION_INDISPONIBLE,
  estimer,
  formaterDistance,
  formaterDuree,
  formaterPrix,
  type Estimation,
} from '../../../../lib/tarif.ts'

export type EtatReservation = {
  readonly erreurs: Partial<Record<ChampReservation, string>>
  readonly erreurGenerale?: string
}

const RESERVATION_IMPOSSIBLE =
  'La réservation n’a pas pu être enregistrée. Réessayez dans un instant.'

function reservationsTropNombreuses(reessayerDansMs: number): string {
  const minutes = Math.max(1, Math.ceil(reessayerDansMs / 60_000))
  return (
    `Vous avez réservé beaucoup de courses en peu de temps. Réessayez dans ${minutes} ` +
    `minute${minutes > 1 ? 's' : ''}, ou appelez la compagnie.`
  )
}

type Limite = readonly [cle: string, regle: (typeof REGLES)[keyof typeof REGLES]]

/// Estimation sous les limites de débit données, dans l'ordre. Limite atteinte :
/// aucune estimation, et l'écran dit « prix confirmé par la compagnie » (S11).
async function estimationLimitee(
  limites: readonly Limite[],
  depart: Adresse,
  arrivee: Adresse,
): Promise<Estimation> {
  for (const [cle, regle] of limites) {
    const verdict = await consommer(prisma(), cle, regle)
    if (!verdict.permis) {
      console.error(`Estimation refusée : limite « ${cle} » atteinte.`)
      return ESTIMATION_INDISPONIBLE
    }
  }
  return estimer(depart, arrivee)
}

/// Crée la course demandée (story 3.3, scénario S1) et mène à sa confirmation.
///
/// Tout est revalidé ici, adresses comprises (S10). Le prix est **recalculé** : celui
/// que le navigateur a affiché n'est jamais repris, une requête forgée le fixerait à
/// sa guise. Si l'estimation échoue, la course est créée sans prix (S11).
export async function reserverCourse(
  _precedent: EtatReservation,
  formulaire: FormData,
): Promise<EtatReservation> {
  const autorisation = await autoriser('CLIENT')
  if (!autorisation.permis) return { erreurs: {}, erreurGenerale: autorisation.motif }
  const clientId = autorisation.session.user.id

  const validation = validerReservation(formulaire, new Date())
  if (!validation.valide) return { erreurs: validation.erreurs }
  const { depart, arrivee, ...contraintes } = validation.reservation

  // Après la validation : une faute de saisie ne consomme rien. Avant l'estimation :
  // une réservation refusée ne coûte pas de recalcul. Cette limite borne aussi le
  // recalcul d'itinéraire fait ci-dessous pour chaque course.
  let verdict: Awaited<ReturnType<typeof consommer>>
  try {
    verdict = await consommer(prisma(), `reservation:${clientId}`, REGLES.reservationParClient)
  } catch (panne) {
    console.error('Réservation impossible : limite de débit illisible.', panne)
    return { erreurs: {}, erreurGenerale: RESERVATION_IMPOSSIBLE }
  }
  if (!verdict.permis) {
    return { erreurs: {}, erreurGenerale: reservationsTropNombreuses(verdict.reessayerDansMs) }
  }

  let estimation: Estimation
  try {
    // Le plafond commun, pas la part d'estimations du client : un client qui a eu sa
    // dernière estimation en remplissant le formulaire y a vu un prix, et sa course
    // ne doit pas être enregistrée sans. Sa part à lui est la limite de réservations.
    estimation = await estimationLimitee(
      [[cleEstimationGlobale(), REGLES.estimationGlobale]],
      depart,
      arrivee,
    )
  } catch (panne) {
    // Une estimation impossible n'empêche pas de réserver : la course part sans prix,
    // et la panne est dite dans le journal.
    console.error('Estimation impossible à la réservation :', panne)
    estimation = ESTIMATION_INDISPONIBLE
  }

  let id: string
  try {
    const course = await prisma().course.create({
      data: {
        clientId,
        etat: 'DEMANDEE',
        departLabel: depart.label,
        departLat: depart.lat,
        departLon: depart.lon,
        arriveeLabel: arrivee.label,
        arriveeLat: arrivee.lat,
        arriveeLon: arrivee.lon,
        ...contraintes,
        distanceM: estimation.itineraire?.distanceM ?? null,
        dureeS: estimation.itineraire?.dureeS ?? null,
        prixEstimeCents: estimation.prixCents,
      },
      select: { id: true },
    })
    id = course.id
  } catch (panne) {
    console.error('Réservation impossible :', panne)
    return { erreurs: {}, erreurGenerale: RESERVATION_IMPOSSIBLE }
  }

  // Hors du `try` : `redirect` signale la navigation en levant une exception, qui ne
  // doit pas être prise pour une panne d'enregistrement.
  redirect(`/client/reserver/confirmee/${encodeURIComponent(id)}`)
}

/// Ce que reçoit le navigateur : des textes déjà mis en forme. Le module qui appelle
/// le service d'itinéraire, et sa clé, restent ainsi entièrement côté serveur.
/// `null` : information indisponible — l'écran dit alors « prix confirmé par la
/// compagnie », jamais un chiffre de repli (S11).
export type EstimationAffichee = {
  readonly distance: string | null
  readonly duree: string | null
  readonly prix: string | null
}

function afficher({ itineraire, prixCents }: Estimation): EstimationAffichee {
  return {
    distance: itineraire === null ? null : formaterDistance(itineraire.distanceM),
    duree: itineraire === null ? null : formaterDuree(itineraire.dureeS),
    prix: prixCents === null ? null : formaterPrix(prixCents),
  }
}

/// Estime distance, durée et prix pour deux adresses retenues (story 3.2).
export async function estimerTrajet(
  departRecu: unknown,
  arriveeRecue: unknown,
): Promise<EstimationAffichee> {
  const autorisation = await autoriser('CLIENT')
  if (!autorisation.permis) return afficher(ESTIMATION_INDISPONIBLE)

  const depart = adresseDepuis(departRecu)
  const arrivee = adresseDepuis(arriveeRecue)
  if (depart === null || arrivee === null) return afficher(ESTIMATION_INDISPONIBLE)

  // La part du client d'abord : un client qui a épuisé la sienne ne consomme pas le
  // plafond commun.
  return afficher(
    await estimationLimitee(
      [
        [`estimation:${autorisation.session.user.id}`, REGLES.estimationParClient],
        [cleEstimationGlobale(), REGLES.estimationGlobale],
      ],
      depart,
      arrivee,
    ),
  )
}
