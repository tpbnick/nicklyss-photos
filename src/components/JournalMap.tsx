import { navigate } from "astro:transitions/client";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { PlaceSummary } from "../lib/types";
import { sitePath } from "../lib/url";

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const SOURCE = "places";
const HIT_LAYER = "place-hit";
const PIN_LAYER = "place-pins";
const LABEL_LAYER = "place-labels";

type MapLibre = typeof import("maplibre-gl");

type Props = {
  places: PlaceSummary[];
};

function styleForTheme() {
  return document.documentElement.dataset.theme === "dark" ? DARK_STYLE : LIGHT_STYLE;
}

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    dot: read("--accent"),
    ring: read("--pin-ring"),
    label: read("--bg"),
    halo: read("--ink"),
  };
}

function locatedPlaces(places: PlaceSummary[]) {
  return places.filter((place): place is PlaceSummary & { lat: number; lng: number } => place.lat != null && place.lng != null);
}

function placeCollection(places: PlaceSummary[]) {
  return {
    type: "FeatureCollection" as const,
    features: locatedPlaces(places).map((place) => ({
        type: "Feature" as const,
        id: place.slug,
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
      "circle-radius": 14,
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
      "text-size": 12,
      "text-anchor": "bottom",
      "text-offset": [0, -1.15],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": colors.label,
      "text-halo-color": colors.halo,
      "text-halo-width": 6,
      "text-halo-blur": 0,
      "text-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
    },
  });
}

export function JournalMap({ places }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const placesRef = useRef(places);
  const [ready, setReady] = useState(false);
  placesRef.current = places;
  const pinKey = places
    .filter((place) => place.lat != null && place.lng != null)
    .map((place) => `${place.slug}\t${place.lat}\t${place.lng}\t${place.title}`)
    .join("\n");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let observer: MutationObserver | null = null;
    let resize: ResizeObserver | null = null;
    let hovered: string | number | null = null;

    const pinAt = (map: MapLibreMap, point: MapMouseEvent["point"]) => {
      if (!map.getLayer(PIN_LAYER)) return undefined;
      const layers = map.getLayer(HIT_LAYER) ? [HIT_LAYER, PIN_LAYER] : [PIN_LAYER];
      return map.queryRenderedFeatures(point, { layers })[0];
    };

    const setHover = (map: MapLibreMap, id: string | number | null) => {
      if (!map.getSource(SOURCE)) return;
      if (hovered != null && hovered !== id) {
        map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      }
      hovered = id;
      if (hovered != null) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: true });
    };

    void (async () => {
      const maplibre = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !containerRef.current) return;

      maplibre.setWorkerUrl(workerUrl);
      libRef.current = maplibre;
      const initialStyle = styleForTheme();
      const map = new maplibre.Map({
        container,
        style: initialStyle,
        center: [-98.5, 39.5],
        zoom: 3,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        scrollZoom: false,
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;

      const onClick = (event: MapMouseEvent) => {
        const feature = pinAt(map, event.point);
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
      };
      const onMove = (event: MapMouseEvent) => {
        const feature = pinAt(map, event.point);
        map.getCanvas().style.cursor = feature ? "pointer" : "";
        const id = feature?.id;
        setHover(map, id == null ? null : id);
      };
      const onLeave = () => {
        map.getCanvas().style.cursor = "";
        setHover(map, null);
      };
      map.on("click", onClick);
      map.on("mousemove", onMove);
      map.on("mouseout", onLeave);

      let appliedStyle = initialStyle;
      observer = new MutationObserver(() => {
        const next = styleForTheme();
        if (next === appliedStyle) return;
        appliedStyle = next;
        map.setStyle(next, { diff: false });
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });

      resize = new ResizeObserver(() => map.resize());
      resize.observe(container);
      const markReady = () => {
        if (!disposed) setReady(true);
      };
      if (map.isStyleLoaded()) markReady();
      map.on("load", markReady);
      map.on("style.load", markReady);
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      resize?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

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
  }, [pinKey, ready]);

  return <div ref={containerRef} className="map-canvas" role="region" aria-label="Map of places" />;
}
