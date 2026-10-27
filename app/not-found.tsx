import Link from 'next/link'

/// Page introuvable, en français : sans elle, Next affiche sa page anglaise, à la fois
/// pour une adresse inconnue et pour un `notFound()` — celui, par exemple, de la
/// confirmation d'une course qui n'appartient pas au client connecté.
///
/// Elle ne dit pas si la page existe pour quelqu'un d'autre : « introuvable » vaut pour
/// les deux cas, exprès.
export default function Introuvable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      {/* `metadata` n'est pas lu dans un not-found.tsx : sans ce titre, l'onglet garde
          celui de la page qui a appelé `notFound()` — « Course réservée ». */}
      <title>Page introuvable — Car&rsquo;in</title>
      <p className="text-sm font-semibold tracking-widest text-accent uppercase">Erreur 404</p>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Page introuvable</h1>
      <p className="text-secondary">
        Cette page n&rsquo;existe pas, ou elle n&rsquo;est pas accessible depuis votre compte.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-cible items-center justify-center self-start rounded-md bg-accent px-4 font-semibold text-on-primary transition-colors duration-200 hover:bg-accent-survol"
      >
        Revenir à l&rsquo;accueil
      </Link>
    </main>
  )
}
