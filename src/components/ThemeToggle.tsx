import { MoonIcon, SunIcon } from "./Icons";

export default function ThemeToggle() {
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Toggle color theme"
      onClick={() => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("theme", next);
        } catch {
          // Private browsing can reject storage; the toggle still applies for this view.
        }
      }}
    >
      <SunIcon className="icon-sun" />
      <MoonIcon className="icon-moon" />
    </button>
  );
}
