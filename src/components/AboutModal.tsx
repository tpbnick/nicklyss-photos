import { useEffect, useId, useRef, useState } from "react";

type Props = {
  updated: string;
  commit: string;
  commitUrl: string;
  repoUrl: string;
};

function formatUpdated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function repoLabel(url: string) {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return url;
  }
}

export default function AboutModal({ updated, commit, commitUrl, repoUrl }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const openFromHash = () => setOpen(window.location.hash === "#about");
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const node = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
      const trigger = node?.closest("[data-about]");
      if (!trigger) return;
      event.preventDefault();
      const next = `${window.location.pathname}${window.location.search}#about`;
      history.replaceState(null, "", next);
      setOpen(true);
    };
    openFromHash();
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", openFromHash);
    window.addEventListener("hashchange", openFromHash);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", openFromHash);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, []);

  function close() {
    if (window.location.hash === "#about") {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    setOpen(false);
  }

  return (
    <dialog
      ref={dialogRef}
      className="about-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <button type="button" className="about-close" aria-label="Close" onClick={close}>
        ×
      </button>
      <p className="eyebrow">Photo journal</p>
      <h2 id={titleId}>About</h2>
      <div className="about-copy">
        <p>
          NickLyss is a photo journal for Nick and Alyssa's trips. The photos are a mixture of 35mm film, mirrorless
          (Fuji X-T30 III), and cell phone shots. The interactive map allows you to click and open a location's images
          directly.
        </p>
        <p>
          The map is the photo journal's index. Filter by year or tag. Search for a location tag, year, or text in a
          page's description.
        </p>
      </div>
      <dl className="about-meta">
        <div>
          <dt>Updated</dt>
          <dd>{updated ? formatUpdated(updated) : "—"}</dd>
        </div>
        <div>
          <dt>Repository</dt>
          <dd>
            <a href={repoUrl}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                />
              </svg>
              {repoLabel(repoUrl)}
            </a>
          </dd>
        </div>
        <div>
          <dt>Latest commit</dt>
          <dd>{commit ? <a href={commitUrl}>{commit}</a> : "—"}</dd>
        </div>
      </dl>
    </dialog>
  );
}
