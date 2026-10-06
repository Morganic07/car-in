import type { Etat } from '../../lib/domaine/course.ts'

/// Ce que le client et le chauffeur lisent. `DEMANDEE` ne se traduit pas par
/// « Demandée » mais par « En attente d'un chauffeur » : le scénario S9 interdit de
/// laisser croire qu'une course réservée est une course assurée.
export const LIBELLES_ETAT: Record<Etat, string> = {
  DEMANDEE: 'En attente d’un chauffeur',
  ACCEPTEE: 'Chauffeur assigné',
  EN_COURSE: 'En course',
  TERMINEE: 'Terminée',
  ANNULEE: 'Annulée',
}

/// Fond et texte vont toujours par paire : le contraste de chacune des cinq est
/// mesuré par tests/design-system.test.tsx, jamais jugé à l'œil.
const COULEURS: Record<Etat, string> = {
  DEMANDEE: 'bg-etat-demandee text-etat-demandee-texte',
  ACCEPTEE: 'bg-etat-acceptee text-etat-acceptee-texte',
  EN_COURSE: 'bg-etat-en-course text-etat-en-course-texte',
  TERMINEE: 'bg-etat-terminee text-etat-terminee-texte',
  ANNULEE: 'bg-etat-annulee text-etat-annulee-texte',
}

export function BadgeEtat({ etat }: { readonly etat: Etat }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold',
        COULEURS[etat],
      ].join(' ')}
    >
      {LIBELLES_ETAT[etat]}
    </span>
  )
}
