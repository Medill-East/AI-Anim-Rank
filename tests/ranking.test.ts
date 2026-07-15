import assert from "node:assert/strict";
import test from "node:test";

import { parseRankingSnapshot } from "../src/data/schema.ts";
import { queryRankedWorks } from "../src/features/ranking/query.ts";
import type { ProgressRecord } from "../src/domain/progress.ts";

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

test("rejects source scores outside their published scales", () => {
  const invalidScores = [
    ["anilist", 101],
    ["mal", 10.1],
    ["bangumi", -0.1],
  ] as const;

  for (const [source, score] of invalidScores) {
    const sourceScores = {
      ...validSnapshot.works[0].sourceScores,
      [source]: { ...validSnapshot.works[0].sourceScores[source], score },
    };
    const invalidSnapshot = {
      ...validSnapshot,
      works: [{ ...validSnapshot.works[0], sourceScores }],
    };

    assert.throws(
      () => parseRankingSnapshot(invalidSnapshot),
      new RegExp(`sourceScores\\.${source}\\.score must be between`, "i"),
    );
  }
});

const queryWorks = [
  { ...validSnapshot.works[0], workId: "anime-1", rank: 2, titleZh: "葬送的芙莉莲", titleOriginal: "Sousou no Frieren", year: 2023, genres: ["冒险"], compositeScore: 91 },
  { ...validSnapshot.works[0], workId: "anime-2", rank: 1, titleZh: "孤独摇滚！", titleOriginal: "Bocchi the Rock!", year: 2022, studios: ["CloverWorks"], genres: ["音乐"], compositeScore: 89 },
  { ...validSnapshot.works[0], workId: "anime-3", rank: 3, titleZh: "赛博朋克：边缘行者", titleOriginal: "Cyberpunk: Edgerunners", year: 2022, studios: ["Trigger"], genres: ["科幻"], compositeScore: 90 },
];

test("ranking query searches titles and sorts deterministically", () => {
  assert.deepEqual(
    queryRankedWorks(queryWorks, [], {
      search: "FRIEREN",
      sort: { field: "year", direction: "desc" },
    }).map((work) => work.workId),
    ["anime-1"],
  );
  assert.deepEqual(
    queryRankedWorks(queryWorks, [], {
      genre: "科幻",
      sort: { field: "compositeScore", direction: "asc" },
    }).map((work) => work.workId),
    ["anime-3"],
  );
  assert.deepEqual(
    queryRankedWorks(queryWorks, [], {
      studio: "Example Studio",
      sort: { field: "rank", direction: "asc" },
    }).map((work) => work.workId),
    ["anime-1"],
  );
  assert.deepEqual(
    queryRankedWorks(queryWorks, [], {
      sort: { field: "rank", direction: "desc" },
    }).map((work) => work.workId),
    ["anime-3", "anime-1", "anime-2"],
  );
});

test("ranking query status filters return only matching works", () => {
  const records: ProgressRecord[] = [
    { workId: "anime-1", watched: true, reviewed: true, recommended: true, notInterested: false, updatedAt: "2026-07-12T00:00:00.000Z", revision: 1 },
    { workId: "anime-2", watched: true, reviewed: false, recommended: false, notInterested: true, updatedAt: "2026-07-12T00:00:00.000Z", revision: 1 },
  ];

  assert.deepEqual(queryRankedWorks(queryWorks, records, { status: "recommended" }).map((work) => work.workId), ["anime-1"]);
  assert.deepEqual(queryRankedWorks(queryWorks, records, { status: "watchedUnreviewed" }).map((work) => work.workId), ["anime-2"]);
  assert.deepEqual(queryRankedWorks(queryWorks, records, { status: "unwatched" }).map((work) => work.workId), ["anime-3"]);
});
