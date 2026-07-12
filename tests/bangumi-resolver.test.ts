import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("rejects a title-only Bangumi match", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    const result = await resolveBangumiMappings({
      suggestions: suggestion(99), source,
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
      suggestions: suggestion(99), source,
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
      suggestions: suggestion(99), source,
      artifactDirectory: directory, mappingPath,
      fetchImpl: async () => response(detail({ date: "2020-01-01", eps: 13 })), sleep: async () => {},
    });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.exceptions[0]?.reason, "metadata-conflict");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("does not change mappings without --apply semantics", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    await resolveBangumiMappings({ suggestions: suggestion(99), source, artifactDirectory: directory, mappingPath, fetchImpl: async () => response(detail()), sleep: async () => {} });
    assert.equal(await readFile(mappingPath, "utf8"), "[]\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("apply writes a valid mapping set and rejects duplicate identifiers", async () => {
  const { directory, mappingPath } = await fixture();
  try {
    await resolveBangumiMappings({ suggestions: suggestion(99), source, artifactDirectory: directory, mappingPath, apply: true, fetchImpl: async () => response(detail()), sleep: async () => {} });
    assert.deepEqual(JSON.parse(await readFile(mappingPath, "utf8")), [{ malId: 10, bangumiId: 99, titleZh: "作品", score: 8.1, votes: 500 }]);
    await writeFile(mappingPath, '[{"malId":77,"bangumiId":7,"titleZh":"old","score":8,"votes":100},{"malId":77,"bangumiId":8,"titleZh":"duplicate","score":8,"votes":100}]\n');
    await assert.rejects(
      resolveBangumiMappings({ suggestions: suggestion(99), source, artifactDirectory: directory, mappingPath, apply: true, fetchImpl: async () => response(detail()), sleep: async () => {} }),
      /duplicate mapping MAL id: 77/,
    );
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
