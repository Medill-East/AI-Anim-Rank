import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertSuggestionOutputPaths, generateBangumiSuggestions, readBangumiSuggestionPair } from "../scripts/bangumi-suggestions.ts";

const anilist = [
  {
    id: 1,
    idMal: 101,
    title: { chinese: "葬送的芙莉莲", native: "葬送のフリーレン", romaji: "Sousou no Frieren" },
  },
  {
    id: 2,
    idMal: 102,
    title: { native: "薬屋のひとりごと", romaji: "Kusuriya no Hitorigoto" },
  },
];

const jikan = [
  { mal_id: 101, title: "Frieren: Beyond Journey's End" },
  { mal_id: 102, title: "The Apothecary Diaries" },
];

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, headers: new Headers(), json: async () => body } as Response;
}

test("writes review-only suggestions with exact-title scores and never writes formal mappings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-bangumi-suggestions-"));
  const mappingPath = join(directory, "bangumi-mappings.json");
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const waits: number[] = [];

  try {
    await writeFile(mappingPath, "[\n  {\"malId\": 101, \"bangumiId\": 7}\n]\n");
    await generateBangumiSuggestions({
      anilist,
      jikan,
      mappings: [],
      artifactDirectory: directory,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return response({ data: [{ id: 123, name: "葬送的芙莉莲", name_cn: "葬送的芙莉莲", rating: { score: 9.1, total: 99_999 } }] });
      },
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      requestDelayMs: 750,
      captureGeneration: "capture-current",
      env: {},
    });

    const pair = await readBangumiSuggestionPair(directory);
    const suggestions = pair.suggestions;
    assert.equal(suggestions.status, "complete");
    assert.equal(suggestions.captureGeneration, "capture-current");
    assert.equal(suggestions.entries.length, 2);
    assert.equal(suggestions.entries[0].query, "葬送的芙莉莲");
    assert.equal(suggestions.entries[0].results[0].matchScore, 1);
    assert.equal(suggestions.entries[0].accepted, false);
    assert.deepEqual(suggestions.entries[0].results[0], {
      subjectId: 123,
      name: "葬送的芙莉莲",
      nameCn: "葬送的芙莉莲",
      ratingScore: 9.1,
      ratingTotal: 99_999,
      matchScore: 1,
    });
    assert.equal(suggestions.entries[0].jikanTitle, "Frieren: Beyond Journey's End");
    assert.equal(requests.length, 2);
    assert.deepEqual(waits, [750]);
    assert.equal((requests[0]?.init?.headers as Record<string, string>)["User-Agent"].includes("Mozilla/5.0"), true);
    assert.equal(await readFile(mappingPath, "utf8"), "[\n  {\"malId\": 101, \"bangumiId\": 7}\n]\n");
    assert.match(pair.report, /Human approval is required/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records a resumable authentication diagnostic without logging or persisting the access token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-bangumi-auth-"));
  const token = "secret-token-must-not-appear";
  const logs: string[] = [];

  try {
    await generateBangumiSuggestions({
      anilist: anilist.slice(0, 1),
      jikan: jikan.slice(0, 1),
      mappings: [],
      artifactDirectory: directory,
      fetchImpl: async (_url, init) => {
        assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
        return response({ message: "Unauthorized" }, false, 401);
      },
      sleep: async () => {},
      env: { BANGUMI_ACCESS_TOKEN: token },
      log: (message) => { logs.push(message); },
    });

    const pair = await readBangumiSuggestionPair(directory);
    const suggestionsText = JSON.stringify(pair.suggestions);
    const reportText = pair.report;
    assert.equal(pair.suggestions.status, "blocked");
    assert.match(pair.suggestions.diagnostic?.nextStep ?? "", /^Set BANGUMI_ACCESS_TOKEN/);
    assert.match(reportText, /authentication/i);
    assert.equal(`${suggestionsText}\n${reportText}\n${logs.join("\n")}`.includes(token), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects suggestion outputs outside the dedicated artifact directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "anim-rank-output-paths-"));
  try {
    await assert.rejects(
      () => assertSuggestionOutputPaths(root, "data/ranking/bangumi-mappings.json", "data/ranking/bangumi-suggestions/report.md"),
      /protected/i,
    );
    await assert.rejects(
      () => assertSuggestionOutputPaths(root, "data/ranking/captured/current.json", "data/ranking/bangumi-suggestions/report.md"),
      /protected/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects identical output and report paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "anim-rank-output-overlap-"));
  try {
    await assert.rejects(
      () => assertSuggestionOutputPaths(root, "data/ranking/bangumi-suggestions/results.json", "data/ranking/bangumi-suggestions/results.json"),
      /overlap/i,
    );
    await assert.rejects(
      () => assertSuggestionOutputPaths(root, "data/ranking/bangumi-suggestions/results", "data/ranking/bangumi-suggestions/results/report.md"),
      /overlap/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects artifact paths escaping through a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "anim-rank-output-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "anim-rank-output-outside-"));
  try {
    const artifacts = join(root, "data/ranking/bangumi-suggestions");
    await mkdir(artifacts, { recursive: true });
    await symlink(outside, join(artifacts, "escape"));
    await assert.rejects(
      () => assertSuggestionOutputPaths(root, "data/ranking/bangumi-suggestions/escape/results.json", "data/ranking/bangumi-suggestions/report.md"),
      /protected/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("skips candidates already covered by reviewed MAL-first or AniList mappings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-bangumi-mapped-"));
  let requests = 0;
  try {
    const suggestions = await generateBangumiSuggestions({
      anilist,
      jikan,
      mappings: [
        { malId: 101, bangumiId: 1, titleZh: "已审核", score: 9, votes: 100 },
        { anilistId: 2, bangumiId: 2, titleZh: "已审核二", score: 9, votes: 100 },
      ],
      artifactDirectory: directory,
      fetchImpl: async () => {
        requests += 1;
        return response({ data: [] });
      },
      sleep: async () => {},
      env: {},
    });

    assert.equal(suggestions.status, "complete");
    assert.deepEqual(suggestions.entries, []);
    assert.equal(requests, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocks the run when Bangumi returns a malformed subject instead of silently dropping it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-bangumi-malformed-"));
  try {
    const suggestions = await generateBangumiSuggestions({
      anilist: anilist.slice(0, 1),
      jikan: jikan.slice(0, 1),
      mappings: [],
      artifactDirectory: directory,
      fetchImpl: async () => response({ data: [{ id: 123, name: "葬送的芙莉莲", name_cn: "葬送的芙莉莲", rating: { score: 9.1 } }] }),
      sleep: async () => {},
      env: {},
      log: () => {},
    });

    assert.equal(suggestions.status, "blocked");
    assert.equal(suggestions.diagnostic?.kind, "invalid-response");
    assert.deepEqual(suggestions.entries, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps readers on the prior generation when the second artifact fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-bangumi-generation-failure-"));
  try {
    await generateBangumiSuggestions({
      anilist: anilist.slice(0, 1), jikan: jikan.slice(0, 1), mappings: [], artifactDirectory: directory, generationId: "old",
      fetchImpl: async () => response({ data: [] }), sleep: async () => {}, env: {}, log: () => {},
    });
    await assert.rejects(
      generateBangumiSuggestions({
        anilist: anilist.slice(0, 1), jikan: jikan.slice(0, 1), mappings: [], artifactDirectory: directory, generationId: "new",
        fetchImpl: async () => response({ data: [] }), sleep: async () => {}, env: {}, log: () => {},
        renameImpl: async (from, to) => {
          if (to.endsWith("/report.md")) throw new Error("simulated second artifact failure");
          const { rename } = await import("node:fs/promises");
          await rename(from, to);
        },
      }),
      /simulated second artifact failure/,
    );
    assert.equal((await readBangumiSuggestionPair(directory)).generation, "old");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps readers on the prior generation when publishing fails before pointer swap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-bangumi-pointer-failure-"));
  try {
    await generateBangumiSuggestions({
      anilist: anilist.slice(0, 1), jikan: jikan.slice(0, 1), mappings: [], artifactDirectory: directory, generationId: "old",
      fetchImpl: async () => response({ data: [] }), sleep: async () => {}, env: {}, log: () => {},
    });
    await assert.rejects(
      generateBangumiSuggestions({
        anilist: anilist.slice(0, 1), jikan: jikan.slice(0, 1), mappings: [], artifactDirectory: directory, generationId: "new",
        fetchImpl: async () => response({ data: [] }), sleep: async () => {}, env: {}, log: () => {},
        beforePointerSwap: () => { throw new Error("simulated pre-pointer failure"); },
      }),
      /simulated pre-pointer failure/,
    );
    const pair = await readBangumiSuggestionPair(directory);
    assert.equal(pair.generation, "old");
    assert.match(pair.report, /Candidates reviewed: 1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
