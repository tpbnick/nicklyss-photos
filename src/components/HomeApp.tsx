import { useEffect, useMemo, useState } from "react";
import { readFilters, sameList } from "../lib/filters";
import { sitePath } from "../lib/url";
import type { PlaceSummary } from "../lib/types";
import { JournalMap } from "./JournalMap";
import { SearchIcon } from "./Icons";
import ThemeToggle from "./ThemeToggle";

type Props = {
  places: PlaceSummary[];
  initialQuery: string;
  initialYears: number[];
  initialTags: string[];
};

function searchText(place: PlaceSummary) {
  return [place.title, place.location, place.description, place.dates, String(place.year), ...place.tags]
    .join(" ")
    .toLowerCase();
}

function matchesText(text: string, words: string[]) {
  return words.every((word) => text.includes(word));
}

function toggleValue<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function HomeApp({ places, initialQuery, initialYears, initialTags }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [years, setYears] = useState(initialYears);
  const [tags, setTags] = useState(initialTags);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const apply = () => {
      const next = readFilters(new URLSearchParams(window.location.search));
      setQuery((current) => (current === next.query ? current : next.query));
      setYears((current) => (sameList(current, next.years) ? current : next.years));
      setTags((current) => (sameList(current, next.tags) ? current : next.tags));
    };
    apply();
    setSynced(true);
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.isContentEditable || target.closest("input, textarea, select, dialog")) return;
      event.preventDefault();
      document.getElementById("place-search")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!synced) return;
    const root = document.documentElement;
    root.dataset.filtersReady = "1";
    root.classList.remove("filters-pending");
    const url = new URL(window.location.href);
    const trimmedQuery = query.trim();
    if (trimmedQuery) url.searchParams.set("q", trimmedQuery);
    else url.searchParams.delete("q");
    if (years.length) url.searchParams.set("year", years.join(","));
    else url.searchParams.delete("year");
    if (tags.length) url.searchParams.set("tag", tags.join(","));
    else url.searchParams.delete("tag");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) history.replaceState(null, "", next);
  }, [query, years, tags, synced]);

  const indexed = useMemo(() => places.map((place) => ({ place, text: searchText(place) })), [places]);
  const words = useMemo(() => query.toLowerCase().trim().split(/\s+/).filter(Boolean), [query]);

  const filtered = useMemo(
    () =>
      indexed
        .filter(
          ({ place, text }) =>
            matchesText(text, words) &&
            (years.length === 0 || years.includes(place.year)) &&
            (tags.length === 0 || place.tags.some((tag) => tags.includes(tag))),
        )
        .map(({ place }) => place),
    [indexed, words, years, tags],
  );

  const yearChoices = useMemo(() => {
    const counts = new Map<number, number>();
    for (const { place, text } of indexed) {
      if (!matchesText(text, words)) continue;
      if (tags.length && !place.tags.some((tag) => tags.includes(tag))) continue;
      counts.set(place.year, (counts.get(place.year) ?? 0) + 1);
    }
    const yearsSeen = new Set<number>();
    for (const { place } of indexed) yearsSeen.add(place.year);
    return [...yearsSeen].sort((a, b) => b - a).map((year) => ({ year, count: counts.get(year) ?? 0 }));
  }, [indexed, words, tags]);

  const tagChoices = useMemo(() => {
    const counts = new Map<string, number>();
    const names = new Set<string>();
    for (const { place, text } of indexed) {
      for (const tag of place.tags) names.add(tag);
      if (!matchesText(text, words)) continue;
      if (years.length && !years.includes(place.year)) continue;
      for (const tag of place.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...names]
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
      .map((tag) => ({ tag, count: counts.get(tag) ?? 0 }));
  }, [indexed, words, years]);

  const filtersActive = query.trim().length > 0 || years.length > 0 || tags.length > 0;
  const yearPool = yearChoices.reduce((sum, item) => sum + item.count, 0);

  function clearFilters() {
    setQuery("");
    setYears([]);
    setTags([]);
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href={sitePath("/")}>
          <h1 className="brand-mark">NickLyss</h1>
          <span className="brand-sub">Photo journal</span>
        </a>
        <div className="header-actions">
          <nav aria-label="Site">
            <a className="nav-link" href="#about" data-about>
              About
            </a>
          </nav>
          <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
            <SearchIcon className="search-icon" />
            <input
              id="place-search"
              type="search"
              placeholder="Search places"
              aria-label="Search places"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </form>
          <ThemeToggle />
        </div>
      </header>

      <main id="content">
      <div className="map-frame">
        {synced && <JournalMap places={filtered} />}
      </div>

      <div className="explorer">
        <div>
          <div className="results-row">
            <p aria-live="polite" aria-atomic="true">
              {filtered.length} {filtered.length === 1 ? "place" : "places"}
            </p>
            {filtersActive && (
              <button type="button" className="text-button" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="empty">
              <p>Nothing in the journal matches that.</p>
              <button type="button" className="text-button" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="cards">
              {filtered.map((place, index) => (
                <article className="card" key={place.slug}>
                  <a className="card-link" href={sitePath(`/places/${place.slug}`)}>
                    <div className="card-media">
                      {place.cover && (
                        <img
                          src={sitePath(place.cover)}
                          alt=""
                          loading={index < 3 ? "eager" : "lazy"}
                          decoding="async"
                          fetchPriority={index === 0 ? "high" : "auto"}
                        />
                      )}
                      <span className="count-badge" aria-hidden="true">{place.photoCount}</span>
                    </div>
                    <div className="card-copy">
                      <h2>{place.title}</h2>
                      <p className="meta">
                        {place.dates}
                        {place.dates.includes(String(place.year)) ? "" : ` · ${place.year}`}
                      </p>
                    </div>
                  </a>
                  {place.tags.length > 0 && (
                    <div className="tag-row">
                      {place.tags.map((tag) => (
                        <button
                          type="button"
                          className={tags.includes(tag) ? "tag is-on" : "tag"}
                          key={tag}
                          aria-pressed={tags.includes(tag)}
                          onClick={() => setTags((current) => toggleValue(current, tag))}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                  {place.description && <p className="card-desc">{place.description}</p>}
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="filters" aria-label="Filter places">
          <div className="filter-block">
            <div className="filter-head">
              <h2>Years</h2>
            </div>
            <div className="chip-list">
              <button
                type="button"
                className={years.length === 0 ? "chip is-on" : "chip"}
                aria-pressed={years.length === 0}
                onClick={() => setYears([])}
              >
                <span>All</span>
                <span className="chip-count">{yearPool}</span>
              </button>
              {yearChoices.map(({ year, count }) => (
                <button
                  type="button"
                  key={year}
                  className={years.includes(year) ? "chip is-on" : "chip"}
                  aria-pressed={years.includes(year)}
                  disabled={count === 0 && !years.includes(year)}
                  onClick={() => setYears((current) => toggleValue(current, year))}
                >
                  <span>{year}</span>
                  <span className="chip-count">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <div className="filter-head">
              <h2>Tags</h2>
            </div>
            {tagChoices.length === 0 ? (
              <p className="filter-empty">Tags show up once a place has them in its notes.</p>
            ) : (
              <div className="chip-list">
                {tagChoices.map(({ tag, count }) => (
                  <button
                    type="button"
                    key={tag}
                    className={tags.includes(tag) ? "chip is-on" : "chip"}
                    aria-pressed={tags.includes(tag)}
                    disabled={count === 0 && !tags.includes(tag)}
                    onClick={() => setTags((current) => toggleValue(current, tag))}
                  >
                    <span>{tag}</span>
                    <span className="chip-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
      </main>
    </>
  );
}
