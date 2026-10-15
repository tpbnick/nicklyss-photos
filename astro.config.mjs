import { defineConfig } from "astro/config";
import react from "@astrojs/react";

const site = process.env.SITE_URL?.trim().replace(/\/$/, "");
const base = process.env.BASE_PATH?.trim().replace(/\/$/, "");

export default defineConfig({
  ...(site ? { site } : {}),
  ...(base ? { base } : {}),
  integrations: [react()],
  vite: {
    optimizeDeps: {
      exclude: ["maplibre-gl"],
    },
  },
});
