import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const clientDirectory = fileURLToPath(new URL("../dist/client", import.meta.url));
const manifestFile = join(clientDirectory, "precache-manifest.js");
const rankingSnapshotFile = fileURLToPath(new URL("../src/data/ranking.json", import.meta.url));

export function isPrecacheableAppShellPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized === "" || normalized.startsWith(".") || normalized.includes("../")) return false;
  if (/(^|\/)(api|recovery|vault|progress|sync-credential)(?:\/|\.|-|$)/i.test(normalized)) return false;
  if (normalized === "sw.js" || normalized === "precache-manifest.js") return false;

  return normalized.startsWith("assets/") || [
    "offline.html",
    "manifest.webmanifest",
    "app-icon-192.png",
    "app-icon-512.png",
  ].includes(normalized);
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  }));
  return files.flat();
}

export async function generatePrecacheManifest(): Promise<void> {
  const files = await listFiles(clientDirectory);
  const assets = files
    .map((file) => relative(clientDirectory, file).replaceAll("\\", "/"))
    .filter(isPrecacheableAppShellPath)
    .map((file) => `/${file}`)
    .sort();
  const publicAssets = ["/", ...assets];
  const snapshot = createHash("sha256").update(await readFile(rankingSnapshotFile)).digest("hex").slice(0, 12);
  const version = createHash("sha256").update(JSON.stringify({ publicAssets, snapshot })).digest("hex").slice(0, 12);
  const source = `self.__AI_ANIM_RANK_PRECACHE__ = ${JSON.stringify({ version, snapshot, assets: publicAssets })};\n`;

  await writeFile(manifestFile, source, "utf8");
}
