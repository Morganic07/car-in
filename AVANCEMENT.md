# Car'in — cahier des charges et avancement

Application de réservation pour une compagnie de taxi de trois chauffeurs.
Ce fichier est à la fois le cahier des charges du MVP et le tableau de bord d'avancement :
les scénarios décrivent ce que l'application doit faire, les stories découpent le travail,
et une case ne se coche qu'une fois la story vérifiée.

Architecture, stack et justification des décisions : `PLAN.md`.

---

## 1. Le besoin

La compagnie prend ses réservations par téléphone et par WhatsApp. Chaque chauffeur gère
les siennes dans son coin : personne n'a de vue d'ensemble, une course peut être oubliée ou
prise deux fois, et la patronne ne sait pas à un instant donné ce qui est couvert.

L'apport de l'application est **le planning partagé**. Elle ne cherche pas à automatiser
l'attribution ni à remplacer le téléphone : elle donne aux trois chauffeurs une même liste
de courses, et aux clients un moyen de réserver et de suivre leur course sans appeler.

Le concurrent réel de cette application est donc le téléphone. Si elle demande plus
d'efforts aux chauffeurs qu'un message WhatsApp, elle ne sera pas utilisée — c'est le
critère qui tranche tout arbitrage d'interface.

**Ce que le MVP doit permettre de décider** : la cliente valide-t-elle l'outil, au point
de vouloir l'héberger et le faire utiliser à ses chauffeurs tous les jours ?

## 2. Utilisateurs

| Rôle | Qui | Contexte d'usage | Nombre |
|---|---|---|---|
| Client | Le passager | Téléphone ou ordinateur, au calme, avant la course | Quelques dizaines |
| Chauffeur | Les trois chauffeurs de la compagnie | Téléphone, entre deux courses, souvent en extérieur | 3 |

Il n'y a **pas de rôle administrateur** dans le MVP : aucun écran de dispatch, aucune
gestion de comptes en ligne. Les trois comptes chauffeurs sont créés par un script.

## 3. Périmètre

**Dans le MVP**

- Réservation d'une course **planifiée** (date et heure choisies par le client).
- Compte client par e-mail et mot de passe, avec historique de ses courses.
- Adresses de départ et d'arrivée saisies avec autocomplétion, coordonnées obligatoires.
- Estimation de la distance, de la durée et du prix, affichée avant validation.
- Contraintes de la course : nombre de passagers, bagages, siège enfant, commentaire.
- Liste partagée des courses disponibles pour les trois chauffeurs.
- Attribution au **premier chauffeur qui accepte**, sans intervention humaine.
- Annulation par le client à tout moment tant que la course n'est pas terminée.
- Désengagement d'un chauffeur après acceptation : la course retourne au pot commun.
- Suivi de l'état de la course par le client, carte du trajet sur le détail.

**Hors périmètre, assumé**

| Exclu | Pourquoi |
|---|---|
| Notifications SMS, push ou e-mail | Payantes ou coûteuses à fiabiliser. Les chauffeurs consultent l'écran. **C'est la première évolution candidate** si la démo convainc |
| Course immédiate (« un taxi maintenant ») | Suppose de connaître la disponibilité en temps réel |
| Géolocalisation des chauffeurs | Suppose une application native et un suivi continu |
| Interface d'administration / dispatch | L'attribution au premier arrivé la rend inutile ici |
| Paiement en ligne | Le paiement se fait à bord, comme aujourd'hui |
| Facturation, taxi conventionné, télétransmission CPAM | Métier à part entière, couvert par des logiciels dédiés |
| Applications natives iOS / Android | Comptes développeur, validation, délais |
| Gestion de flotte, véhicules, plannings de repos | Pas le besoin exprimé |
| Multi-langue | Français uniquement |
| Relance automatique d'une course non attribuée | Le MVP signale, la relance reste téléphonique (S9) |
| Hébergement, sauvegardes, RGPD en production | Le MVP est une démonstration locale |

## 4. Cycle de vie d'une course

```
DEMANDEE ──accepter (chauffeur)──> ACCEPTEE ──démarrer──> EN_COURSE ──terminer──> TERMINEE
   │                                   │
   │                            se désengager
   │<──────────────────────────────────┘
   │
   └──annuler (client)──> ANNULEE        (annulable aussi depuis ACCEPTEE et EN_COURSE)
```

| État | Signification | Qui peut agir |
|---|---|---|
| `DEMANDEE` | Réservée, aucun chauffeur ne l'a prise | Chauffeur : accepter · Client : annuler |
| `ACCEPTEE` | Un chauffeur s'est engagé | Chauffeur : démarrer, se désengager · Client : annuler |
| `EN_COURSE` | Le chauffeur a démarré | Chauffeur : terminer · Client : annuler |
| `TERMINEE` | Course effectuée — état terminal | Personne |
| `ANNULEE` | Annulée par le client — état terminal | Personne |

Toute transition absente de ce graphe est **refusée côté serveur**, et pas seulement
masquée dans l'interface.

## 5. Scénarios d'usage

### S1 — Le client réserve une course
Il se connecte, saisit son adresse de départ et d'arrivée en choisissant une proposition
d'autocomplétion, une date et une heure au moins une heure dans le futur, le nombre de
passagers, ses bagages, un siège enfant si besoin, un commentaire libre. L'écran affiche la
distance, la durée et le prix estimés. Il valide.
**Issue** : la course existe en `DEMANDEE`, apparaît aux trois chauffeurs, et une page de
confirmation récapitule tout.

### S2 — Un chauffeur accepte
Il ouvre la liste des courses disponibles, triée par heure de départ, lit les adresses,
l'heure, les contraintes, et accepte.
**Issue** : la course passe `ACCEPTEE`, disparaît des disponibles des deux autres, et le
client voit le nom et le téléphone de son chauffeur.

### S3 — Deux chauffeurs acceptent au même instant
Les trois voient la même course, deux cliquent dans la même seconde.
**Issue** : un seul obtient la course. L'autre lit « cette course vient d'être prise » et sa
liste se rafraîchit. Jamais deux chauffeurs sur une même course, jamais d'écrasement
silencieux du premier par le second.

### S4 — Le client annule
Depuis le détail de sa course, il annule et confirme.
**Issue** : la course passe `ANNULEE`, quitte les listes des chauffeurs, et reste visible
dans son historique avec la mention annulée. Une course `TERMINEE` ou déjà `ANNULEE` n'offre
pas l'annulation, et l'action serveur la refuse même si la requête est forgée. Si le
chauffeur termine la course au même instant, une seule des deux transitions aboutit : une
course terminée ne redevient jamais annulée.

### S5 — Le chauffeur se désengage
Il a accepté une course mais ne peut plus l'assurer. Depuis le détail, il se désengage et
confirme.
**Issue** : la course revient en `DEMANDEE`, sans chauffeur, et réapparaît dans les courses
disponibles des trois. Le client voit son état repasser à « en attente d'un chauffeur ».
Le désengagement n'est possible que depuis `ACCEPTEE` : une course démarrée se termine.

### S6 — Le chauffeur effectue la course
Au moment de charger le client, il appuie sur « Je démarre ». À l'arrivée, sur « Course
terminée ».
**Issue** : `EN_COURSE` puis `TERMINEE`. La course quitte ses courses du jour et rejoint
l'historique des deux côtés.

### S7 — Le client suit sa course
Il ouvre le détail de sa course.
**Issue** : l'état affiché correspond à l'état réel à moins de quinze secondes près, sans
rechargement manuel. Dès qu'un chauffeur est assigné, son nom et son téléphone s'affichent.

### S8 — Le client consulte son historique
**Issue** : deux listes distinctes, séparées **par état et non par date** — « à venir »
regroupe `DEMANDEE`, `ACCEPTEE` et `EN_COURSE` quelle que soit l'heure de départ, la plus
proche d'abord ; « passées » regroupe `TERMINEE` et `ANNULEE`, la plus récente d'abord.
Une course dont l'heure est dépassée mais qu'aucun chauffeur n'a prise reste donc dans « à
venir », signalée en attente : le client ne doit jamais la croire faite (S9).

### S9 — Personne n'accepte avant l'heure de départ
L'heure de départ arrive, la course est toujours `DEMANDEE`.
**Issue** : elle reste `DEMANDEE`, remonte en tête de la liste des chauffeurs avec un badge
« en retard » bien visible. **Aucun traitement automatique** : c'est un signal, la relance
est téléphonique. Le MVP ne promet pas au client qu'une course réservée est une course
assurée, et son écran de suivi le dit.

### S10 — Adresse introuvable ou non sélectionnée
Le client tape une adresse sans choisir de proposition, ou une adresse inconnue de la base
nationale.
**Issue** : la validation est refusée, avec un message à côté du champ concerné. Aucune
course n'est créée sans coordonnées : le chauffeur ne doit jamais recevoir une adresse
qu'aucune carte ne sait situer.

### S11 — L'estimation de prix échoue
Le service de calcul d'itinéraire est indisponible, ou la clé n'est pas configurée.
**Issue** : la réservation reste possible, et le prix s'affiche « confirmé par la
compagnie ». **Aucun repli silencieux** sur une distance à vol d'oiseau : un prix faux
affiché comme juste est pire qu'une absence de prix.

### S12 — Un client force une URL de l'espace chauffeur
**Issue** : redirection vers son propre espace. Et si la requête d'action est forgée
directement, l'action serveur la refuse : le contrôle de rôle n'est jamais délégué au seul
routage.

### Couverture — chaque scénario a sa story

| Scénario | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Story | 3.3 | 4.2 | 4.2 | 3.5 | 4.5 | 4.4 | 4.6 | 3.4 | 4.1 | 3.1 | 3.2 | 2.3 |
| Aussi | 3.1 · 3.2 | 4.1 | 1.3 | 1.3 | 1.3 | 1.3 | 3.4 | — | 1.2 | 3.3 | 3.3 | 1.3 |

## 6. Règles transverses

Elles s'appliquent à toutes les stories et font partie de chaque critère d'acceptation :

1. **Le serveur décide.** Toute transition d'état et tout contrôle de rôle est revérifié
   dans l'action serveur. Masquer un bouton n'est pas une protection.
2. **Aucune transition ne s'écrit en deux temps.** Accepter, se désengager, démarrer,
   terminer et annuler s'écrivent chacune en une seule mise à jour conditionnée sur les
   états d'origine autorisés, dont on vérifie qu'elle a bien touché une ligne. Entre une
   lecture et une écriture, un autre utilisateur a pu changer l'état : quatre personnes
   regardent la même course.
3. **Aucune erreur silencieuse.** Une action échouée produit un message lisible par
   l'utilisateur. Pas de `catch` vide, pas de valeur de repli inventée.
4. **Cibles tactiles ≥ 44 px**, 8 px entre deux cibles, contraste ≥ 4.5:1 — l'interface
   chauffeur s'utilise debout, au soleil, avec des gants parfois.
5. **Chaque liste a son état vide**, chaque action son retour visible (chargement, puis
   succès ou erreur).
6. **Le français partout** dans l'interface, y compris les messages d'erreur et les dates.

---

## 7. Epics et stories

Cinq lots séquentiels à fichiers disjoints. Une story ne se coche qu'une fois tests, lint et
typage verts, son critère d'acceptation vérifié à la main dans l'application, et aucune
objection de relecture restée sans réponse.

### Epic 1 — Socle

*Branche `epic/socle`. Fichiers : configuration racine, `prisma/`, `lib/domaine/`,
`app/globals.css`, `components/ui/`.*

- [x] **1.1 — Squelette du projet et outillage**
  *Critère* : `npm run dev` sert une page d'accueil Car'in sur `localhost:3000`.
  `npm run lint`, `npm run typecheck` et `npm test` s'exécutent et passent au vert sur un
  dépôt fraîchement installé. Les versions de `prisma` et `@prisma/client` sont épinglées
  sur la même version stable (pas une préversion).

- [x] **1.2 — Modèle de données, migration et jeu de démonstration**
  *Critère* : la migration crée les tables `User` et `Course`. `npm run seed` insère les
  trois chauffeurs, un client de démonstration et au moins six courses couvrant les cinq
  états, dont une course `DEMANDEE` dont l'heure de départ est passée (pour S9). Relancer
  le seed deux fois de suite ne duplique rien et ne casse rien.

- [x] **1.3 — Machine à états d'une course**
  *Critère* : un module sans dépendance à la base expose les transitions autorisées pour un
  état et un rôle donnés. Les tests couvrent chaque transition autorisée du graphe du §4
  **et le refus de chaque transition interdite** : terminer une course `DEMANDEE`, annuler
  une course `TERMINEE`, se désengager d'une course `EN_COURSE`, accepter une course déjà
  `ACCEPTEE`.

- [x] **1.4 — Design system**
  *Critère* : les jetons de couleur et les deux fontes définis dans `app/globals.css` sont
  appliqués globalement, et aucune valeur hexadécimale ne subsiste dans un composant.
  Les composants `Bouton`, `Champ`, `BadgeEtat` et `CarteCourse` existent et sont utilisés
  par une page de démonstration interne. Le contraste des cinq badges d'état est mesuré et
  ≥ 4.5:1, les boutons font au moins 44 px de haut, le focus clavier est visible.

### Epic 2 — Comptes et accès

*Branche `epic/comptes`. Fichiers : `lib/auth.ts`, `app/(auth)/`, `proxy.ts`.*

- [x] **2.1 — Inscription client**
  *Critère* : e-mail, mot de passe de huit caractères minimum, nom et téléphone créent un
  compte de rôle `CLIENT`. Un e-mail déjà utilisé affiche un message à côté du champ. Un
  rôle envoyé dans le formulaire est ignoré — un test le prouve en postant
  `role=CHAUFFEUR` et en vérifiant le rôle enregistré.

- [x] **2.2 — Connexion et déconnexion**
  *Critère* : après connexion, la session survit à un rechargement et à la fermeture de
  l'onglet. Un mauvais mot de passe affiche un message qui ne révèle pas si l'e-mail
  existe. La déconnexion invalide la session : revenir en arrière ne redonne pas accès.

- [x] **2.3 — Cloisonnement des deux espaces**
  *Critère* : un client qui ouvre une URL de `/chauffeur` est redirigé vers son espace, et
  réciproquement. Un visiteur non connecté est envoyé vers la connexion. Un test appelle
  une action chauffeur avec une session client et attend un refus explicite (S12).

### Epic 3 — Réserver, côté client

*Branche `epic/reserver`. Fichiers : `app/(client)/`, `lib/adresse.ts`, `lib/tarif.ts`,
`components/carte/`.*

- [x] **3.1 — Saisie d'adresse avec autocomplétion**
  *Critère* : à partir de trois caractères et après 300 ms sans frappe, des propositions
  s'affichent, navigables au clavier et sélectionnables à la souris. L'adresse retenue
  porte ses coordonnées. Si l'utilisateur tape sans rien sélectionner, la validation est
  refusée avec un message à côté du champ (S10). Le service indisponible affiche un message
  et ne bloque pas la page.

- [x] **3.2 — Estimation distance, durée et prix**
  *Critère* : pour deux adresses géolocalisées, la distance, la durée et le prix calculé
  depuis la grille tarifaire s'affichent avant validation. En cas d'échec du service ou de
  clé absente, l'écran affiche « prix confirmé par la compagnie », la réservation reste
  possible, et **aucune distance de repli n'est calculée** (S11) — un test simule la panne
  et vérifie qu'aucun prix n'est inventé.

- [x] **3.3 — Formulaire de réservation et création de la course**
  *Critère* : départ, arrivée, date et heure, passagers de 1 à 6, bagages, siège enfant,
  commentaire. Une date passée ou à moins d'une heure est refusée avec un message. La
  validation crée une course `DEMANDEE` et mène à une page de confirmation qui récapitule
  tout, prix compris (S1).

- [ ] **3.4 — Mes courses : à venir, historique, détail**
  *Critère* : deux listes séparées **par état**, jamais par date — « à venir » contient
  `DEMANDEE`, `ACCEPTEE` et `EN_COURSE`, « passées » contient `TERMINEE` et `ANNULEE` ;
  l'état est visible sur chaque ligne. Le jeu de démonstration de 1.2 comporte une course
  `DEMANDEE` dont l'heure est passée : elle doit apparaître dans « à venir » (S8, S9). Le
  détail affiche la carte du trajet avec les deux points, les contraintes, et dès
  l'acceptation le nom et le téléphone du chauffeur. Une liste vide affiche un message qui
  invite à réserver, pas un écran blanc.

- [ ] **3.5 — Annulation par le client**
  *Critère* : le bouton d'annulation est présent sur toute course `DEMANDEE`, `ACCEPTEE` ou
  `EN_COURSE`, et demande confirmation. Une course `TERMINEE` ou `ANNULEE` ne l'affiche pas,
  et l'action serveur refuse la demande même forgée. Après annulation, la course est
  `ANNULEE`, disparaît des courses disponibles côté chauffeur, et reste dans l'historique du
  client (S4). Un test de concurrence annule et termine la même course `EN_COURSE` en même
  temps : une seule des deux transitions aboutit, l'autre est refusée avec un message, et
  une course `TERMINEE` n'est jamais réécrite en `ANNULEE`.

### Epic 4 — Conduire, côté chauffeur

*Branche `epic/conduire`. Fichiers : `app/(chauffeur)/`.*

- [ ] **4.1 — Courses disponibles**
  *Critère* : la liste des courses `DEMANDEE`, triée par heure de départ, affiche adresses,
  heure, passagers et bagages sans qu'il faille ouvrir le détail. Une course dont l'heure
  est dépassée remonte en tête avec un badge « en retard » (S9). Liste vide : message
  explicite.

- [ ] **4.2 — Accepter une course**
  *Critère* : accepter passe la course en `ACCEPTEE` au nom du chauffeur et la retire des
  disponibles des autres. Un test de concurrence lance deux acceptations simultanées sur la
  même course : une seule réussit, la seconde reçoit « cette course vient d'être prise » et
  la course conserve son premier chauffeur (S3).

- [ ] **4.3 — Mes courses et détail de course**
  *Critère* : les courses du chauffeur, celles du jour d'abord, puis les suivantes. Le
  détail affiche la carte, les deux adresses complètes, le téléphone du client et les
  contraintes (bagages, siège enfant, commentaire).

- [ ] **4.4 — Démarrer et terminer une course**
  *Critère* : deux boutons pleine largeur, au moins 44 px de haut, font passer `ACCEPTEE` →
  `EN_COURSE` → `TERMINEE`. L'état se reflète côté client sans qu'il recharge (S6, S7).
  Une transition hors ordre est refusée par l'action serveur, avec un message.

- [ ] **4.5 — Se désengager d'une course**
  *Critère* : depuis une course `ACCEPTEE`, après confirmation, la course revient en
  `DEMANDEE` sans chauffeur et réapparaît dans les disponibles des trois. Le bouton est
  absent sur une course `EN_COURSE`, et l'action la refuse (S5).

- [ ] **4.6 — Rafraîchissement automatique des listes**
  *Critère* : les listes chauffeur et le suivi client se réactualisent au moins toutes les
  quinze secondes sans perdre la position de défilement ni une saisie en cours. Le
  rafraîchissement se suspend quand l'onglet est caché et reprend au retour (S7).

### Epic 5 — Prête à montrer

*Branche `epic/demo`. Fichiers : `e2e/`, `README.md`, scripts de `package.json`.*

- [ ] **5.1 — Deux parcours de bout en bout automatisés**
  *Critère* : deux tests de bout en bout passent sur une base fraîche — (a) un client
  réserve, un chauffeur accepte, démarre et termine, le client voit « terminée » ; (b) un
  client réserve puis annule, la course a disparu des courses disponibles du chauffeur.
  `npm run test:e2e` les exécute sans étape manuelle.

- [ ] **5.2 — États vides, chargements et erreurs**
  *Critère* : chaque liste des deux interfaces a son état vide rédigé, chaque action son
  retour visible, et aucune erreur ni avertissement n'apparaît dans la console du
  navigateur au fil des deux parcours de 5.1.

- [ ] **5.3 — Démonstration en une commande**
  *Critère* : le `README.md` décrit l'installation et une commande unique qui prépare la
  base, charge le jeu de démonstration et lance l'application. Les identifiants des
  comptes de démonstration (un client, trois chauffeurs) y sont documentés. Un dépôt cloné
  à neuf est démontrable devant la cliente en moins de cinq minutes.

---

## 8. Après le MVP — évolutions candidates

Par ordre de valeur attendue, à trancher avec la cliente **après** la démonstration :

1. **Notifications aux chauffeurs** (SMS ou push) — sans elles, l'outil suppose que
   quelqu'un regarde l'écran. C'est la limite la plus probable de la démonstration.
2. **Hébergement et mise en production** : domaine, HTTPS, sauvegarde quotidienne de la
   base, registre de traitement RGPD, purge des données après une durée définie.
3. **Écran patronne** : vue d'ensemble des courses, relance des courses non attribuées.
4. **Course immédiate**, qui suppose de savoir quel chauffeur est libre.
5. **Export comptable** des courses terminées.
