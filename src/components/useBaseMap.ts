import { useEffect, useRef, useState, type RefObject } from "react";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

export const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";
export const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
export const HIT_RADIUS = 22;

type MapLibre = typeof import("maplibre-gl");

type Start = {
  center: [number, number];
  zoom: number;
};

type ReadyMap = {
  map: MapLibreMap;
  maplibre: MapLibre;
};

export function styleForTheme() {
  return document.documentElement.dataset.theme === "dark" ? DARK_STYLE : LIGHT_STYLE;
}

export function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    dot: read("--accent"),
    ring: read("--pin-ring"),
    label: read("--ink"),
    halo: document.documentElement.dataset.theme === "dark" ? "#141416" : "#f4f5f7",
  };
}

/** Stable MapLibre feature id. String ids are parsed as integers, so a slug cannot be the id. */
export function featureId(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const id = hash >>> 0;
  return id === 0 ? 1 : id;
}

export function featureAt(map: MapLibreMap, point: MapMouseEvent["point"], hitLayer: string, pinLayer: string) {
  if (!map.getLayer(pinLayer)) return undefined;
  const layers = map.getLayer(hitLayer) ? [hitLayer, pinLayer] : [pinLayer];
  return map.queryRenderedFeatures(point, { layers })[0];
}

export function useBaseMap(
  containerRef: RefObject<HTMLDivElement | null>,
  start: Start,
  onReady: (ready: ReadyMap) => void,
) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const startRef = useRef(start);
  const onReadyRef = useRef(onReady);
  const [ready, setReady] = useState(false);
  onReadyRef.current = onReady;

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
        center: startRef.current.center,
        zoom: startRef.current.zoom,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        scrollZoom: false,
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      let attributionCollapsed = false;
      const collapseAttribution = () => {
        if (attributionCollapsed) return;
        const details = map.getContainer().querySelector<HTMLDetailsElement>("details.maplibregl-ctrl-attrib");
        if (!details?.classList.contains("maplibregl-compact") || details.classList.contains("maplibregl-attrib-empty")) return;
        details.classList.remove("maplibregl-compact-show");
        details.removeAttribute("open");
        attributionCollapsed = true;
      };
      map.on("sourcedata", collapseAttribution);
      map.on("styledata", collapseAttribution);
      mapRef.current = map;
      onReadyRef.current({ map, maplibre });

      let appliedStyle = initialStyle;
      observer = new MutationObserver(() => {
        const next = styleForTheme();
        if (next === appliedStyle) return;
        appliedStyle = next;
        attributionCollapsed = false;
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
  }, [containerRef]);

  return { mapRef, libRef, ready };
}
