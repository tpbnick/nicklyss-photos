import { navigate } from "astro:transitions/client";
import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { PlaceSummary } from "../lib/types";
import { sitePath } from "../lib/url";
import { HIT_RADIUS, featureAt, featureId, themeColors, useBaseMap } from "./useBaseMap";

const SOURCE = "places";
const HIT_LAYER = "place-hit";
const PIN_LAYER = "place-pins";
const LABEL_LAYER = "place-labels";

type Props = {
  places: PlaceSummary[];
};

function locatedPlaces(places: PlaceSummary[]) {
  return places.filter((place): place is PlaceSummary & { lat: number; lng: number } => place.lat != null && place.lng != null);
}

function placeCollection(places: PlaceSummary[]) {
  return {
    type: "FeatureCollection" as const,
    features: locatedPlaces(places).map((place) => ({
      type: "Feature" as const,
      id: featureId(place.slug),
      properties: { slug: place.slug, title: place.title },
      geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] as [number, number] },
    })),
  };
}

function paintPins(map: MapLibreMap) {
  const colors = themeColors();
  map.setPaintProperty(PIN_LAYER, "circle-color", colors.dot);
  map.setPaintProperty(PIN_LAYER, "circle-stroke-color", colors.ring);
  map.setPaintProperty(LABEL_LAYER, "text-color", colors.label);
  map.setPaintProperty(LABEL_LAYER, "text-halo-color", colors.halo);
  map.setPaintProperty(LABEL_LAYER, "text-halo-width", 0);
}

function ensurePlaces(map: MapLibreMap, places: PlaceSummary[]) {
  const data = placeCollection(places);
  const existing = map.getSource(SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    paintPins(map);
    return;
  }

  const colors = themeColors();
  map.addSource(SOURCE, { type: "geojson", data });
  map.addLayer({
    id: HIT_LAYER,
    type: "circle",
    source: SOURCE,
    paint: {
      "circle-radius": HIT_RADIUS,
      "circle-color": "#000000",
      "circle-opacity": 0.01,
    },
  });
  map.addLayer({
    id: PIN_LAYER,
    type: "circle",
    source: SOURCE,
    paint: {
      "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], 8, 6],
      "circle-color": colors.dot,
      "circle-stroke-width": 2,
      "circle-stroke-color": colors.ring,
    },
  });
  map.addLayer({
    id: LABEL_LAYER,
    type: "symbol",
    source: SOURCE,
    layout: {
      "text-field": ["get", "title"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 13,
      "text-anchor": "bottom",
      "text-offset": [0, -1.7],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": colors.label,
      "text-halo-color": colors.halo,
      "text-halo-width": 0,
      "text-halo-blur": 0,
      "text-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
    },
  });
}

export function JournalMap({ places }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const placesRef = useRef(places);
  placesRef.current = places;
  const pinKey = places
    .filter((place) => place.lat != null && place.lng != null)
    .map((place) => `${place.slug}\t${place.lat}\t${place.lng}\t${place.title}`)
    .join("\n");

  const { mapRef, libRef, ready } = useBaseMap(containerRef, { center: [-98.5, 39.5], zoom: 3 }, ({ map }) => {
    let hovered: string | number | null = null;

    const setHover = (id: string | number | null) => {
      if (!map.getSource(SOURCE)) return;
      if (hovered != null && hovered !== id) {
        map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      }
      hovered = id;
      if (hovered != null) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: true });
    };

    map.on("click", (event: MapMouseEvent) => {
      const feature = featureAt(map, event.point, HIT_LAYER, PIN_LAYER);
      const slug = feature?.properties?.slug;
      if (!slug) return;
      event.preventDefault();
      const href = sitePath(`/places/${slug}`);
      const mouse = event.originalEvent;
      if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) {
        window.open(href, "_blank", "noopener");
        return;
      }
      void navigate(href);
    });
    map.on("mousemove", (event: MapMouseEvent) => {
      const feature = featureAt(map, event.point, HIT_LAYER, PIN_LAYER);
      map.getCanvas().style.cursor = feature ? "pointer" : "";
      const id = feature?.id;
      setHover(id == null ? null : id);
    });
    map.on("mouseout", () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    });
  });

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = libRef.current;
    if (!map || !maplibre || !ready) return;

    const draw = (fit: boolean) => {
      const current = locatedPlaces(placesRef.current);
      ensurePlaces(map, current);
      if (!fit || current.length === 0) return;
      const bounds = new maplibre.LngLatBounds();
      for (const place of current) bounds.extend([place.lng, place.lat]);
      const padding = map.getContainer().clientWidth < 720 ? 32 : 72;
      if (current.length === 1) {
        map.jumpTo({ center: bounds.getCenter(), zoom: 5 });
      } else {
        map.fitBounds(bounds, { padding, maxZoom: 5.5, duration: 0 });
      }
    };

    const onStyle = () => draw(false);
    map.on("style.load", onStyle);
    draw(true);
    return () => {
      map.off("style.load", onStyle);
    };
  }, [pinKey, ready, mapRef, libRef]);

  return <div ref={containerRef} className="map-canvas" role="region" aria-label="Map of places" />;
}
