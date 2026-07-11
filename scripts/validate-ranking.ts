import { readFile } from "node:fs/promises";

import { parseRankingSnapshot, releaseWorkCount } from "../src/data/ranking.ts";

const release = process.argv.includes("--release");
const rankingFile = new URL("../src/data/ranking.json", import.meta.url);

async function main() {
  const raw = JSON.parse(await readFile(rankingFile, "utf8")) as unknown;
  const snapshot = parseRankingSnapshot(raw);

  if (release) {
    if (snapshot.sample) {
      throw new Error("release validation rejects sample snapshots");
    }
    if (snapshot.works.length !== releaseWorkCount) {
      throw new Error(`release validation requires exactly ${releaseWorkCount} works`);
    }

    console.log(`Release ranking snapshot is valid: ${snapshot.works.length} works.`);
    return;
  }

  if (snapshot.sample) {
    console.log(`Development fixture is valid: ${snapshot.works.length} works (sample: true).`);
    return;
  }

  console.log(`Ranking snapshot is valid: ${snapshot.works.length} works.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
