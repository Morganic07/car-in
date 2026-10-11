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
  const session = await auth().api.getSession({
    headers: requete.headers,
    query: { disableRefresh: true },
  })
  const cible = destination(requete.nextUrl.pathname, roleDeSession(session))
  if (cible === null) return NextResponse.next()
  return NextResponse.redirect(new URL(cible, requete.url))
}

export const config = {
  // `:path*` couvre aussi la racine de chaque espace. Constantes obligatoires : le
  // `matcher` est lu à la compilation.
  matcher: ['/client/:path*', '/chauffeur/:path*', '/compte'],
}
