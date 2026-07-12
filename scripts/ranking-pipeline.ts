import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  const eligible = candidates.filter((candidate) => candidate.eligible && candidate.mal && candidate.bangumi && candidate.compositeScore !== null);
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

async function fetchAniList(pageCount: number): Promise<AniListMedia[]> {
  const query = `query ($page: Int!) { Page(page: $page, perPage: 50) { media(type: ANIME, sort: SCORE_DESC) { id idMal title { romaji native } averageScore popularity seasonYear studios { nodes { name } } genres } } }`;
  const pages = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
    const response = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { page: index + 1 } }) });
    if (!response.ok) throw new Error(`AniList request failed: ${response.status}`);
    const payload = await response.json() as { data?: { Page?: { media?: AniListMedia[] } } };
    return payload.data?.Page?.media ?? [];
  }));
  return pages.flat();
}

async function fetchJikan(pageCount: number): Promise<JikanAnime[]> {
  const pages = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
    const response = await fetch(`https://api.jikan.moe/v4/top/anime?page=${index + 1}&limit=25`);
    if (!response.ok) throw new Error(`Jikan request failed: ${response.status}`);
    const payload = await response.json() as { data?: JikanAnime[] };
    return payload.data ?? [];
  }));
  return pages.flat();
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
  const candidatesPath = option(args, "--candidates", resolve(root, "data/ranking/candidate-review.json"));
  const reportPath = option(args, "--report", resolve(root, "data/ranking/unmatched-report.md"));

  if (command === "fetch") {
    const pageCount = Number(option(args, "--pages", "12"));
    await writeJson(resolve(captureDir, "anilist.json"), await fetchAniList(pageCount));
    await writeJson(resolve(captureDir, "jikan.json"), await fetchJikan(Math.ceil(pageCount * 2)));
    return;
  }
  if (command === "review") {
    const anilist = await readJson<AniListMedia[]>(option(args, "--anilist", resolve(captureDir, "anilist.json")));
    const jikan = await readJson<JikanAnime[]>(option(args, "--jikan", resolve(captureDir, "jikan.json")));
    const candidates = buildCandidates(anilist, jikan, await readJson<BangumiMapping[]>(mappingsPath));
    await writeJson(candidatesPath, candidates);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, unmatchedReport(candidates), "utf8");
    return;
  }
  if (command === "release") {
    const snapshot = buildReleaseSnapshot(await readJson<RankingCandidate[]>(candidatesPath), option(args, "--version", new Date().toISOString().slice(0, 10)));
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
