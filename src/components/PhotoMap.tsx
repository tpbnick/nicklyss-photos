import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { HIT_RADIUS, featureAt, featureId, themeColors, useBaseMap } from "./useBaseMap";

const SOURCE = "photo-places";
const HIT_LAYER = "photo-hit";
const HALO_LAYER = "photo-halo";
const PIN_LAYER = "photo-pins";
const LABEL_LAYER = "photo-labels";

type PhotoClusterPoint = {
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

function clusterCollection(clusters: PhotoClusterPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: clusters.map((cluster) => ({
      type: "Feature" as const,
      id: featureId(cluster.id),
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
  const clustersRef = useRef(clusters);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const fittedKey = useRef("");
  clustersRef.current = clusters;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  const geometryKey = clusters
    .map((cluster) => `${cluster.id}\t${cluster.lat}\t${cluster.lng}\t${cluster.count}`)
    .join("\n");
  const pinKey = `${selectedId ?? ""}\n${geometryKey}`;

  const { mapRef, libRef, ready } = useBaseMap(
    containerRef,
    { center: [clusters[0]?.lng ?? 0, clusters[0]?.lat ?? 0], zoom: 11 },
    ({ map }) => {
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
        const id = feature?.properties?.id;
        if (!id) return;
        event.preventDefault();
        onSelectRef.current(id);
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
    },
  );

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
          paint: { "circle-radius": HIT_RADIUS, "circle-color": "#000000", "circle-opacity": 0.01 },
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
      map.setPaintProperty(LABEL_LAYER, "text-halo-width", 0);
      for (const cluster of current) {
        map.setFeatureState(
          { source: SOURCE, id: featureId(cluster.id) },
          { selected: cluster.id === selectedRef.current },
        );
      }
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
  }, [pinKey, ready, geometryKey, mapRef, libRef]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      role="region"
      aria-label={`${clusters.length} photo ${clusters.length === 1 ? "location" : "locations"}`}
    />
  );
}
