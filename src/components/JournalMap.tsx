import { navigate } from "astro:transitions/client";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { PlaceSummary } from "../lib/types";
import { sitePath } from "../lib/url";

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

type MapLibre = typeof import("maplibre-gl");

type Props = {
  places: PlaceSummary[];
};

function styleForTheme() {
  return document.documentElement.dataset.theme === "dark" ? DARK_STYLE : LIGHT_STYLE;
}

export function JournalMap({ places }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const markersRef = useRef<Marker[]>([]);
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
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = libRef.current;
    if (!map || !maplibre || !ready) return;

    const draw = (fit: boolean) => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      const bounds = new maplibre.LngLatBounds();
      let count = 0;

      for (const place of placesRef.current) {
        if (place.lat == null || place.lng == null) continue;
        const link = document.createElement("a");
        link.className = "map-pin";
        link.href = sitePath(`/places/${place.slug}`);
        link.setAttribute("aria-label", place.title);

        const dot = document.createElement("span");
        dot.className = "map-pin-dot";
        const label = document.createElement("span");
        label.className = "map-pin-label";
        label.textContent = place.title;
        link.append(dot, label);
        link.addEventListener("click", (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            return;
          }
          event.preventDefault();
          void navigate(sitePath(`/places/${place.slug}`));
        });

        markersRef.current.push(
          new maplibre.Marker({ element: link, anchor: "center" }).setLngLat([place.lng, place.lat]).addTo(map),
        );
        bounds.extend([place.lng, place.lat]);
        count += 1;
      }

      if (!fit || count === 0) return;
      const padding = map.getContainer().clientWidth < 720 ? 32 : 72;
      if (count === 1) {
        map.jumpTo({ center: bounds.getCenter(), zoom: 5 });
      } else {
        map.fitBounds(bounds, { padding, maxZoom: 5.5, duration: 0 });
      }
    };

    const onStyle = () => draw(false);
    draw(true);
    map.on("style.load", onStyle);
    return () => {
      map.off("style.load", onStyle);
    };
  }, [pinKey, ready]);

  return <div ref={containerRef} className="map-canvas" role="region" aria-label="Map of places" />;
}
