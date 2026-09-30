export default function Accueil() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-semibold tracking-widest text-sky-700 uppercase">
        Compagnie de taxi
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Car&rsquo;in</h1>
      <p className="text-lg leading-relaxed text-slate-700">
        Réservation de courses à l&rsquo;avance pour les clients, planning partagé pour les
        chauffeurs.
      </p>
      <p className="text-base text-slate-600">
        Les espaces client et chauffeur s&rsquo;ouvriront ici une fois les comptes en place.
      </p>
    </main>
  )
}
