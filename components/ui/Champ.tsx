import type { InputHTMLAttributes } from 'react'

type ProprietesChamp = InputHTMLAttributes<HTMLInputElement> & {
  /// Exigé plutôt que tiré d'un `useId` : cela garde le composant utilisable dans un
  /// composant serveur, et laisse l'appelant maîtriser l'ancre de son message d'erreur.
  readonly id: string
  readonly libelle: string
  readonly aide?: string
  readonly erreur?: string
}

/// Une chaîne vide est une absence, pas un texte. `erreur={erreurs.adresse ?? ''}` est
/// un motif courant côté formulaire : sans cette normalisation, il peindrait le champ
/// en rouge et l'annoncerait invalide pour un message qui n'existe pas.
function texteOuRien(valeur: string | undefined): string | undefined {
  return valeur === undefined || valeur === '' ? undefined : valeur
}

/// Fusionne les descriptions au lieu de les remplacer. Extraite et exportée pour être
/// testable : déployer `{...reste}` par-dessus un `aria-describedby` calculé faisait
/// disparaître **en silence** le lien vers le message d'erreur, qui restait affiché à
/// l'écran mais n'était plus annoncé par un lecteur d'écran.
export function descriptionsAssociees(
  id: string,
  { aide, erreur, fournie }: { aide?: string; erreur?: string; fournie?: string },
): string | undefined {
  const identifiants = [
    texteOuRien(fournie),
    texteOuRien(aide) === undefined ? undefined : `${id}-aide`,
    texteOuRien(erreur) === undefined ? undefined : `${id}-erreur`,
  ].filter((valeur): valeur is string => valeur !== undefined)

  return identifiants.length === 0 ? undefined : identifiants.join(' ')
}

/// Libellé **au-dessus** du champ, message d'erreur **à côté** — juste en dessous, pas
/// en haut de page. Le texte indicatif n'est jamais un libellé : il vient en plus.
export function Champ({
  id,
  libelle,
  aide,
  erreur,
  className = '',
  'aria-describedby': decritParAppelant,
  'aria-invalid': invalideSelonAppelant,
  ...reste
}: ProprietesChamp) {
  const aideVisible = texteOuRien(aide)
  const erreurVisible = texteOuRien(erreur)

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold text-foreground">
        {libelle}
      </label>

      {aideVisible === undefined ? null : (
        <p id={`${id}-aide`} className="text-sm text-secondary">
          {aideVisible}
        </p>
      )}

      <input
        id={id}
        // Un message d'erreur affiché l'emporte sur ce que dit l'appelant : l'écran
        // et le lecteur d'écran doivent raconter la même chose. Sans erreur visible,
        // la valeur de l'appelant passe.
        aria-invalid={erreurVisible === undefined ? invalideSelonAppelant : true}
        aria-describedby={descriptionsAssociees(id, {
          aide: aideVisible,
          erreur: erreurVisible,
          fournie: decritParAppelant,
        })}
        className={[
          'min-h-cible rounded-md border bg-background px-3 text-foreground',
          erreurVisible === undefined ? 'border-border' : 'border-destructive',
          className,
        ].join(' ')}
        {...reste}
      />

      {erreurVisible === undefined ? null : (
        <p id={`${id}-erreur`} className="text-sm font-semibold text-destructive">
          {erreurVisible}
        </p>
      )}
    </div>
  )
}
