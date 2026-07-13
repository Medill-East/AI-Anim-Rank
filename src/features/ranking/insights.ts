import type { RankedWork } from "../../data/schema.ts";
import type { ProgressRecord } from "../../domain/progress.ts";

export interface ProgressInsightItem {
  label: string;
  count: number;
  percentage: number;
}

export interface ProgressInsights {
  completion: number;
  watchedCount: number;
  recommendedCount: number;
  topGenres: ProgressInsightItem[];
  topStudio: { label: string; count: number } | null;
}

export function deriveProgressInsights(
  works: readonly RankedWork[],
  records: readonly ProgressRecord[],
): ProgressInsights {
  const watchedWorkIds = new Set(records.filter((record) => record.watched).map((record) => record.workId));
  const watchedWorks = works.filter((work) => watchedWorkIds.has(work.workId));
  const watchedCount = watchedWorks.length;
  const topGenres = countLabels(watchedWorks.flatMap((work) => work.genres), watchedCount).slice(0, 3);
  const studios = countLabels(watchedWorks.flatMap((work) => work.studios), watchedCount);

  return {
    completion: works.length === 0 ? 0 : Math.round(watchedCount / works.length * 100),
    watchedCount,
    recommendedCount: records.filter((record) => record.recommended).length,
    topGenres,
    topStudio: studios[0] ? { label: studios[0].label, count: studios[0].count } : null,
  };
}

function countLabels(labels: readonly string[], watchedCount: number): ProgressInsightItem[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, percentage: watchedCount === 0 ? 0 : Math.round(count / watchedCount * 100) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"));
}
