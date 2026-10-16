'use server'

import {
  adresseDepuis,
  lireAdresse,
  type Adresse,
  type ChampAdresse,
} from '../../../../lib/adresse.ts'
import { autoriser } from '../../../../lib/garde.ts'
import { REGLES, cleEstimationGlobale, consommer } from '../../../../lib/limite-debit.ts'
import { prisma } from '../../../../lib/prisma.ts'
import {
  ESTIMATION_INDISPONIBLE,
  estimer,
  formaterDistance,
  formaterDuree,
  formaterPrix,
  type Estimation,
} from '../../../../lib/tarif.ts'

export type EtatTrajet = {
  readonly erreurs: Partial<Record<ChampAdresse, string>>
  readonly erreurGenerale?: string
  /// Présent quand les deux adresses sont retenues et localisées.
  readonly trajet?: { readonly depart: Adresse; readonly arrivee: Adresse }
}

/// Vérifie le trajet saisi : deux adresses choisies parmi les propositions, donc
/// localisées (S10). La création de la course viendra s'y greffer (story 3.3) ; le
/// contrôle des adresses, lui, est déjà celui qu'elle appliquera.
export async function verifierTrajet(
  _precedent: EtatTrajet,
  formulaire: FormData,
): Promise<EtatTrajet> {
  const autorisation = await autoriser('CLIENT')
  if (!autorisation.permis) return { erreurs: {}, erreurGenerale: autorisation.motif }

  const depart = lireAdresse(formulaire, 'depart')
  const arrivee = lireAdresse(formulaire, 'arrivee')
  if (!depart.valide || !arrivee.valide) {
    return {
      erreurs: {
        ...(depart.valide ? {} : { depart: depart.erreur }),
        ...(arrivee.valide ? {} : { arrivee: arrivee.erreur }),
      },
    }
  }
  return { erreurs: {}, trajet: { depart: depart.adresse, arrivee: arrivee.adresse } }
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

  // Le compteur du client d'abord : un client qui a épuisé sa part ne consomme pas
  // le plafond commun.
  for (const [cle, regle] of [
    [`estimation:${autorisation.session.user.id}`, REGLES.estimationParClient],
    [cleEstimationGlobale(), REGLES.estimationGlobale],
  ] as const) {
    const verdict = await consommer(prisma(), cle, regle)
    if (!verdict.permis) {
      console.error(`Estimation refusée : limite « ${cle} » atteinte.`)
      return afficher(ESTIMATION_INDISPONIBLE)
    }
  }

  return afficher(await estimer(depart, arrivee))
}
