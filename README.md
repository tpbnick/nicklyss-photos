# NickLyss

A photo journal for the folders in [cdn.nickplatt.dev/Photos](https://cdn.nickplatt.dev/Photos). Each `year/location` folder becomes a page. The home page is a map plus a filterable index.

## Add a trip

1. Put photos in `Photos/<year>/<location>/` on the CDN.
2. Add a markdown file in that folder:

```md
# Title
Blue Ridge Mountains

## Dates
October 8, 2017

## Description
A weekend along the parkway.

## Notes
The overlook was closed, so we walked the ridge instead.
Hours are on the [park site](https://www.nps.gov/blri/).

## Tags
hiking, fall, virginia

## Cover
IMG_0420.jpg
```

`Cover` is the homepage photo. Use the filename from that folder, or a path like `6879/002_0.JPG` when the photo is nested. Without it, the first landscape photo is used.

Optional, when the folder name is not a precise pin:

```md
## Coordinates
37.90, -79.05
```

3. Rebuild the catalog, then the site:

```bash
npm run catalog
npm run dev
```

`npm run catalog` only downloads photos that do not already have a preview. Pass `--force` to rebuild every preview:

```bash
npm run catalog -- --force
```

Pins for new places are geocoded once and saved in `scripts/geocache.json`. Edit that file to move a pin, then rerun the catalog.

## Scripts

- `npm run catalog` reads the CDN and writes `src/data/catalog.json` plus `public/previews/`. Photos with GPS in their EXIF get a map on that place's page.
- `npm run dev` starts the site
- `npm run build` writes a static site to `dist/`

## Publish

The **Update site** workflow rebuilds the catalog from the CDN, then publishes `dist/` to GitHub Pages. It runs only when you start it: Actions → Update site → Run workflow.

In the repository, set Settings → Pages → Build and deployment → Source to **GitHub Actions** before the first run. The site is published at `https://tpbnick.github.io/nicklyss-photos/`. A custom domain configured in Pages is served from the domain root instead.
