import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("release build accepts the checked-in published ranking snapshot", () => {
  const result = spawnSync("npm", ["run", "build"], {
    encoding: "utf8",
    env: { ...process.env, VITE_RELEASE_BUILD: "true" },
  });

  assert.equal(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Release ranking snapshot is valid: 300 works\./i);
});
