/// Validation du formulaire d'inscription client.
///
/// Module pur, sans dépendance au serveur ni à la base : le formulaire l'appelle au
/// `blur` de chaque champ pour afficher l'erreur à côté de lui, et l'action serveur
/// l'appelle de nouveau sur ce qui a réellement été posté. Le serveur ne fait jamais
/// confiance à la validation du navigateur — elle sert l'ergonomie, pas les données.
///
/// Le rôle n'apparaît nulle part ici, et c'est voulu : il n'est pas une donnée du
/// formulaire. Better Auth le pose lui-même à `CLIENT` (lib/auth.ts).

export const CHAMPS_INSCRIPTION = ['nom', 'email', 'telephone', 'motDePasse'] as const
export type ChampInscription = (typeof CHAMPS_INSCRIPTION)[number]

export type ValeursInscription = Record<ChampInscription, string>
export type ErreursInscription = Partial<Record<ChampInscription, string>>

/// Bornes de Better Auth : `minPasswordLength` est réglé à la même valeur dans
/// lib/auth.ts, et 128 est son maximum par défaut. Les vérifier ici donne un message
/// en français à côté du champ, plutôt que l'erreur anglaise de la brique.
export const MOT_DE_PASSE_MIN = 8
export const MOT_DE_PASSE_MAX = 128
const NOM_MAX = 100

/// Volontairement simple : la vraie preuve qu'une adresse existe est un message
/// reçu, pas une expression rationnelle. On écarte seulement ce qui ne peut pas en
/// être une.
const FORME_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/// Numéro français, fixe ou mobile, avec ou sans indicatif.
const FORME_TELEPHONE = /^(?:\+33|0033|0)[1-9]\d{8}$/

/// Retire espaces, points, tirets et parenthèses, et ramène l'indicatif `+33` ou
/// `0033` au `0` national : « 06 12 34 56 78 », « 06.12.34.56.78 » et
/// « +33 6 12 34 56 78 » sont le même numéro, et s'enregistrent sous une seule forme.
/// La validation porte ensuite sur cette forme : `+330612…` y devient `00612…`, que
/// la forme attendue refuse.
export function normaliserTelephone(valeur: string): string {
  return valeur.replace(/[\s.\-()]/g, '').replace(/^(?:\+33|0033)/, '0')
}

export function normaliserEmail(valeur: string): string {
  return valeur.trim().toLowerCase()
}

/// Rend le message d'erreur du champ, ou `undefined` s'il est valide.
export function erreurChamp(champ: ChampInscription, valeur: string): string | undefined {
  switch (champ) {
    case 'nom': {
      const nom = valeur.trim()
      if (nom === '') return 'Indiquez votre nom.'
      if (nom.length > NOM_MAX) return `Le nom ne doit pas dépasser ${NOM_MAX} caractères.`
      return undefined
    }
    case 'email': {
      const email = normaliserEmail(valeur)
      if (email === '') return 'Indiquez votre adresse e-mail.'
      if (!FORME_EMAIL.test(email)) return 'Cette adresse e-mail n’est pas valide.'
      return undefined
    }
    case 'telephone': {
      const telephone = normaliserTelephone(valeur)
      if (telephone === '') return 'Indiquez votre numéro de téléphone.'
      if (!FORME_TELEPHONE.test(telephone)) {
        return 'Indiquez un numéro français à dix chiffres, par exemple 06 12 34 56 78.'
      }
      return undefined
    }
    case 'motDePasse': {
      // Ni `trim` ni normalisation : un espace fait partie du mot de passe.
      if (valeur.length < MOT_DE_PASSE_MIN) {
        return `Le mot de passe doit faire au moins ${MOT_DE_PASSE_MIN} caractères.`
      }
      if (valeur.length > MOT_DE_PASSE_MAX) {
        return `Le mot de passe ne doit pas dépasser ${MOT_DE_PASSE_MAX} caractères.`
      }
      return undefined
    }
  }
}

export type ResultatValidation =
  | { readonly valide: true; readonly donnees: ValeursInscription }
  | { readonly valide: false; readonly erreurs: ErreursInscription }

/// Valide l'ensemble et rend les données normalisées, prêtes à enregistrer.
export function validerInscription(valeurs: ValeursInscription): ResultatValidation {
  const erreurs: ErreursInscription = {}
  for (const champ of CHAMPS_INSCRIPTION) {
    const erreur = erreurChamp(champ, valeurs[champ])
    if (erreur !== undefined) erreurs[champ] = erreur
  }

  if (Object.keys(erreurs).length > 0) return { valide: false, erreurs }

  return {
    valide: true,
    donnees: {
      nom: valeurs.nom.trim(),
      email: normaliserEmail(valeurs.email),
      telephone: normaliserTelephone(valeurs.telephone),
      motDePasse: valeurs.motDePasse,
    },
  }
}

/// Lit **uniquement** les quatre champs attendus. Tout autre champ posté — `role`
/// compris — n'est jamais lu, donc jamais transmis. Une valeur absente ou qui n'est
/// pas du texte (un fichier) devient une chaîne vide, que la validation refuse.
export function lireFormulaire(formulaire: FormData): ValeursInscription {
  const lire = (champ: ChampInscription) => {
    const valeur = formulaire.get(champ)
    return typeof valeur === 'string' ? valeur : ''
  }
  return {
    nom: lire('nom'),
    email: lire('email'),
    telephone: lire('telephone'),
    motDePasse: lire('motDePasse'),
  }
}
