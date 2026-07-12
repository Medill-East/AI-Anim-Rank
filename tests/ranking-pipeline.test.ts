import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCandidates,
  captureSources,
  canonicalizeAniListByMal,
  buildReleaseSnapshot,
  buildReleaseSnapshotFromSources,
  calculateCompositeScore,
  formatUnmatchedReport,
  normalizeSourceScore,
  readCapturedSources,
  resolveCaptureSources,
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

async function withExistingCaptures(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-capture-"));
  await writeFile(join(directory, "anilist.json"), "old-anilist\n");
  await writeFile(join(directory, "jikan.json"), "old-jikan\n");
  try {
    await run(directory);
    assert.equal(await readFile(join(directory, "anilist.json"), "utf8"), "old-anilist\n");
    assert.equal(await readFile(join(directory, "jikan.json"), "utf8"), "old-jikan\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function response(body: unknown, ok = true, status = 200, retryAfter?: string) {
  return { ok, status, headers: new Headers(retryAfter === undefined ? undefined : { "retry-after": retryAfter }), json: async () => body } as Response;
}

async function writeGeneration(directory: string, generation: string, capturedAniList: unknown, capturedJikan: unknown) {
  const generationDir = join(directory, "generations", generation);
  await mkdir(generationDir, { recursive: true });
  await writeFile(join(generationDir, "anilist.json"), `${JSON.stringify(capturedAniList)}\n`);
  await writeFile(join(generationDir, "jikan.json"), `${JSON.stringify(capturedJikan)}\n`);
  await writeFile(join(directory, "current.json"), `${JSON.stringify({ version: 1, generation })}\n`);
}

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
    () => buildCandidates([anilist, { ...anilist }], [jikan], []),
    /duplicate AniList id/i,
  );
});

test("canonicalizes duplicate AniList MAL links deterministically and reports discarded records", () => {
  const duplicates = [
    { ...anilist, id: 5, idMal: 101, averageScore: 90, popularity: 200 },
    { ...anilist, id: 3, idMal: 101, averageScore: 90, popularity: 300 },
    { ...anilist, id: 2, idMal: 101, averageScore: 90, popularity: 300 },
  ];
  const canonicalized = canonicalizeAniListByMal(duplicates);
  const candidates = buildCandidates(duplicates, [jikan], [
    { malId: 101, bangumiId: 100, titleZh: "例", score: 9, votes: 300 },
  ]);

  assert.deepEqual(canonicalized.anilist.map((media) => media.id), [2]);
  assert.deepEqual(canonicalized.discarded.map((conflict) => conflict.discarded.id), [3, 5]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.anilist.id, 2);
  assert.match(formatUnmatchedReport(candidates, canonicalized.discarded), /discarded duplicate AniList MAL links/i);
  assert.match(formatUnmatchedReport(candidates, canonicalized.discarded), /AniList 3.*MAL 101/i);
});

test("still rejects duplicate Jikan MAL IDs after AniList canonicalization", () => {
  assert.throws(
    () => buildCandidates([anilist], [jikan, { ...jikan }], []),
    /duplicate Jikan MAL id/i,
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

test("capture rejects invalid page counts before fetching or changing capture files", async () => {
  for (const pageCount of [0, -1, 1.5, Number.NaN]) {
    await withExistingCaptures(async (directory) => {
      let calls = 0;
      await assert.rejects(
        captureSources({ captureDir: directory, pageCount, fetchImpl: async () => { calls += 1; return response({}); } }),
        /pages must be a positive integer/i,
      );
      assert.equal(calls, 0);
    });
  }
});

test("capture leaves both files untouched when either upstream source fails validation", async () => {
  await withExistingCaptures(async (directory) => {
    await assert.rejects(
      captureSources({ captureDir: directory, pageCount: 1, fetchImpl: async (url) =>
        String(url).includes("graphql") ? response({ errors: [{ message: "bad query" }] }) : response({ data: [jikan] }),
      }),
      /AniList GraphQL errors/i,
    );
  });

  await withExistingCaptures(async (directory) => {
    await assert.rejects(
      captureSources({ captureDir: directory, pageCount: 1, fetchImpl: async (url) =>
        String(url).includes("graphql") ? response({ data: { Page: { media: [anilist] } } }) : response({ data: {} }),
      }),
      /Jikan response data must be a non-empty array/i,
    );
  });

  await withExistingCaptures(async (directory) => {
    await assert.rejects(
      captureSources({ captureDir: directory, pageCount: 1, sleep: async () => {}, fetchImpl: async (url) =>
        String(url).includes("graphql") ? response({ data: { Page: { media: [anilist] } } }) : response({}, false, 503),
      }),
      /Jikan page 1 request failed after 3 attempts: 503/i,
    );
  });
});

test("capture failure before pointer swap keeps readers on the prior complete generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-generation-"));
  try {
    await writeGeneration(directory, "prior", [{ ...anilist, id: 99 }], [{ ...jikan, mal_id: 99 }]);
    await assert.rejects(
      captureSources({
        captureDir: directory,
        pageCount: 1,
        generationId: "next",
        beforePointerSwap: () => { throw new Error("pointer swap blocked"); },
        fetchImpl: async (url) => String(url).includes("graphql")
          ? response({ data: { Page: { media: [anilist] } } })
          : response({ data: [jikan] }),
      }),
      /pointer swap blocked/i,
    );
    const captured = await readCapturedSources(directory);
    assert.equal(captured.anilist[0]?.id, 99);
    assert.equal(captured.jikan[0]?.mal_id, 99);
    assert.match(await readFile(join(directory, "current.json"), "utf8"), /prior/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture pointer swap publishes AniList and Jikan from one generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-generation-"));
  try {
    await writeGeneration(directory, "prior", [{ ...anilist, id: 99 }], [{ ...jikan, mal_id: 99 }]);
    await writeFile(join(directory, "anilist.json"), "legacy-anilist\n");
    await writeFile(join(directory, "jikan.json"), "legacy-jikan\n");
    await captureSources({
      captureDir: directory,
      pageCount: 1,
      generationId: "next",
      fetchImpl: async (url) => String(url).includes("graphql")
        ? response({ data: { Page: { media: [anilist] } } })
        : response({ data: [jikan] }),
    });
    const captured = await readCapturedSources(directory);
    assert.equal(captured.generation, "next");
    assert.equal(captured.anilist[0]?.id, anilist.id);
    assert.equal(captured.jikan[0]?.mal_id, jikan.mal_id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture overrides must be paired or resolve the current manifest generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-generation-"));
  try {
    await writeGeneration(directory, "current", [{ ...anilist, id: 99 }], [{ ...jikan, mal_id: 99 }]);
    const explicitAniList = join(directory, "manual-anilist.json");
    const explicitJikan = join(directory, "manual-jikan.json");
    await writeFile(explicitAniList, `${JSON.stringify([anilist])}\n`);
    await writeFile(explicitJikan, `${JSON.stringify([jikan])}\n`);

    await assert.rejects(
      resolveCaptureSources({ captureDir: directory, anilistPath: explicitAniList }),
      /provide both --anilist and --jikan together/i,
    );
    const explicit = await resolveCaptureSources({ captureDir: directory, anilistPath: explicitAniList, jikanPath: explicitJikan });
    assert.equal(explicit.generation, "explicit");
    assert.equal(explicit.anilist[0]?.id, anilist.id);
    assert.equal(explicit.jikan[0]?.mal_id, jikan.mal_id);

    const current = await resolveCaptureSources({ captureDir: directory });
    assert.equal(current.generation, "current");
    assert.equal(current.anilist[0]?.id, 99);
    assert.equal(current.jikan[0]?.mal_id, 99);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture fetches Jikan pages one at a time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-jikan-"));
  let inFlightJikan = 0;
  const jikanPages: number[] = [];
  try {
    await captureSources({
      captureDir: directory,
      pageCount: 2,
      generationId: "sequential",
      fetchImpl: async (url) => {
        if (String(url).includes("graphql")) return response({ data: { Page: { media: [anilist] } } });
        const page = Number(new URL(String(url)).searchParams.get("page"));
        assert.equal(inFlightJikan, 0, "Jikan requests must not overlap");
        inFlightJikan += 1;
        await Promise.resolve();
        inFlightJikan -= 1;
        jikanPages.push(page);
        return response({ data: [jikan] });
      },
    });
    assert.deepEqual(jikanPages, [1, 2, 3, 4]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture paces successful Jikan pages only between requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-jikan-"));
  const events: string[] = [];
  try {
    await captureSources({
      captureDir: directory,
      pageCount: 2,
      generationId: "paced",
      jikanPageDelayMs: 1_500,
      sleep: async (delay) => { events.push(`sleep:${delay}`); },
      fetchImpl: async (url) => {
        if (String(url).includes("graphql")) return response({ data: { Page: { media: [anilist] } } });
        const page = Number(new URL(String(url)).searchParams.get("page"));
        events.push(`request:${page}`);
        return response({ data: [jikan] });
      },
    });
    assert.deepEqual(events, [
      "request:1", "sleep:1500", "request:2", "sleep:1500",
      "request:3", "sleep:1500", "request:4",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture retries a Jikan 429 using Retry-After before publishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-jikan-"));
  const delays: number[] = [];
  let jikanAttempts = 0;
  try {
    await captureSources({
      captureDir: directory,
      pageCount: 1,
      generationId: "retry-success",
      sleep: async (delay) => { delays.push(delay); },
      fetchImpl: async (url) => {
        if (String(url).includes("graphql")) return response({ data: { Page: { media: [anilist] } } });
        jikanAttempts += 1;
        return jikanAttempts === 1 ? response({}, false, 429, "2") : response({ data: [jikan] });
      },
    });
    assert.equal(jikanAttempts, 3, "two Jikan pages plus one retried first page");
    assert.deepEqual(delays, [2_000, 1_000]);
    assert.equal((await readCapturedSources(directory)).generation, "retry-success");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exhausted Jikan retries leave the prior manifest generation current", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-jikan-"));
  const delays: number[] = [];
  try {
    await writeGeneration(directory, "prior", [{ ...anilist, id: 99 }], [{ ...jikan, mal_id: 99 }]);
    await assert.rejects(
      captureSources({
        captureDir: directory,
        pageCount: 1,
        generationId: "blocked",
        jikanRetryAttempts: 2,
        sleep: async (delay) => { delays.push(delay); },
        fetchImpl: async (url) => String(url).includes("graphql")
          ? response({ data: { Page: { media: [anilist] } } })
          : response({}, false, 429),
      }),
      /Jikan page 1 request failed after 2 attempts: 429/i,
    );
    assert.deepEqual(delays, [1_000]);
    assert.equal((await readCapturedSources(directory)).generation, "prior");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture retries a transient Jikan 504 before publishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-jikan-"));
  const delays: number[] = [];
  let jikanAttempts = 0;
  try {
    await captureSources({
      captureDir: directory,
      pageCount: 1,
      generationId: "retry-504",
      sleep: async (delay) => { delays.push(delay); },
      fetchImpl: async (url) => {
        if (String(url).includes("graphql")) return response({ data: { Page: { media: [anilist] } } });
        jikanAttempts += 1;
        return jikanAttempts === 1 ? response({}, false, 504) : response({ data: [jikan] });
      },
    });
    assert.equal(jikanAttempts, 3, "two Jikan pages plus one retried first page");
    assert.deepEqual(delays, [2_000, 1_000]);
    assert.equal((await readCapturedSources(directory)).generation, "retry-504");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exhausted transient Jikan retries preserve the prior manifest generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-jikan-"));
  const delays: number[] = [];
  try {
    await writeGeneration(directory, "prior", [{ ...anilist, id: 99 }], [{ ...jikan, mal_id: 99 }]);
    await assert.rejects(
      captureSources({
        captureDir: directory,
        pageCount: 1,
        generationId: "blocked-504",
        jikanRetryAttempts: 2,
        sleep: async (delay) => { delays.push(delay); },
        fetchImpl: async (url) => String(url).includes("graphql")
          ? response({ data: { Page: { media: [anilist] } } })
          : response({}, false, 504),
      }),
      /Jikan page 1 request failed after 2 attempts: 504/i,
    );
    assert.deepEqual(delays, [2_000]);
    assert.equal((await readCapturedSources(directory)).generation, "prior");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture does not retry nonretryable Jikan 4xx responses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-jikan-"));
  let jikanAttempts = 0;
  try {
    await assert.rejects(
      captureSources({
        captureDir: directory,
        pageCount: 1,
        sleep: async () => { throw new Error("nonretryable response must not sleep"); },
        fetchImpl: async (url) => {
          if (String(url).includes("graphql")) return response({ data: { Page: { media: [anilist] } } });
          jikanAttempts += 1;
          return response({}, false, 404);
        },
      }),
      /Jikan page 1 request failed: 404/i,
    );
    assert.equal(jikanAttempts, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
