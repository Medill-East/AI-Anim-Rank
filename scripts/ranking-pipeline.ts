import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseRankingSnapshot, type RankedWork, type RankingSnapshot, type RankingSource } from "../src/data/schema.ts";

export const METHODOLOGY_VERSION = "v1-auditable-three-source";
export const MINIMUM_VOTES: Record<RankingSource, number> = {
  anilist: 100,
  mal: 100,
  bangumi: 100,
};

export interface AniListMedia {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; native: string | null };
  averageScore: number | null;
  popularity: number | null;
  seasonYear: number | null;
  studios: { nodes: Array<{ name: string }> };
  genres: string[];
}

export interface JikanAnime {
  mal_id: number;
  title: string;
  score: number | null;
  scored_by: number | null;
  members: number | null;
}

export interface BangumiMapping {
  bangumiId: number;
  titleZh: string;
  score: number;
  votes: number;
  malId?: number;
  anilistId?: number;
}

export interface RankingCandidate {
  anilist: AniListMedia;
  mal: JikanAnime | null;
  bangumi: BangumiMapping | null;
  eligible: boolean;
  ineligibilityReasons: string[];
  normalizedScores: Partial<Record<RankingSource, number>>;
  compositeScore: number | null;
}

type FullyMappedRankingCandidate = RankingCandidate & {
  mal: JikanAnime;
  bangumi: BangumiMapping;
};

function hasSourceMappings(candidate: RankingCandidate): candidate is FullyMappedRankingCandidate {
  return candidate.mal !== null && candidate.bangumi !== null;
}

const sourceMaximum: Record<RankingSource, number> = { anilist: 100, mal: 10, bangumi: 10 };

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function requiredExternalId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function rejectDuplicates<T>(items: T[], key: (item: T) => number | undefined, label: string) {
  const seen = new Set<number>();
  for (const item of items) {
    const value = key(item);
    if (value === undefined) continue;
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

export interface AniListDuplicateConflict {
  malId: number;
  canonical: AniListMedia;
  discarded: AniListMedia;
}

export function canonicalizeAniListByMal(anilist: AniListMedia[]): {
  anilist: AniListMedia[];
  discarded: AniListDuplicateConflict[];
} {
  rejectDuplicates(anilist, (media) => media.id, "AniList id");
  const byMal = new Map<number, AniListMedia[]>();
  const withoutMal: AniListMedia[] = [];
  for (const media of anilist) {
    if (media.idMal === null) {
      withoutMal.push(media);
      continue;
    }
    const linked = byMal.get(media.idMal) ?? [];
    linked.push(media);
    byMal.set(media.idMal, linked);
  }

  const canonical: AniListMedia[] = [...withoutMal];
  const discarded: AniListDuplicateConflict[] = [];
  for (const [malId, linked] of byMal) {
    const ordered = [...linked].sort((left, right) =>
      (right.averageScore ?? -1) - (left.averageScore ?? -1)
      || (right.popularity ?? -1) - (left.popularity ?? -1)
      || left.id - right.id,
    );
    const selected = ordered[0]!;
    canonical.push(selected);
    for (const alternate of ordered.slice(1)) discarded.push({ malId, canonical: selected, discarded: alternate });
  }
  return {
    anilist: canonical.sort((left, right) => left.id - right.id),
    discarded: discarded.sort((left, right) => left.malId - right.malId || left.discarded.id - right.discarded.id),
  };
}

export interface JikanDuplicateConflict {
  malId: number;
  canonical: JikanAnime;
  discarded: JikanAnime;
}

function compareJikanTitles(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeJikanByMal(jikan: JikanAnime[]): {
  jikan: JikanAnime[];
  discarded: JikanDuplicateConflict[];
} {
  const byMal = new Map<number, JikanAnime[]>();
  for (const anime of jikan) {
    const linked = byMal.get(anime.mal_id) ?? [];
    linked.push(anime);
    byMal.set(anime.mal_id, linked);
  }
  const canonical: JikanAnime[] = [];
  const discarded: JikanDuplicateConflict[] = [];
  for (const [malId, linked] of byMal) {
    const ordered = [...linked].sort((left, right) =>
      (right.score ?? -1) - (left.score ?? -1)
      || (right.scored_by ?? -1) - (left.scored_by ?? -1)
      || (right.members ?? -1) - (left.members ?? -1)
      || compareJikanTitles(left.title, right.title),
    );
    const selected = ordered[0]!;
    canonical.push(selected);
    for (const alternate of ordered.slice(1)) discarded.push({ malId, canonical: selected, discarded: alternate });
  }
  return {
    jikan: canonical.sort((left, right) => left.mal_id - right.mal_id),
    discarded: discarded.sort((left, right) => left.malId - right.malId || compareJikanTitles(left.discarded.title, right.discarded.title)),
  };
}

function validateMappings(mappings: BangumiMapping[]) {
  rejectDuplicates(mappings, (mapping) => mapping.malId, "mapping MAL id");
  rejectDuplicates(mappings, (mapping) => mapping.anilistId, "mapping AniList id");
  rejectDuplicates(mappings, (mapping) => mapping.bangumiId, "mapping Bangumi id");
  for (const mapping of mappings) {
    requiredExternalId(mapping.bangumiId, "Bangumi id");
    if (mapping.malId !== undefined) requiredExternalId(mapping.malId, "MAL id");
    if (mapping.anilistId !== undefined) requiredExternalId(mapping.anilistId, "AniList id");
    if ((mapping.malId === undefined) === (mapping.anilistId === undefined)) {
      throw new Error(`Bangumi mapping ${mapping.bangumiId} must contain exactly one of malId or anilistId`);
    }
    requiredNumber(mapping.score, `Bangumi mapping ${mapping.bangumiId} score`);
    requiredNumber(mapping.votes, `Bangumi mapping ${mapping.bangumiId} votes`);
    if (mapping.score < 0 || mapping.score > 10 || mapping.votes < 0 || !Number.isInteger(mapping.votes)) {
      throw new Error(`Bangumi mapping ${mapping.bangumiId} has an invalid score or votes`);
    }
  }
}

/** Uses the stable shared MAL ID before a deliberately reviewed AniList-only mapping. */
export function selectBangumiMapping(media: Pick<AniListMedia, "id" | "idMal">, mappings: BangumiMapping[]): BangumiMapping | undefined {
  validateMappings(mappings);
  if (media.idMal !== null) {
    const byMal = mappings.find((mapping) => mapping.malId === media.idMal);
    if (byMal) return byMal;
  }
  return mappings.find((mapping) => mapping.anilistId === media.id);
}

export function normalizeSourceScore(source: RankingSource, score: number): number {
  const maximum = sourceMaximum[source];
  requiredNumber(score, `${source} score`);
  if (score < 0 || score > maximum) throw new Error(`${source} score is outside its public scale`);
  return Number(((score / maximum) * 100).toFixed(4));
}

/** Equal-weight arithmetic mean of the published 0-100 normalized source scores. */
export function calculateCompositeScore(scores: Record<RankingSource, number>): number {
  return Number(((scores.anilist + scores.mal + scores.bangumi) / 3).toFixed(4));
}

export function buildCandidates(anilist: AniListMedia[], jikan: JikanAnime[], mappings: BangumiMapping[]): RankingCandidate[] {
  const canonicalized = canonicalizeAniListByMal(anilist);
  const canonicalJikan = canonicalizeJikanByMal(jikan);
  for (const media of canonicalized.anilist) {
    requiredExternalId(media.id, "AniList id");
    if (media.idMal !== null) requiredExternalId(media.idMal, "MAL id");
  }
  for (const anime of canonicalJikan.jikan) requiredExternalId(anime.mal_id, "Jikan MAL id");
  rejectDuplicates(canonicalized.anilist.filter((media) => media.idMal !== null), (media) => media.idMal ?? undefined, "AniList idMal");
  rejectDuplicates(canonicalJikan.jikan, (anime) => anime.mal_id, "Jikan MAL id");
  validateMappings(mappings);
  const jikanByMal = new Map(canonicalJikan.jikan.map((anime) => [anime.mal_id, anime]));

  return canonicalized.anilist.map((media) => {
    const mal = media.idMal === null ? null : jikanByMal.get(media.idMal) ?? null;
    const bangumi = selectBangumiMapping(media, mappings) ?? null;
    const reasons: string[] = [];
    if (media.averageScore === null) reasons.push("AniList score missing");
    if ((media.popularity ?? 0) < MINIMUM_VOTES.anilist) reasons.push(`AniList votes below ${MINIMUM_VOTES.anilist}`);
    if (mal?.score === null || mal === null) reasons.push("MAL score missing");
    if ((mal?.scored_by ?? 0) < MINIMUM_VOTES.mal) reasons.push(`MAL votes below ${MINIMUM_VOTES.mal}`);
    if (bangumi === null) reasons.push("Bangumi mapping missing");
    if ((bangumi?.votes ?? 0) < MINIMUM_VOTES.bangumi) reasons.push(`Bangumi votes below ${MINIMUM_VOTES.bangumi}`);

    const normalizedScores = media.averageScore !== null && mal !== null && mal.score !== null && bangumi !== null
      ? { anilist: normalizeSourceScore("anilist", media.averageScore), mal: normalizeSourceScore("mal", mal.score), bangumi: normalizeSourceScore("bangumi", bangumi.score) }
      : {};
    const eligible = reasons.length === 0;
    return {
      anilist: media,
      mal,
      bangumi,
      eligible,
      ineligibilityReasons: reasons,
      normalizedScores,
      compositeScore: eligible ? calculateCompositeScore(normalizedScores as Record<RankingSource, number>) : null,
    };
  });
}

export function buildReleaseSnapshot(candidates: RankingCandidate[], version: string): RankingSnapshot {
  const selected = candidates.filter(hasSourceMappings);
  const rawAniList = selected.map((candidate) => candidate.anilist);
  const rawMal: JikanAnime[] = [];
  const rawBangumi: BangumiMapping[] = [];

  for (const candidate of selected) {
    if (candidate.anilist.idMal !== candidate.mal.mal_id) {
      throw new Error(`release candidate AniList ${candidate.anilist.id} has mismatched MAL id`);
    }
    rawMal.push(candidate.mal);
    rawBangumi.push(candidate.bangumi);
  }

  // Candidate-review JSON is an untrusted operational artifact. Rebuild every
  // match and score from source fields instead of accepting its derived flags.
  const recomputed = buildCandidates(rawAniList, rawMal, rawBangumi);
  for (let index = 0; index < recomputed.length; index += 1) {
    const original = selected[index]!;
    const candidate = recomputed[index]!;
    if (candidate.mal?.mal_id !== original.mal!.mal_id || candidate.bangumi?.bangumiId !== original.bangumi!.bangumiId) {
      throw new Error(`release candidate AniList ${original.anilist.id} does not match its reviewed source IDs`);
    }
  }

  const eligible = recomputed.filter((candidate) => candidate.eligible && candidate.mal && candidate.bangumi && candidate.compositeScore !== null);
  if (eligible.length < 300) throw new Error(`release requires at least 300 fully mapped eligible works; found ${eligible.length}`);

  const works: RankedWork[] = eligible
    .sort((left, right) => right.compositeScore! - left.compositeScore! || left.anilist.id - right.anilist.id)
    .slice(0, 300)
    .map((candidate, index) => ({
      workId: `anilist:${candidate.anilist.id}`,
      rank: index + 1,
      titleZh: candidate.bangumi!.titleZh,
      titleOriginal: candidate.anilist.title.romaji ?? candidate.anilist.title.native ?? candidate.mal!.title,
      year: candidate.anilist.seasonYear ?? 1,
      studios: candidate.anilist.studios.nodes.map((studio) => studio.name).filter(Boolean).slice(0, 1),
      genres: candidate.anilist.genres.filter(Boolean),
      compositeScore: candidate.compositeScore!,
      sourceScores: {
        anilist: { score: candidate.anilist.averageScore!, votes: candidate.anilist.popularity! },
        mal: { score: candidate.mal!.score!, votes: candidate.mal!.scored_by! },
        bangumi: { score: candidate.bangumi!.score, votes: candidate.bangumi!.votes },
      },
    }));
  const snapshot = { version, methodologyVersion: METHODOLOGY_VERSION, sample: false, works };
  return parseRankingSnapshot(snapshot);
}

/** Builds a release only from captured upstream responses and reviewed mappings. */
export function buildReleaseSnapshotFromSources(
  anilist: AniListMedia[],
  jikan: JikanAnime[],
  mappings: BangumiMapping[],
  version: string,
): RankingSnapshot {
  return buildReleaseSnapshot(buildCandidates(anilist, jikan, mappings), version);
}

export function formatUnmatchedReport(
  candidates: RankingCandidate[],
  discardedAniList: AniListDuplicateConflict[] = [],
  discardedJikan: JikanDuplicateConflict[] = [],
): string {
  const unmatched = candidates.filter((candidate) => candidate.ineligibilityReasons.length > 0);
  return [
    `# Ranking candidate unmatched report`,
    "",
    `Candidates: ${candidates.length}`,
    `Eligible: ${candidates.length - unmatched.length}`,
    `Needs review: ${unmatched.length}`,
    "",
    ...unmatched.map((candidate) => `- AniList ${candidate.anilist.id} (${candidate.anilist.title.romaji ?? candidate.anilist.title.native ?? "untitled"}): ${candidate.ineligibilityReasons.join("; ")}`),
    ...(discardedAniList.length === 0 ? [] : [
      "",
      "## Discarded duplicate AniList MAL links",
      "",
      ...discardedAniList.map((conflict) => `- AniList ${conflict.discarded.id} discarded for MAL ${conflict.malId}; kept AniList ${conflict.canonical.id}.`),
    ]),
    ...(discardedJikan.length === 0 ? [] : [
      "",
      "## Discarded duplicate Jikan MAL links",
      "",
      ...discardedJikan.map((conflict) => `- Jikan ${conflict.discarded.title} discarded for MAL ${conflict.malId}; kept Jikan ${conflict.canonical.title}.`),
    ]),
    "",
  ].join("\n");
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

type FetchResponse = Pick<Response, "ok" | "status" | "headers" | "json">;
type FetchImpl = (input: string, init?: RequestInit) => Promise<FetchResponse>;
type Sleep = (milliseconds: number) => Promise<void>;
const defaultJikanRetryAttempts = 3;
const defaultJikanRetryDelayMs = 1_000;
const defaultJikanPageDelayMs = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positivePageCount(pageCount: number): number {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("pages must be a positive integer");
  return pageCount;
}

async function fetchAniList(pageCount: number, fetchImpl: FetchImpl): Promise<AniListMedia[]> {
  const query = `query ($page: Int!) { Page(page: $page, perPage: 50) { media(type: ANIME, sort: SCORE_DESC) { id idMal title { romaji native } averageScore popularity seasonYear studios { nodes { name } } genres } } }`;
  const pages = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
    const response = await fetchImpl("https://graphql.anilist.co", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { page: index + 1 } }) });
    if (!response.ok) throw new Error(`AniList request failed: ${response.status}`);
    const payload = await response.json();
    if (!isRecord(payload)) throw new Error("AniList response must be an object");
    if (Array.isArray(payload.errors) && payload.errors.length > 0) throw new Error("AniList GraphQL errors");
    const media = isRecord(payload.data) && isRecord(payload.data.Page) ? payload.data.Page.media : undefined;
    if (!Array.isArray(media) || media.length === 0) throw new Error("AniList response media must be a non-empty array");
    return media as AniListMedia[];
  }));
  return pages.flat();
}

function retryDelay(response: FetchResponse, attempt: number): number {
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
    }
    return defaultJikanRetryDelayMs * attempt;
  }
  return Math.min(8_000, 2_000 * 2 ** (attempt - 1));
}

function isRetryableJikanStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

async function fetchJikan(
  pageCount: number,
  fetchImpl: FetchImpl,
  sleep: Sleep,
  retryAttempts: number,
  pageDelayMs: number,
): Promise<JikanAnime[]> {
  if (!Number.isInteger(retryAttempts) || retryAttempts < 1) throw new Error("Jikan retry attempts must be a positive integer");
  if (!Number.isInteger(pageDelayMs) || pageDelayMs < 0) throw new Error("Jikan page delay must be a non-negative integer");
  const anime: JikanAnime[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      const response = await fetchImpl(`https://api.jikan.moe/v4/top/anime?page=${page}&limit=25`);
      if (!response.ok) {
        if (isRetryableJikanStatus(response.status) && attempt < retryAttempts) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        if (isRetryableJikanStatus(response.status)) {
          throw new Error(`Jikan page ${page} request failed after ${retryAttempts} attempts: ${response.status}`);
        }
        throw new Error(`Jikan page ${page} request failed: ${response.status}`);
      }
      const payload = await response.json();
      const data = isRecord(payload) ? payload.data : undefined;
      if (!Array.isArray(data) || data.length === 0) throw new Error("Jikan response data must be a non-empty array");
      anime.push(...data as JikanAnime[]);
      if (page < pageCount) await sleep(pageDelayMs);
      break;
    }
  }
  return anime;
}

const captureManifestName = "current.json";
const generationDirectoryName = "generations";

function validGenerationId(generation: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(generation)) throw new Error("capture generation has an invalid name");
  return generation;
}

function generatedId(): string {
  return `capture-${new Date().toISOString().replace(/\D/g, "")}-${process.pid}`;
}

export interface CapturedSources {
  generation: string;
  anilist: AniListMedia[];
  jikan: JikanAnime[];
}

export async function readCapturedSources(captureDir: string): Promise<CapturedSources> {
  const manifestPath = resolve(captureDir, captureManifestName);
  let manifest: unknown;
  try {
    manifest = await readJson<unknown>(manifestPath);
  } catch (error: unknown) {
    if (isRecord(error) && error.code === "ENOENT") {
      return {
        generation: "legacy",
        anilist: await readJson<AniListMedia[]>(resolve(captureDir, "anilist.json")),
        jikan: await readJson<JikanAnime[]>(resolve(captureDir, "jikan.json")),
      };
    }
    throw error;
  }
  if (!isRecord(manifest) || manifest.version !== 1 || typeof manifest.generation !== "string") {
    throw new Error("capture manifest is invalid");
  }
  const generation = validGenerationId(manifest.generation);
  const generationDir = resolve(captureDir, generationDirectoryName, generation);
  return {
    generation,
    anilist: await readJson<AniListMedia[]>(resolve(generationDir, "anilist.json")),
    jikan: await readJson<JikanAnime[]>(resolve(generationDir, "jikan.json")),
  };
}

function assertPairedCaptureOverrides(anilistPath: string | undefined, jikanPath: string | undefined) {
  if ((anilistPath === undefined) !== (jikanPath === undefined)) {
    throw new Error("provide both --anilist and --jikan together, or neither to use the current capture generation");
  }
}

export async function resolveCaptureSources({
  captureDir,
  anilistPath,
  jikanPath,
}: {
  captureDir: string;
  anilistPath?: string;
  jikanPath?: string;
}): Promise<CapturedSources> {
  assertPairedCaptureOverrides(anilistPath, jikanPath);
  if (anilistPath !== undefined && jikanPath !== undefined) {
    return {
      generation: "explicit",
      anilist: await readJson<AniListMedia[]>(anilistPath),
      jikan: await readJson<JikanAnime[]>(jikanPath),
    };
  }
  return readCapturedSources(captureDir);
}

async function publishCaptureGeneration(
  captureDir: string,
  generation: string,
  anilist: AniListMedia[],
  jikan: JikanAnime[],
  beforePointerSwap?: () => void | Promise<void>,
) {
  const generationDir = resolve(captureDir, generationDirectoryName, validGenerationId(generation));
  await mkdir(resolve(captureDir, generationDirectoryName), { recursive: true });
  await mkdir(generationDir);
  try {
    await Promise.all([
      writeJson(resolve(generationDir, "anilist.json"), anilist),
      writeJson(resolve(generationDir, "jikan.json"), jikan),
    ]);
  } catch (error) {
    await rm(generationDir, { recursive: true, force: true });
    throw error;
  }

  await beforePointerSwap?.();
  const manifestPath = resolve(captureDir, captureManifestName);
  const temporaryManifest = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  await writeJson(temporaryManifest, { version: 1, generation });
  await rename(temporaryManifest, manifestPath);
}

export async function captureSources({
  captureDir,
  pageCount,
  fetchImpl = fetch,
  generationId = generatedId(),
  beforePointerSwap,
  sleep = (milliseconds) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  jikanRetryAttempts = defaultJikanRetryAttempts,
  jikanPageDelayMs = defaultJikanPageDelayMs,
}: {
  captureDir: string;
  pageCount: number;
  fetchImpl?: FetchImpl;
  generationId?: string;
  beforePointerSwap?: () => void | Promise<void>;
  sleep?: Sleep;
  jikanRetryAttempts?: number;
  jikanPageDelayMs?: number;
}) {
  const pages = positivePageCount(pageCount);
  const [anilist, jikan] = await Promise.all([
    fetchAniList(pages, fetchImpl),
    fetchJikan(Math.ceil(pages * 2), fetchImpl, sleep, jikanRetryAttempts, jikanPageDelayMs),
  ]);
  await publishCaptureGeneration(captureDir, generationId, anilist, jikan, beforePointerSwap);
}

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? (() => { throw new Error(`${name} requires a value`); })());
}

async function main(args: string[]) {
  const command = args[0];
  if (!command || command === "--help") {
    console.log("Usage: ranking-pipeline <fetch|review|release> [options]");
    return;
  }
  const root = resolve(import.meta.dirname, "..");
  const captureDir = resolve(root, "data/ranking/captured");
  const mappingsPath = option(args, "--mappings", resolve(root, "data/ranking/bangumi-mappings.json"));
  const anilistPath = args.includes("--anilist") ? option(args, "--anilist", "") : undefined;
  const jikanPath = args.includes("--jikan") ? option(args, "--jikan", "") : undefined;
  assertPairedCaptureOverrides(anilistPath, jikanPath);
  const candidatesPath = option(args, "--candidates", resolve(root, "data/ranking/candidate-review.json"));
  const reportPath = option(args, "--report", resolve(root, "data/ranking/unmatched-report.md"));

  if (command === "fetch") {
    await captureSources({ captureDir, pageCount: Number(option(args, "--pages", "12")) });
    return;
  }
  if (command === "review") {
    const captured = await resolveCaptureSources({ captureDir, anilistPath, jikanPath });
    const anilist = captured.anilist;
    const jikan = captured.jikan;
    const canonicalized = canonicalizeAniListByMal(anilist);
    const canonicalJikan = canonicalizeJikanByMal(jikan);
    const candidates = buildCandidates(canonicalized.anilist, canonicalJikan.jikan, await readJson<BangumiMapping[]>(mappingsPath));
    await writeJson(candidatesPath, candidates);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, formatUnmatchedReport(candidates, canonicalized.discarded, canonicalJikan.discarded), "utf8");
    return;
  }
  if (command === "release") {
    const captured = await resolveCaptureSources({ captureDir, anilistPath, jikanPath });
    const snapshot = buildReleaseSnapshotFromSources(
      captured.anilist,
      captured.jikan,
      await readJson<BangumiMapping[]>(mappingsPath),
      option(args, "--version", new Date().toISOString().slice(0, 10)),
    );
    const output = option(args, "--output", resolve(root, "src/data/ranking.json"));
    const temporary = `${output}.next`;
    await writeJson(temporary, snapshot);
    await rename(temporary, output);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
