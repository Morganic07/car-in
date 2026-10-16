'use client'

import { useActionState, useEffect, useState } from 'react'

import { Bouton } from '../../../../components/ui/Bouton.tsx'
import {
  ADRESSE_MANQUANTE,
  type Adresse,
  type ChampAdresse as NomChamp,
} from '../../../../lib/adresse.ts'
import { ChampAdresse } from './ChampAdresse.tsx'
import {
  estimerTrajet,
  verifierTrajet,
  type EstimationAffichee,
  type EtatTrajet,
} from './actions.ts'

const ETAT_INITIAL: EtatTrajet = { erreurs: {} }
const INDISPONIBLE: EstimationAffichee = { distance: null, duree: null, prix: null }

/// Verdicts du navigateur posés au `blur` ; absents, c'est le serveur qui parle.
type Verdicts = Partial<Record<NomChamp, string | null>>

type Retenues = Record<NomChamp, Adresse | null>

/// Une estimation vaut pour **une** paire d'adresses : la clé la rattache à celle
/// qui l'a demandée, pour qu'une réponse lente n'habille pas un autre trajet.
function cleTrajet({ depart, arrivee }: Retenues): string | null {
  if (depart === null || arrivee === null) return null
  return JSON.stringify([depart.label, depart.lat, depart.lon, arrivee.label, arrivee.lat, arrivee.lon])
}

export function FormulaireTrajet() {
  const [etat, action, enCours] = useActionState(verifierTrajet, ETAT_INITIAL)
  const [verdicts, setVerdicts] = useState<Verdicts>({})
  const [retenues, setRetenues] = useState<Retenues>({ depart: null, arrivee: null })
  const [estimation, setEstimation] = useState<{
    readonly cle: string
    readonly resultat: EstimationAffichee
  } | null>(null)

  const cle = cleTrajet(retenues)

  // L'estimation part dès que les deux adresses sont retenues, avant tout envoi — et
  // une seule fois par trajet **réussi** : retaper puis rechoisir la même adresse ne
  // coûte alors ni un appel au service ni une unité de la limite du client. Après un
  // échec, rechoisir le trajet retente : la panne était peut-être passagère.
  const dejaEstime = estimation?.cle === cle && estimation.resultat.distance !== null
  useEffect(() => {
    const { depart, arrivee } = retenues
    if (cle === null || depart === null || arrivee === null || dejaEstime) return
    let actuelle = true
    estimerTrajet(depart, arrivee).then(
      (resultat) => {
        if (actuelle) setEstimation({ cle, resultat })
      },
      (panne: unknown) => {
        if (!actuelle) return
        // L'action a levé (base indisponible…) : on le dit dans la console, et l'écran
        // affiche « prix confirmé », comme pour toute estimation impossible.
        console.error('Estimation impossible :', panne)
        setEstimation({ cle, resultat: INDISPONIBLE })
      },
    )
    return () => {
      actuelle = false
    }
  }, [cle, retenues, dejaEstime])

  function erreur(champ: NomChamp): string | undefined {
    return champ in verdicts ? (verdicts[champ] ?? undefined) : etat.erreurs[champ]
  }

  function verifier(champ: NomChamp) {
    return (verdict: string | null) => setVerdicts((avant) => ({ ...avant, [champ]: verdict }))
  }

  function retenir(champ: NomChamp) {
    return (adresse: Adresse | null) => setRetenues((avant) => ({ ...avant, [champ]: adresse }))
  }

  const resultat = cle !== null && estimation?.cle === cle ? estimation.resultat : null

  return (
    <form
      action={action}
      noValidate
      // Un nouvel envoi rend la parole au serveur, qui revalide tout.
      onSubmit={() => setVerdicts({})}
      className="flex flex-col gap-6"
    >
      <ChampAdresse
        champ="depart"
        libelle="Adresse de départ"
        manquante={ADRESSE_MANQUANTE.depart}
        erreur={erreur('depart')}
        onVerifier={verifier('depart')}
        onRetenue={retenir('depart')}
      />
      <ChampAdresse
        champ="arrivee"
        libelle="Adresse d’arrivée"
        manquante={ADRESSE_MANQUANTE.arrivee}
        erreur={erreur('arrivee')}
        onVerifier={verifier('arrivee')}
        onRetenue={retenir('arrivee')}
      />

      <EncartEstimation enAttente={cle === null} resultat={resultat} />

      {etat.erreurGenerale === undefined ? null : (
        <p role="alert" className="font-semibold text-destructive">
          {etat.erreurGenerale}
        </p>
      )}

      {etat.trajet === undefined ? null : (
        <div role="status" className="flex flex-col gap-1 rounded-md bg-muted p-4">
          <p className="font-semibold text-foreground">Trajet retenu</p>
          <p className="text-foreground">De : {etat.trajet.depart.label}</p>
          <p className="text-foreground">À : {etat.trajet.arrivee.label}</p>
          <p className="text-sm text-secondary">
            La date et les passagers se choisiront ici très bientôt.
          </p>
        </div>
      )}

      <Bouton type="submit" disabled={enCours} className="self-start">
        {enCours ? 'Vérification…' : 'Continuer'}
      </Bouton>
    </form>
  )
}

function EncartEstimation({
  enAttente,
  resultat,
}: {
  readonly enAttente: boolean
  readonly resultat: EstimationAffichee | null
}) {
  return (
    <section
      aria-labelledby="estimation-titre"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <h2 id="estimation-titre" className="font-semibold text-foreground">
        Estimation
      </h2>
      {enAttente ? (
        <p className="text-secondary">
          Choisissez les deux adresses pour voir la distance, la durée et le prix estimés.
        </p>
      ) : resultat === null ? (
        <p className="text-secondary">Calcul de l’estimation…</p>
      ) : (
        <>
          {resultat.distance === null || resultat.duree === null ? null : (
            <dl className="flex flex-wrap gap-x-6 gap-y-1">
              <div className="flex gap-2">
                <dt className="text-secondary">Distance</dt>
                <dd className="font-semibold text-foreground">{resultat.distance}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-secondary">Durée</dt>
                <dd className="font-semibold text-foreground">{resultat.duree}</dd>
              </div>
            </dl>
          )}
          {resultat.prix === null ? (
            <>
              <p className="font-semibold text-foreground">Prix confirmé par la compagnie</p>
              <p className="text-sm text-secondary">
                L’estimation n’est pas disponible pour le moment. Vous pouvez réserver
                normalement : la compagnie vous confirmera le prix.
              </p>
            </>
          ) : (
            <p className="flex items-baseline gap-2">
              <span className="text-secondary">Prix estimé</span>
              <span className="text-xl font-bold text-foreground">{resultat.prix}</span>
            </p>
          )}
        </>
      )}
    </section>
  )
}
