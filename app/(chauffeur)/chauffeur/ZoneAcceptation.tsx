'use client'

import { useActionState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

import { Bouton } from '../../../components/ui/Bouton.tsx'
import { accepterCourse, type EtatAcceptation } from './actions.ts'

const ETAT_INITIAL: EtatAcceptation = {}

/// Un seul formulaire autour de toute la liste, chaque bouton envoyant son identifiant.
///
/// L'action rafraîchit la liste et la course acceptée en sort : un état porté par sa ligne
/// disparaîtrait avec elle, et le chauffeur devancé ne lirait jamais pourquoi (S3). Le
/// message est collant, pour rester lisible depuis le bas d'une longue liste.
export function ZoneAcceptation({ children }: { readonly children: ReactNode }) {
  const [etat, action, enCours] = useActionState(accepterCourse, ETAT_INITIAL)

  return (
    <form action={action} className="flex flex-col gap-3">
      {/* Masqué pendant l'envoi : « Course acceptée » parlerait de la précédente, alors
          qu'une autre est en train de partir. */}
      {!enCours && etat.acceptee === true ? (
        <p
          role="status"
          className="sticky top-2 z-10 rounded-lg bg-etat-terminee p-4 font-semibold text-etat-terminee-texte"
        >
          Course acceptée : elle vous est attribuée.
        </p>
      ) : null}
      {enCours || etat.erreur === undefined ? null : (
        <p
          role="alert"
          className="sticky top-2 z-10 rounded-lg bg-destructive p-4 font-semibold text-on-primary"
        >
          {etat.erreur}
        </p>
      )}
      {children}
    </form>
  )
}

/// Tous les boutons sont neutralisés pendant l'envoi : un chauffeur n'accepte qu'une course
/// à la fois. Seul celui qui a été touché annonce le chargement.
export function BoutonAccepter({
  courseId,
  depart,
}: {
  readonly courseId: string
  readonly depart: string
}) {
  const { pending, data } = useFormStatus()

  return (
    <Bouton
      type="submit"
      name="courseId"
      value={courseId}
      disabled={pending}
      // Plusieurs boutons de même texte : le lecteur d'écran doit dire lequel.
      aria-label={`Accepter la course au départ de ${depart}`}
      className="w-full"
    >
      {pending && data?.get('courseId') === courseId ? 'Acceptation…' : 'Accepter'}
    </Bouton>
  )
}
