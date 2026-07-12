import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { resolveCaptureSources, selectBangumiMapping, type BangumiMapping } from "./ranking-pipeline.ts";

const bangumiSearchUrl = "https://api.bgm.tv/v0/search/subjects";
const defaultRequestDelayMs = 1_000;
const resultLimit = 5;
const suggestionGenerationDirectoryName = "generations";
const suggestionManifestName = "current.json";

type FetchResponse = Pick<Response, "ok" | "status" | "json">;
type FetchImpl = (input: string, init?: RequestInit) => Promise<FetchResponse>;
type Sleep = (milliseconds: number) => Promise<void>;
type Rename = (oldPath: string, newPath: string) => Promise<void>;

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

export interface BangumiSuggestionPair {
  generation: string;
  suggestions: BangumiSuggestions;
  report: string;
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

async function writeArtifact(path: string, content: string, renameImpl: Rename) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, "utf8");
    await renameImpl(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeJson(path: string, value: unknown, renameImpl: Rename) {
  await writeArtifact(path, `${JSON.stringify(value, null, 2)}\n`, renameImpl);
}

function validGenerationId(generation: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(generation)) throw new Error("suggestion generation has an invalid name");
  return generation;
}

function generatedGenerationId(): string {
  return `suggestions-${new Date().toISOString().replace(/\D/g, "")}-${process.pid}`;
}

async function publishSuggestionGeneration({
  artifactDirectory,
  generation,
  suggestions,
  reportText,
  renameImpl,
  beforePointerSwap,
}: {
  artifactDirectory: string;
  generation: string;
  suggestions: BangumiSuggestions;
  reportText: string;
  renameImpl: Rename;
  beforePointerSwap?: () => void | Promise<void>;
}) {
  const generationDirectory = resolve(artifactDirectory, suggestionGenerationDirectoryName, validGenerationId(generation));
  await mkdir(resolve(artifactDirectory, suggestionGenerationDirectoryName), { recursive: true });
  await mkdir(generationDirectory);
  try {
    await writeJson(resolve(generationDirectory, "suggestions.json"), suggestions, renameImpl);
    await writeArtifact(resolve(generationDirectory, "report.md"), reportText, renameImpl);
    await beforePointerSwap?.();
    const manifestPath = resolve(artifactDirectory, suggestionManifestName);
    const temporaryManifest = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeJson(temporaryManifest, { version: 1, generation }, renameImpl);
      await renameImpl(temporaryManifest, manifestPath);
    } catch (error) {
      await rm(temporaryManifest, { force: true });
      throw error;
    }
  } catch (error) {
    await rm(generationDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function readBangumiSuggestionPair(artifactDirectory: string): Promise<BangumiSuggestionPair> {
  const manifest = await readJson<unknown>(resolve(artifactDirectory, suggestionManifestName));
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error("suggestion manifest is invalid");
  }
  const manifestRecord = manifest as { version?: unknown; generation?: unknown };
  if (manifestRecord.version !== 1 || typeof manifestRecord.generation !== "string") throw new Error("suggestion manifest is invalid");
  const generation = validGenerationId(manifestRecord.generation);
  const generationDirectory = resolve(artifactDirectory, suggestionGenerationDirectoryName, generation);
  return {
    generation,
    suggestions: await readJson<BangumiSuggestions>(resolve(generationDirectory, "suggestions.json")),
    report: await readFile(resolve(generationDirectory, "report.md"), "utf8"),
  };
}

export async function generateBangumiSuggestions({
  anilist,
  jikan,
  mappings,
  artifactDirectory,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  requestDelayMs = defaultRequestDelayMs,
  env,
  log = console.log,
  renameImpl = rename,
  generationId = generatedGenerationId(),
  beforePointerSwap,
}: {
  anilist: AniListCandidate[];
  jikan: JikanCandidate[];
  mappings: BangumiMapping[];
  artifactDirectory: string;
  fetchImpl?: FetchImpl;
  sleep?: Sleep;
  requestDelayMs?: number;
  env?: Readonly<{ BANGUMI_ACCESS_TOKEN?: string }>;
  log?: (message: string) => void;
  renameImpl?: Rename;
  generationId?: string;
  beforePointerSwap?: () => void | Promise<void>;
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
  await publishSuggestionGeneration({ artifactDirectory, generation: generationId, suggestions, reportText: report(suggestions), renameImpl, beforePointerSwap });
  log(`Bangumi mapping suggestions: ${suggestions.status}; ${entries.length} candidates written for human review.`);
  return suggestions;
}

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? (() => { throw new Error(`${name} requires a value`); })());
}

function isWithin(path: string, directory: string): boolean {
  return path.startsWith(`${directory}${sep}`);
}

async function nearestExistingParent(path: string): Promise<string> {
  let parent = dirname(path);
  while (parent !== dirname(parent)) {
    try {
      return await realpath(parent);
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        parent = dirname(parent);
        continue;
      }
      throw error;
    }
  }
  return realpath(parent);
}

async function canonicalArtifactPath(path: string, allowedDirectory: string): Promise<string> {
  const parent = await nearestExistingParent(path);
  if (!isWithin(parent, allowedDirectory) && parent !== allowedDirectory) throw new Error("suggestion output path is protected");
  try {
    const existing = await realpath(path);
    if (!isWithin(existing, allowedDirectory)) throw new Error("suggestion output path is protected");
    return existing;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return resolve(parent, path.slice(parent.length + 1));
    }
    throw error;
  }
}

export async function assertSuggestionOutputPaths(root: string, suggestionsPath: string, reportPath: string) {
  const lexicalRoot = resolve(root);
  const rootPath = await realpath(root);
  const artifactDirectory = resolve(rootPath, "data/ranking/bangumi-suggestions");
  await mkdir(artifactDirectory, { recursive: true });
  const realArtifactDirectory = await realpath(artifactDirectory);
  if (realArtifactDirectory !== artifactDirectory) throw new Error("suggestion output path is protected");
  const requested = [suggestionsPath, reportPath].map((path) => {
    const lexicalPath = resolve(root, path);
    const rootRelativePath = relative(lexicalRoot, lexicalPath);
    return resolve(rootPath, rootRelativePath);
  });
  if (requested.some((path) => !isWithin(path, artifactDirectory))) throw new Error("suggestion output path is protected");
  const [suggestionsArtifact, reportArtifact] = await Promise.all(requested.map((path) => canonicalArtifactPath(path, realArtifactDirectory)));
  if (suggestionsArtifact === reportArtifact || isWithin(suggestionsArtifact, reportArtifact) || isWithin(reportArtifact, suggestionsArtifact)) {
    throw new Error("suggestion output paths overlap");
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
  const artifactDirectory = resolve(root, "data/ranking/bangumi-suggestions");
  await assertSuggestionOutputPaths(root, resolve(artifactDirectory, "generations/suggestions.json"), resolve(artifactDirectory, "generations/report.md"));
  const captured = await resolveCaptureSources({ captureDir, anilistPath, jikanPath });
  await generateBangumiSuggestions({
    anilist: captured.anilist,
    jikan: captured.jikan,
    mappings: await readJson<BangumiMapping[]>(resolve(root, "data/ranking/bangumi-mappings.json")),
    artifactDirectory,
  });
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
