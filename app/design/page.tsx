import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BadgeEtat } from '../../components/ui/BadgeEtat.tsx'
import { Bouton } from '../../components/ui/Bouton.tsx'
import { CarteCourse, type CourseAffichee } from '../../components/ui/CarteCourse.tsx'
import { Champ } from '../../components/ui/Champ.tsx'
import { ETATS } from '../../lib/domaine/course.ts'

export const metadata: Metadata = {
  title: "Design system — Car'in",
  description:
    'Page de référence interne : tous les composants d’interface réunis, pour comparer ' +
    'leur rendu d’un coup d’œil.',
}

/// Dates fixes plutôt que relatives : cette page est pré-rendue, et des exemples
/// stables se comparent d'une version à l'autre.
const EXEMPLES: readonly CourseAffichee[] = [
  {
    id: 'exemple-1',
    etat: 'DEMANDEE',
    departLabel: 'Mairie de Colomiers, 1 Place Alex Raymond, 31770 Colomiers',
    arriveeLabel: 'Aéroport Toulouse-Blagnac, 31700 Blagnac',
    departAt: new Date('2026-10-12T08:30:00+02:00'),
    passagers: 2,
    bagages: 2,
    siegeEnfant: false,
    prixEstimeCents: 1880,
  },
  {
    id: 'exemple-2',
    etat: 'EN_COURSE',
    departLabel: 'Hôpital Purpan, Place du Docteur Baylac, 31300 Toulouse',
    arriveeLabel: 'Place du Capitole, 31000 Toulouse',
    departAt: new Date('2026-10-12T14:05:00+02:00'),
    passagers: 1,
    bagages: 1,
    siegeEnfant: true,
    // Estimation indisponible : la carte doit l'écrire, pas l'inventer (S11).
    prixEstimeCents: null,
  },
]

function Section({
  titre,
  description,
  children,
}: {
  readonly titre: string
  readonly description: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-foreground">{titre}</h2>
        <p className="text-secondary">{description}</p>
      </div>
      {children}
    </section>
  )
}

/// Page interne : elle n'existe qu'en développement. En production, elle répond 404
/// comme une adresse inconnue — c'est le serveur qui le décide, pas un lien masqué.
export default function PageDesign() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">
          Référence interne
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Design system</h1>
        <p className="text-lg text-secondary">
          Tous les composants d’interface de Car’in au même endroit. Les contrastes et
          l’absence de couleur codée en dur sont vérifiés par les tests, pas par l’œil.
        </p>
      </header>

      <Section
        titre="États d’une course"
        description="Les cinq états du cycle de vie, dans l’ordre du graphe."
      >
        <div className="flex flex-wrap gap-2">
          {ETATS.map((etat) => (
            <BadgeEtat key={etat} etat={etat} />
          ))}
        </div>
      </Section>

      <Section
        titre="Boutons"
        description="Trois variantes, 44 px de haut au minimum, focus clavier visible à la tabulation."
      >
        <div className="flex flex-wrap gap-2">
          <Bouton>Réserver une course</Bouton>
          <Bouton variante="secondaire">Voir le détail</Bouton>
          <Bouton variante="destructif">Annuler la course</Bouton>
          <Bouton disabled>Indisponible</Bouton>
        </div>
      </Section>

      <Section
        titre="Champs de formulaire"
        description="Libellé au-dessus, texte d’aide distinct du libellé, erreur juste sous le champ."
      >
        <div className="flex flex-col gap-6">
          <Champ id="exemple-nom" libelle="Votre nom" placeholder="Camille Besson" />
          <Champ
            id="exemple-telephone"
            libelle="Téléphone"
            aide="Le chauffeur s’en sert pour vous joindre à l’arrivée."
            placeholder="06 12 34 56 78"
          />
          <Champ
            id="exemple-adresse"
            libelle="Adresse de départ"
            erreur="Choisissez une adresse dans la liste proposée."
            defaultValue="12 rue qui n’existe pas"
          />
        </div>
      </Section>

      <Section
        titre="Carte d’une course"
        description="Ce que client et chauffeur lisent d’abord : l’heure, l’état, les deux adresses."
      >
        <div className="flex flex-col gap-4">
          {EXEMPLES.map((course) => (
            <CarteCourse key={course.id} course={course} />
          ))}
        </div>
      </Section>
    </main>
  )
}
