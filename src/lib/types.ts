export type Photo = {
  src: string;
  preview: string;
  width: number;
  height: number;
  alt: string;
};

export type Place = {
  slug: string;
  year: number;
  location: string;
  folder: string;
  title: string;
  dates: string;
  description: string;
  tags: string[];
  lat: number | null;
  lng: number | null;
  cover: string | null;
  photos: Photo[];
};

export type Catalog = {
  generatedAt: string;
  places: Place[];
};

export type PlaceSummary = Omit<Place, "photos"> & {
  photoCount: number;
};
