import Link from 'next/link'

export default function Accueil() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-semibold tracking-widest text-accent uppercase">
        Compagnie de taxi
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
        Car&rsquo;in
      </h1>
      <p className="text-lg leading-relaxed text-secondary">
        Réservation de courses à l&rsquo;avance pour les clients, planning partagé pour les
        chauffeurs.
      </p>
      <p className="text-base text-secondary">
        Les espaces client et chauffeur s&rsquo;ouvriront ici une fois les comptes en place.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/inscription"
          className="inline-flex min-h-cible items-center justify-center rounded-md bg-accent px-4 font-semibold text-on-primary transition-colors duration-200 hover:bg-accent-survol"
        >
          Créer un compte client
        </Link>
        <Link
          href="/connexion"
          className="inline-flex min-h-cible items-center justify-center rounded-md border border-border bg-background px-4 font-semibold text-foreground transition-colors duration-200 hover:bg-muted"
        >
          Se connecter
        </Link>
      </div>
    </main>
  )
}
