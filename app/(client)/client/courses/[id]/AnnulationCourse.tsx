'use client'

import { useActionState, useRef } from 'react'

import { Bouton } from '../../../../../components/ui/Bouton.tsx'
import { annulerCourse, type EtatAnnulation } from './actions.ts'

const ETAT_INITIAL: EtatAnnulation = {}

/// Bouton d'annulation et sa confirmation. `<dialog>` natif : `showModal` piège le focus,
/// Échap ferme, et le focus revient au bouton à la fermeture.
///
/// Ce composant reste monté quand la course n'est plus `annulable`, et les messages sont
/// hors du dialogue : l'action rafraîchit la page, et un refus sur un écran périmé
/// (course terminée entre-temps) disparaîtrait sinon avec le bouton, sans un mot.
export function AnnulationCourse({
  courseId,
  annulable,
}: {
  readonly courseId: string
  readonly annulable: boolean
}) {
  const [etat, action, enCours] = useActionState(annulerCourse, ETAT_INITIAL)
  const dialogue = useRef<HTMLDialogElement>(null)

  return (
    <div className="flex flex-col gap-2">
      {annulable ? (
        <>
          <Bouton
            variante="destructif"
            disabled={enCours}
            onClick={() => dialogue.current?.showModal()}
            className="self-start"
          >
            {enCours ? 'Annulation…' : 'Annuler la course'}
          </Bouton>

          {/* Pas de `flex` sur le dialogue : il l'emporterait sur le `display: none` fermé. */}
          <dialog
            ref={dialogue}
            aria-labelledby="annulation-titre"
            className="m-auto w-[calc(100%-2rem)] max-w-md rounded-md bg-background p-6 text-foreground backdrop:bg-primary/60"
          >
            <h2 id="annulation-titre" className="text-xl font-semibold">
              Annuler cette course ?
            </h2>
            <p className="mt-2">L’annulation est définitive : la course ne pourra pas être reprise.</p>
            <form
              action={action}
              onSubmit={() => dialogue.current?.close()}
              className="mt-6 flex flex-wrap gap-2"
            >
              <input type="hidden" name="courseId" value={courseId} />
              {/* En premier : `showModal` donne le focus au premier élément focalisable, et
                  un double appui sur Entrée ne doit pas annuler une course sans retour. */}
              <Bouton variante="secondaire" onClick={() => dialogue.current?.close()}>
                Non, garder ma course
              </Bouton>
              <Bouton type="submit" variante="destructif">
                Oui, annuler la course
              </Bouton>
            </form>
          </dialog>
        </>
      ) : null}

      {etat.annulee === true ? (
        <p role="status" className="font-semibold text-foreground">
          Votre course est annulée.
        </p>
      ) : null}
      {etat.erreur === undefined ? null : (
        <p role="alert" className="font-semibold text-destructive">
          {etat.erreur}
        </p>
      )}
    </div>
  )
}
