'use client'

import 'leaflet/dist/leaflet.css'
import './carte.css'

import { useEffect, useRef, useState } from 'react'

export type PointCarte = {
  readonly label: string
  readonly lat: number
  readonly lon: number
}

export const CARTE_INDISPONIBLE =
  'La carte n’a pas pu s’afficher entièrement. Les adresses ci-dessous restent exactes.'

/// Tuiles OpenStreetMap : leur attribution est obligatoire et reste affichée sur la
/// carte (PLAN.md §1).
const TUILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">Contributeurs OpenStreetMap</a>'

/// Étiquette posée sur un point. Les classes sont écrites en entier ici pour que
/// Tailwind, qui lit ce fichier, les produise ; le texte est échappé par le
/// navigateur, jamais concaténé dans le HTML.
function etiquette(texte: string, classes: string): HTMLElement {
  const element = document.createElement('span')
  element.className = `inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap ${classes}`
  element.textContent = texte
  return element
}

/// Carte du trajet, deux points et rien d'autre (story 3.4).
///
/// Aucun trait entre les deux : une ligne droite se lirait comme le trajet, et ce
/// serait un trajet à vol d'oiseau inventé — ce que S11 refuse pour le prix.
///
/// La carte est figée (ni glisser, ni zoomer) : elle sert à situer deux adresses, et
/// une carte qui capte le doigt empêche de faire défiler la page sur un téléphone.
/// Leaflet touche `window` dès son chargement : il est importé dans l'effet, donc
/// seulement dans le navigateur.
export function CarteTrajet({
  depart,
  arrivee,
}: {
  readonly depart: PointCarte
  readonly arrivee: PointCarte
}) {
  const conteneur = useRef<HTMLDivElement>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const { lat: departLat, lon: departLon } = depart
  const { lat: arriveeLat, lon: arriveeLon } = arrivee

  useEffect(() => {
    const element = conteneur.current
    if (element === null) return

    let carte: import('leaflet').Map | null = null
    let demontee = false

    import('leaflet')
      .then(({ default: L }) => {
        if (demontee) return
        carte = L.map(element, {
          zoomControl: false,
          dragging: false,
          touchZoom: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          // Aucune animation : la carte ne bouge jamais, et prefers-reduced-motion
          // n'a donc rien à couper.
          fadeAnimation: false,
          zoomAnimation: false,
          markerZoomAnimation: false,
        })

        L.tileLayer(TUILES, { maxZoom: 19, attribution: ATTRIBUTION })
          .on('tileerror', () => setErreur(CARTE_INDISPONIBLE))
          .addTo(carte)

        const points = [
          { lat: departLat, lon: departLon, texte: 'Départ', classes: 'bg-accent text-on-primary' },
          { lat: arriveeLat, lon: arriveeLon, texte: 'Arrivée', classes: 'bg-primary text-on-primary' },
        ]
        for (const point of points) {
          L.marker([point.lat, point.lon], {
            keyboard: false,
            interactive: false,
            icon: L.divIcon({
              className: '',
              html: etiquette(point.texte, point.classes),
              // Ancre au centre de l'étiquette, qui est posée sur le point.
              iconSize: [80, 28],
              iconAnchor: [40, 14],
            }),
          }).addTo(carte)
        }

        carte.fitBounds(
          L.latLngBounds(points.map((point) => [point.lat, point.lon])),
          // Marge pour que les étiquettes ne débordent pas ; plafond de zoom pour que
          // deux points voisins ne donnent pas une carte sans rue lisible autour.
          { padding: [48, 48], maxZoom: 16, animate: false },
        )
      })
      .catch((cause: unknown) => {
        console.error('La carte du trajet n’a pas pu être créée.', cause)
        setErreur(CARTE_INDISPONIBLE)
      })

    return () => {
      demontee = true
      carte?.remove()
    }
  }, [departLat, departLon, arriveeLat, arriveeLon])

  return (
    <figure className="carte-trajet flex flex-col gap-2">
      <figcaption className="sr-only">
        Carte du trajet, de {depart.label} à {arrivee.label}
      </figcaption>
      {/* `isolate` : les calques de Leaflet portent des z-index élevés, contenus ici
          plutôt que de passer au-dessus du reste de la page. */}
      <div
        ref={conteneur}
        className="isolate h-64 w-full overflow-hidden rounded-lg border border-border bg-muted sm:h-80"
      />
      {erreur === null ? null : (
        <p role="status" className="text-secondary">
          {erreur}
        </p>
      )}
    </figure>
  )
}
