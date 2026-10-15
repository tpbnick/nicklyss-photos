import { useEffect, useRef, useState } from "react";
import { RowsPhotoAlbum } from "react-photo-album";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import type { Photo as JournalPhoto } from "../lib/types";
import { sitePath } from "../lib/url";
import "react-photo-album/rows.css";
import "photoswipe/style.css";
import "../styles/photoswipe.css";

type Props = {
  photos: JournalPhoto[];
};

export default function PhotoAlbum({ photos }: Props) {
  const lightboxRef = useRef<PhotoSwipeLightbox | null>(null);
  const thumbs = useRef(new Map<number, HTMLImageElement>());
  const [rowHeight, setRowHeight] = useState(240);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const update = () => setRowHeight(query.matches ? 168 : 240);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const lightbox = new PhotoSwipeLightbox({
      dataSource: photos.map((photo) => ({
        src: photo.src,
        msrc: sitePath(photo.preview),
        width: photo.width,
        height: photo.height,
        alt: photo.alt,
      })),
      pswpModule: () => import("photoswipe"),
      bgOpacity: 1,
      showHideAnimationType: "zoom",
      padding: { top: 28, bottom: 28, left: 16, right: 16 },
      wheelToZoom: true,
      closeOnVerticalDrag: true,
      imageClickAction: "zoom",
      tapAction: "toggle-controls",
      loop: photos.length > 2,
      preload: [1, 1],
    });

    lightbox.addFilter("thumbEl", (_thumbnail, _item, index) => {
      return thumbs.current.get(index) ?? document.createElement("span");
    });

    lightbox.init();
    lightboxRef.current = lightbox;
    return () => {
      lightbox.destroy();
      lightboxRef.current = null;
      thumbs.current.clear();
    };
  }, [photos]);

  return (
    <div className="place-album">
      <RowsPhotoAlbum
        photos={photos.map((photo) => ({
          src: sitePath(photo.preview),
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
          label: photo.alt,
          key: photo.src,
        }))}
        targetRowHeight={rowHeight}
        spacing={8}
        defaultContainerWidth={1200}
        sizes={{ size: "min(1240px, calc(100vw - 40px))" }}
        onClick={({ index, event }) => {
          event.preventDefault();
          lightboxRef.current?.loadAndOpen(index);
        }}
        render={{
          image: (props, { index, photo }) => (
            <img
              {...props}
              alt={photo.alt ?? ""}
              ref={(node) => {
                if (node) thumbs.current.set(index, node);
                else thumbs.current.delete(index);
              }}
            />
          ),
        }}
      />
    </div>
  );
}
