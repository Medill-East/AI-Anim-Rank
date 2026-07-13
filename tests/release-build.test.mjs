import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release build accepts the checked-in published ranking snapshot", () => {
  const result = spawnSync("npm", ["run", "build"], {
    encoding: "utf8",
    env: { ...process.env, VITE_RELEASE_BUILD: "true" },
  });

  assert.equal(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Release ranking snapshot is valid: 300 works\./i);
});

test("release workflow names the neutral Worker deployment", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(packageJson.scripts["site:deploy"] ?? "", /vinext deploy --name ai-anim-rank/);
  assert.match(readme, /ai-anim-rank\.play-with-experiences\.workers\.dev/);
});
