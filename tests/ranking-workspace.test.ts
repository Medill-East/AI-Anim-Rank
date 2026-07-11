import assert from "node:assert/strict";
import test from "node:test";

import type { RankedWork } from "../src/data/schema.ts";
import {
  createRankingWorkspaceState,
  reduceRankingWorkspaceState,
  visibleRankingWorks,
} from "../src/features/ranking/workspace.ts";

const works: RankedWork[] = [
  {
    workId: "frieren",
    rank: 1,
    titleZh: "葬送的芙莉莲",
    titleOriginal: "Sousou no Frieren",
    year: 2023,
    studios: ["Madhouse"],
    genres: ["冒险"],
    compositeScore: 91.2,
    sourceScores: {
      anilist: { score: 90, votes: 100 },
      mal: { score: 9.1, votes: 200 },
      bangumi: { score: 9.2, votes: 300 },
    },
  },
  {
    workId: "bocchi",
    rank: 2,
    titleZh: "孤独摇滚！",
    titleOriginal: "Bocchi the Rock!",
    year: 2022,
    studios: ["CloverWorks"],
    genres: ["音乐"],
    compositeScore: 89.4,
    sourceScores: {
      anilist: { score: 88, votes: 100 },
      mal: { score: 8.9, votes: 200 },
      bangumi: { score: 8.8, votes: 300 },
    },
  },
];

test("workspace filters Chinese titles through the shared ranking query", () => {
  const state = reduceRankingWorkspaceState(createRankingWorkspaceState(), {
    type: "search",
    value: "芙莉莲",
  });

  assert.deepEqual(visibleRankingWorks(works, [], state).map((work) => work.workId), ["frieren"]);
});

test("workspace opens the selected work detail and resets filters", () => {
  let state = reduceRankingWorkspaceState(createRankingWorkspaceState(), {
    type: "search",
    value: "孤独",
  });
  state = reduceRankingWorkspaceState(state, { type: "openDetail", workId: "bocchi" });

  assert.equal(state.selectedWorkId, "bocchi");

  state = reduceRankingWorkspaceState(state, { type: "reset" });

  assert.deepEqual(state, createRankingWorkspaceState());
});
