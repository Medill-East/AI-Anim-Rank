import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCandidates,
  buildReleaseSnapshot,
  calculateCompositeScore,
  normalizeSourceScore,
  selectBangumiMapping,
} from "../scripts/ranking-pipeline.ts";

const anilist = {
  id: 1,
  idMal: 101,
  title: { romaji: "Example", native: "例" },
  averageScore: 80,
  favourites: 1,
  popularity: 5_000,
  episodes: 12,
  seasonYear: 2024,
  studios: { nodes: [{ name: "Studio" }] },
  genres: ["Drama"],
};

const jikan = { mal_id: 101, title: "Example", score: 8.5, scored_by: 3_000, members: 100_000 };

test("maps Bangumi by AniList idMal before an explicit mapping", () => {
  const mapping = selectBangumiMapping(anilist, [
    { anilistId: 1, bangumiId: 200, titleZh: "显式映射", score: 9, votes: 300 },
    { malId: 101, bangumiId: 100, titleZh: "MAL 映射", score: 8.8, votes: 400 },
  ]);

  assert.equal(mapping?.bangumiId, 100);
});

test("rejects duplicate external identities during candidate construction", () => {
  assert.throws(
    () => buildCandidates([anilist, { ...anilist, id: 2 }], [jikan], []),
    /duplicate AniList idMal/i,
  );
});

test("normalizes source scores and calculates a transparent composite", () => {
  assert.equal(normalizeSourceScore("anilist", 80), 80);
  assert.equal(normalizeSourceScore("mal", 8.5), 85);
  assert.equal(normalizeSourceScore("bangumi", 9), 90);
  assert.equal(calculateCompositeScore({ anilist: 80, mal: 85, bangumi: 90 }), 85);
});

test("does not score candidates below a source minimum-vote threshold", () => {
  const [candidate] = buildCandidates([anilist], [jikan], [
    { malId: 101, bangumiId: 100, titleZh: "例", score: 9, votes: 10 },
  ]);

  assert.equal(candidate.eligible, false);
  assert.match(candidate.ineligibilityReasons.join(" "), /Bangumi votes/i);
});

test("refuses a release unless exactly 300 fully mapped eligible works validate", () => {
  const [candidate] = buildCandidates([anilist], [jikan], [
    { malId: 101, bangumiId: 100, titleZh: "例", score: 9, votes: 300 },
  ]);

  assert.throws(() => buildReleaseSnapshot([candidate], "2026-07-12"), /exactly 300/i);
});
