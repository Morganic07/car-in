'use client'

import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { Bouton } from '../../../../components/ui/Bouton.tsx'
import { Champ } from '../../../../components/ui/Champ.tsx'
import { ADRESSE_MANQUANTE, type Adresse, type ChampAdresse as NomChamp } from '../../../../lib/adresse.ts'
import {
  BAGAGES_MAX,
  COMMENTAIRE_MAX,
  MESSAGES_CONTRAINTES,
  PASSAGERS_MAX,
  PASSAGERS_MIN,
  lireDepart,
  longueurCommentaire,
  type ChampReservation,
} from '../../../../lib/reservation.ts'
import { ChampAdresse } from './ChampAdresse.tsx'
import {
  estimerTrajet,
  reserverCourse,
  type EstimationAffichee,
  type EtatReservation,
} from './actions.ts'

const ETAT_INITIAL: EtatReservation = { erreurs: {} }
const INDISPONIBLE: EstimationAffichee = { distance: null, duree: null, prix: null }

/// Verdicts du navigateur posés au `blur` ; absents, c'est le serveur qui parle.
type Verdicts = Partial<Record<ChampReservation, string | null>>

type Retenues = Record<NomChamp, Adresse | null>

/// Une estimation vaut pour **une** paire d'adresses : la clé la rattache à celle
/// qui l'a demandée, pour qu'une réponse lente n'habille pas un autre trajet.
function cleTrajet({ depart, arrivee }: Retenues): string | null {
  if (depart === null || arrivee === null) return null
  return JSON.stringify([depart.label, depart.lat, depart.lon, arrivee.label, arrivee.lat, arrivee.lon])
}

function nombres(de: number, a: number): number[] {
  return Array.from({ length: a - de + 1 }, (_, i) => de + i)
}

/// Le formulaire de réservation entier (story 3.3). Les champs sont contrôlés : React
/// vide un formulaire non contrôlé après chaque action, et un refus du serveur
/// effacerait alors toute la saisie du client.
///
/// `minimum` est l'heure de départ la plus proche permise, calculée par le serveur au
/// rendu : la calculer ici donnerait une valeur différente au serveur et au
/// navigateur. Elle ne sert qu'à griser le sélecteur de date ; le verdict, lui, est
/// rendu au `blur` puis refait par le serveur.
export function FormulaireReservation({ minimum }: { readonly minimum: string }) {
  const [etat, action, enCours] = useActionState(reserverCourse, ETAT_INITIAL)
  const [verdicts, setVerdicts] = useState<Verdicts>({})
  const [retenues, setRetenues] = useState<Retenues>({ depart: null, arrivee: null })
  const [departAt, setDepartAt] = useState('')
  const [passagers, setPassagers] = useState(String(PASSAGERS_MIN))
  const [bagages, setBagages] = useState('0')
  const [siegeEnfant, setSiegeEnfant] = useState(false)
  const [commentaire, setCommentaire] = useState('')
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

  function erreur(champ: ChampReservation): string | undefined {
    return champ in verdicts ? (verdicts[champ] ?? undefined) : etat.erreurs[champ]
  }

  function poser(champ: ChampReservation, verdict: string | null) {
    setVerdicts((avant) => ({ ...avant, [champ]: verdict }))
  }

  function retenir(champ: NomChamp) {
    return (adresse: Adresse | null) => setRetenues((avant) => ({ ...avant, [champ]: adresse }))
  }

  function envoyer(evenement: FormEvent<HTMLFormElement>) {
    // Un second appui sur Entrée pendant l'envoi mettrait une deuxième réservation en
    // file : deux courses identiques, et peut-être deux chauffeurs au rendez-vous.
    if (enCours) {
      evenement.preventDefault()
      return
    }
    // Un nouvel envoi rend la parole au serveur, qui revalide tout.
    setVerdicts({})
  }

  const resultat = cle !== null && estimation?.cle === cle ? estimation.resultat : null
  const restants = COMMENTAIRE_MAX - longueurCommentaire(commentaire)

  return (
    <form action={action} noValidate onSubmit={envoyer} className="flex flex-col gap-6">
      <ChampAdresse
        champ="depart"
        libelle="Adresse de départ"
        manquante={ADRESSE_MANQUANTE.depart}
        erreur={erreur('depart')}
        onVerifier={(verdict) => poser('depart', verdict)}
        onRetenue={retenir('depart')}
      />
      <ChampAdresse
        champ="arrivee"
        libelle="Adresse d’arrivée"
        manquante={ADRESSE_MANQUANTE.arrivee}
        erreur={erreur('arrivee')}
        onVerifier={(verdict) => poser('arrivee', verdict)}
        onRetenue={retenir('arrivee')}
      />

      <Champ
        id="champ-departAt"
        name="departAt"
        type="datetime-local"
        libelle="Date et heure de départ"
        aide="Au moins une heure à l’avance, à l’heure de Paris."
        min={minimum}
        value={departAt}
        onChange={(evenement) => setDepartAt(evenement.target.value)}
        onBlur={() => {
          const lecture = lireDepart(departAt, new Date())
          poser('departAt', lecture.valide ? null : lecture.erreur)
        }}
        erreur={erreur('departAt')}
      />

      <div className="flex flex-wrap gap-4">
        <Choix
          id="champ-passagers"
          name="passagers"
          libelle="Passagers"
          valeur={passagers}
          onChange={setPassagers}
          erreur={erreur('passagers')}
        >
          {nombres(PASSAGERS_MIN, PASSAGERS_MAX).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Choix>
        <Choix
          id="champ-bagages"
          name="bagages"
          libelle="Bagages"
          valeur={bagages}
          onChange={setBagages}
          erreur={erreur('bagages')}
        >
          {nombres(0, BAGAGES_MAX).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Choix>
      </div>

      <label className="flex min-h-cible cursor-pointer items-center gap-3 self-start text-foreground">
        <input
          type="checkbox"
          name="siegeEnfant"
          checked={siegeEnfant}
          onChange={(evenement) => setSiegeEnfant(evenement.target.checked)}
          className="size-5 accent-accent"
        />
        <span className="font-semibold">Siège enfant</span>
      </label>

      <div className="flex flex-col gap-1">
        <label htmlFor="champ-commentaire" className="font-semibold text-foreground">
          Commentaire <span className="font-normal text-secondary">(facultatif)</span>
        </label>
        <p id="champ-commentaire-aide" className="text-sm text-secondary">
          Un code d’accès, un point de rendez-vous précis, un besoin particulier.
        </p>
        <textarea
          id="champ-commentaire"
          name="commentaire"
          rows={3}
          // Pas de `maxLength` : il compte en unités UTF-16 (un émoji en vaut deux),
          // pas en caractères comme le compteur et le serveur. La limite est dite par
          // le compteur et le verdict au `blur`, et tenue par le serveur.
          value={commentaire}
          onChange={(evenement) => setCommentaire(evenement.target.value)}
          onBlur={() =>
            poser(
              'commentaire',
              longueurCommentaire(commentaire) > COMMENTAIRE_MAX
                ? MESSAGES_CONTRAINTES.commentaire
                : null,
            )
          }
          aria-invalid={erreur('commentaire') === undefined ? undefined : true}
          aria-describedby={[
            'champ-commentaire-aide',
            'champ-commentaire-restants',
            erreur('commentaire') === undefined ? null : 'champ-commentaire-erreur',
          ]
            .filter(Boolean)
            .join(' ')}
          className={[
            'rounded-md border bg-background px-3 py-2 text-foreground',
            erreur('commentaire') === undefined ? 'border-border' : 'border-destructive',
          ].join(' ')}
        />
        <p id="champ-commentaire-restants" className="text-sm text-secondary">
          {`${restants} caractère${Math.abs(restants) > 1 ? 's' : ''} restant${Math.abs(restants) > 1 ? 's' : ''}`}
        </p>
        {erreur('commentaire') === undefined ? null : (
          <p id="champ-commentaire-erreur" className="text-sm font-semibold text-destructive">
            {erreur('commentaire')}
          </p>
        )}
      </div>

      <EncartEstimation enAttente={cle === null} resultat={resultat} />

      {etat.erreurGenerale === undefined ? null : (
        <p role="alert" className="font-semibold text-destructive">
          {etat.erreurGenerale}
        </p>
      )}

      <Bouton type="submit" disabled={enCours} className="self-start">
        {enCours ? 'Réservation en cours…' : 'Réserver la course'}
      </Bouton>
    </form>
  )
}

/// Liste déroulante pour un petit nombre : un seul geste au téléphone, et aucune
/// saisie hors bornes possible — le serveur revérifie quand même.
function Choix({
  id,
  name,
  libelle,
  valeur,
  onChange,
  erreur,
  children,
}: {
  readonly id: string
  readonly name: string
  readonly libelle: string
  readonly valeur: string
  readonly onChange: (valeur: string) => void
  readonly erreur?: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold text-foreground">
        {libelle}
      </label>
      <select
        id={id}
        name={name}
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
        aria-invalid={erreur === undefined ? undefined : true}
        aria-describedby={erreur === undefined ? undefined : `${id}-erreur`}
        className={[
          'min-h-cible min-w-24 rounded-md border bg-background px-3 text-foreground',
          erreur === undefined ? 'border-border' : 'border-destructive',
        ].join(' ')}
      >
        {children}
      </select>
      {erreur === undefined ? null : (
        <p id={`${id}-erreur`} className="text-sm font-semibold text-destructive">
          {erreur}
        </p>
      )}
    </div>
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
