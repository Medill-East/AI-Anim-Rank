import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveBangumiMappings } from "../scripts/bangumi-resolver.ts";

const source = {
  anilist: [{ id: 1, idMal: 10, title: { native: "作品", romaji: "Sakuhin" }, seasonYear: 2024 }],
  jikan: [{ mal_id: 10, title: "Work", type: "TV", year: 2024, episodes: 12 }],
};

const suggestion = (subjectId: number) => ({
  status: "complete",
  generatedAt: "2026-07-12T00:00:00.000Z",
  captureGeneration: "capture-a",
  approvalRequired: true,
  entries: [{ anilistId: 1, malId: 10, jikanTitle: "Work", query: "作品", results: [{ subjectId, name: "作品", nameCn: "作品", ratingScore: 8.1, ratingTotal: 500, matchScore: 1 }], accepted: false }],
});

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    type: 2,
    name: "作品",
    name_cn: "作品",
    date: "2024-01-01",
    eps: 12,
    rating: { score: 8.1, total: 500 },
    ...overrides,
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "anim-rank-bangumi-resolver-"));
  const mappingPath = join(directory, "bangumi-mappings.json");
  await writeFile(mappingPath, "[]\n");
  return { directory, mappingPath };
}

async function readCurrentArtifact(directory: string, name: "resolution.json" | "exceptions.json") {
  const pointer = JSON.parse(await readFile(join(directory, "current.json"), "utf8")) as { generation: string };
  return readFile(join(directory, "generations", pointer.generation, name), "utf8");
}

test("rejects a title-only Bangumi match", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    const result = await resolveBangumiMappings({
      suggestions: suggestion(99), source, captureGeneration: "capture-a",
      artifactDirectory: directory, mappingPath,
      fetchImpl: async () => response(detail({ date: undefined, eps: undefined })), sleep: async () => {},
    });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.exceptions[0]?.reason, "insufficient-metadata-corroboration");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("accepts an exact title with independent type, year, and episode corroboration", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    const result = await resolveBangumiMappings({
      suggestions: suggestion(99), source, captureGeneration: "capture-a",
      artifactDirectory: directory, mappingPath,
      fetchImpl: async () => response(detail()), sleep: async () => {},
    });
    assert.equal(result.accepted.length, 1);
    assert.deepEqual(result.accepted[0]?.mapping, { malId: 10, bangumiId: 99, titleZh: "作品", score: 8.1, votes: 500 });
    assert.equal(result.accepted[0]?.evidence.metadataSignals.length, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects an exact title when year or episode metadata conflicts", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    const result = await resolveBangumiMappings({
      suggestions: suggestion(99), source, captureGeneration: "capture-a",
      artifactDirectory: directory, mappingPath,
      fetchImpl: async () => response(detail({ date: "2020-01-01", eps: 13 })), sleep: async () => {},
    });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.exceptions[0]?.reason, "metadata-conflict");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("hard rejects a non-anime Bangumi subject before evidence can accept it", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    const result = await resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, fetchImpl: async () => response(detail({ type: 1 })), sleep: async () => {} });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.exceptions[0]?.reason, "non-anime-subject");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("does not change mappings without --apply semantics", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    await resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, fetchImpl: async () => response(detail()), sleep: async () => {} });
    assert.equal(await readFile(mappingPath, "utf8"), "[]\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("apply writes a valid mapping set and rejects duplicate identifiers", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    await resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, apply: true, fetchImpl: async () => response(detail()), sleep: async () => {} });
    assert.deepEqual(JSON.parse(await readFile(mappingPath, "utf8")), [{ malId: 10, bangumiId: 99, titleZh: "作品", score: 8.1, votes: 500 }]);
    await writeFile(mappingPath, '[{"malId":77,"bangumiId":7,"titleZh":"old","score":8,"votes":100},{"malId":77,"bangumiId":8,"titleZh":"duplicate","score":8,"votes":100}]\n');
    await assert.rejects(
      resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, apply: true, fetchImpl: async () => response(detail()), sleep: async () => {} }),
      /duplicate mapping MAL id: 77/,
    );
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("successful apply saves the exact prior formal mappings as a backup", async () => {
  const { directory, mappingPath } = await fixture();
  const priorMappings = '[\n  {"malId": 77, "bangumiId": 7, "titleZh": "old", "score": 8, "votes": 100}\n]\n';
  try {
    await writeFile(mappingPath, priorMappings);
    await resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, apply: true, fetchImpl: async () => response(detail()), sleep: async () => {} });
    assert.equal(await readFile(`${mappingPath}.bak`, "utf8"), priorMappings);
    assert.deepEqual(JSON.parse(await readFile(mappingPath, "utf8")), [
      { malId: 77, bangumiId: 7, titleZh: "old", score: 8, votes: 100 },
      { malId: 10, bangumiId: 99, titleZh: "作品", score: 8.1, votes: 500 },
    ]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("requires a complete suggestion artifact bound to the supplied capture generation", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    await assert.rejects(
      resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-b", artifactDirectory: directory, mappingPath, fetchImpl: async () => response(detail()), sleep: async () => {} }),
      /capture generation/i,
    );
    await assert.rejects(
      resolveBangumiMappings({ suggestions: { ...suggestion(99), status: "blocked" }, source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, fetchImpl: async () => response(detail()), sleep: async () => {} }),
      /complete/i,
    );
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects a fetched detail whose ID differs from the top suggestion", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    const result = await resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, fetchImpl: async () => response(detail({ id: 100 })), sleep: async () => {} });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.exceptions[0]?.reason, "subject-id-mismatch");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("demotes duplicate identities before dry-run audit output", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    const duplicate = suggestion(99);
    duplicate.entries.push({ ...duplicate.entries[0]! });
    const result = await resolveBangumiMappings({ suggestions: duplicate, source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, fetchImpl: async () => response(detail()), sleep: async () => {} });
    assert.equal(result.accepted.length, 1);
    assert.equal(result.exceptions[0]?.reason, "mapping-already-exists");
    assert.deepEqual(JSON.parse(await readCurrentArtifact(directory, "resolution.json")).accepted.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("does not persist the access token and paces bounded retries", async () => {
  const { directory, mappingPath } = await fixture();
  const token = "resolver-token-must-not-persist";
  const waits: number[] = [];
  let requests = 0;
  try {
    await resolveBangumiMappings({
      suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath,
      fetchImpl: async (_url, init) => {
        requests += 1;
        assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
        return requests === 1 ? { ok: false, status: 503, json: async () => ({}) } as Response : response(detail());
      },
      sleep: async (milliseconds) => { waits.push(milliseconds); }, requestDelayMs: 123, retryAttempts: 2, env: { BANGUMI_ACCESS_TOKEN: token },
    });
    assert.equal(requests, 2);
    assert.deepEqual(waits, [123]);
    assert.equal(`${await readCurrentArtifact(directory, "resolution.json")}\n${await readCurrentArtifact(directory, "exceptions.json")}`.includes(token), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("does not publish resolver artifacts when apply validation fails", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    await writeFile(mappingPath, '[{"malId":77,"bangumiId":7,"titleZh":"old","score":8,"votes":100},{"malId":77,"bangumiId":8,"titleZh":"duplicate","score":8,"votes":100}]\n');
    await assert.rejects(
      resolveBangumiMappings({ suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, apply: true, fetchImpl: async () => response(detail()), sleep: async () => {} }),
      /duplicate mapping MAL id: 77/,
    );
    await assert.rejects(readFile(join(directory, "current.json"), "utf8"));
    assert.equal(await readFile(mappingPath, "utf8"), '[{"malId":77,"bangumiId":7,"titleZh":"old","score":8,"votes":100},{"malId":77,"bangumiId":8,"titleZh":"duplicate","score":8,"votes":100}]\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("artifact publish failure rolls back the formal mapping and leaves the current pointer unchanged", async () => {
  const { directory, mappingPath } = await fixture();
  const priorMappings = '[{"malId":77,"bangumiId":7,"titleZh":"old","score":8,"votes":100}]\n';
  const priorPointer = '{"version":1,"generation":"old"}\n';
  try {
    await writeFile(mappingPath, priorMappings);
    await mkdir(join(directory, "generations", "old"), { recursive: true });
    await writeFile(join(directory, "current.json"), priorPointer);
    await assert.rejects(
      resolveBangumiMappings({
        suggestions: suggestion(99), source, captureGeneration: "capture-a", artifactDirectory: directory, mappingPath, apply: true, generationId: "new",
        fetchImpl: async () => response(detail()), sleep: async () => {},
        renameImpl: async (from, to) => {
          if (to === join(directory, "current.json")) throw new Error("simulated pointer publish failure");
          await rename(from, to);
        },
      }),
      /simulated pointer publish failure/,
    );
    assert.equal(await readFile(mappingPath, "utf8"), priorMappings);
    assert.equal(await readFile(join(directory, "current.json"), "utf8"), priorPointer);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
