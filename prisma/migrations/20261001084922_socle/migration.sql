-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLIENT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "chauffeurId" TEXT,
    "departLabel" TEXT NOT NULL,
    "departLat" REAL NOT NULL,
    "departLon" REAL NOT NULL,
    "arriveeLabel" TEXT NOT NULL,
    "arriveeLat" REAL NOT NULL,
    "arriveeLon" REAL NOT NULL,
    "departAt" DATETIME NOT NULL,
    "passagers" INTEGER NOT NULL DEFAULT 1,
    "bagages" INTEGER NOT NULL DEFAULT 0,
    "siegeEnfant" BOOLEAN NOT NULL DEFAULT false,
    "commentaire" TEXT,
    "etat" TEXT NOT NULL DEFAULT 'DEMANDEE',
    "distanceM" INTEGER,
    "dureeS" INTEGER,
    "prixEstimeCents" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepteeAt" DATETIME,
    "demarreeAt" DATETIME,
    "termineeAt" DATETIME,
    "annuleeAt" DATETIME,
    CONSTRAINT "Course_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Course_chauffeurId_fkey" FOREIGN KEY ("chauffeurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Course_etat_departAt_idx" ON "Course"("etat", "departAt");

-- CreateIndex
CREATE INDEX "Course_clientId_idx" ON "Course"("clientId");

-- CreateIndex
CREATE INDEX "Course_chauffeurId_idx" ON "Course"("chauffeurId");
