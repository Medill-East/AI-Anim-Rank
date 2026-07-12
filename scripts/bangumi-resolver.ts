import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { readBangumiSuggestionPair, type BangumiSuggestions } from "./bangumi-suggestions.ts";
import { resolveCaptureSources, type AniListMedia, type BangumiMapping, type JikanAnime } from "./ranking-pipeline.ts";

export const BANGUMI_RESOLVER_ALGORITHM_VERSION = "v2-bound-evidence-chain";

const bangumiSubjectUrl = "https://api.bgm.tv/v0/subjects";
const animationTypes = new Set(["TV", "Movie", "OVA", "ONA", "Special", "Music"]);

type FetchResponse = Pick<Response, "ok" | "status" | "json">;
type FetchImpl = (input: string, init?: RequestInit) => Promise<FetchResponse>;
type Sleep = (milliseconds: number) => Promise<void>;
type Rename = (oldPath: string, newPath: string) => Promise<void>;

type CandidateSource = {
  anilist: Pick<AniListMedia, "id" | "idMal" | "title" | "seasonYear">[];
  jikan: Array<Pick<JikanAnime, "mal_id" | "title"> & { type?: string | null; year?: number | null; episodes?: number | null }>;
};

interface BangumiDetail {
  id: number;
  type: number;
  name: string;
  name_cn?: string;
  date?: string;
  eps?: number;
  rating?: { score?: number; total?: number };
}

export interface ResolverEvidence {
  titleExact: true;
  titleMatches: Array<{ source: string; bangumi: string }>;
  metadataSignals: Array<"animation-type" | "year" | "episodes">;
  metadataConflicts: Array<"year" | "episodes">;
}

export interface ResolverAccepted {
  anilistId: number;
  bangumiId: number;
  mapping: BangumiMapping;
  evidence: ResolverEvidence;
  provenance: { suggestionGeneratedAt: string; captureGeneration: string; subjectUrl: string; algorithmVersion: string };
}

export interface ResolverException {
  anilistId: number;
  bangumiId: number | null;
  reason: "no-exact-top-candidate" | "subject-request-failed" | "subject-id-mismatch" | "non-anime-subject" | "invalid-subject" | "title-not-exact" | "metadata-conflict" | "insufficient-metadata-corroboration" | "mapping-already-exists";
  detail: string;
}

export interface BangumiResolution {
  algorithmVersion: string;
  generatedAt: string;
  dryRun: boolean;
  accepted: ResolverAccepted[];
  exceptions: ResolverException[];
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function parseYear(value: string | undefined): number | null {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function isDetail(value: unknown): value is BangumiDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const detail = value as BangumiDetail;
  return Number.isInteger(detail.id) && detail.id > 0 && Number.isInteger(detail.type)
    && typeof detail.name === "string" && detail.name.trim().length > 0;
}

function validRating(detail: BangumiDetail): detail is BangumiDetail & { rating: { score: number; total: number } } {
  return typeof detail.rating?.score === "number" && Number.isFinite(detail.rating.score)
    && typeof detail.rating.total === "number" && Number.isInteger(detail.rating.total) && detail.rating.total >= 0;
}

function validateMappings(mappings: BangumiMapping[]) {
  const seen = { malId: new Set<number>(), anilistId: new Set<number>(), bangumiId: new Set<number>() };
  for (const mapping of mappings) {
    for (const [key, value] of Object.entries({ malId: mapping.malId, anilistId: mapping.anilistId, bangumiId: mapping.bangumiId }) as Array<[keyof typeof seen, number | undefined]>) {
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value < 1) throw new Error(`invalid mapping ${key}`);
      if (seen[key].has(value)) throw new Error(`duplicate mapping ${key === "bangumiId" ? "Bangumi" : key === "malId" ? "MAL" : "AniList"} id: ${value}`);
      seen[key].add(value);
    }
    if ((mapping.malId === undefined) === (mapping.anilistId === undefined)) throw new Error(`Bangumi mapping ${mapping.bangumiId} must contain exactly one source id`);
    if (typeof mapping.titleZh !== "string" || !mapping.titleZh.trim() || !Number.isFinite(mapping.score) || mapping.score < 0 || mapping.score > 10 || !Number.isInteger(mapping.votes) || mapping.votes < 0) {
      throw new Error(`Bangumi mapping ${mapping.bangumiId} is invalid`);
    }
  }
}

async function writeJsonAtomic(path: string, value: unknown, renameImpl: Rename) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await renameImpl(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function validGenerationId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error("resolver generation has an invalid name");
  return value;
}

function generatedGenerationId(): string {
  return `resolver-${new Date().toISOString().replace(/\D/g, "")}-${process.pid}`;
}

async function stageMappingUpdate(path: string, mappings: BangumiMapping[]) {
  const replacement = `${path}.tmp-${process.pid}-${Date.now()}`;
  const backupTemporary = `${path}.bak.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(replacement, `${JSON.stringify(mappings, null, 2)}\n`, "utf8");
    await copyFile(path, backupTemporary);
    return { replacement, backupTemporary };
  } catch (error) {
    await rm(replacement, { force: true });
    await rm(backupTemporary, { force: true });
    throw error;
  }
}

async function stageResolverGeneration({ artifactDirectory, generation, resolution, exceptions, renameImpl }: {
  artifactDirectory: string;
  generation: string;
  resolution: BangumiResolution;
  exceptions: ResolverException[];
  renameImpl: Rename;
}) {
  const generationDirectory = resolve(artifactDirectory, "generations", validGenerationId(generation));
  const pointerPath = resolve(artifactDirectory, "current.json");
  const pointerTemporary = `${pointerPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(resolve(artifactDirectory, "generations"), { recursive: true });
  await mkdir(generationDirectory);
  try {
    await writeJsonAtomic(resolve(generationDirectory, "resolution.json"), resolution, renameImpl);
    await writeJsonAtomic(resolve(generationDirectory, "exceptions.json"), { algorithmVersion: BANGUMI_RESOLVER_ALGORITHM_VERSION, exceptions }, renameImpl);
    await writeFile(pointerTemporary, `${JSON.stringify({ version: 1, generation }, null, 2)}\n`, "utf8");
    return { generationDirectory, pointerPath, pointerTemporary };
  } catch (error) {
    await rm(pointerTemporary, { force: true });
    await rm(generationDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function commitApplyTransaction({ mappingPath, stagedMapping, pointerPath, pointerTemporary, renameImpl }: {
  mappingPath: string;
  stagedMapping: { replacement: string; backupTemporary: string } | undefined;
  pointerPath: string;
  pointerTemporary: string;
  renameImpl: Rename;
}) {
  let mappingReplaced = false;
  try {
    if (stagedMapping) {
      await renameImpl(stagedMapping.backupTemporary, `${mappingPath}.bak`);
      await renameImpl(stagedMapping.replacement, mappingPath);
      mappingReplaced = true;
    }
    // This pointer is the resolver's commit marker. Until it moves, readers
    // continue to observe the prior immutable evidence generation.
    await renameImpl(pointerTemporary, pointerPath);
  } catch (error) {
    if (mappingReplaced) {
      const rollback = `${mappingPath}.rollback-${process.pid}-${Date.now()}`;
      try {
        await copyFile(`${mappingPath}.bak`, rollback);
        await renameImpl(rollback, mappingPath);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Bangumi apply failed and rollback could not restore formal mappings");
      }
    }
    throw error;
  } finally {
    if (stagedMapping) {
      await rm(stagedMapping.replacement, { force: true });
      await rm(stagedMapping.backupTemporary, { force: true });
    }
    await rm(pointerTemporary, { force: true });
  }
}

async function fetchDetail(id: number, fetchImpl: FetchImpl, sleep: Sleep, requestDelayMs: number, retryAttempts: number, token?: string): Promise<BangumiDetail | null> {
  for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
    if (attempt > 0) await sleep(requestDelayMs);
    try {
      const response = await fetchImpl(`${bangumiSubjectUrl}/${id}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Anim-Rank BangumiResolver/1.0)", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!response.ok) continue;
      const payload = await response.json();
      return isDetail(payload) ? payload : null;
    } catch { /* bounded retries intentionally hide transport internals from artifacts */ }
  }
  return null;
}

function evaluate(detail: BangumiDetail, anilist: CandidateSource["anilist"][number], jikan: CandidateSource["jikan"][number] | undefined, query: string): { evidence?: ResolverEvidence; reason?: ResolverException["reason"]; detail?: string } {
  const sourceTitles = [
    ["anilist.native", anilist.title.native], ["anilist.romaji", anilist.title.romaji], ["jikan.title", jikan?.title], ["suggestion.query", query],
  ].filter((item): item is [string, string] => typeof item[1] === "string" && item[1].trim().length > 0);
  const bangumiTitles = [["bangumi.name", detail.name], ["bangumi.name_cn", detail.name_cn]].filter((item): item is [string, string] => typeof item[1] === "string" && item[1].trim().length > 0);
  const titleMatches = sourceTitles.flatMap(([source, sourceTitle]) => bangumiTitles.filter(([, bangumiTitle]) => normalizeTitle(sourceTitle) === normalizeTitle(bangumiTitle)).map(([bangumi, bangumiTitle]) => ({ source: `${source}:${sourceTitle}`, bangumi: `${bangumi}:${bangumiTitle}` })));
  if (titleMatches.length === 0) return { reason: "title-not-exact", detail: "No normalized Japanese/Chinese/native/romaji title is exactly equal." };

  const metadataSignals: ResolverEvidence["metadataSignals"] = [];
  const metadataConflicts: ResolverEvidence["metadataConflicts"] = [];
  if (detail.type === 2 && jikan?.type !== undefined && jikan.type !== null && animationTypes.has(jikan.type)) metadataSignals.push("animation-type");
  const sourceYears = [anilist.seasonYear, jikan?.year].filter((year): year is number => Number.isInteger(year));
  const bangumiYear = parseYear(detail.date);
  if (bangumiYear !== null && sourceYears.length > 0) {
    if (sourceYears.some((year) => Math.abs(year - bangumiYear) > 1)) metadataConflicts.push("year");
    else metadataSignals.push("year");
  }
  if (typeof detail.eps === "number" && Number.isInteger(detail.eps) && detail.eps > 0 && typeof jikan?.episodes === "number" && Number.isInteger(jikan.episodes) && jikan.episodes > 0) {
    if (detail.eps !== jikan.episodes) metadataConflicts.push("episodes");
    else metadataSignals.push("episodes");
  }
  const evidence: ResolverEvidence = { titleExact: true, titleMatches, metadataSignals, metadataConflicts };
  if (metadataConflicts.length > 0) return { evidence, reason: "metadata-conflict", detail: `Conflicting ${metadataConflicts.join(" and ")} metadata.` };
  if (metadataSignals.length < 2) return { evidence, reason: "insufficient-metadata-corroboration", detail: "Exact title requires at least two independent metadata corroborations." };
  return { evidence };
}

export async function resolveBangumiMappings({
  suggestions, source, captureGeneration, artifactDirectory, mappingPath, apply = false, fetchImpl = fetch, sleep = (milliseconds) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)), requestDelayMs = 1_000, retryAttempts = 3, env, generationId = generatedGenerationId(), renameImpl = rename,
}: {
  suggestions: BangumiSuggestions;
  source: CandidateSource;
  captureGeneration: string;
  artifactDirectory: string;
  mappingPath: string;
  apply?: boolean;
  fetchImpl?: FetchImpl;
  sleep?: Sleep;
  requestDelayMs?: number;
  retryAttempts?: number;
  env?: Readonly<{ BANGUMI_ACCESS_TOKEN?: string }>;
  generationId?: string;
  renameImpl?: Rename;
}): Promise<BangumiResolution> {
  if (!Number.isInteger(requestDelayMs) || requestDelayMs < 0 || !Number.isInteger(retryAttempts) || retryAttempts < 1) throw new Error("invalid pacing or retry configuration");
  if (suggestions.status !== "complete") throw new Error("Bangumi suggestions must be complete before resolution");
  if (suggestions.captureGeneration !== captureGeneration) throw new Error("Bangumi suggestion capture generation does not match the supplied capture generation");
  const existing = JSON.parse(await readFile(mappingPath, "utf8")) as BangumiMapping[];
  validateMappings(existing);
  const accepted: ResolverAccepted[] = [];
  const exceptions: ResolverException[] = [];
  const anilistById = new Map(source.anilist.map((item) => [item.id, item]));
  const jikanByMal = new Map(source.jikan.map((item) => [item.mal_id, item]));
  const token = env === undefined ? process.env.BANGUMI_ACCESS_TOKEN : env.BANGUMI_ACCESS_TOKEN;
  const claimed = {
    malId: new Set(existing.flatMap((mapping) => mapping.malId === undefined ? [] : [mapping.malId])),
    anilistId: new Set(existing.flatMap((mapping) => mapping.anilistId === undefined ? [] : [mapping.anilistId])),
    bangumiId: new Set(existing.map((mapping) => mapping.bangumiId)),
  };
  let requested = 0;

  for (const entry of suggestions.entries) {
    const top = entry.results[0];
    const anilist = anilistById.get(entry.anilistId);
    if (!top || top.matchScore !== 1 || !anilist) {
      exceptions.push({ anilistId: entry.anilistId, bangumiId: top?.subjectId ?? null, reason: "no-exact-top-candidate", detail: "Only the top exact search candidate is eligible for detail lookup." });
      continue;
    }
    if (claimed.bangumiId.has(top.subjectId) || claimed.anilistId.has(anilist.id) || (anilist.idMal !== null && claimed.malId.has(anilist.idMal))) {
      exceptions.push({ anilistId: anilist.id, bangumiId: top.subjectId, reason: "mapping-already-exists", detail: "A formal mapping already uses this source or Bangumi ID." });
      continue;
    }
    if (requested > 0) await sleep(requestDelayMs);
    requested += 1;
    const detail = await fetchDetail(top.subjectId, fetchImpl, sleep, requestDelayMs, retryAttempts, token);
    if (!detail) {
      exceptions.push({ anilistId: anilist.id, bangumiId: top.subjectId, reason: "subject-request-failed", detail: "Subject detail could not be fetched after bounded retries." });
      continue;
    }
    if (detail.type !== 2) {
      exceptions.push({ anilistId: anilist.id, bangumiId: detail.id, reason: "non-anime-subject", detail: "Fetched Bangumi subject is not in the animation category." });
      continue;
    }
    if (detail.id !== top.subjectId) {
      exceptions.push({ anilistId: anilist.id, bangumiId: top.subjectId, reason: "subject-id-mismatch", detail: "Fetched subject detail ID does not match the top suggested Bangumi ID." });
      continue;
    }
    if (!validRating(detail)) {
      exceptions.push({ anilistId: anilist.id, bangumiId: detail.id, reason: "invalid-subject", detail: "Subject detail is missing a valid rating needed by the formal mapping." });
      continue;
    }
    const outcome = evaluate(detail, anilist, anilist.idMal === null ? undefined : jikanByMal.get(anilist.idMal), entry.query);
    if (!outcome.evidence || outcome.reason) {
      exceptions.push({ anilistId: anilist.id, bangumiId: detail.id, reason: outcome.reason!, detail: outcome.detail! });
      continue;
    }
    const mapping: BangumiMapping = { bangumiId: detail.id, titleZh: detail.name_cn?.trim() || detail.name, score: detail.rating.score, votes: detail.rating.total, ...(anilist.idMal === null ? { anilistId: anilist.id } : { malId: anilist.idMal }) };
    accepted.push({ anilistId: anilist.id, bangumiId: detail.id, mapping, evidence: outcome.evidence, provenance: { suggestionGeneratedAt: suggestions.generatedAt, captureGeneration, subjectUrl: `${bangumiSubjectUrl}/${detail.id}`, algorithmVersion: BANGUMI_RESOLVER_ALGORITHM_VERSION } });
    claimed.bangumiId.add(mapping.bangumiId);
    if (mapping.malId !== undefined) claimed.malId.add(mapping.malId);
    if (mapping.anilistId !== undefined) claimed.anilistId.add(mapping.anilistId);
  }
  const resolution: BangumiResolution = { algorithmVersion: BANGUMI_RESOLVER_ALGORITHM_VERSION, generatedAt: new Date().toISOString(), dryRun: !apply, accepted, exceptions };
  const proposed = [...existing, ...accepted.map((item) => item.mapping)];
  if (apply) validateMappings(proposed);
  const stagedMapping = apply && accepted.length > 0 ? await stageMappingUpdate(mappingPath, proposed) : undefined;
  let stagedGeneration: Awaited<ReturnType<typeof stageResolverGeneration>>;
  try {
    stagedGeneration = await stageResolverGeneration({ artifactDirectory, generation: generationId, resolution, exceptions, renameImpl });
  } catch (error) {
    if (stagedMapping) {
      await rm(stagedMapping.replacement, { force: true });
      await rm(stagedMapping.backupTemporary, { force: true });
    }
    throw error;
  }
  await commitApplyTransaction({
    mappingPath,
    stagedMapping,
    pointerPath: stagedGeneration.pointerPath,
    pointerTemporary: stagedGeneration.pointerTemporary,
    renameImpl,
  });
  return resolution;
}

async function main(args: string[]) {
  const root = resolve(import.meta.dirname, "..");
  const captured = await resolveCaptureSources({ captureDir: resolve(root, "data/ranking/captured") });
  const suggestionPair = await readBangumiSuggestionPair(resolve(root, "data/ranking/bangumi-suggestions"));
  const result = await resolveBangumiMappings({
    suggestions: suggestionPair.suggestions,
    source: { anilist: captured.anilist, jikan: captured.jikan },
    captureGeneration: captured.generation,
    artifactDirectory: resolve(root, "data/ranking/bangumi-resolver"),
    mappingPath: resolve(root, "data/ranking/bangumi-mappings.json"),
    apply: args.includes("--apply"),
  });
  console.log(`Bangumi resolver: ${result.accepted.length} accepted, ${result.exceptions.length} exceptions, ${result.dryRun ? "dry-run" : "applied"}.`);
}

if (import.meta.main) main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
