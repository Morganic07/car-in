import { NextResponse, type NextRequest } from 'next/server'

import { destination, roleDeSession } from './lib/acces.ts'
import { auth } from './lib/auth.ts'

/// Redirige un visiteur mal placé : sans session vers la connexion, dans l'espace de
/// l'autre rôle vers le sien (story 2.3, S12).
///
/// C'est de l'ergonomie, pas une protection (PLAN.md) : chaque page d'espace refait
/// ce contrôle (`exigerEspace`), et chaque action serveur le sien (`autoriser`). Ce
/// fichier tourne sous Node — c'est le défaut de `proxy` dans cette version de Next —
/// et lit donc la vraie session en base, pas un cookie supposé valide.
export async function proxy(requete: NextRequest) {
  // `disableRefresh` : le proxy lit la session sans la prolonger. Il n'a pas à écrire
  // de cookie ; c'est la page qui suit qui s'en charge.
  let session
  try {
    session = await auth().api.getSession({
      headers: requete.headers,
      query: { disableRefresh: true },
    })
  } catch (erreur) {
    // Une panne ici donnerait la page 500 anglaise de Next : `error.tsx` ne couvre pas
    // le proxy, qui tourne avant le rendu. On laisse passer, la page refait la garde
    // (`exigerEspace`) et sa panne aboutit à la page d'erreur française. Rien n'est
    // ouvert : laisser passer n'accorde aucun accès que la page n'accorde pas.
    console.error('Lecture de la session impossible dans le proxy', erreur)
    return NextResponse.next()
  }
  const cible = destination(requete.nextUrl.pathname, roleDeSession(session))
  if (cible === null) return NextResponse.next()
  return NextResponse.redirect(new URL(cible, requete.url))
}

export const config = {
  // `:path*` couvre aussi la racine de chaque espace. Constantes obligatoires : le
  // `matcher` est lu à la compilation.
  matcher: ['/client/:path*', '/chauffeur/:path*', '/compte'],
}
