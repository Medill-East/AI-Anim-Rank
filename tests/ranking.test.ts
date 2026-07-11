import assert from "node:assert/strict";
import test from "node:test";

import { parseRankingSnapshot } from "../src/data/schema.ts";

const validSnapshot = {
  version: "1.0.0",
  methodologyVersion: "1.0.0",
  sample: true,
  works: [
    {
      workId: "anime-1",
      rank: 1,
      titleZh: "示例作品",
      titleOriginal: "Example Work",
      year: 2026,
      studios: ["Example Studio"],
      genres: ["Original"],
      compositeScore: 80,
      sourceScores: {
        anilist: { score: 80, votes: 100 },
        mal: { score: 8, votes: 200 },
        bangumi: { score: 8, votes: 300 },
      },
    },
  ],
};

test("parses a versioned ranking snapshot", () => {
  const snapshot = parseRankingSnapshot(validSnapshot);

  assert.equal(snapshot.works[0]?.workId, "anime-1");
});

test("rejects duplicate work IDs", () => {
  const duplicateWorkIds = {
    ...validSnapshot,
    works: [...validSnapshot.works, { ...validSnapshot.works[0], rank: 2 }],
  };

  assert.throws(() => parseRankingSnapshot(duplicateWorkIds), /duplicate workId/i);
});

test("rejects duplicate ranks", () => {
  const duplicateRanks = {
    ...validSnapshot,
    works: [
      ...validSnapshot.works,
      { ...validSnapshot.works[0], workId: "anime-2" },
    ],
  };

  assert.throws(() => parseRankingSnapshot(duplicateRanks), /duplicate rank/i);
});
