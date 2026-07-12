import { spawnSync } from "node:child_process";

import { generatePrecacheManifest } from "./generate-precache-manifest.ts";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.VITE_RELEASE_BUILD === "true") {
  run(process.execPath, ["--experimental-strip-types", "scripts/validate-ranking.ts", "--release"]);
}

run("vinext", ["build"]);
await generatePrecacheManifest();
