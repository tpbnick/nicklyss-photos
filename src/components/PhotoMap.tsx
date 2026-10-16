import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const SOURCE = "photo-places";
const HIT_LAYER = "photo-hit";
const HALO_LAYER = "photo-halo";
const PIN_LAYER = "photo-pins";
const LABEL_LAYER = "photo-labels";

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

function clusterCollection(clusters: PhotoClusterPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: clusters.map((cluster, index) => ({
      type: "Feature" as const,
      // Same integer-id rule as the homepage map. A photo URL is not a unique MapLibre id.
      id: index + 1,
      properties: {
        id: cluster.id,
        title: `${cluster.count} ${cluster.count === 1 ? "photo" : "photos"}`,
      },
      geometry: { type: "Point" as const, coordinates: [cluster.lng, cluster.lat] as [number, number] },
    })),
  };
}

export default function PhotoMap({ clusters, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const clustersRef = useRef(clusters);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const fittedKey = useRef("");
  const hoverRef = useRef<string | number | null>(null);
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

      const onClick = (event: MapMouseEvent) => {
        if (!map.getLayer(PIN_LAYER)) return;
        const layers = map.getLayer(HIT_LAYER) ? [HIT_LAYER, PIN_LAYER] : [PIN_LAYER];
        const feature = map.queryRenderedFeatures(event.point, { layers })[0];
        const id = feature?.properties?.id;
        if (!id) return;
        event.preventDefault();
        onSelectRef.current(id);
      };
      const onMove = (event: MapMouseEvent) => {
        if (!map.getLayer(PIN_LAYER) || !map.getSource(SOURCE)) return;
        const layers = map.getLayer(HIT_LAYER) ? [HIT_LAYER, PIN_LAYER] : [PIN_LAYER];
        const feature = map.queryRenderedFeatures(event.point, { layers })[0];
        map.getCanvas().style.cursor = feature ? "pointer" : "";
        const next = feature?.id;
        if (hoverRef.current != null && hoverRef.current !== next) {
          map.setFeatureState({ source: SOURCE, id: hoverRef.current }, { hover: false });
        }
        hoverRef.current = next == null ? null : next;
        if (hoverRef.current != null) {
          map.setFeatureState({ source: SOURCE, id: hoverRef.current }, { hover: true });
        }
      };
      const onLeave = () => {
        map.getCanvas().style.cursor = "";
        if (hoverRef.current != null && map.getSource(SOURCE)) {
          map.setFeatureState({ source: SOURCE, id: hoverRef.current }, { hover: false });
        }
        hoverRef.current = null;
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
      const current = clustersRef.current;
      const data = clusterCollection(current);
      const colors = themeColors();
      const existing = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource(SOURCE, { type: "geojson", data });
        map.addLayer({
          id: HIT_LAYER,
          type: "circle",
          source: SOURCE,
          paint: { "circle-radius": 14, "circle-color": "#000000", "circle-opacity": 0.01 },
        });
        map.addLayer({
          id: HALO_LAYER,
          type: "circle",
          source: SOURCE,
          paint: {
            "circle-radius": 12,
            "circle-color": colors.dot,
            "circle-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.35, 0],
          },
        });
        map.addLayer({
          id: PIN_LAYER,
          type: "circle",
          source: SOURCE,
          paint: {
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              8,
              ["boolean", ["feature-state", "hover"], false],
              8,
              6,
            ],
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
            "text-opacity": [
              "case",
              ["any", ["boolean", ["feature-state", "hover"], false], ["boolean", ["feature-state", "selected"], false]],
              1,
              0,
            ],
          },
        });
      }
      map.setPaintProperty(PIN_LAYER, "circle-color", colors.dot);
      map.setPaintProperty(PIN_LAYER, "circle-stroke-color", colors.ring);
      map.setPaintProperty(HALO_LAYER, "circle-color", colors.dot);
      map.setPaintProperty(LABEL_LAYER, "text-color", colors.label);
      map.setPaintProperty(LABEL_LAYER, "text-halo-color", colors.halo);
      current.forEach((cluster, index) => {
        map.setFeatureState(
          { source: SOURCE, id: index + 1 },
          { selected: cluster.id === selectedRef.current },
        );
      });
      if (!fit || current.length === 0) return;
      const bounds = new maplibre.LngLatBounds();
      for (const cluster of current) bounds.extend([cluster.lng, cluster.lat]);
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
