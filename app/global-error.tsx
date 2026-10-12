'use client'

import './globals.css'

import Erreur, { type ProprietesErreur } from './error.tsx'

/// Remplace le layout racine quand c'est lui qui lève : il faut donc reposer ici
/// `<html lang="fr">`, `<body>` et la feuille de style, qui portent les jetons, le
/// fond de page et le focus visible. Les polices de `next/font` ne sont pas reprises :
/// leurs variables sont posées par le layout, et la pile de repli de `globals.css`
/// (`ui-sans-serif, system-ui`) prend le relais — lisible, sans dépendre du layout
/// qui vient d'échouer.
export default function ErreurGlobale(proprietes: ProprietesErreur) {
  return (
    <html lang="fr">
      <body className="min-h-screen antialiased">
        <title>Erreur — Car&apos;in</title>
        <Erreur {...proprietes} />
      </body>
    </html>
  )
}
