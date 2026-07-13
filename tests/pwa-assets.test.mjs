import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

test("PWA manifest identifies AnimeRank as a standalone app with branded PNG icons", async () => {
  const manifest = JSON.parse(await readFile(publicFile("manifest.webmanifest"), "utf8"));
  const [offlinePage, icon] = await Promise.all([
    readFile(publicFile("offline.html"), "utf8"),
    readFile(publicFile("app-icon.svg"), "utf8"),
  ]);

  assert.equal(manifest.name, "AnimeRank");
  assert.equal(manifest.short_name, "AnimeRank");
  assert.match(offlinePage, /AnimeRank/);
  assert.match(icon, /aria-label="AnimeRank"/);
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })),
    [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  );

  for (const icon of manifest.icons) {
    const file = await readFile(publicFile(icon.src.slice(1)));
    assert.deepEqual([...file.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(file.length > 1000, `${icon.src} must be a non-trivial branded image`);
  }
});

test("offline worker uses the generated public app-shell manifest without caching private data", async () => {
  const [worker, precache] = await Promise.all([
    readFile(publicFile("sw.js"), "utf8"),
    readFile(new URL("../dist/client/precache-manifest.js", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /precache-manifest\.js/);
  assert.match(worker, /caches\.match\("\/"\)/);
  assert.match(worker, /await self\.skipWaiting\(\)/);
  assert.match(worker, /await self\.clients\.claim\(\)/);
  assert.match(precache, /offline\.html/);
  assert.match(precache, /manifest\.webmanifest/);
  assert.match(precache, /assets\/RankingWorkspace-[A-Za-z0-9_-]+\.js/);
  assert.doesNotMatch(precache, /recovery|vault|progress|credential/i);
  assert.doesNotMatch(worker, /recovery|vault|progress|runtime cache/i);
});
