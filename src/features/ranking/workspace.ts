import type { RankedWork } from "../../data/schema.ts";
import type { ProgressRecord } from "../../domain/progress.ts";
import {
  queryRankedWorks,
  type PrivateStatusFilter,
  type RankingQuery,
  type RankingSortField,
  type SortDirection,
} from "./query.ts";

export interface RankingWorkspaceState {
  search: string;
  genre: string;
  studio: string;
  status: PrivateStatusFilter;
  sortField: RankingSortField;
  sortDirection: SortDirection;
  selectedWorkId: string | null;
}

export type RankingWorkspaceAction =
  | { type: "search"; value: string }
  | { type: "genre"; value: string }
  | { type: "studio"; value: string }
  | { type: "status"; value: PrivateStatusFilter }
  | { type: "sortField"; value: RankingSortField }
  | { type: "sortDirection"; value: SortDirection }
  | { type: "openDetail"; workId: string }
  | { type: "closeDetail" }
  | { type: "reset" };

export function createRankingWorkspaceState(): RankingWorkspaceState {
  return {
    search: "",
    genre: "",
    studio: "",
    status: "all",
    sortField: "rank",
    sortDirection: "asc",
    selectedWorkId: null,
  };
}

export function reduceRankingWorkspaceState(
  state: RankingWorkspaceState,
  action: RankingWorkspaceAction,
): RankingWorkspaceState {
  switch (action.type) {
    case "search": return { ...state, search: action.value };
    case "genre": return { ...state, genre: action.value };
    case "studio": return { ...state, studio: action.value };
    case "status": return { ...state, status: action.value };
    case "sortField": return { ...state, sortField: action.value };
    case "sortDirection": return { ...state, sortDirection: action.value };
    case "openDetail": return { ...state, selectedWorkId: action.workId };
    case "closeDetail": return { ...state, selectedWorkId: null };
    case "reset": return createRankingWorkspaceState();
  }
}

export function visibleRankingWorks(
  works: readonly RankedWork[],
  progressRecords: readonly ProgressRecord[],
  state: RankingWorkspaceState,
): RankedWork[] {
  const query: RankingQuery = {
    search: state.search,
    genre: state.genre,
    studio: state.studio,
    status: state.status,
    sort: { field: state.sortField, direction: state.sortDirection },
  };

  return queryRankedWorks(works, progressRecords, query);
}
