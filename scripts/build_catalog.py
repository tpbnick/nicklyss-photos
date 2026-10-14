#!/usr/bin/env python3
"""Build a static catalog from https://cdn.nickplatt.dev/Photos.

Walks <year>/<location>/ folders, reads an optional markdown notes file,
geocodes the place, and writes resized WebP previews plus src/data/catalog.json.
Run it again whenever a folder is added. Existing previews are reused.
"""

from __future__ import annotations

import argparse
import calendar
import hashlib
import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent.parent
CDN = "https://cdn.nickplatt.dev/Photos/"
PREVIEWS = ROOT / "public" / "previews"
CATALOG_PATH = ROOT / "src" / "data" / "catalog.json"
GEOCACHE_PATH = ROOT / "scripts" / "geocache.json"
MANIFEST_PATH = ROOT / "scripts" / "manifest.json"
UA = "nickplatt-photo-journal/1.0 (personal photo journal catalog)"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
MAX_EDGE = 960
QUALITY = 68
WORKERS = 8

# Tuned pins for the folders that exist today. New folders are geocoded and
# then stored in scripts/geocache.json, which you can edit by hand.
OVERRIDES: dict[str, tuple[float, float] | None] = {
    "blue ridge mountains, va": (37.90, -79.05),
    "fredericksburg, va": (38.3032, -77.4605),
    "gettysburg, pa": (39.8309, -77.2311),
    "hollywood, ca": (34.1016, -118.3267),
    "juneau, ak": (58.3019, -134.4197),
    "ketchikan, ak": (55.3422, -131.6461),
    "seattle, wa": (47.6062, -122.3321),
    "skagway, ak": (59.4583, -135.3139),
    "disneyland, ca": (33.8121, -117.9190),
    "laguna, ca": (33.5427, -117.7854),
    "pch & monterey, ca": (36.5552, -121.9233),
    "san francisco, ca": (37.7749, -122.4194),
    "yosemite, ca": (37.7459, -119.5936),
    "new york city, ny": (40.7580, -73.9855),
    "appalachan trail, md": (39.648, -77.492),
    "appalachian trail, md": (39.545, -77.720),
    "random, ca": None,
    "disneyworld, fl": (28.3772, -81.5707),
    "oahu, hi": (21.4389, -158.0001),
    "pennhurst asylum, pa": (40.185, -75.688),
    "philadelphia, pa": (39.9526, -75.1652),
    "germany": (51.1657, 10.4515),
    "grand canyon": (36.0544, -112.1401),
}

MD_PREFERENCE = {"index.md": 0, "notes.md": 1, "place.md": 2, "info.md": 3}


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._cls = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        data = dict(attrs)
        self._href = data.get("href")
        self._cls = data.get("class") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href and self._cls in {"directory", "file"}:
            self.links.append((self._href, self._cls))
            self._href = None
            self._cls = ""


def fetch_bytes(url: str, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = error
            time.sleep(1.2 * (attempt + 1))
    assert last is not None
    raise last


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode("utf-8", "replace")


def list_dir(url: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    if not url.endswith("/"):
        url += "/"
    parser = LinkParser()
    parser.feed(fetch_text(url))
    directories: list[tuple[str, str]] = []
    files: list[tuple[str, str]] = []
    for href, kind in parser.links:
        full = urllib.parse.urljoin(url, href)
        path = urllib.parse.urlparse(full).path
        name = urllib.parse.unquote(path.rstrip("/").split("/")[-1])
        if not name or name in {".", ".."}:
            continue
        if kind == "directory":
            if not full.endswith("/"):
                full += "/"
            directories.append((name, full))
        else:
            files.append((name, full.split("?", 1)[0]))
    return directories, files


def walk(url: str, seen: set[str] | None = None) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    seen = seen or set()
    if url in seen:
        return [], []
    seen.add(url)
    directories, files = list_dir(url)
    images: list[tuple[str, str]] = []
    notes: list[tuple[str, str]] = []
    for name, file_url in files:
        ext = Path(name).suffix.lower()
        if ext in IMAGE_EXTS:
            images.append((name, file_url))
        elif ext == ".md":
            notes.append((name, file_url))
    for _name, dir_url in directories:
        child_images, child_notes = walk(dir_url, seen)
        images.extend(child_images)
        notes.extend(child_notes)
    return images, notes


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value).strip().lower())


def clean_location(folder_name: str) -> str:
    name = html.unescape(folder_name).strip().strip("/")
    return re.sub(r"\s+-\s+20\d{2}$", "", name).strip()


def slugify(year: int, location: str) -> str:
    text = location.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return f"{year}-{text or 'place'}"


def parse_notes(text: str) -> dict[str, object]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        if line.startswith("#"):
            current = line.lstrip("#").strip().lower()
            sections.setdefault(current, [])
            continue
        if current:
            sections[current].append(line)
    body = {key: "\n".join(lines).strip() for key, lines in sections.items()}
    tag_text = body.get("tags", "")
    tags: list[str] = []
    for line in tag_text.splitlines():
        for piece in line.split(","):
            tag = piece.strip().lstrip("#")
            if tag and tag not in tags:
                tags.append(tag)
    cover = ""
    for key in ("cover", "image", "display image", "display"):
        raw = str(body.get(key, "")).strip()
        if raw:
            cover = raw.splitlines()[0].strip().strip("`").strip("\"'")
            break
    return {
        "title": str(body.get("title", "")).strip(),
        "dates": str(body.get("dates", "")).strip(),
        "description": str(body.get("description", "")).strip(),
        "tags": tags,
        "coordinates": parse_coords(str(body.get("coordinates", ""))),
        "cover": cover,
    }


def parse_coords(raw: str) -> tuple[float, float] | None:
    if not raw.strip():
        return None
    numbers = re.findall(r"-?\d+(?:\.\d+)?", raw)
    if len(numbers) < 2:
        return None
    lat, lng = float(numbers[0]), float(numbers[1])
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return lat, lng
    return None


def days_in_names(names: list[str]) -> list[date]:
    found: list[date] = []
    for name in names:
        for year, month, day in re.findall(r"(20\d{2})(\d{2})(\d{2})", name):
            try:
                found.append(date(int(year), int(month), int(day)))
            except ValueError:
                continue
    return found


def format_range(days: list[date]) -> str:
    unique = sorted(set(days))
    if not unique:
        return ""
    if len(unique) == 1:
        only = unique[0]
        return f"{calendar.month_name[only.month]} {only.day}, {only.year}"
    start, end = unique[0], unique[-1]
    if start.year == end.year and start.month == end.month:
        return f"{calendar.month_name[start.month]} {start.day}–{end.day}, {start.year}"
    if start.year == end.year:
        return (
            f"{calendar.month_name[start.month]} {start.day} – "
            f"{calendar.month_name[end.month]} {end.day}, {start.year}"
        )
    return (
        f"{calendar.month_name[start.month]} {start.day}, {start.year} – "
        f"{calendar.month_name[end.month]} {end.day}, {end.year}"
    )


def load_json(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    return json.loads(path.read_text())


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def pick_notes(notes: list[tuple[str, str]]) -> tuple[str, str] | None:
    if not notes:
        return None
    return sorted(notes, key=lambda item: (MD_PREFERENCE.get(item[0].lower(), 10), item[0].lower()))[0]


def geocode(query: str, cache: dict[str, list[float] | None]) -> tuple[float, float] | None:
    key = norm(query)
    if key in cache:
        value = cache[key]
        if value is None:
            return None
        if isinstance(value, (list, tuple)) and len(value) == 2:
            try:
                return (float(value[0]), float(value[1]))
            except (TypeError, ValueError):
                pass
        print(f"  ignoring bad geocache entry for {query}")
    if key in OVERRIDES:
        value = OVERRIDES[key]
        cache[key] = None if value is None else [value[0], value[1]]
        return value
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "limit": 1}
    )
    time.sleep(1.1)
    try:
        payload = json.loads(fetch_text(url))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        print(f"  geocode failed for {query}: {error}")
        return None
    if not payload:
        print(f"  geocode missed {query}")
        cache[key] = None
        return None
    lat, lng = float(payload[0]["lat"]), float(payload[0]["lon"])
    cache[key] = [lat, lng]
    print(f"  geocoded {query} -> {lat:.4f}, {lng:.4f}")
    return lat, lng


def make_preview(data: bytes, dest: Path) -> tuple[int, int]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image) or image
        width, height = image.size
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGB")
        image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
        image.save(dest, "WEBP", quality=QUALITY, method=4)
        return width, height


def matches_cover(photo: dict[str, object], requested: str) -> bool:
    wanted = requested.replace("\\", "/").strip().lstrip("./")
    if not wanted:
        return False
    path = urllib.parse.unquote(urllib.parse.urlparse(str(photo["src"])).path)
    return path.casefold().endswith("/" + wanted.casefold())


def choose_cover(photos: list[dict[str, object]], requested: str = "", warn: bool = False, label: str = "") -> str | None:
    if not photos:
        return None
    if requested:
        for photo in photos:
            if matches_cover(photo, requested):
                return str(photo["preview"])
        if warn:
            print(f"  cover not found for {label}: {requested}")
    for photo in photos:
        width = int(photo["width"])
        height = int(photo["height"])
        if width >= height:
            return str(photo["preview"])
    return str(photos[0]["preview"])


def public_catalog(places: list[dict[str, object]], warn: bool = False) -> dict[str, object]:
    published = []
    for place in places:
        photos = sorted(place["photos"], key=lambda photo: str(photo["name"]).casefold())
        title = str(place["title"])
        published.append(
            {
                "slug": place["slug"],
                "year": place["year"],
                "location": place["location"],
                "folder": place["folder"],
                "title": title,
                "dates": place["dates"],
                "description": place["description"],
                "tags": place["tags"],
                "lat": place["lat"],
                "lng": place["lng"],
                "cover": choose_cover(photos, str(place.get("coverName") or ""), warn, title),
                "photos": [
                    {
                        "src": photo["src"],
                        "preview": photo["preview"],
                        "width": photo["width"],
                        "height": photo["height"],
                        "alt": f"{title} — {index}",
                    }
                    for index, photo in enumerate(photos, start=1)
                ],
            }
        )
    published.sort(key=lambda place: (-int(place["year"]), str(place["title"]).casefold()))
    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "places": published,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the photo journal catalog from the CDN.")
    parser.add_argument("--force", action="store_true", help="Regenerate every preview")
    args = parser.parse_args()

    Image.MAX_IMAGE_PIXELS = 250_000_000
    print(f"Reading {CDN}")
    year_dirs, _files = list_dir(CDN)
    places: list[dict[str, object]] = []
    jobs: list[tuple[str, str, int]] = []
    cache = load_json(GEOCACHE_PATH, {})
    manifest = load_json(MANIFEST_PATH, {})
    if not isinstance(cache, dict) or not isinstance(manifest, dict):
        raise SystemExit("geocache.json or manifest.json is not a JSON object")

    for year_name, year_url in year_dirs:
        if not re.fullmatch(r"20\d{2}", year_name):
            continue
        year = int(year_name)
        locations, _extra = list_dir(year_url)
        for folder_name, folder_url in locations:
            location = clean_location(folder_name)
            images, notes = walk(folder_url)
            images.sort(key=lambda item: item[0].casefold())
            chosen = pick_notes(notes)
            parsed = {
                "title": "",
                "dates": "",
                "description": "",
                "tags": [],
                "coordinates": None,
            }
            if chosen:
                if len(notes) > 1:
                    print(f"  {year}/{location}: using {chosen[0]} ({len(notes)} markdown files)")
                parsed = parse_notes(fetch_text(chosen[1]))
            else:
                print(f"  {year}/{location}: no markdown yet")

            title = str(parsed["title"]) or location
            dates = str(parsed["dates"]) or format_range(days_in_names([name for name, _url in images])) or str(year)
            coords = parsed["coordinates"]
            if coords is None:
                coords = geocode(location, cache)
            lat, lng = (None, None) if coords is None else coords
            place_index = len(places)
            slug = slugify(year, location)
            taken = {str(place["slug"]) for place in places}
            if slug in taken:
                suffix = 2
                while f"{slug}-{suffix}" in taken:
                    suffix += 1
                print(f"  duplicate slug {slug}, using {slug}-{suffix}")
                slug = f"{slug}-{suffix}"
            places.append(
                {
                    "slug": slug,
                    "year": year,
                    "location": location,
                    "folder": f"{year}/{folder_name}",
                    "title": title,
                    "dates": dates,
                    "description": parsed["description"],
                    "tags": parsed["tags"],
                    "coverName": parsed.get("cover", ""),
                    "lat": lat,
                    "lng": lng,
                    "photos": [],
                }
            )
            for name, image_url in images:
                digest = hashlib.sha1(image_url.encode()).hexdigest()[:20]
                preview = f"/previews/{slug}/{digest}.webp"
                jobs.append((image_url, preview, place_index))
            print(f"  {year}  {location}  {len(images)} photos")

    write_json(GEOCACHE_PATH, cache)
    print(f"{len(places)} places, {len(jobs)} photos")

    lock = threading.Lock()
    done = 0
    failed: list[str] = []

    def persist_progress() -> None:
        write_json(MANIFEST_PATH, manifest)

    def work(job: tuple[str, str, int]) -> None:
        nonlocal done
        image_url, preview, place_index = job
        dest = ROOT / "public" / preview.lstrip("/")
        record = manifest.get(image_url)
        if (
            not args.force
            and isinstance(record, dict)
            and record.get("preview") == preview
            and type(record.get("width")) is int
            and type(record.get("height")) is int
            and dest.exists()
        ):
            width, height = record["width"], record["height"]
        else:
            try:
                width, height = make_preview(fetch_bytes(image_url), dest)
            except (urllib.error.URLError, TimeoutError, UnidentifiedImageError, OSError) as error:
                with lock:
                    failed.append(f"{image_url} ({error})")
                    done += 1
                print(f"  skip {image_url}: {error}")
                return
            record = {"preview": preview, "width": width, "height": height}
        name = urllib.parse.unquote(urllib.parse.urlparse(image_url).path.rsplit("/", 1)[-1])
        with lock:
            manifest[image_url] = record
            photos = places[place_index]["photos"]
            assert isinstance(photos, list)
            photos.append(
                {
                    "name": name,
                    "src": image_url,
                    "preview": preview,
                    "width": width,
                    "height": height,
                }
            )
            done += 1
            if done % 10 == 0 or done == len(jobs):
                persist_progress()
                print(f"previews {done}/{len(jobs)}", flush=True)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(work, job) for job in jobs]
        for future in as_completed(futures):
            future.result()

    stale = [key for key in manifest if key not in {image_url for image_url, _preview, _index in jobs}]
    for key in stale:
        del manifest[key]
    if stale:
        print(f"Dropped {len(stale)} stale manifest entries")
    persist_progress()
    keep = {
        ROOT / "public" / str(photo["preview"]).lstrip("/")
        for place in places
        for photo in place["photos"]
    }
    if PREVIEWS.exists():
        for path in PREVIEWS.rglob("*"):
            if path.is_file() and path.suffix == ".webp" and path not in keep:
                path.unlink()
        for path in sorted(PREVIEWS.rglob("*"), reverse=True):
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()

    catalog = public_catalog(places, warn=True)
    write_json(CATALOG_PATH, catalog)
    photo_count = sum(len(place["photos"]) for place in catalog["places"])
    print(f"Wrote {CATALOG_PATH} ({len(catalog['places'])} places, {photo_count} photos)")
    if failed:
        print(f"{len(failed)} photos could not be previewed")
        for line in failed:
            print(f"  {line}")


if __name__ == "__main__":
    main()
