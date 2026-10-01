/// Règle unique de résolution de l'adresse de la base.
///
/// Elle vit ici parce que trois appelants en dépendent — la configuration de Prisma
/// (donc les migrations), la semence, et le client de l'application — et qu'une
/// divergence entre eux produit exactement le défaut constaté pendant la story 1.2 :
/// `db:migrate` fonctionnait sur un dépôt fraîchement cloné, `seed` échouait.
///
/// Deux surfaces, une seule règle : la stricte est définie à partir de la tolérante,
/// elles ne peuvent donc pas divulguer deux comportements différents.

/// Identique à la valeur de .env.example. Le chemin est relatif à la racine du
/// projet, et non au dossier prisma/.
const DEFAUT_DEVELOPPEMENT = 'file:./dev.db'

function enProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/// Pour les appelants qui n'ouvrent pas forcément la base — `prisma generate` en est
/// un, et il tourne au `postinstall`, y compris sur une installation de production
/// où DATABASE_URL n'est fournie qu'à l'exécution. Rend `undefined` plutôt que de
/// deviner : aucune commande ne doit se rabattre en silence sur une base locale en
/// production.
export function urlBaseDeDonneesSiDisponible(): string | undefined {
  const declaree = process.env.DATABASE_URL
  if (declaree) return declaree
  return enProduction() ? undefined : DEFAUT_DEVELOPPEMENT
}

/// Pour les appelants qui vont réellement se connecter. Échoue plutôt que de
/// supposer une base.
export function urlBaseDeDonnees(): string {
  const url = urlBaseDeDonneesSiDisponible()
  if (!url) {
    throw new Error(
      'DATABASE_URL est obligatoire en production : aucune base par défaut ' +
        "n'est supposée hors développement.",
    )
  }
  return url
}
