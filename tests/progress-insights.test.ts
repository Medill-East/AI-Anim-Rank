import assert from "node:assert/strict";
import test from "node:test";

import type { RankedWork } from "../src/data/schema.ts";
import type { ProgressRecord } from "../src/domain/progress.ts";
import { deriveProgressInsights } from "../src/features/ranking/insights.ts";

const works: RankedWork[] = [
  { workId: "one", rank: 1, titleZh: "作品一", titleOriginal: "One", year: 2024, studios: ["Studio A"], genres: ["Drama", "Fantasy"], compositeScore: 90, sourceScores: { anilist: { score: 90, votes: 10 }, mal: { score: 9, votes: 10 }, bangumi: { score: 9, votes: 10 } } },
  { workId: "two", rank: 2, titleZh: "作品二", titleOriginal: "Two", year: 2023, studios: ["Studio A"], genres: ["Drama"], compositeScore: 89, sourceScores: { anilist: { score: 89, votes: 10 }, mal: { score: 8.9, votes: 10 }, bangumi: { score: 8.9, votes: 10 } } },
  { workId: "three", rank: 3, titleZh: "作品三", titleOriginal: "Three", year: 2022, studios: ["Studio B"], genres: ["Music"], compositeScore: 88, sourceScores: { anilist: { score: 88, votes: 10 }, mal: { score: 8.8, votes: 10 }, bangumi: { score: 8.8, votes: 10 } } },
];

const record = (workId: string, patch: Partial<ProgressRecord>): ProgressRecord => ({ workId, watched: false, reviewed: false, recommended: false, notInterested: false, updatedAt: "2026-07-13T00:00:00.000Z", revision: 1, ...patch });

test("deriveProgressInsights reports completion, watch preferences, and recommendations from private records", () => {
  const insights = deriveProgressInsights(works, [
    record("one", { watched: true, recommended: true }),
    record("two", { watched: true }),
    record("three", { notInterested: true }),
  ]);

  assert.equal(insights.completion, 67);
  assert.equal(insights.watchedCount, 2);
  assert.equal(insights.recommendedCount, 1);
  assert.deepEqual(insights.topGenres, [
    { label: "Drama", count: 2, percentage: 100 },
    { label: "Fantasy", count: 1, percentage: 50 },
  ]);
  assert.deepEqual(insights.topStudio, { label: "Studio A", count: 2 });
});

test("deriveProgressInsights keeps the empty state meaningful", () => {
  const insights = deriveProgressInsights(works, []);

  assert.equal(insights.completion, 0);
  assert.equal(insights.topStudio, null);
  assert.deepEqual(insights.topGenres, []);
});
