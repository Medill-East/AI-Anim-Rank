import type { RankedWork } from "../../data/schema.ts";
import type { ProgressRecord } from "../../domain/progress.ts";

export type PrivateStatusFilter =
  | "all"
  | "watched"
  | "unwatched"
  | "reviewed"
  | "recommended"
  | "notInterested"
  | "watchedUnreviewed";

export type RankingSortField = "rank" | "compositeScore" | "year";
export type SortDirection = "asc" | "desc";

export interface RankingQuery {
  search?: string;
  genre?: string;
  status?: PrivateStatusFilter;
  sort?: {
    field: RankingSortField;
    direction: SortDirection;
  };
}

export function queryRankedWorks(
  works: readonly RankedWork[],
  progressRecords: readonly ProgressRecord[],
  query: RankingQuery = {},
): RankedWork[] {
  const progressByWorkId = new Map(progressRecords.map((record) => [record.workId, record]));
  const search = query.search?.trim().toLocaleLowerCase();
  const genre = query.genre?.trim().toLocaleLowerCase();
  const sort = query.sort ?? { field: "rank", direction: "asc" as const };

  return works
    .filter((work) => matchesSearch(work, search))
    .filter((work) => matchesGenre(work, genre))
    .filter((work) => matchesStatus(progressByWorkId.get(work.workId), query.status ?? "all"))
    .slice()
    .sort((left, right) => compareWorks(left, right, sort.field, sort.direction));
}

function matchesSearch(work: RankedWork, search: string | undefined): boolean {
  return !search ||
    work.titleZh.toLocaleLowerCase().includes(search) ||
    work.titleOriginal.toLocaleLowerCase().includes(search);
}

function matchesGenre(work: RankedWork, genre: string | undefined): boolean {
  return !genre || work.genres.some((workGenre) => workGenre.toLocaleLowerCase() === genre);
}

function matchesStatus(record: ProgressRecord | undefined, status: PrivateStatusFilter): boolean {
  switch (status) {
    case "all": return true;
    case "watched": return record?.watched === true;
    case "unwatched": return record?.watched !== true;
    case "reviewed": return record?.reviewed === true;
    case "recommended": return record?.recommended === true;
    case "notInterested": return record?.notInterested === true;
    case "watchedUnreviewed": return record?.watched === true && record.reviewed === false;
  }
}

function compareWorks(
  left: RankedWork,
  right: RankedWork,
  field: RankingSortField,
  direction: SortDirection,
): number {
  const primary = (left[field] - right[field]) * (direction === "asc" ? 1 : -1);
  return primary || left.rank - right.rank || left.workId.localeCompare(right.workId);
}
