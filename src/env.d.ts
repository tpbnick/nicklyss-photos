/// <reference types="astro/client" />

declare module "node:child_process" {
  export function execSync(
    command: string,
    options?: {
      cwd?: string;
      encoding: "utf8";
      stdio?: Array<"ignore" | "pipe">;
    },
  ): string;
}

declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
}
