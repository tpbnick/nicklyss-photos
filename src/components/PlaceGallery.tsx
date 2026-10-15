import { useMemo, useState } from "react";
import type { Photo } from "../lib/types";
import PhotoAlbum from "./PhotoAlbum";
import PhotoMap from "./PhotoMap";

const CLUSTER_METERS = 200;

export type PhotoCluster = {
  id: string;
  lat: number;
  lng: number;
  photos: Photo[];
};

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const earth = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function clusterPhotos(photos: Photo[]): PhotoCluster[] {
  const located = photos.flatMap((photo, index) =>
    photo.lat != null && photo.lng != null ? [{ photo, index, lat: photo.lat, lng: photo.lng }] : [],
  );

  type Group = { lat: number; lng: number; items: typeof located };
  const groups: Group[] = [];

  for (const item of located) {
    let nearest: Group | null = null;
    let nearestMeters = CLUSTER_METERS;
    for (const group of groups) {
      const meters = metersBetween(item, group);
      if (meters <= nearestMeters) {
        nearest = group;
        nearestMeters = meters;
      }
    }
    if (!nearest) {
      groups.push({ lat: item.lat, lng: item.lng, items: [item] });
      continue;
    }
    nearest.items.push(item);
    nearest.lat = nearest.items.reduce((sum, entry) => sum + entry.lat, 0) / nearest.items.length;
    nearest.lng = nearest.items.reduce((sum, entry) => sum + entry.lng, 0) / nearest.items.length;
  }

  return groups.map((group) => {
    const photosInGroup = group.items.sort((a, b) => a.index - b.index).map((entry) => entry.photo);
    return {
      id: photosInGroup[0].src,
      lat: group.lat,
      lng: group.lng,
      photos: photosInGroup,
    };
  });
}

type Props = {
  photos: Photo[];
};

export default function PlaceGallery({ photos }: Props) {
  const clusters = useMemo(() => clusterPhotos(photos), [photos]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = clusters.find((cluster) => cluster.id === selectedId) ?? null;
  const visible = selected?.photos ?? photos;

  return (
    <>
      {clusters.length > 0 && (
        <div className="place-map">
          <PhotoMap
            clusters={clusters.map((cluster) => ({
              id: cluster.id,
              lat: cluster.lat,
              lng: cluster.lng,
              count: cluster.photos.length,
            }))}
            selectedId={selected?.id ?? null}
            onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
          />
        </div>
      )}
      {selected && (
        <div className="place-filter">
          <p>
            {selected.photos.length} {selected.photos.length === 1 ? "photo" : "photos"} at this spot
          </p>
          <button type="button" className="text-button" onClick={() => setSelectedId(null)}>
            Show all photos
          </button>
        </div>
      )}
      {visible.length > 0 && <PhotoAlbum photos={visible} />}
    </>
  );
}
