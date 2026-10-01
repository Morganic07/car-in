import { describe, expect, it } from 'vitest'

import {
  ACTIONS,
  ETATS,
  ROLES,
  TRANSITIONS,
  appliquerTransition,
  estTerminal,
  transitionsPossibles,
  type Action,
  type Etat,
  type Role,
} from '../lib/domaine/course.ts'
import { EtatCourse, Role as RolePrisma } from '../prisma/generated/client/index.js'

/// Le graphe du §4 d'AVANCEMENT.md, recopié à la main. C'est volontaire : s'il était
/// dérivé de `TRANSITIONS`, le test ne vérifierait plus que `TRANSITIONS` est
/// cohérente avec elle-même.
const PERMIS: readonly (readonly [Etat, Action, Role])[] = [
  ['DEMANDEE', 'accepter', 'CHAUFFEUR'],
  ['ACCEPTEE', 'seDesengager', 'CHAUFFEUR'],
  ['ACCEPTEE', 'demarrer', 'CHAUFFEUR'],
  ['EN_COURSE', 'terminer', 'CHAUFFEUR'],
  ['DEMANDEE', 'annuler', 'CLIENT'],
  ['ACCEPTEE', 'annuler', 'CLIENT'],
  ['EN_COURSE', 'annuler', 'CLIENT'],
]

const CIBLES: Record<Action, Etat> = {
  accepter: 'ACCEPTEE',
  seDesengager: 'DEMANDEE',
  demarrer: 'EN_COURSE',
  terminer: 'TERMINEE',
  annuler: 'ANNULEE',
}

function estPermis(etat: Etat, action: Action, role: Role): boolean {
  return PERMIS.some(([e, a, r]) => e === etat && a === action && r === role)
}

describe('alignement avec le schéma de la base', () => {
  // Si un état ou un rôle était ajouté au schéma Prisma sans l'être ici, la machine
  // laisserait passer une valeur qu'elle ne sait pas traiter. Ce test est le seul
  // endroit où les deux listes se rencontrent.
  it('couvre exactement les états du schéma', () => {
    expect([...ETATS].sort()).toEqual(Object.keys(EtatCourse).sort())
  })

  it('couvre exactement les rôles du schéma', () => {
    expect([...ROLES].sort()).toEqual(Object.keys(RolePrisma).sort())
  })
})

describe('transitions du graphe', () => {
  it('autorise les sept transitions du §4, et pose le bon état cible', () => {
    for (const [etat, action, role] of PERMIS) {
      const resultat = appliquerTransition(etat, action, role)
      const repere = `${etat} + ${action} (${role})`

      expect(resultat.permis, repere).toBe(true)
      if (resultat.permis) {
        expect(resultat.etatCible, repere).toBe(CIBLES[action])
      }
    }
  })

  it('refuse les quarante-trois autres combinaisons, avec un motif', () => {
    // Exhaustif : 5 états × 5 actions × 2 rôles = 50 combinaisons, dont 7 permises.
    // Un test par cas nommé ne prouverait que les cas auxquels on a pensé.
    let refusees = 0

    for (const etat of ETATS) {
      for (const action of ACTIONS) {
        for (const role of ROLES) {
          if (estPermis(etat, action, role)) continue

          const resultat = appliquerTransition(etat, action, role)
          const repere = `${etat} + ${action} (${role})`

          expect(resultat.permis, repere).toBe(false)
          if (!resultat.permis) {
            expect(resultat.motif, repere).not.toHaveLength(0)
          }
          refusees += 1
        }
      }
    }

    expect(refusees).toBe(ETATS.length * ACTIONS.length * ROLES.length - PERMIS.length)
  })

  it('refuse nommément les quatre cas cités par la story', () => {
    expect(appliquerTransition('DEMANDEE', 'terminer', 'CHAUFFEUR').permis).toBe(false)
    expect(appliquerTransition('TERMINEE', 'annuler', 'CLIENT').permis).toBe(false)
    expect(appliquerTransition('EN_COURSE', 'seDesengager', 'CHAUFFEUR').permis).toBe(false)
    expect(appliquerTransition('ACCEPTEE', 'accepter', 'CHAUFFEUR').permis).toBe(false)
  })

  it('refuse une action au rôle qui n’en est pas le propriétaire', () => {
    // Un client ne démarre pas une course, un chauffeur ne l'annule pas — même
    // depuis un état où l'action est par ailleurs permise.
    const parClient = appliquerTransition('ACCEPTEE', 'demarrer', 'CLIENT')
    expect(parClient.permis).toBe(false)
    if (!parClient.permis) expect(parClient.motif).toContain('chauffeurs')

    const parChauffeur = appliquerTransition('DEMANDEE', 'annuler', 'CHAUFFEUR')
    expect(parChauffeur.permis).toBe(false)
    if (!parChauffeur.permis) expect(parChauffeur.motif).toContain('clients')
  })
})

describe('transitions possibles pour un état et un rôle', () => {
  const attendu: Record<Etat, Record<Role, readonly Action[]>> = {
    DEMANDEE: { CHAUFFEUR: ['accepter'], CLIENT: ['annuler'] },
    ACCEPTEE: { CHAUFFEUR: ['seDesengager', 'demarrer'], CLIENT: ['annuler'] },
    EN_COURSE: { CHAUFFEUR: ['terminer'], CLIENT: ['annuler'] },
    TERMINEE: { CHAUFFEUR: [], CLIENT: [] },
    ANNULEE: { CHAUFFEUR: [], CLIENT: [] },
  }

  it('rend la liste du §4, sans rien de plus', () => {
    for (const etat of ETATS) {
      for (const role of ROLES) {
        expect([...transitionsPossibles(etat, role)].sort(), `${etat} / ${role}`).toEqual(
          [...attendu[etat][role]].sort(),
        )
      }
    }
  })
})

describe('états terminaux', () => {
  it('ne reconnaît comme terminaux que TERMINEE et ANNULEE', () => {
    const terminaux = ETATS.filter((etat) => estTerminal(etat))
    expect([...terminaux].sort()).toEqual(['ANNULEE', 'TERMINEE'])
  })

  it('ne laisse aucune action partir d’un état terminal', () => {
    for (const etat of ETATS.filter(estTerminal)) {
      for (const role of ROLES) {
        expect(transitionsPossibles(etat, role), `${etat} / ${role}`).toHaveLength(0)
      }
    }
  })
})

describe('données d’écriture portées par chaque transition', () => {
  it('libère le chauffeur de toute course qui retourne à DEMANDEE', () => {
    // L'invariant de PLAN.md §4 : une course DEMANDEE n'a jamais de chauffeur. Sans
    // cette remise à nul, `accepter` — qui exige `chauffeurId IS NULL` — ne pourrait
    // plus jamais s'appliquer à une course libérée.
    for (const action of ACTIONS) {
      const transition = TRANSITIONS[action]
      if (transition.cible !== 'DEMANDEE') continue
      expect(transition.remiseANul, action).toContain('chauffeurId')
      expect(transition.remiseANul, action).toContain('accepteeAt')
    }
  })

  it('pose un horodatage à chaque transition sauf le désengagement', () => {
    for (const action of ACTIONS) {
      const transition = TRANSITIONS[action]
      if (action === 'seDesengager') {
        expect(transition.horodatage, action).toBeNull()
      } else {
        expect(transition.horodatage, action).not.toBeNull()
      }
    }
  })

  it('conserve l’historique d’une course annulée en route', () => {
    // Annuler n'effface ni l'acceptation ni le départ : ils ont eu lieu.
    expect(TRANSITIONS.annuler.remiseANul).toHaveLength(0)
  })

  it('exige la propriété attendue pour chaque action', () => {
    expect(TRANSITIONS.accepter.propriete).toBe('chauffeurAbsent')
    expect(TRANSITIONS.seDesengager.propriete).toBe('chauffeurEstLAuteur')
    expect(TRANSITIONS.demarrer.propriete).toBe('chauffeurEstLAuteur')
    expect(TRANSITIONS.terminer.propriete).toBe('chauffeurEstLAuteur')
    expect(TRANSITIONS.annuler.propriete).toBe('clientEstLAuteur')
  })

  it('ne laisse fuir aucun identifiant technique dans un message', () => {
    // Les messages sont lus par un client ou un chauffeur : ni nom d'état, ni nom de
    // champ, ni anglais.
    for (const action of ACTIONS) {
      const { refus } = TRANSITIONS[action]
      expect(refus, action).not.toHaveLength(0)
      for (const etat of ETATS) {
        expect(refus, `${action} cite ${etat}`).not.toContain(etat)
      }
      expect(refus, action).not.toMatch(/chauffeurId|clientId|At\b|null/)
    }
  })
})
