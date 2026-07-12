import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("release build rejects the checked-in sample ranking snapshot", () => {
  const result = spawnSync("npm", ["run", "build"], {
    encoding: "utf8",
    env: { ...process.env, VITE_RELEASE_BUILD: "true" },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /release validation rejects sample snapshots/i);
});
