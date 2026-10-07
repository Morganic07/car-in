'use client'

import { useActionState, useState, type FocusEvent } from 'react'

import { Bouton } from '../../../components/ui/Bouton.tsx'
import { Champ } from '../../../components/ui/Champ.tsx'
import {
  MOT_DE_PASSE_MIN,
  erreurChamp,
  type ChampInscription,
} from '../../../lib/inscription.ts'
import { inscrire, type EtatInscription } from './actions.ts'

const ETAT_INITIAL: EtatInscription = {
  valeurs: { nom: '', email: '', telephone: '' },
  erreurs: {},
}

/// Verdict du navigateur, champ par champ, posé au `blur`. `null` : le champ a été
/// vérifié et il est valide. Absent : pas encore vérifié depuis le dernier envoi, et
/// c'est alors le verdict du serveur qui s'affiche.
type VerdictsLocaux = Partial<Record<ChampInscription, string | null>>

export function FormulaireInscription() {
  const [etat, action, enCours] = useActionState(inscrire, ETAT_INITIAL)
  const [verdicts, setVerdicts] = useState<VerdictsLocaux>({})

  function verifier(champ: ChampInscription) {
    return (evenement: FocusEvent<HTMLInputElement>) => {
      const valeur = evenement.currentTarget.value
      const erreur = erreurChamp(champ, valeur)
      // Le navigateur ne sait pas qu'une adresse est déjà prise. Tant que la valeur
      // est celle que le serveur a refusée, son verdict reste affiché : seule une
      // erreur locale ou une valeur modifiée le remplace.
      const refuseeTelleQuelle = champ !== 'motDePasse' && valeur === etat.valeurs[champ]
      setVerdicts((precedents) => {
        if (erreur === undefined && refuseeTelleQuelle) {
          const { [champ]: _ancien, ...autres } = precedents
          return autres
        }
        return { ...precedents, [champ]: erreur ?? null }
      })
    }
  }

  function erreur(champ: ChampInscription): string | undefined {
    return champ in verdicts ? (verdicts[champ] ?? undefined) : etat.erreurs[champ]
  }

  return (
    <form
      action={action}
      // Le navigateur ne remplace pas nos messages par les siens : chaque erreur est
      // rédigée en français et affichée sous son champ.
      noValidate
      // Un nouvel envoi rend la parole au serveur, qui revalide tout.
      onSubmit={() => setVerdicts({})}
      className="flex flex-col gap-6"
    >
      <Champ
        id="nom"
        name="nom"
        libelle="Nom et prénom"
        autoComplete="name"
        defaultValue={etat.valeurs.nom}
        onBlur={verifier('nom')}
        erreur={erreur('nom')}
      />
      <Champ
        id="email"
        name="email"
        type="email"
        libelle="Adresse e-mail"
        autoComplete="email"
        defaultValue={etat.valeurs.email}
        onBlur={verifier('email')}
        erreur={erreur('email')}
      />
      <Champ
        id="telephone"
        name="telephone"
        type="tel"
        libelle="Téléphone"
        aide="Le chauffeur s’en sert pour vous joindre le jour de la course."
        autoComplete="tel"
        defaultValue={etat.valeurs.telephone}
        onBlur={verifier('telephone')}
        erreur={erreur('telephone')}
      />
      <Champ
        id="motDePasse"
        name="motDePasse"
        type="password"
        libelle="Mot de passe"
        aide={`Au moins ${MOT_DE_PASSE_MIN} caractères.`}
        autoComplete="new-password"
        onBlur={verifier('motDePasse')}
        erreur={erreur('motDePasse')}
      />

      {etat.erreurGenerale === undefined ? null : (
        <p role="alert" className="font-semibold text-destructive">
          {etat.erreurGenerale}
        </p>
      )}

      <Bouton type="submit" disabled={enCours}>
        {enCours ? 'Création du compte…' : 'Créer mon compte'}
      </Bouton>
    </form>
  )
}
