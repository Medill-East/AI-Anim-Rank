import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCandidates,
  buildReleaseSnapshot,
  buildReleaseSnapshotFromSources,
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

function releaseCandidates() {
  return Array.from({ length: 300 }, (_, index) => {
    const id = index + 1;
    return buildCandidates([
      { ...anilist, id, idMal: 10_000 + id, title: { romaji: `Example ${id}`, native: `例 ${id}` } },
    ], [
      { ...jikan, mal_id: 10_000 + id, title: `Example ${id}` },
    ], [
      { malId: 10_000 + id, bangumiId: 20_000 + id, titleZh: `例 ${id}`, score: 9, votes: 300 },
    ]);
  }).flat();
}

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

test("release recomputes eligibility instead of trusting a tampered candidate review", () => {
  const candidates = releaseCandidates();
  const first = candidates[0]!;
  first.bangumi!.votes = 1;
  first.eligible = true;
  first.compositeScore = 100;

  assert.throws(() => buildReleaseSnapshot(candidates, "2026-07-12"), /exactly 300/i);
});

test("release rejects duplicate MAL or Bangumi IDs across 300 candidates", () => {
  const duplicateMal = releaseCandidates();
  duplicateMal[299]!.anilist.idMal = duplicateMal[0]!.anilist.idMal;
  duplicateMal[299]!.mal!.mal_id = duplicateMal[0]!.mal!.mal_id;
  duplicateMal[299]!.bangumi!.malId = duplicateMal[0]!.bangumi!.malId;
  assert.throws(() => buildReleaseSnapshot(duplicateMal, "2026-07-12"), /duplicate AniList idMal|duplicate Jikan MAL id/i);

  const duplicateBangumi = releaseCandidates();
  duplicateBangumi[299]!.bangumi!.bangumiId = duplicateBangumi[0]!.bangumi!.bangumiId;
  assert.throws(() => buildReleaseSnapshot(duplicateBangumi, "2026-07-12"), /duplicate mapping Bangumi id/i);
});

test("release rejects non-positive external IDs", () => {
  const invalid = releaseCandidates();
  invalid[0]!.bangumi!.bangumiId = 0;
  assert.throws(() => buildReleaseSnapshot(invalid, "2026-07-12"), /Bangumi id must be a positive integer/i);
});

test("release accepts exactly 300 raw candidates and recalculates their composite", () => {
  const snapshot = buildReleaseSnapshot(releaseCandidates(), "2026-07-12");
  assert.equal(snapshot.works.length, 300);
  assert.equal(snapshot.works[0]?.compositeScore, 85);
});

test("source-based release ignores tampered candidate-review source objects", () => {
  const verified = releaseCandidates();
  const anilistCapture = verified.map((candidate) => candidate.anilist);
  const jikanCapture = verified.map((candidate) => candidate.mal!);
  const mappings = verified.map((candidate) => candidate.bangumi!);
  const tamperedReview = structuredClone(verified);
  for (const candidate of tamperedReview) {
    candidate.anilist.averageScore = 100;
    candidate.mal!.score = 10;
    candidate.bangumi!.score = 10;
    candidate.bangumi!.votes = 1_000_000;
    candidate.eligible = true;
    candidate.compositeScore = 100;
  }

  const snapshot = buildReleaseSnapshotFromSources(anilistCapture, jikanCapture, mappings, "2026-07-12");
  assert.equal(snapshot.works[0]?.compositeScore, 85);
  assert.equal(tamperedReview[0]?.compositeScore, 100);
});
