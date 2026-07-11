"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";

import type { RankedWork } from "../../data/schema.ts";
import type { ProgressRecord } from "../../domain/progress.ts";
import {
  createRankingWorkspaceState,
  reduceRankingWorkspaceState,
  visibleRankingWorks,
} from "./workspace.ts";
import type { PrivateStatusFilter, RankingSortField, SortDirection } from "./query.ts";

type PublicProgress = Pick<ProgressRecord, "watched" | "reviewed" | "recommended" | "notInterested">;

interface RankingWorkspaceProps {
  works: readonly RankedWork[];
  progressByWorkId?: Readonly<Record<string, PublicProgress>>;
}

const statusOptions: ReadonlyArray<{ value: PrivateStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "watched", label: "已看" },
  { value: "unwatched", label: "未看" },
  { value: "reviewed", label: "已评价" },
  { value: "recommended", label: "想推荐" },
  { value: "notInterested", label: "不感兴趣" },
  { value: "watchedUnreviewed", label: "已看未评价" },
];

const sortOptions: ReadonlyArray<{ value: RankingSortField; label: string }> = [
  { value: "rank", label: "排名" },
  { value: "compositeScore", label: "综合分" },
  { value: "year", label: "年份" },
];

export function RankingWorkspace({ works, progressByWorkId = {} }: RankingWorkspaceProps) {
  const [state, dispatch] = useReducer(reduceRankingWorkspaceState, undefined, createRankingWorkspaceState);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const progressRecords = useMemo<ProgressRecord[]>(
    () => Object.entries(progressByWorkId).map(([workId, progress]) => ({
      workId,
      ...progress,
      updatedAt: "",
      revision: 0,
    })),
    [progressByWorkId],
  );
  const visibleWorks = useMemo(
    () => visibleRankingWorks(works, progressRecords, state),
    [works, progressRecords, state],
  );
  const selectedWork = works.find((work) => work.workId === state.selectedWorkId) ?? null;
  const genres = useMemo(
    () => [...new Set(works.flatMap((work) => work.genres))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [works],
  );
  const openDetail = (workId: string, trigger: HTMLElement) => {
    detailTriggerRef.current = trigger;
    dispatch({ type: "openDetail", workId });
  };
  const closeDetail = () => {
    dispatch({ type: "closeDetail" });
    detailTriggerRef.current?.focus();
  };

  return (
    <section className="ranking-workspace" aria-label="AI Anim Rank">
      <header className="ranking-masthead">
        <p className="ranking-kicker">PUBLIC ANIMATION INDEX</p>
        <h1>AI Anim Rank</h1>
        <p>公开作品资料与可复核排序，个人进度仅保留在本地。</p>
      </header>

      <form className="ranking-controls" role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="work-search">搜索作品</label>
        <input
          id="work-search"
          type="search"
          name="query"
          value={state.search}
          onChange={(event) => dispatch({ type: "search", value: event.target.value })}
          placeholder="中文或原文标题"
        />
        <label htmlFor="genre-filter">类型</label>
        <select id="genre-filter" value={state.genre} onChange={(event) => dispatch({ type: "genre", value: event.target.value })}>
          <option value="">全部类型</option>
          {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
        </select>
        <label htmlFor="status-filter">本地状态</label>
        <select id="status-filter" value={state.status} onChange={(event) => dispatch({ type: "status", value: event.target.value as PrivateStatusFilter })}>
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label htmlFor="sort-field">排序</label>
        <select id="sort-field" value={state.sortField} onChange={(event) => dispatch({ type: "sortField", value: event.target.value as RankingSortField })}>
          {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label htmlFor="sort-direction">方向</label>
        <select id="sort-direction" value={state.sortDirection} onChange={(event) => dispatch({ type: "sortDirection", value: event.target.value as SortDirection })}>
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
        <button type="button" className="text-button" onClick={() => dispatch({ type: "reset" })}>重置筛选</button>
      </form>

      {works.length === 0 ? <p className="ranking-empty" role="status">榜单数据准备中</p> : <>
        <p className="ranking-result" aria-live="polite">显示 {visibleWorks.length} 部作品</p>
        <div className="ranking-table-region" aria-label="榜单结果">
          <table>
            <thead><tr><th>排名</th><th>作品</th><th>年份</th><th>类型</th><th>综合分</th><th>本地进度</th></tr></thead>
            <tbody>{visibleWorks.map((work) => <DesktopRow key={work.workId} work={work} progress={progressByWorkId[work.workId]} onOpen={(trigger) => openDetail(work.workId, trigger)} />)}</tbody>
          </table>
        </div>
        <div className="ranking-mobile-list" aria-label="榜单结果（紧凑视图）">
          {visibleWorks.map((work) => <MobileRow key={work.workId} work={work} onOpen={(trigger) => openDetail(work.workId, trigger)} />)}
        </div>
        {visibleWorks.length === 0 && <p className="ranking-empty">没有符合条件的作品。</p>}
      </>}

      {selectedWork && <WorkDialog work={selectedWork} onClose={closeDetail} />}
    </section>
  );
}

function DesktopRow({ work, progress, onOpen }: { work: RankedWork; progress?: PublicProgress; onOpen: (trigger: HTMLElement) => void }) {
  return <tr tabIndex={0} onClick={(event) => onOpen(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(event.currentTarget); } }}>
    <td>{work.rank}</td><td><button type="button" className="work-title" onClick={(event) => { event.stopPropagation(); onOpen(event.currentTarget); }}>{work.titleZh}<span>{work.titleOriginal}</span></button></td><td>{work.year}</td><td>{work.genres.join(" · ")}</td><td>{work.compositeScore.toFixed(1)}</td><td>{progressLabel(progress)}</td>
  </tr>;
}

function MobileRow({ work, onOpen }: { work: RankedWork; onOpen: (trigger: HTMLElement) => void }) {
  return <div className="mobile-work-row"><button type="button" className="mobile-work-title" onClick={(event) => onOpen(event.currentTarget)}><span>#{work.rank}</span><strong>{work.titleZh}</strong><span>{work.year}</span></button><details><summary>展开公开资料</summary><div className="mobile-work-detail"><p>{work.titleOriginal}</p><p>{work.genres.join(" · ")} · {work.compositeScore.toFixed(1)}</p></div></details></div>;
}

function WorkDialog({ work, onClose }: { work: RankedWork; onClose: () => void }) {
  const labelId = `work-detail-${work.workId}`;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return <dialog ref={dialogRef} aria-labelledby={labelId} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }} onClose={onClose}>
    <div className="dialog-heading"><h2 id={labelId}>{work.titleZh}详情</h2><button type="button" aria-label="关闭详情" onClick={() => dialogRef.current?.close()}>×</button></div>
    <p className="original-title">{work.titleOriginal}</p>
    <dl className="work-facts"><div><dt>排名</dt><dd>{work.rank}</dd></div><div><dt>年份</dt><dd>{work.year}</dd></div><div><dt>制作</dt><dd>{work.studios.join("、")}</dd></div><div><dt>类型</dt><dd>{work.genres.join("、")}</dd></div><div><dt>综合分</dt><dd>{work.compositeScore.toFixed(1)}</dd></div></dl>
  </dialog>;
}

function progressLabel(progress: PublicProgress | undefined): string {
  if (!progress) return "—";
  if (progress.notInterested) return "不感兴趣";
  if (progress.recommended) return "想推荐";
  if (progress.reviewed) return "已评价";
  if (progress.watched) return "已看";
  return "—";
}
