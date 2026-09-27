# Car'in — architecture et décisions

Périmètre fonctionnel, scénarios et stories : `AVANCEMENT.md`.
Ce fichier porte l'architecture, la stack et **la raison** de chaque décision — pour qu'une
décision ne soit pas rejouée dans six mois faute de savoir pourquoi elle a été prise.

---

## 1. Ce que le projet écrit, et ce qu'il ne réécrit pas

Une recherche d'antériorité a précédé le cadrage. Résultat : **le socle est à écrire, les
briques techniques sont à brancher.**

| Brique | Décision | Retenu | Pourquoi |
|---|---|---|---|
| Réservation, attribution, cycle de vie | Écrire | — | C'est le cœur métier, propre à cette compagnie |
| Socle « taxi dispatch » tout fait | Écarté | — | Les projets ouverts du domaine sont des démonstrations dormantes ou **sans licence**, donc sans droit d'usage. Le plus visible est une super-application en cinq parties : l'adapter coûte plus que d'écrire le CRUD |
| SaaS métier français | Écarté, signalé à la cliente | — | Ondy, Bber, Caree, Soraya visent la facturation du taxi conventionné et la télétransmission CPAM, pas la réservation client en ligne. À réexaminer si le besoin bascule vers la facturation |
| Adresses et géocodage | Réutiliser | **API Adresse (Base Adresse Nationale)** | Gratuite, sans clé, sans inscription, 50 requêtes/s par IP, couvre toute la France. Aucune raison de payer un service américain ni d'écrire quoi que ce soit |
| Distance et durée | Réutiliser | **openrouteservice** | 2 500 requêtes/jour en gratuit, largement au-delà de trois chauffeurs. Le serveur de démonstration d'OSRM est exclu : 1 requête/s et usage commercial explicitement interdit |
| Carte | Réutiliser | **Leaflet** en direct + tuiles OpenStreetMap | Une carte statique à deux points ne justifie pas un liant React supplémentaire ni ses questions de compatibilité. Attribution OpenStreetMap obligatoire et affichée |
| Authentification | Réutiliser | **Better Auth** | Sous licence MIT, activement développé, e-mail/mot de passe natif avec hachage scrypt. On n'écrit jamais d'authentification à la main |

## 2. Stack

| Couche | Choix | Pourquoi ce choix |
|---|---|---|
| Cadre applicatif | Next.js (App Router) + React + TypeScript | Un seul projet pour les deux interfaces et le serveur : une commande à lancer pour une démonstration, pas deux |
| Styles | Tailwind | Les contraintes de design vivent dans des jetons, pas dans des feuilles dispersées |
| Base de données | SQLite via Prisma | Un fichier, rien à installer, rien à administrer. Le schéma migre vers PostgreSQL sans réécrire les requêtes si le projet passe en production |
| Écritures | Server Actions | Les règles de transition restent côté serveur par construction |
| Tests | Vitest (domaine et actions) + Playwright (deux parcours) | Le domaine se teste sans navigateur ; les deux parcours critiques se testent comme un utilisateur |

**Épingler Prisma sur une version stable.** Au moment du cadrage, l'étiquette `latest` de
`prisma` pointe sur une préversion (`8.0.0-rc`). Un `npm install prisma@latest` installerait
donc un candidat de publication. `prisma` et `@prisma/client` sont épinglés sur la même
version stable, et une montée de version est une décision, pas un effet de bord.

**Next.js remplace `middleware` par `proxy`.** Le fichier `proxy.ts` sert uniquement à
rediriger un visiteur mal placé. Le contrôle de rôle est **refait dans chaque Server
Action** : une redirection de routage protège l'ergonomie, pas les données.

## 3. Modèle de données

```
User
  id, email (unique), nom, telephone
  role        CLIENT | CHAUFFEUR
  (tables de session et de comptes gérées par la brique d'authentification)

Course
  id, clientId → User, chauffeurId → User (nullable)
  departLabel, departLat, departLon
  arriveeLabel, arriveeLat, arriveeLon
  departAt                        date et heure souhaitées par le client
  passagers, bagages, siegeEnfant, commentaire
  etat        DEMANDEE | ACCEPTEE | EN_COURSE | TERMINEE | ANNULEE
  distanceM, dureeS, prixEstimeCents   (nullable : voir S11)
  createdAt, accepteeAt, demarreeAt, termineeAt, annuleeAt
```

Deux conséquences assumées :

- **Les coordonnées sont obligatoires** à la création. Une course sans coordonnées est une
  adresse qu'aucune carte ne sait situer : le formulaire la refuse (S10).
- **Le prix est nullable.** `NULL` signifie « estimation indisponible », affiché tel quel au
  client. Le code ne remplace jamais cette absence par un calcul approché (S11).

Les tarifs (base, prix au kilomètre, prix à la minute) sont lus dans l'environnement. Pas
d'écran de réglages dans le MVP : trois valeurs qui changent une fois par an ne justifient
pas une interface.

## 4. Transitions concurrentes : le point à ne pas rater

Quatre personnes regardent la même course — le client et les trois chauffeurs. **Aucune
transition d'état ne s'écrit donc en deux temps.** Ni `findUnique` puis `update`, jamais :
chaque changement d'état est une **écriture conditionnée sur les états d'origine autorisés**,
dont on vérifie le nombre de lignes touchées.

```
mise à jour de la course  où  id = ?  ET  etat ∈ (états d'origine autorisés)
                                      [ET chauffeurId = moi, pour une action chauffeur]
  → nouvel état + horodatage de la transition
si le nombre de lignes modifiées vaut 0 → refus, message à l'utilisateur
```

| Action | Qui | Condition sur `etat` | Condition sur `chauffeurId` | Message si 0 ligne |
|---|---|---|---|---|
| Accepter | Chauffeur | `DEMANDEE` | doit être `NULL` | « cette course vient d'être prise » |
| Se désengager | Chauffeur | `ACCEPTEE` | `= moi` | « cette course a changé d'état » |
| Démarrer | Chauffeur | `ACCEPTEE` | `= moi` | « cette course a changé d'état » |
| Terminer | Chauffeur | `EN_COURSE` | `= moi` | « cette course a changé d'état » |
| Annuler | Client | `DEMANDEE`, `ACCEPTEE`, `EN_COURSE` | — (`clientId = moi`) | « cette course a changé d'état, rafraîchissez » |

Trois collisions à traiter. Les deux premières produisent un état interdit si l'écriture
n'est pas conditionnée, et **sans qu'aucune erreur n'apparaisse** ; la troisième est
légitime dans un ordre et refusée dans l'autre, ce qui change la façon de la tester :

- deux chauffeurs acceptent dans la même seconde → un seul gagne, dans les deux ordres (S3) ;
- le client annule pendant que le chauffeur termine → un seul des deux aboutit, dans les deux
  ordres ; une course `TERMINEE` n'est jamais réécrite en `ANNULEE` ;
- le client annule pendant que le chauffeur démarre → **asymétrique, et c'est normal** : si
  l'annulation arrive la première, le démarrage est refusé ; dans l'autre ordre,
  l'annulation s'applique à une course `EN_COURSE`, ce que le périmètre autorise. Ce cas ne
  doit donc pas être testé comme « exactement une des deux transitions aboutit ».

Invariant dont dépend la première ligne du tableau : **une course `DEMANDEE` n'a jamais de
chauffeur.** Le désengagement remet donc `chauffeurId` à `NULL` en même temps qu'il repasse
l'état à `DEMANDEE`, dans la même écriture — sinon une course libérée resterait inacceptable
par les autres.

La machine à états (story 1.3) dit ce qui est permis ; la condition dans la requête garantit
que l'état lu est encore l'état réel au moment de l'écriture. Les deux sont nécessaires : la
première seule valide une décision prise sur une information périmée.

Deux stories portent un test de concurrence, pas seulement un test fonctionnel : 4.2 pour la
double acceptation, 3.5 pour annuler contre terminer.

## 5. Découpage en lots

Cinq epics séquentiels à fichiers disjoints, dans cet ordre :

| Epic | Fichiers | Dépend de |
|---|---|---|
| 1 — Socle | configuration, `prisma/`, `lib/domaine/`, `components/ui/` | — |
| 2 — Comptes et accès | `lib/auth.ts`, `app/(auth)/`, `proxy.ts` | 1 |
| 3 — Réserver | `app/(client)/`, `lib/adresse.ts`, `lib/tarif.ts`, `components/carte/` | 1, 2 |
| 4 — Conduire | `app/(chauffeur)/` | 1, 2, 3 |
| 5 — Prête à montrer | `e2e/`, `README.md` | tous |

L'ordre n'est pas négociable sur deux points : la machine à états (1.3) précède toute
interface qui en dépend, et l'authentification (epic 2) précède tout écran qui suppose un
utilisateur connu.

## 6. Ce que le MVP ne garantit pas

À dire à la cliente pendant la démonstration, parce que ce sont les limites du choix de
périmètre, pas des défauts à corriger :

1. **Une course réservée n'est pas une course assurée.** Sans notification, l'attribution
   dépend d'un chauffeur qui regarde son écran. Le suivi client le formule explicitement,
   et une course non prise à l'heure est signalée côté chauffeur (S9).
2. **Rien n'est hébergé.** Les données vivent dans un fichier sur une machine de
   développement : ni sauvegarde, ni accès depuis l'extérieur, ni obligations RGPD
   traitées. C'est cohérent avec l'objectif — valider le besoin avant d'investir.
3. **Les prix affichés sont des estimations** calculées sur un itinéraire routier et une
   grille paramétrée. Le prix réel reste celui du compteur.
