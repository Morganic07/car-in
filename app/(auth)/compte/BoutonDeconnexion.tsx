'use client'

import { useActionState } from 'react'

import { Bouton } from '../../../components/ui/Bouton.tsx'
import { deconnecter, type EtatDeconnexion } from './actions.ts'

const ETAT_INITIAL: EtatDeconnexion = {}

export function BoutonDeconnexion() {
  const [etat, action, enCours] = useActionState(deconnecter, ETAT_INITIAL)

  return (
    <form action={action} className="flex flex-col gap-2">
      <Bouton type="submit" variante="secondaire" disabled={enCours} className="self-start">
        {enCours ? 'Déconnexion…' : 'Se déconnecter'}
      </Bouton>
      {etat.erreur === undefined ? null : (
        <p role="alert" className="font-semibold text-destructive">
          {etat.erreur}
        </p>
      )}
    </form>
  )
}
