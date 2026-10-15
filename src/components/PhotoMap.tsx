import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

type MapLibre = typeof import("maplibre-gl");

export type PhotoClusterPoint = {
  id: string;
  lat: number;
  lng: number;
  count: number;
};

type Props = {
  clusters: PhotoClusterPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function styleForTheme() {
  return document.documentElement.dataset.theme === "dark" ? DARK_STYLE : LIGHT_STYLE;
}

export default function PhotoMap({ clusters, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const clustersRef = useRef(clusters);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const fittedKey = useRef("");
  const [ready, setReady] = useState(false);
  clustersRef.current = clusters;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  const geometryKey = clusters
    .map((cluster) => `${cluster.id}\t${cluster.lat}\t${cluster.lng}\t${cluster.count}`)
    .join("\n");
  const pinKey = `${selectedId ?? ""}\n${geometryKey}`;

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
        center: [clusters[0]?.lng ?? 0, clusters[0]?.lat ?? 0],
        zoom: 11,
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
      const current = clustersRef.current;
      for (const cluster of current) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = cluster.id === selectedRef.current ? "map-pin is-selected" : "map-pin";
        const label = `${cluster.count} ${cluster.count === 1 ? "photo" : "photos"}`;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-pressed", cluster.id === selectedRef.current ? "true" : "false");
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelectRef.current(cluster.id);
        });

        const dot = document.createElement("span");
        dot.className = "map-pin-dot";
        const caption = document.createElement("span");
        caption.className = "map-pin-label";
        caption.textContent = label;
        button.append(dot, caption);

        markersRef.current.push(
          new maplibre.Marker({ element: button, anchor: "center" }).setLngLat([cluster.lng, cluster.lat]).addTo(map),
        );
        bounds.extend([cluster.lng, cluster.lat]);
      }
      if (!fit || current.length === 0) return;
      const span = bounds.getSouthWest().distanceTo(bounds.getNorthEast());
      if (current.length === 1 || span < 80) {
        map.jumpTo({ center: bounds.getCenter(), zoom: 13 });
        return;
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    };

    const onStyle = () => draw(false);
    const fit = fittedKey.current !== geometryKey;
    fittedKey.current = geometryKey;
    draw(fit);
    map.on("style.load", onStyle);
    return () => {
      map.off("style.load", onStyle);
    };
  }, [pinKey, ready]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      role="region"
      aria-label={`${clusters.length} photo ${clusters.length === 1 ? "location" : "locations"}`}
    />
  );
}
