'use client'

import { useActionState, useState } from 'react'

import { Bouton } from '../../../../components/ui/Bouton.tsx'
import { ADRESSE_MANQUANTE, type ChampAdresse as NomChamp } from '../../../../lib/adresse.ts'
import { ChampAdresse } from './ChampAdresse.tsx'
import { verifierTrajet, type EtatTrajet } from './actions.ts'

const ETAT_INITIAL: EtatTrajet = { erreurs: {} }

/// Verdicts du navigateur posés au `blur` ; absents, c'est le serveur qui parle.
type Verdicts = Partial<Record<NomChamp, string | null>>

export function FormulaireTrajet() {
  const [etat, action, enCours] = useActionState(verifierTrajet, ETAT_INITIAL)
  const [verdicts, setVerdicts] = useState<Verdicts>({})

  function erreur(champ: NomChamp): string | undefined {
    return champ in verdicts ? (verdicts[champ] ?? undefined) : etat.erreurs[champ]
  }

  function verifier(champ: NomChamp) {
    return (verdict: string | null) => setVerdicts((avant) => ({ ...avant, [champ]: verdict }))
  }

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
      />
      <ChampAdresse
        champ="arrivee"
        libelle="Adresse d’arrivée"
        manquante={ADRESSE_MANQUANTE.arrivee}
        erreur={erreur('arrivee')}
        onVerifier={verifier('arrivee')}
      />

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
            La date, les passagers et le prix se choisiront ici très bientôt.
          </p>
        </div>
      )}

      <Bouton type="submit" disabled={enCours} className="self-start">
        {enCours ? 'Vérification…' : 'Continuer'}
      </Bouton>
    </form>
  )
}
