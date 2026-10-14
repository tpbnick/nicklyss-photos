import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoUrl = "https://github.com/tpbnick/nicklyss-photos";

const root = fileURLToPath(new URL("../../", import.meta.url));

function git(args: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const [commitHash = "", commitDate = ""] = git("log -1 --format=%H%x09%cI").split("\t");
export { commitHash };
export const commitShort = commitHash.slice(0, 7);
export const commitUrl = commitHash ? `${repoUrl}/commit/${commitHash}` : repoUrl;

function timestamp(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function latestUpdate(catalogGeneratedAt: string) {
  return [commitDate, catalogGeneratedAt]
    .filter((value) => timestamp(value) != null)
    .sort((a, b) => (timestamp(a) ?? 0) - (timestamp(b) ?? 0))
    .at(-1) ?? "";
}
