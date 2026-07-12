import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
export function selectBangumiMapping(media: AniListMedia, mappings: BangumiMapping[]): BangumiMapping | undefined {
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
  for (const media of anilist) {
    requiredExternalId(media.id, "AniList id");
    if (media.idMal !== null) requiredExternalId(media.idMal, "MAL id");
  }
  for (const anime of jikan) requiredExternalId(anime.mal_id, "Jikan MAL id");
  rejectDuplicates(anilist, (media) => media.id, "AniList id");
  rejectDuplicates(anilist.filter((media) => media.idMal !== null), (media) => media.idMal ?? undefined, "AniList idMal");
  rejectDuplicates(jikan, (anime) => anime.mal_id, "Jikan MAL id");
  validateMappings(mappings);
  const jikanByMal = new Map(jikan.map((anime) => [anime.mal_id, anime]));

  return anilist.map((media) => {
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
  const rawAniList = candidates.map((candidate) => candidate.anilist);
  const rawMal: JikanAnime[] = [];
  const rawBangumi: BangumiMapping[] = [];

  for (const candidate of candidates) {
    if (candidate.mal === null || candidate.bangumi === null) {
      throw new Error(`release candidate AniList ${candidate.anilist.id} is missing a required source`);
    }
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
    const original = candidates[index]!;
    const candidate = recomputed[index]!;
    if (candidate.mal?.mal_id !== original.mal!.mal_id || candidate.bangumi?.bangumiId !== original.bangumi!.bangumiId) {
      throw new Error(`release candidate AniList ${original.anilist.id} does not match its reviewed source IDs`);
    }
  }

  const eligible = recomputed.filter((candidate) => candidate.eligible && candidate.mal && candidate.bangumi && candidate.compositeScore !== null);
  if (eligible.length !== 300) throw new Error(`release requires exactly 300 fully mapped eligible works; found ${eligible.length}`);

  const works: RankedWork[] = eligible
    .sort((left, right) => right.compositeScore! - left.compositeScore! || left.anilist.id - right.anilist.id)
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

function unmatchedReport(candidates: RankingCandidate[]): string {
  const unmatched = candidates.filter((candidate) => candidate.ineligibilityReasons.length > 0);
  return [
    `# Ranking candidate unmatched report`,
    "",
    `Candidates: ${candidates.length}`,
    `Eligible: ${candidates.length - unmatched.length}`,
    `Needs review: ${unmatched.length}`,
    "",
    ...unmatched.map((candidate) => `- AniList ${candidate.anilist.id} (${candidate.anilist.title.romaji ?? candidate.anilist.title.native ?? "untitled"}): ${candidate.ineligibilityReasons.join("; ")}`),
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

type FetchResponse = Pick<Response, "ok" | "status" | "json">;
type FetchImpl = (input: string, init?: RequestInit) => Promise<FetchResponse>;

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

async function fetchJikan(pageCount: number, fetchImpl: FetchImpl): Promise<JikanAnime[]> {
  const pages = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
    const response = await fetchImpl(`https://api.jikan.moe/v4/top/anime?page=${index + 1}&limit=25`);
    if (!response.ok) throw new Error(`Jikan request failed: ${response.status}`);
    const payload = await response.json();
    const data = isRecord(payload) ? payload.data : undefined;
    if (!Array.isArray(data) || data.length === 0) throw new Error("Jikan response data must be a non-empty array");
    return data as JikanAnime[];
  }));
  return pages.flat();
}

async function removeIfPresent(path: string) {
  await unlink(path).catch((error: unknown) => {
    if (!(isRecord(error) && error.code === "ENOENT")) throw error;
  });
}

async function replaceCapturePair(captureDir: string, anilist: AniListMedia[], jikan: JikanAnime[]) {
  await mkdir(captureDir, { recursive: true });
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const targets = [
    { path: resolve(captureDir, "anilist.json"), value: anilist },
    { path: resolve(captureDir, "jikan.json"), value: jikan },
  ];
  const staged = targets.map((target) => ({ ...target, temporary: `${target.path}${suffix}`, backup: `${target.path}.bak${suffix}`, hadOriginal: false }));

  try {
    await Promise.all(staged.map((target) => writeJson(target.temporary, target.value)));
    for (const target of staged) {
      try {
        await rename(target.path, target.backup);
        target.hadOriginal = true;
      } catch (error: unknown) {
        if (!(isRecord(error) && error.code === "ENOENT")) throw error;
      }
    }
    for (const target of staged) await rename(target.temporary, target.path);
    await Promise.all(staged.map((target) => removeIfPresent(target.backup)));
  } catch (error) {
    await Promise.all(staged.map(async (target) => {
      await removeIfPresent(target.temporary);
      if (target.hadOriginal) {
        await removeIfPresent(target.path);
        await rename(target.backup, target.path).catch(async (rollbackError: unknown) => {
          if (!(isRecord(rollbackError) && rollbackError.code === "ENOENT")) throw rollbackError;
        });
      } else {
        await removeIfPresent(target.path);
      }
    }));
    throw error;
  }
}

export async function captureSources({
  captureDir,
  pageCount,
  fetchImpl = fetch,
}: {
  captureDir: string;
  pageCount: number;
  fetchImpl?: FetchImpl;
}) {
  const pages = positivePageCount(pageCount);
  const [anilist, jikan] = await Promise.all([
    fetchAniList(pages, fetchImpl),
    fetchJikan(Math.ceil(pages * 2), fetchImpl),
  ]);
  await replaceCapturePair(captureDir, anilist, jikan);
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
  const anilistPath = option(args, "--anilist", resolve(captureDir, "anilist.json"));
  const jikanPath = option(args, "--jikan", resolve(captureDir, "jikan.json"));
  const candidatesPath = option(args, "--candidates", resolve(root, "data/ranking/candidate-review.json"));
  const reportPath = option(args, "--report", resolve(root, "data/ranking/unmatched-report.md"));

  if (command === "fetch") {
    await captureSources({ captureDir, pageCount: Number(option(args, "--pages", "12")) });
    return;
  }
  if (command === "review") {
    const anilist = await readJson<AniListMedia[]>(anilistPath);
    const jikan = await readJson<JikanAnime[]>(jikanPath);
    const candidates = buildCandidates(anilist, jikan, await readJson<BangumiMapping[]>(mappingsPath));
    await writeJson(candidatesPath, candidates);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, unmatchedReport(candidates), "utf8");
    return;
  }
  if (command === "release") {
    const snapshot = buildReleaseSnapshotFromSources(
      await readJson<AniListMedia[]>(anilistPath),
      await readJson<JikanAnime[]>(jikanPath),
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
