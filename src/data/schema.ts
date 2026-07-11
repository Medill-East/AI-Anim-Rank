export type RankingSource = "anilist" | "mal" | "bangumi";

export interface SourceScore {
  score: number;
  votes: number;
}

export interface RankedWork {
  workId: string;
  rank: number;
  titleZh: string;
  titleOriginal: string;
  year: number;
  studios: string[];
  genres: string[];
  compositeScore: number;
  sourceScores: Record<RankingSource, SourceScore>;
}

export interface RankingSnapshot {
  version: string;
  methodologyVersion: string;
  sample: boolean;
  works: RankedWork[];
}

const requiredSources: RankingSource[] = ["anilist", "mal", "bangumi"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a nonempty string`);
  }

  return value;
}

function requiredInteger(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be an integer of at least ${minimum}`);
  }

  return value as number;
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }

  return value;
}

function requiredStringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must contain at least one value`);
  }

  return value.map((item, index) => requiredString(item, `${path}[${index}]`));
}

function parseSourceScores(value: unknown, path: string): Record<RankingSource, SourceScore> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return Object.fromEntries(
    requiredSources.map((source) => {
      const sourceValue = value[source];
      if (!isRecord(sourceValue)) {
        throw new Error(`${path}.${source} must be an object`);
      }

      return [
        source,
        {
          score: requiredNumber(sourceValue.score, `${path}.${source}.score`),
          votes: requiredInteger(sourceValue.votes, `${path}.${source}.votes`, 0),
        },
      ];
    }),
  ) as Record<RankingSource, SourceScore>;
}

function parseRankedWork(value: unknown, index: number): RankedWork {
  const path = `works[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const compositeScore = requiredNumber(value.compositeScore, `${path}.compositeScore`);
  if (compositeScore < 0 || compositeScore > 100) {
    throw new Error(`${path}.compositeScore must be between 0 and 100`);
  }

  return {
    workId: requiredString(value.workId, `${path}.workId`),
    rank: requiredInteger(value.rank, `${path}.rank`, 1),
    titleZh: requiredString(value.titleZh, `${path}.titleZh`),
    titleOriginal: requiredString(value.titleOriginal, `${path}.titleOriginal`),
    year: requiredInteger(value.year, `${path}.year`, 1),
    studios: requiredStringList(value.studios, `${path}.studios`),
    genres: requiredStringList(value.genres, `${path}.genres`),
    compositeScore,
    sourceScores: parseSourceScores(value.sourceScores, `${path}.sourceScores`),
  };
}

export function parseRankingSnapshot(value: unknown): RankingSnapshot {
  if (!isRecord(value)) {
    throw new Error("ranking snapshot must be an object");
  }
  if (!Array.isArray(value.works)) {
    throw new Error("works must be an array");
  }
  if (typeof value.sample !== "boolean") {
    throw new Error("sample must be a boolean");
  }

  const works = value.works.map(parseRankedWork);
  const workIds = new Set<string>();
  const ranks = new Set<number>();

  for (const work of works) {
    if (workIds.has(work.workId)) {
      throw new Error(`duplicate workId: ${work.workId}`);
    }
    if (ranks.has(work.rank)) {
      throw new Error(`duplicate rank: ${work.rank}`);
    }
    workIds.add(work.workId);
    ranks.add(work.rank);
  }

  return {
    version: requiredString(value.version, "version"),
    methodologyVersion: requiredString(value.methodologyVersion, "methodologyVersion"),
    sample: value.sample,
    works,
  };
}
