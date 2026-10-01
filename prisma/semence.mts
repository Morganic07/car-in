/// Jeu de démonstration de Car'in.
///
/// Idempotent par construction : chaque enregistrement porte un identifiant fixe
/// et passe par un `upsert`. Relancer la semence met les données à jour, ne les
/// duplique jamais. Les dates sont relatives à l'instant de l'exécution, pour que
/// la démonstration reste plausible des mois plus tard.

import { urlBaseDeDonnees } from '../lib/base-de-donnees.ts'
import { creerClientPrisma } from '../lib/prisma.ts'
import type { PrismaClient } from './generated/client/index.js'

const MINUTE = 60 * 1000
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

type Lieu = { label: string; lat: number; lon: number }

const COLOMIERS: Lieu = {
  label: 'Mairie de Colomiers, 1 Place Alex Raymond, 31770 Colomiers',
  lat: 43.6103,
  lon: 1.3337,
}
const AEROPORT: Lieu = {
  label: 'Aéroport Toulouse-Blagnac, 31700 Blagnac',
  lat: 43.6293,
  lon: 1.3638,
}
const MATABIAU: Lieu = {
  label: 'Gare de Toulouse Matabiau, 64 Boulevard Pierre Sémard, 31000 Toulouse',
  lat: 43.6113,
  lon: 1.4537,
}
const CAPITOLE: Lieu = {
  label: 'Place du Capitole, 31000 Toulouse',
  lat: 43.6045,
  lon: 1.444,
}
const PURPAN: Lieu = {
  label: 'Hôpital Purpan, Place du Docteur Baylac, 31300 Toulouse',
  lat: 43.608,
  lon: 1.398,
}

const COMPTES = [
  {
    id: 'demo-client',
    email: 'camille.besson@exemple.fr',
    nom: 'Camille Besson',
    telephone: '0612345678',
    role: 'CLIENT',
  },
  {
    id: 'demo-chauffeur-1',
    email: 'hakim.diallo@carin.fr',
    nom: 'Hakim Diallo',
    telephone: '0623456789',
    role: 'CHAUFFEUR',
  },
  {
    id: 'demo-chauffeur-2',
    email: 'sophie.marchand@carin.fr',
    nom: 'Sophie Marchand',
    telephone: '0634567890',
    role: 'CHAUFFEUR',
  },
  {
    id: 'demo-chauffeur-3',
    email: 'yann.perrot@carin.fr',
    nom: 'Yann Perrot',
    telephone: '0645678901',
    role: 'CHAUFFEUR',
  },
] as const

type DefinitionCourse = {
  id: string
  depart: Lieu
  arrivee: Lieu
  /// Décalage en millisecondes par rapport à l'instant de la semence. Négatif = passé.
  departDans: number
  passagers: number
  bagages: number
  siegeEnfant: boolean
  commentaire: string | null
  etat: 'DEMANDEE' | 'ACCEPTEE' | 'EN_COURSE' | 'TERMINEE' | 'ANNULEE'
  chauffeurId: string | null
  distanceM: number | null
  dureeS: number | null
  prixEstimeCents: number | null
  accepteeDans?: number
  demarreeDans?: number
  termineeDans?: number
  annuleeDans?: number
}

const COURSES: DefinitionCourse[] = [
  {
    id: 'demo-course-1',
    depart: COLOMIERS,
    arrivee: AEROPORT,
    departDans: 2 * JOUR,
    passagers: 2,
    bagages: 2,
    siegeEnfant: false,
    commentaire: 'Vol à 11 h, merci de prévoir le coffre.',
    etat: 'DEMANDEE',
    chauffeurId: null,
    distanceM: 9400,
    dureeS: 900,
    prixEstimeCents: 1880,
  },
  {
    // Scénario S9 : l'heure de départ est passée et personne ne l'a prise.
    // Doit remonter en tête de la liste chauffeur avec un badge « en retard »,
    // et rester dans « à venir » côté client.
    id: 'demo-course-2',
    depart: CAPITOLE,
    arrivee: MATABIAU,
    departDans: -1 * HEURE,
    passagers: 1,
    bagages: 0,
    siegeEnfant: false,
    commentaire: null,
    etat: 'DEMANDEE',
    chauffeurId: null,
    distanceM: 2100,
    dureeS: 480,
    prixEstimeCents: 920,
  },
  {
    id: 'demo-course-3',
    depart: MATABIAU,
    arrivee: PURPAN,
    departDans: 3 * HEURE,
    passagers: 3,
    bagages: 1,
    siegeEnfant: true,
    commentaire: 'Siège enfant pour un enfant de 3 ans.',
    etat: 'ACCEPTEE',
    chauffeurId: 'demo-chauffeur-1',
    distanceM: 6300,
    dureeS: 780,
    prixEstimeCents: 1450,
    accepteeDans: -30 * MINUTE,
  },
  {
    id: 'demo-course-4',
    depart: PURPAN,
    arrivee: COLOMIERS,
    departDans: -25 * MINUTE,
    passagers: 1,
    bagages: 1,
    siegeEnfant: false,
    commentaire: null,
    etat: 'EN_COURSE',
    chauffeurId: 'demo-chauffeur-2',
    distanceM: 7800,
    dureeS: 840,
    prixEstimeCents: 1620,
    accepteeDans: -3 * HEURE,
    demarreeDans: -20 * MINUTE,
  },
  {
    id: 'demo-course-5',
    depart: AEROPORT,
    arrivee: CAPITOLE,
    departDans: -2 * JOUR,
    passagers: 2,
    bagages: 3,
    siegeEnfant: false,
    commentaire: null,
    etat: 'TERMINEE',
    chauffeurId: 'demo-chauffeur-3',
    distanceM: 11200,
    dureeS: 1320,
    prixEstimeCents: 2340,
    accepteeDans: -2 * JOUR - 4 * HEURE,
    demarreeDans: -2 * JOUR,
    termineeDans: -2 * JOUR + 22 * MINUTE,
  },
  {
    // Scénario S11 : l'estimation a échoué, le prix reste nul et l'interface
    // affiche « confirmé par la compagnie ». Aucun calcul de repli ne le remplit.
    id: 'demo-course-6',
    depart: CAPITOLE,
    arrivee: AEROPORT,
    departDans: -1 * JOUR,
    passagers: 4,
    bagages: 2,
    siegeEnfant: false,
    commentaire: 'Annulée par le client, réunion déplacée.',
    etat: 'ANNULEE',
    chauffeurId: null,
    distanceM: null,
    dureeS: null,
    prixEstimeCents: null,
    annuleeDans: -1 * JOUR - 3 * HEURE,
  },
]

function dateDecalee(reference: Date, decalageMs: number | undefined): Date | null {
  if (decalageMs === undefined) return null
  return new Date(reference.getTime() + decalageMs)
}

export async function semer(client: PrismaClient, reference: Date = new Date()): Promise<void> {
  for (const compte of COMPTES) {
    const donnees = {
      email: compte.email,
      nom: compte.nom,
      telephone: compte.telephone,
      role: compte.role,
    }
    await client.user.upsert({
      where: { id: compte.id },
      create: { id: compte.id, ...donnees },
      update: donnees,
    })
  }

  for (const course of COURSES) {
    const donnees = {
      clientId: 'demo-client',
      chauffeurId: course.chauffeurId,
      departLabel: course.depart.label,
      departLat: course.depart.lat,
      departLon: course.depart.lon,
      arriveeLabel: course.arrivee.label,
      arriveeLat: course.arrivee.lat,
      arriveeLon: course.arrivee.lon,
      departAt: new Date(reference.getTime() + course.departDans),
      passagers: course.passagers,
      bagages: course.bagages,
      siegeEnfant: course.siegeEnfant,
      commentaire: course.commentaire,
      etat: course.etat,
      distanceM: course.distanceM,
      dureeS: course.dureeS,
      prixEstimeCents: course.prixEstimeCents,
      accepteeAt: dateDecalee(reference, course.accepteeDans),
      demarreeAt: dateDecalee(reference, course.demarreeDans),
      termineeAt: dateDecalee(reference, course.termineeDans),
      annuleeAt: dateDecalee(reference, course.annuleeDans),
    }
    await client.course.upsert({
      where: { id: course.id },
      create: { id: course.id, ...donnees },
      update: donnees,
    })
  }
}

/// Point d'entrée en ligne de commande. `import.meta.main` est vrai seulement quand
/// ce fichier est le module lancé, jamais quand un test l'importe.
///
/// Le chargement de `.env` est confié à `node --env-file-if-exists` dans le script
/// npm : cette option n'échoue pas si le fichier manque, et n'écrase pas une
/// variable déjà présente dans l'environnement — vérifié, pas supposé.
if (import.meta.main) {
  const client = creerClientPrisma(urlBaseDeDonnees())
  try {
    await semer(client)
    const comptes = await client.user.count()
    const courses = await client.course.count()
    console.log(`Semence appliquée : ${comptes} comptes, ${courses} courses.`)
  } finally {
    await client.$disconnect()
  }
}
