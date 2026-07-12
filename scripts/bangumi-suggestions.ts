import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveCaptureSources, selectBangumiMapping, type BangumiMapping } from "./ranking-pipeline.ts";

const bangumiSearchUrl = "https://api.bgm.tv/v0/search/subjects";
const defaultRequestDelayMs = 1_000;
const resultLimit = 5;

type FetchResponse = Pick<Response, "ok" | "status" | "json">;
type FetchImpl = (input: string, init?: RequestInit) => Promise<FetchResponse>;
type Sleep = (milliseconds: number) => Promise<void>;

interface AniListTitle {
  chinese?: string | null;
  native?: string | null;
  romaji?: string | null;
}

interface AniListCandidate {
  id: number;
  idMal: number | null;
  title: AniListTitle;
}

interface JikanCandidate {
  mal_id: number;
  title: string;
}

interface BangumiSubject {
  id: number;
  name: string;
  name_cn?: string;
  rating?: { score?: number; total?: number };
}

interface SuggestionResult {
  subjectId: number;
  name: string;
  nameCn: string | null;
  ratingScore: number | null;
  ratingTotal: number | null;
  matchScore: number;
}

interface SuggestionEntry {
  anilistId: number;
  malId: number | null;
  jikanTitle: string | null;
  query: string;
  results: SuggestionResult[];
  accepted: false;
}

interface Diagnostic {
  kind: "authentication" | "request" | "invalid-response";
  status?: number;
  nextStep: string;
}

export interface BangumiSuggestions {
  status: "complete" | "blocked";
  generatedAt: string;
  entries: SuggestionEntry[];
  diagnostic?: Diagnostic;
  approvalRequired: true;
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function preferredTitle(candidate: AniListCandidate): string | null {
  for (const title of [candidate.title.chinese, candidate.title.native, candidate.title.romaji]) {
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return null;
}

function isSubject(value: unknown): value is BangumiSubject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const subject = value as BangumiSubject;
  return Number.isInteger(subject.id) && subject.id > 0
    && typeof subject.name === "string"
    && typeof subject.name_cn === "string"
    && typeof subject.rating === "object" && subject.rating !== null
    && typeof subject.rating.score === "number" && Number.isFinite(subject.rating.score)
    && typeof subject.rating.total === "number" && Number.isInteger(subject.rating.total) && subject.rating.total >= 0;
}

function parseSubjects(payload: unknown): BangumiSubject[] {
  if (typeof payload !== "object" || payload === null || !("data" in payload) || !Array.isArray(payload.data)) {
    throw new Error("Bangumi response data must be an array");
  }
  if (!payload.data.every(isSubject)) throw new Error("Bangumi response contains an invalid subject");
  return payload.data.slice(0, resultLimit);
}

function toSuggestionResult(subject: BangumiSubject, query: string): SuggestionResult {
  const normalizedQuery = normalizeTitle(query);
  const exact = [subject.name, subject.name_cn]
    .filter((title): title is string => typeof title === "string" && title.trim().length > 0)
    .some((title) => normalizeTitle(title) === normalizedQuery);
  return {
    subjectId: subject.id,
    name: subject.name,
    nameCn: subject.name_cn ?? null,
    ratingScore: subject.rating?.score ?? null,
    ratingTotal: subject.rating?.total ?? null,
    matchScore: exact ? 1 : 0,
  };
}

function report(suggestions: BangumiSuggestions): string {
  const lines = [
    "# Bangumi mapping suggestions",
    "",
    "These are non-authoritative search suggestions. Human approval is required before any formal mapping is added.",
    "",
    `Status: ${suggestions.status}`,
    `Candidates reviewed: ${suggestions.entries.length}`,
  ];
  if (suggestions.diagnostic) {
    lines.push("", "## Resumable diagnostic", "", `- ${suggestions.diagnostic.kind === "authentication" ? "Authentication is required or was rejected." : "The Bangumi request could not be completed."}`, `- ${suggestions.diagnostic.nextStep}`);
    if (suggestions.diagnostic.status !== undefined) lines.push(`- Bangumi HTTP status: ${suggestions.diagnostic.status}`);
  }
  const withoutResults = suggestions.entries.filter((entry) => entry.results.length === 0);
  const ambiguous = suggestions.entries.filter((entry) => entry.results.length > 1 || entry.results.some((result) => result.matchScore === 0));
  lines.push("", "## Candidates", "", ...suggestions.entries.map((entry) => `- AniList ${entry.anilistId}: ${entry.query} (${entry.results.length} results; never auto-accepted)`));
  lines.push("", "## No result", "", ...(withoutResults.length === 0 ? ["- None"] : withoutResults.map((entry) => `- AniList ${entry.anilistId}: ${entry.query}`)));
  lines.push("", "## Ambiguous or non-exact", "", ...(ambiguous.length === 0 ? ["- None"] : ambiguous.map((entry) => `- AniList ${entry.anilistId}: ${entry.query}`)), "");
  return lines.join("\n");
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function generateBangumiSuggestions({
  anilist,
  jikan,
  mappings,
  suggestionsPath,
  reportPath,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  requestDelayMs = defaultRequestDelayMs,
  env,
  log = console.log,
}: {
  anilist: AniListCandidate[];
  jikan: JikanCandidate[];
  mappings: BangumiMapping[];
  suggestionsPath: string;
  reportPath: string;
  fetchImpl?: FetchImpl;
  sleep?: Sleep;
  requestDelayMs?: number;
  env?: Readonly<{ BANGUMI_ACCESS_TOKEN?: string }>;
  log?: (message: string) => void;
}): Promise<BangumiSuggestions> {
  if (!Number.isInteger(requestDelayMs) || requestDelayMs < 0) throw new Error("request delay must be a non-negative integer");
  const token = env === undefined ? process.env.BANGUMI_ACCESS_TOKEN : env.BANGUMI_ACCESS_TOKEN;
  const entries: SuggestionEntry[] = [];
  let diagnostic: Diagnostic | undefined;
  const jikanTitles = new Map(jikan.map((candidate) => [candidate.mal_id, candidate.title]));
  const candidates = anilist
    .filter((candidate) => selectBangumiMapping(candidate, mappings) === undefined)
    .map((candidate) => ({ candidate, query: preferredTitle(candidate) }))
    .filter((item): item is { candidate: AniListCandidate; query: string } => item.query !== null);

  for (let index = 0; index < candidates.length; index += 1) {
    if (index > 0) await sleep(requestDelayMs);
    const { candidate, query } = candidates[index]!;
    let response: FetchResponse;
    try {
      response = await fetchImpl(bangumiSearchUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; AI-Anim-Rank BangumiSuggestions/1.0)",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ keyword: query, filter: { type: [2] }, limit: resultLimit }),
      });
    } catch {
      diagnostic = { kind: "request", nextStep: "Check network access and rerun this suggestion command; no formal mappings were created." };
      break;
    }
    if (!response.ok) {
      diagnostic = response.status === 401 || response.status === 403
        ? { kind: "authentication", status: response.status, nextStep: "Set BANGUMI_ACCESS_TOKEN in the environment if your Bangumi access requires it, then rerun; no formal mappings were created." }
        : { kind: "request", status: response.status, nextStep: "Resolve the Bangumi request error and rerun; no formal mappings were created." };
      break;
    }
    try {
      entries.push({
        anilistId: candidate.id,
        malId: candidate.idMal,
        jikanTitle: candidate.idMal === null ? null : jikanTitles.get(candidate.idMal) ?? null,
        query,
        results: parseSubjects(await response.json()).map((subject) => toSuggestionResult(subject, query)),
        accepted: false,
      });
    } catch {
      diagnostic = { kind: "invalid-response", nextStep: "Bangumi returned an unexpected response; rerun after checking the API response; no formal mappings were created." };
      break;
    }
  }

  const suggestions: BangumiSuggestions = {
    status: diagnostic ? "blocked" : "complete",
    generatedAt: new Date().toISOString(),
    entries,
    ...(diagnostic ? { diagnostic } : {}),
    approvalRequired: true,
  };
  await writeJson(suggestionsPath, suggestions);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report(suggestions), "utf8");
  log(`Bangumi mapping suggestions: ${suggestions.status}; ${entries.length} candidates written for human review.`);
  return suggestions;
}

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? (() => { throw new Error(`${name} requires a value`); })());
}

export function assertSuggestionOutputPaths(root: string, suggestionsPath: string, reportPath: string) {
  const protectedMappingPath = resolve(root, "data/ranking/bangumi-mappings.json");
  const protectedReleaseDataPath = resolve(root, "src/data");
  for (const path of [resolve(root, suggestionsPath), resolve(root, reportPath)]) {
    if (path === protectedMappingPath || path === protectedReleaseDataPath || path.startsWith(`${protectedReleaseDataPath}/`)) {
      throw new Error("suggestion output path is protected");
    }
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function main(args: string[]) {
  const root = resolve(import.meta.dirname, "..");
  const captureDir = resolve(root, "data/ranking/captured");
  const anilistPath = args.includes("--anilist") ? option(args, "--anilist", "") : undefined;
  const jikanPath = args.includes("--jikan") ? option(args, "--jikan", "") : undefined;
  const suggestionsPath = option(args, "--output", resolve(root, "data/ranking/bangumi-suggestions.json"));
  const reportPath = option(args, "--report", resolve(root, "data/ranking/bangumi-suggestions-report.md"));
  assertSuggestionOutputPaths(root, suggestionsPath, reportPath);
  const captured = await resolveCaptureSources({ captureDir, anilistPath, jikanPath });
  await generateBangumiSuggestions({
    anilist: captured.anilist,
    jikan: captured.jikan,
    mappings: await readJson<BangumiMapping[]>(resolve(root, "data/ranking/bangumi-mappings.json")),
    suggestionsPath,
    reportPath,
  });
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
