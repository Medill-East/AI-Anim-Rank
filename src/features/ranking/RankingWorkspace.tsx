"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { RankedWork } from "../../data/schema.ts";
import { applyProgressPatch, type ProgressPatch, type ProgressRecord } from "../../domain/progress.ts";
import { applyProgressBackup, exportProgressBackup, parseProgressBackup, type ProgressBackup } from "../../storage/backup.ts";
import { ProgressRepository } from "../../storage/progress-db.ts";
import { createRankingWorkspaceState, reduceRankingWorkspaceState, visibleRankingWorks } from "./workspace.ts";
import type { PrivateStatusFilter, RankingSortField, SortDirection } from "./query.ts";

type ProgressStore = Pick<ProgressRepository, "loadAll" | "save" | "replaceAll">;

interface RankingWorkspaceProps {
  works: readonly RankedWork[];
  progressRepository?: ProgressStore;
}

const statusOptions: ReadonlyArray<{ value: PrivateStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" }, { value: "watched", label: "已看" }, { value: "unwatched", label: "未看" },
  { value: "reviewed", label: "已评价" }, { value: "recommended", label: "想推荐" }, { value: "notInterested", label: "不感兴趣" }, { value: "watchedUnreviewed", label: "已看未评价" },
];
const sortOptions: ReadonlyArray<{ value: RankingSortField; label: string }> = [
  { value: "rank", label: "排名" }, { value: "compositeScore", label: "综合分" }, { value: "year", label: "年份" },
];

export function RankingWorkspace({ works, progressRepository }: RankingWorkspaceProps) {
  if (works.length === 0) return <EmptyRankingWorkspace />;

  return <PopulatedRankingWorkspace works={works} progressRepository={progressRepository} />;
}

function EmptyRankingWorkspace() {
  return <section className="ranking-workspace" aria-label="AI Anim Rank">
    <header className="ranking-masthead"><p className="ranking-kicker">PUBLIC ANIMATION INDEX</p><h1>AI Anim Rank</h1><p>公开作品资料与可复核排序，个人进度仅保留在本地。</p></header>
    <p className="ranking-empty" role="status">榜单数据准备中</p>
  </section>;
}

function PopulatedRankingWorkspace({ works, progressRepository }: RankingWorkspaceProps) {
  const [state, dispatch] = useReducer(reduceRankingWorkspaceState, undefined, createRankingWorkspaceState);
  const [records, setRecords] = useState<ProgressRecord[]>([]);
  const [saveStatus, setSaveStatus] = useState("");
  const [pendingBackup, setPendingBackup] = useState<ProgressBackup | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const recordsRef = useRef<ProgressRecord[]>([]);
  const pendingSavesRef = useRef<Promise<void>>(Promise.resolve());
  const repository = useMemo<ProgressStore>(() => progressRepository ?? new ProgressRepository(), [progressRepository]);

  useEffect(() => {
    let active = true;
    void repository.loadAll().then(
      (loaded) => {
        if (active && loaded.length > 0) {
          recordsRef.current = loaded;
          setRecords(loaded);
        }
      },
      () => {},
    );
    return () => { active = false; };
  }, [repository]);

  const visibleWorks = useMemo(() => visibleRankingWorks(works, records, state), [works, records, state]);
  const selectedWork = works.find((work) => work.workId === state.selectedWorkId) ?? null;
  const selectedRecord = selectedWork ? records.find((record) => record.workId === selectedWork.workId) : undefined;
  const genres = useMemo(() => [...new Set(works.flatMap((work) => work.genres))].sort((a, b) => a.localeCompare(b, "zh-CN")), [works]);

  const savePatch = (workId: string, patch: ProgressPatch) => {
    const existing = recordsRef.current.find((record) => record.workId === workId) ?? emptyProgress(workId);
    const next = applyProgressPatch(existing, patch, new Date().toISOString());
    if (next === existing) return Promise.resolve();

    const updatedRecords = [...recordsRef.current.filter((record) => record.workId !== workId), next];
    recordsRef.current = updatedRecords;
    setRecords(updatedRecords);
    const save = pendingSavesRef.current.then(() => repository.save(next));
    pendingSavesRef.current = save.catch(() => {});
    return save.then(
      () => {
      setSaveStatus("已保存");
      },
      () => { setSaveStatus("保存失败"); },
    );
  };
  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setPendingBackup(parseProgressBackup(await file.text(), new Set(works.map((work) => work.workId))));
      setSaveStatus("备份已验证，请选择导入方式");
    } catch (error) {
      setPendingBackup(null);
      setSaveStatus(error instanceof Error ? error.message : "备份导入失败");
    } finally {
      event.target.value = "";
    }
  };
  const confirmImport = async (mode: "merge" | "replace") => {
    if (!pendingBackup) return;
    const next = applyProgressBackup(records, pendingBackup, mode);
    try {
      await repository.replaceAll(next);
      recordsRef.current = next;
      setRecords(next);
      setPendingBackup(null);
      setSaveStatus("已保存");
    } catch {
      setSaveStatus("保存失败");
    }
  };
  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(exportProgressBackup(records), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-anim-rank-progress.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const openDetail = (workId: string, trigger: HTMLElement) => { detailTriggerRef.current = trigger; dispatch({ type: "openDetail", workId }); };
  const closeDetail = () => { dispatch({ type: "closeDetail" }); detailTriggerRef.current?.focus(); };

  return <section className="ranking-workspace" aria-label="AI Anim Rank">
    <header className="ranking-masthead"><p className="ranking-kicker">PUBLIC ANIMATION INDEX</p><h1>AI Anim Rank</h1><p>公开作品资料与可复核排序，个人进度仅保留在本地。</p></header>
    <PrivateSummary works={works} records={records} />
    <section className="private-backup" aria-label="本地备份"><h2>本地备份</h2><button type="button" onClick={downloadBackup}>导出 JSON 备份</button><label>导入 JSON 备份<input type="file" accept="application/json,.json" onChange={importBackup} /></label>{pendingBackup && <div className="backup-confirm" role="group" aria-label="确认导入方式"><p>备份已验证，确认导入方式：</p><button type="button" onClick={() => void confirmImport("merge")}>合并导入</button><button type="button" onClick={() => void confirmImport("replace")}>替换导入</button></div>}</section>
    <p className="save-status" role="status" aria-live="polite">{saveStatus}</p>
    <form className="ranking-controls" role="search" onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="work-search">搜索作品</label><input id="work-search" type="search" value={state.search} onChange={(event) => dispatch({ type: "search", value: event.target.value })} placeholder="中文或原文标题" />
      <label htmlFor="genre-filter">类型</label><select id="genre-filter" value={state.genre} onChange={(event) => dispatch({ type: "genre", value: event.target.value })}><option value="">全部类型</option>{genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}</select>
      <label htmlFor="status-filter">本地状态</label><select id="status-filter" value={state.status} onChange={(event) => dispatch({ type: "status", value: event.target.value as PrivateStatusFilter })}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <label htmlFor="sort-field">排序</label><select id="sort-field" value={state.sortField} onChange={(event) => dispatch({ type: "sortField", value: event.target.value as RankingSortField })}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <label htmlFor="sort-direction">方向</label><select id="sort-direction" value={state.sortDirection} onChange={(event) => dispatch({ type: "sortDirection", value: event.target.value as SortDirection })}><option value="asc">升序</option><option value="desc">降序</option></select><button type="button" className="text-button" onClick={() => dispatch({ type: "reset" })}>重置筛选</button>
    </form>
    <><p className="ranking-result" aria-live="polite">显示 {visibleWorks.length} 部作品</p><div className="ranking-table-region" aria-label="榜单结果"><table><thead><tr><th>排名</th><th>作品</th><th>年份</th><th>类型</th><th>综合分</th></tr></thead><tbody>{visibleWorks.map((work) => <DesktopRow key={work.workId} work={work} onOpen={(trigger) => openDetail(work.workId, trigger)} />)}</tbody></table></div><div className="ranking-mobile-list" aria-label="榜单结果（紧凑视图）">{visibleWorks.map((work) => <MobileRow key={work.workId} work={work} onOpen={(trigger) => openDetail(work.workId, trigger)} />)}</div>{visibleWorks.length === 0 && <p className="ranking-empty">没有符合条件的作品。</p>}</>
    {selectedWork && <WorkDialog work={selectedWork} record={selectedRecord} onPatch={savePatch} onClose={closeDetail} />}
  </section>;
}

function PrivateSummary({ works, records }: { works: readonly RankedWork[]; records: readonly ProgressRecord[] }) {
  const watched = records.filter((record) => record.watched).length;
  const reviewed = records.filter((record) => record.reviewed).length;
  const recommended = records.filter((record) => record.recommended).length;
  const notInterested = records.filter((record) => record.notInterested).length;
  const completion = works.length === 0 ? 0 : Math.round(watched / works.length * 100);
  return <section className="private-summary" aria-label="我的进度"><h2>我的进度</h2><p>共 {works.length} 部 · 已看 {watched} · 完成 {completion}% · 已评价 {reviewed} · 推荐 {recommended} · 不感兴趣 {notInterested}</p></section>;
}

function DesktopRow({ work, onOpen }: { work: RankedWork; onOpen: (trigger: HTMLElement) => void }) { return <tr tabIndex={0} onClick={(event) => onOpen(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(event.currentTarget); } }}><td>{work.rank}</td><td><button type="button" className="work-title" onClick={(event) => { event.stopPropagation(); onOpen(event.currentTarget); }}>{work.titleZh}<span>{work.titleOriginal}</span></button></td><td>{work.year}</td><td>{work.genres.join(" · ")}</td><td>{work.compositeScore.toFixed(1)}</td></tr>; }
function MobileRow({ work, onOpen }: { work: RankedWork; onOpen: (trigger: HTMLElement) => void }) { return <div className="mobile-work-row"><button type="button" className="mobile-work-title" onClick={(event) => onOpen(event.currentTarget)}><span>#{work.rank}</span><strong>{work.titleZh}</strong><span>{work.year}</span></button><details><summary>展开公开资料</summary><div className="mobile-work-detail"><p>{work.titleOriginal}</p><p>{work.genres.join(" · ")} · {work.compositeScore.toFixed(1)}</p></div></details></div>; }

function WorkDialog({ work, record, onPatch, onClose }: { work: RankedWork; record?: ProgressRecord; onPatch: (workId: string, patch: ProgressPatch) => Promise<void>; onClose: () => void }) {
  const labelId = `work-detail-${work.workId}`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const progress = record ?? emptyProgress(work.workId);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return <dialog ref={dialogRef} aria-labelledby={labelId} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }} onClose={onClose}><div className="dialog-heading"><h2 id={labelId}>{work.titleZh}详情</h2><button type="button" aria-label="关闭详情" onClick={() => dialogRef.current?.close()}>×</button></div><p className="original-title">{work.titleOriginal}</p><dl className="work-facts"><div><dt>排名</dt><dd>{work.rank}</dd></div><div><dt>年份</dt><dd>{work.year}</dd></div><div><dt>制作</dt><dd>{work.studios.join("、")}</dd></div><div><dt>类型</dt><dd>{work.genres.join("、")}</dd></div><div><dt>综合分</dt><dd>{work.compositeScore.toFixed(1)}</dd></div></dl><fieldset className="private-progress"><legend>我的本地进度</legend>{([['watched', '已看'], ['reviewed', '已评价'], ['recommended', '推荐'], ['notInterested', '不感兴趣']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={progress[key]} onChange={(event) => void onPatch(work.workId, { [key]: event.target.checked })} />{label}</label>)}<label className="progress-note">备注<textarea value={progress.note ?? ""} onChange={(event) => void onPatch(work.workId, { note: event.target.value })} /></label></fieldset></dialog>;
}

function emptyProgress(workId: string): ProgressRecord { return { workId, watched: false, reviewed: false, recommended: false, notInterested: false, updatedAt: "", revision: 0 }; }
