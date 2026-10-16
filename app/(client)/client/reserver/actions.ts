'use server'

import { lireAdresse, type Adresse, type ChampAdresse } from '../../../../lib/adresse.ts'
import { autoriser } from '../../../../lib/garde.ts'

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
