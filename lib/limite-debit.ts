import type { PrismaClient } from '../prisma/generated/client/index.js'

/// Limite de débit des actions d'authentification.
///
/// Nécessaire parce que le limiteur de Better Auth ne protège que les requêtes HTTP
/// passées par son routeur : un appel `auth().api.…` depuis une action serveur — notre
/// cas pour l'inscription et la connexion — y échappe entièrement (constaté dans le
/// code de Better Auth 1.7.7, story 2.1).
///
/// Fenêtre fixe par clé. Chaque appel compte une tentative, y compris celles déjà
/// refusées : insister ne rouvre pas la porte avant la fin de la fenêtre.

export type Regle = {
  readonly maximum: number
  readonly fenetreMs: number
}

export const REGLES = {
  /// Essais de mot de passe sur une même adresse : la protection principale contre la
  /// devinette, indépendante du réseau de l'attaquant. Remise à zéro par une connexion
  /// réussie, pour qu'un usage normal ne bloque jamais personne.
  connexionParEmail: { maximum: 5, fenetreMs: 15 * 60_000 },
  /// Essais depuis une origine connue (derrière un proxy déclaré).
  connexionParIp: { maximum: 30, fenetreMs: 15 * 60_000 },
  /// Sans origine fiable, un seul compteur pour tout le monde : un plafond de
  /// sauvegarde contre un balayage massif, assez haut pour ne jamais gêner un usage
  /// normal à trois chauffeurs et leurs clients.
  connexionGlobale: { maximum: 300, fenetreMs: 15 * 60_000 },
  /// Inscriptions depuis une origine connue : freine la création de comptes en masse
  /// et le test d'adresses à la chaîne (l'inscription dit si une adresse est prise).
  inscriptionParIp: { maximum: 10, fenetreMs: 60 * 60_000 },
  /// Même plafond de sauvegarde, sans origine fiable.
  inscriptionGlobale: { maximum: 100, fenetreMs: 60 * 60_000 },
} as const satisfies Record<string, Regle>

/// La plus longue fenêtre : une ligne plus ancienne est expirée pour toutes les règles.
const FENETRE_MAX_MS = Math.max(...Object.values(REGLES).map((regle) => regle.fenetreMs))

export type Verdict =
  | { readonly permis: true }
  | { readonly permis: false; readonly reessayerDansMs: number }

/// Compte une tentative et dit si elle est permise.
///
/// Une seule instruction, atomique : lire le compteur puis l'écrire laisserait deux
/// requêtes simultanées lire la même valeur, et passer toutes les deux. La fenêtre
/// expirée est remise à zéro dans la même instruction.
export async function consommer(
  client: PrismaClient,
  cle: string,
  regle: Regle,
  maintenantMs: number = Date.now(),
): Promise<Verdict> {
  const expireAvant = BigInt(maintenantMs - regle.fenetreMs)
  const maintenant = BigInt(maintenantMs)

  const lignes = await client.$queryRaw<{ tentatives: number | bigint; debutMs: number | bigint }[]>`
    INSERT INTO "LimiteDebit" ("cle", "tentatives", "debutMs")
    VALUES (${cle}, 1, ${maintenant})
    ON CONFLICT ("cle") DO UPDATE SET
      "tentatives" = CASE WHEN "debutMs" <= ${expireAvant} THEN 1 ELSE "tentatives" + 1 END,
      "debutMs" = CASE WHEN "debutMs" <= ${expireAvant} THEN ${maintenant} ELSE "debutMs" END
    RETURNING "tentatives", "debutMs"
  `

  // Purge des compteurs expirés pour toutes les règles : sans elle, chaque adresse
  // essayée laisserait une ligne pour toujours.
  await client.$executeRaw`
    DELETE FROM "LimiteDebit" WHERE "debutMs" <= ${BigInt(maintenantMs - FENETRE_MAX_MS)}
  `

  const ligne = lignes[0]
  if (ligne === undefined) {
    // L'instruction rend toujours une ligne ; son absence est une panne, pas un feu vert.
    throw new Error(`Limite de débit : aucun compteur rendu pour « ${cle} ».`)
  }

  if (Number(ligne.tentatives) <= regle.maximum) return { permis: true }
  return {
    permis: false,
    reessayerDansMs: Math.max(0, Number(ligne.debutMs) + regle.fenetreMs - maintenantMs),
  }
}

/// Remet un compteur à zéro — après une connexion réussie, pour la clé de l'adresse.
export async function oublier(client: PrismaClient, cle: string): Promise<void> {
  await client.limiteDebit.deleteMany({ where: { cle } })
}

/// Adresse d'origine de la requête, ou `null` si elle n'est pas fiable.
///
/// Une action serveur de Next n'expose pas l'adresse de la connexion : seule celle
/// qu'un proxy écrit dans `x-forwarded-for` est disponible. Or ce projet tourne sans
/// proxy (PLAN.md) — c'est le cas nominal, pas une exception — et sans proxy, cet
/// en-tête est écrit par le client lui-même, qui en change à volonté. Il n'est donc lu
/// que si `CONFIANCE_PROXY=1` déclare qu'un proxy le complète.
///
/// C'est la valeur la plus à **droite** qui compte : un proxy courant (nginx et son
/// `$proxy_add_x_forwarded_for`, la plupart des hébergeurs) **ajoute** l'adresse
/// qu'il voit à la fin de ce que le client a envoyé. Tout ce qui précède est écrit par
/// le client ; lire la valeur de gauche lui laisserait ouvrir un compteur neuf à
/// chaque essai. Un seul proxy de confiance est pris en charge — un seul saut.
///
/// Une dernière valeur vide veut dire que le proxy n'a rien ajouté : on ne remonte pas
/// à la précédente, qui viendrait du client, et l'on retombe sur le plafond global.
export function origine(entetes: Headers): string | null {
  if (process.env.CONFIANCE_PROXY !== '1') return null
  const transmise = entetes.get('x-forwarded-for')?.split(',').at(-1)?.trim()
  return transmise ? transmise : null
}

/// Clé et règle de la limite d'origine : par adresse si elle est fiable, sinon le
/// compteur global et son plafond de sauvegarde.
export function limiteOrigine(
  action: 'connexion' | 'inscription',
  entetes: Headers,
): readonly [string, Regle] {
  const adresse = origine(entetes)
  if (action === 'connexion') {
    return adresse === null
      ? ['connexion:globale', REGLES.connexionGlobale]
      : [`connexion:ip:${adresse}`, REGLES.connexionParIp]
  }
  return adresse === null
    ? ['inscription:globale', REGLES.inscriptionGlobale]
    : [`inscription:ip:${adresse}`, REGLES.inscriptionParIp]
}

/// Message affiché quand la limite est atteinte. Il ne dit rien de l'adresse e-mail :
/// le même texte s'affiche qu'elle ait un compte ou non.
export function messageLimite(reessayerDansMs: number): string {
  const minutes = Math.max(1, Math.ceil(reessayerDansMs / 60_000))
  return `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`
}
