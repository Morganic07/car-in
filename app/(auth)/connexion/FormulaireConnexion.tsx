'use client'

import { useActionState, useState, type FocusEvent } from 'react'

import { Bouton } from '../../../components/ui/Bouton.tsx'
import { Champ } from '../../../components/ui/Champ.tsx'
import { erreurChampConnexion, type ChampConnexion } from '../../../lib/connexion.ts'
import { connecter, type EtatConnexion } from './actions.ts'

const ETAT_INITIAL: EtatConnexion = { email: '', erreurs: {} }

/// Même convention que le formulaire d'inscription : `null` = vérifié et valide au
/// `blur`, absent = c'est le verdict du serveur qui s'affiche.
type VerdictsLocaux = Partial<Record<ChampConnexion, string | null>>

export function FormulaireConnexion() {
  const [etat, action, enCours] = useActionState(connecter, ETAT_INITIAL)
  const [verdicts, setVerdicts] = useState<VerdictsLocaux>({})

  function verifier(champ: ChampConnexion) {
    return (evenement: FocusEvent<HTMLInputElement>) => {
      const erreur = erreurChampConnexion(champ, evenement.currentTarget.value)
      setVerdicts((precedents) => ({ ...precedents, [champ]: erreur ?? null }))
    }
  }

  function erreur(champ: ChampConnexion): string | undefined {
    return champ in verdicts ? (verdicts[champ] ?? undefined) : etat.erreurs[champ]
  }

  return (
    <form
      action={action}
      noValidate
      onSubmit={() => setVerdicts({})}
      className="flex flex-col gap-6"
    >
      <Champ
        id="email"
        name="email"
        type="email"
        libelle="Adresse e-mail"
        autoComplete="email"
        defaultValue={etat.email}
        onBlur={verifier('email')}
        erreur={erreur('email')}
      />
      <Champ
        id="motDePasse"
        name="motDePasse"
        type="password"
        libelle="Mot de passe"
        autoComplete="current-password"
        onBlur={verifier('motDePasse')}
        erreur={erreur('motDePasse')}
      />

      {etat.erreurGenerale === undefined ? null : (
        <p role="alert" className="font-semibold text-destructive">
          {etat.erreurGenerale}
        </p>
      )}

      <Bouton type="submit" disabled={enCours}>
        {enCours ? 'Connexion…' : 'Se connecter'}
      </Bouton>
    </form>
  )
}
