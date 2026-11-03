'use client'

import { useEffect, useReducer, type KeyboardEvent } from 'react'

import {
  DELAI_FRAPPE_MS,
  LONGUEUR_MAX,
  MESSAGE_INDISPONIBLE,
  MIN_CARACTERES,
  etatInitial,
  evoluer,
  erreurSaisie,
  rechercherAdresses,
  type Adresse,
  type ChampAdresse as NomChamp,
} from '../../../../lib/adresse.ts'

type ProprietesChampAdresse = {
  readonly champ: NomChamp
  readonly libelle: string
  readonly manquante: string
  /// Message à afficher sous le champ : verdict local au `blur`, ou refus du serveur.
  readonly erreur?: string
  /// Appelé au `blur` avec le verdict local (`null` : rien à redire).
  readonly onVerifier: (erreur: string | null) => void
  /// Appelé quand l'adresse retenue change : une proposition choisie, ou `null`
  /// quand une frappe défait le choix.
  readonly onRetenue?: (adresse: Adresse | null) => void
}

/// Champ d'adresse avec propositions de la Base Adresse Nationale, selon le motif
/// « combobox » de l'ARIA : le focus reste dans le champ, la proposition surlignée est
/// annoncée par `aria-activedescendant`.
///
/// Seule une proposition choisie remplit les trois champs cachés (libellé, latitude,
/// longitude) que lit le serveur. Un texte tapé sans choix part sans coordonnées, et
/// le serveur le refuse (S10).
export function ChampAdresse({
  champ,
  libelle,
  manquante,
  erreur,
  onVerifier,
  onRetenue,
}: ProprietesChampAdresse) {
  const [etat, envoyer] = useReducer(evoluer, null, () => etatInitial())

  function choisir(index: number) {
    const choisie = etat.ouverte ? etat.propositions[index] : undefined
    if (choisie === undefined) return
    envoyer({ type: 'choisir', index })
    onVerifier(null)
    onRetenue?.(choisie)
  }
  const id = `champ-${champ}`
  const idListe = `${id}-propositions`
  const idEtat = `${id}-etat`

  // La recherche part 300 ms après la dernière frappe. Une nouvelle frappe annule la
  // minuterie **et** la requête en vol : seule la dernière saisie interroge le service.
  useEffect(() => {
    if (etat.statut !== 'recherche') return
    const saisie = etat.saisie
    const controleur = new AbortController()
    const minuterie = setTimeout(() => {
      rechercherAdresses(saisie, { signal: controleur.signal }).then(
        (propositions) => envoyer({ type: 'resultats', saisie, propositions }),
        (panne: unknown) => {
          if (controleur.signal.aborted) return
          // La page reste utilisable : le message s'affiche sous le champ, la trace
          // part dans la console.
          console.error('Recherche d’adresse impossible :', panne)
          envoyer({ type: 'panne', saisie })
        },
      )
    }, DELAI_FRAPPE_MS)
    return () => {
      clearTimeout(minuterie)
      controleur.abort()
    }
  }, [etat.statut, etat.saisie])

  function auClavier(evenement: KeyboardEvent<HTMLInputElement>) {
    switch (evenement.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (etat.propositions.length === 0) return
        evenement.preventDefault()
        envoyer({ type: 'deplacer', sens: evenement.key === 'ArrowDown' ? 1 : -1 })
        return
      case 'Enter':
        // Entrée choisit la proposition surlignée au lieu d'envoyer le formulaire.
        if (etat.ouverte && etat.active !== -1) {
          evenement.preventDefault()
          choisir(etat.active)
        }
        return
      case 'Escape':
        if (etat.ouverte) {
          evenement.preventDefault()
          envoyer({ type: 'fermer' })
        }
        return
    }
  }

  const statut = (() => {
    switch (etat.statut) {
      case 'recherche':
        return 'Recherche des adresses…'
      case 'aucune':
        return 'Aucune adresse trouvée. Vérifiez la saisie, ou ajoutez la commune.'
      case 'indisponible':
        return MESSAGE_INDISPONIBLE
      case 'resultats':
        // Liste fermée (Échap, sortie du champ) : ne pas décrire une liste invisible.
        return etat.ouverte
          ? `${etat.propositions.length} proposition${etat.propositions.length > 1 ? 's' : ''}. Flèches pour parcourir, Entrée pour choisir.`
          : 'Flèche bas pour rouvrir les propositions.'
      case 'repos':
        return etat.saisie.trim() !== '' && etat.retenue === null
          ? `Tapez au moins ${MIN_CARACTERES} caractères, puis choisissez dans la liste.`
          : ''
    }
  })()

  const listeVisible = etat.ouverte && etat.propositions.length > 0
  const erreurVisible = erreur === undefined || erreur === '' ? undefined : erreur
  const idErreur = `${id}-erreur`

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold text-foreground">
        {libelle}
      </label>
      <input
        id={id}
        name={champ}
        type="text"
        role="combobox"
        autoComplete="off"
        maxLength={LONGUEUR_MAX}
        placeholder="Numéro, rue, commune"
        aria-autocomplete="list"
        aria-expanded={listeVisible}
        aria-controls={idListe}
        aria-activedescendant={
          listeVisible && etat.active !== -1 ? `${idListe}-${etat.active}` : undefined
        }
        aria-invalid={erreurVisible === undefined ? undefined : true}
        aria-describedby={[idEtat, erreurVisible === undefined ? '' : idErreur]
          .filter(Boolean)
          .join(' ')}
        value={etat.saisie}
        onChange={(evenement) => {
          envoyer({ type: 'frappe', saisie: evenement.currentTarget.value })
          if (etat.retenue !== null) onRetenue?.(null)
        }}
        onKeyDown={auClavier}
        onBlur={() => {
          envoyer({ type: 'fermer' })
          onVerifier(erreurSaisie(etat, manquante) ?? null)
        }}
        className={[
          'min-h-cible rounded-md border bg-background px-3 text-foreground',
          'placeholder:text-secondary',
          erreurVisible === undefined ? 'border-border' : 'border-destructive',
        ].join(' ')}
      />

      <input type="hidden" name={`${champ}Label`} value={etat.retenue?.label ?? ''} />
      <input type="hidden" name={`${champ}Lat`} value={etat.retenue?.lat ?? ''} />
      <input type="hidden" name={`${champ}Lon`} value={etat.retenue?.lon ?? ''} />

      <ul
        id={idListe}
        role="listbox"
        aria-label={`Propositions pour ${libelle.toLowerCase()}`}
        hidden={!listeVisible}
        className="absolute top-full right-0 left-0 z-10 mt-1 flex flex-col rounded-md border border-border bg-background py-1"
      >
        {etat.propositions.map((proposition, index) => (
          <li
            key={`${proposition.label}-${proposition.lat}-${proposition.lon}`}
            id={`${idListe}-${index}`}
            role="option"
            aria-selected={index === etat.active}
            // `mousedown` garde le focus dans le champ : sans cela, le `blur` fermerait
            // la liste avant que le clic n'arrive.
            onMouseDown={(evenement) => evenement.preventDefault()}
            onClick={() => choisir(index)}
            className={[
              'flex min-h-cible cursor-pointer items-center px-3 text-foreground',
              index === etat.active ? 'bg-muted' : 'hover:bg-muted',
            ].join(' ')}
          >
            {proposition.label}
          </li>
        ))}
      </ul>

      <p id={idEtat} role="status" className="min-h-5 text-sm text-secondary">
        {statut}
      </p>

      {erreurVisible === undefined ? null : (
        <p id={idErreur} className="text-sm font-semibold text-destructive">
          {erreurVisible}
        </p>
      )}
    </div>
  )
}
