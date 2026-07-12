import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isPrecacheableAppShellPath } from "../scripts/generate-precache-manifest.ts";

test("precache manifest includes the emitted ranking UI assets without guessing hashed filenames", async () => {
  const manifestSource = await readFile(new URL("../dist/client/precache-manifest.js", import.meta.url), "utf8");

  assert.match(manifestSource, /"\/"/);
  assert.match(manifestSource, /"snapshot":"[a-f0-9]{12}"/);
  assert.match(manifestSource, /\/assets\/RankingWorkspace-[A-Za-z0-9_-]+\.js/);
});

test("precache manifest excludes credential and private-data paths", () => {
  assert.equal(isPrecacheableAppShellPath("assets/index-abc.js"), true);
  for (const privatePath of ["api/vaults/id", "recovery-phrase.txt", "progress-export.json", "sync-credential.json"]) {
    assert.equal(isPrecacheableAppShellPath(privatePath), false, privatePath);
  }
});
