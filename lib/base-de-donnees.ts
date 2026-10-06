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

/// Le repli exige un signal **positif** de développement. Tester « pas en
/// production » ne suffisait pas : la CLI Prisma et la semence tournent sans
/// NODE_ENV, et un `prisma migrate deploy` lancé sur un serveur sans DATABASE_URL
/// migrait alors un fichier local en annonçant un succès. `next dev` et Vitest posent
/// NODE_ENV eux-mêmes ; les commandes lancées à la main lisent `.env`.
function enDeveloppement(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
}

/// Une variable déclarée vide est une erreur de configuration, pas une absence : on
/// ne la remplace jamais par la base locale, même en développement.
function declareeVide(): boolean {
  const declaree = process.env.DATABASE_URL
  return declaree !== undefined && declaree.trim() === ''
}

/// Pour les appelants qui n'ouvrent pas forcément la base — `prisma generate` en est
/// un, et il tourne au `postinstall`, y compris sur une installation de production
/// où DATABASE_URL n'est fournie qu'à l'exécution. Rend `undefined` plutôt que de
/// deviner : aucune commande ne doit se rabattre en silence sur une base locale hors
/// développement.
export function urlBaseDeDonneesSiDisponible(): string | undefined {
  const declaree = process.env.DATABASE_URL
  if (declaree !== undefined && !declareeVide()) return declaree
  return declaree === undefined && enDeveloppement() ? DEFAUT_DEVELOPPEMENT : undefined
}

/// Pour les appelants qui vont réellement se connecter. Échoue plutôt que de
/// supposer une base, avec un message qui dit quoi faire.
export function urlBaseDeDonnees(): string {
  const url = urlBaseDeDonneesSiDisponible()
  if (url) return url

  if (declareeVide()) {
    throw new Error('DATABASE_URL est déclarée mais vide : renseignez l’adresse de la base.')
  }
  throw new Error(
    'DATABASE_URL est obligatoire hors développement : aucune base par défaut ' +
      'n’est supposée. En local, copiez .env.example en .env ; sur un serveur, ' +
      'fournissez la variable à la commande.',
  )
}
