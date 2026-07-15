"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type Ref } from "react";

import type { RankedWork } from "../../data/schema.ts";
import { applyProgressPatch, type ProgressPatch, type ProgressRecord } from "../../domain/progress.ts";
import { applyProgressBackup, exportProgressBackup, parseProgressBackup, type ProgressBackup } from "../../storage/backup.ts";
import { ProgressRepository } from "../../storage/progress-db.ts";
import { SyncSettings } from "../progress/SyncSettings.tsx";
import { deriveProgressInsights } from "./insights.ts";
import { createRankingWorkspaceState, reduceRankingWorkspaceState, visibleRankingWorks } from "./workspace.ts";
import type { PrivateStatusFilter, RankingSortField, SortDirection } from "./query.ts";

type ProgressStore = Pick<ProgressRepository, "loadAll" | "save" | "replaceAll">;
type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "ai-anim-rank-theme";

interface RankingWorkspaceProps {
  works: readonly RankedWork[];
  methodologyVersion?: string;
  sourceSnapshotVersion?: string;
  progressRepository?: ProgressStore;
}

const statusOptions: ReadonlyArray<{ value: PrivateStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" }, { value: "watched", label: "已看" }, { value: "unwatched", label: "未看" },
  { value: "reviewed", label: "已评价" }, { value: "recommended", label: "想推荐" }, { value: "notInterested", label: "不感兴趣" }, { value: "watchedUnreviewed", label: "已看未评价" },
];
const sortOptions: ReadonlyArray<{ value: RankingSortField; label: string }> = [
  { value: "rank", label: "排名" }, { value: "compositeScore", label: "综合分" }, { value: "year", label: "年份" },
];

export function RankingWorkspace({ works, methodologyVersion, sourceSnapshotVersion, progressRepository }: RankingWorkspaceProps) {
  if (works.length === 0) return <EmptyRankingWorkspace />;

  return <PopulatedRankingWorkspace works={works} methodologyVersion={methodologyVersion} sourceSnapshotVersion={sourceSnapshotVersion} progressRepository={progressRepository} />;
}

function EmptyRankingWorkspace() {
  return <section className="ranking-workspace" aria-label="AnimeRank">
    <header className="ranking-masthead"><p className="ranking-kicker">PUBLIC ANIMATION INDEX</p><h1>AnimeRank</h1><p>公开作品资料与可复核排序，个人进度仅保留在本地。</p></header>
    <p className="ranking-empty" role="status">榜单数据准备中</p>
  </section>;
}

function PopulatedRankingWorkspace({ works, methodologyVersion = "v1-auditable-three-source", sourceSnapshotVersion = "2026-07-12", progressRepository }: RankingWorkspaceProps) {
  const [state, dispatch] = useReducer(reduceRankingWorkspaceState, undefined, createRankingWorkspaceState);
  const [records, setRecords] = useState<ProgressRecord[]>([]);
  const [theme, setTheme] = useState<Theme>("light");
  const [saveStatus, setSaveStatus] = useState("");
  const [filterNotice, setFilterNotice] = useState("");
  const [pendingBackup, setPendingBackup] = useState<ProgressBackup | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const rankingControlsRef = useRef<HTMLFormElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const resultsEndRef = useRef<HTMLDivElement>(null);
  const lastOperationDesktopRef = useRef<HTMLTableRowElement>(null);
  const lastOperationMobileRef = useRef<HTMLDivElement>(null);
  const pendingLastOperationWorkIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (readThemePreference() !== "dark") return;
    const timer = window.setTimeout(() => setTheme("dark"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveThemePreference(theme);
  }, [theme]);

  const visibleWorks = useMemo(() => visibleRankingWorks(works, records, state), [works, records, state]);
  const lastOperationWorkId = useMemo(() => records.reduce<ProgressRecord | undefined>((latest, record) => {
    if (!latest || record.updatedAt > latest.updatedAt || record.updatedAt === latest.updatedAt && record.revision > latest.revision) return record;
    return latest;
  }, undefined)?.workId, [records]);
  const selectedWork = works.find((work) => work.workId === state.selectedWorkId) ?? null;
  const selectedRecord = selectedWork ? records.find((record) => record.workId === selectedWork.workId) : undefined;
  const genres = useMemo(() => [...new Set(works.flatMap((work) => work.genres))].sort((a, b) => a.localeCompare(b, "zh-CN")), [works]);
  const studios = useMemo(() => [...new Set(works.flatMap((work) => work.studios))].sort((a, b) => a.localeCompare(b, "en")), [works]);

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
  const applyInsightStatus = (status: PrivateStatusFilter, label: string) => {
    dispatch({ type: "reset" });
    dispatch({ type: "status", value: status });
    setFilterNotice(`已筛选：${label}`);
    scrollTo(rankingControlsRef.current, "start");
  };
  const applyInsightGenre = (genre: string) => {
    dispatch({ type: "reset" });
    dispatch({ type: "genre", value: genre });
    setFilterNotice(`已筛选：${genre}`);
    scrollTo(rankingControlsRef.current, "start");
  };
  const applyStudioFilter = (studio: string) => {
    dispatch({ type: "reset" });
    dispatch({ type: "studio", value: studio });
    setFilterNotice(`已筛选制作：${studio}`);
    scrollTo(rankingControlsRef.current, "start");
  };
  const scrollTo = (element: HTMLElement | null, block: ScrollLogicalPosition) => {
    if (!element || typeof element.scrollIntoView !== "function") return;
    element.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block });
  };
  const isMobileViewport = () => window.matchMedia?.("(max-width: 700px)").matches ?? false;
  const scrollToLastOperation = () => scrollTo(isMobileViewport() ? lastOperationMobileRef.current : lastOperationDesktopRef.current, "center");
  const settleLastOperationTarget = (element: HTMLElement | null, mobile: boolean) => {
    if (!element || pendingLastOperationWorkIdRef.current !== element.dataset.pageJumpTarget || isMobileViewport() !== mobile) return;
    scrollTo(element, "center");
    pendingLastOperationWorkIdRef.current = null;
  };
  const setLastOperationDesktopRef = (element: HTMLTableRowElement | null) => {
    lastOperationDesktopRef.current = element;
    settleLastOperationTarget(element, false);
  };
  const setLastOperationMobileRef = (element: HTMLDivElement | null) => {
    lastOperationMobileRef.current = element;
    settleLastOperationTarget(element, true);
  };
  const jumpToLastOperation = () => {
    if (!lastOperationWorkId) return;
    if (!visibleWorks.some((work) => work.workId === lastOperationWorkId)) {
      setFilterNotice("已重置筛选，定位最后操作");
      pendingLastOperationWorkIdRef.current = lastOperationWorkId;
      dispatch({ type: "reset" });
      return;
    }
    scrollToLastOperation();
  };

  return <section ref={workspaceRef} className="ranking-workspace" data-page-jump-target="page-start" aria-label="AnimeRank">
    <header className="ranking-masthead"><div className="masthead-utility"><p className="ranking-kicker">PUBLIC ANIMATION INDEX</p><ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === "light" ? "dark" : "light")} /></div><h1>AnimeRank</h1><p>公开作品资料与可复核排序，个人进度仅保留在本地。</p></header>
    <PrivateSummary works={works} records={records} onStatusSelect={applyInsightStatus} onGenreSelect={applyInsightGenre} onStudioSelect={applyStudioFilter} />
    <section className="data-tools" aria-label="备份与同步"><div className="section-heading"><div><h2>备份与同步</h2><p>个人标记默认仅保存在此浏览器。</p></div><span>数据由你掌握</span></div><div className="data-tools-grid"><section className="data-tool data-tool-backup" aria-label="本地备份"><div className="data-tool-copy"><h3>本地备份</h3><p>导出或恢复 JSON 个人标记。</p></div><div className="backup-actions"><button type="button" onClick={downloadBackup}>导出备份</button><label>导入备份<input type="file" accept="application/json,.json" onChange={importBackup} /></label></div>{pendingBackup && <div className="backup-confirm" role="group" aria-label="确认导入方式"><p>备份已验证，选择导入方式：</p><button type="button" onClick={() => void confirmImport("merge")}>合并导入</button><button type="button" onClick={() => void confirmImport("replace")}>替换现有数据</button></div>}</section><section className="data-tool data-tool-sync" aria-label="私密同步"><div className="data-tool-copy"><h3>私密同步 <small>可选 · 端到端加密</small></h3></div><SyncSettings heading={false} /></section></div></section>
    <p className="save-status" role="status" aria-live="polite">{saveStatus}</p>
    <section className="ranking-methodology" aria-label="排名依据"><div className="section-heading"><h2>排名依据</h2><span>三个来源等权 · 可复核快照</span></div><div><p>本榜单汇总 <a href="https://anilist.co/" target="_blank" rel="noreferrer">AniList</a>、<a href="https://myanimelist.net/" target="_blank" rel="noreferrer">MyAnimeList（MAL）</a> 与 <a href="https://bgm.tv/" target="_blank" rel="noreferrer">Bangumi</a> 的公开评分。</p><p>三个来源统一换算为 0–100 后等权取平均；样本量仅用于最低门槛筛选。</p><p>条目通过可审阅的跨站映射合并；续作、剧场版与独立作品分别计入。</p><p>数据快照日期：{sourceSnapshotVersion} · 数据版本：{methodologyVersion}。它适合作为发现作品的入口，不替代个人判断。</p></div></section>
    <p className="filter-status" role="status" aria-live="polite">{filterNotice}</p>
    <form ref={rankingControlsRef} className="ranking-controls" role="search" onSubmit={(event) => event.preventDefault()}>
      <label className="filter-field filter-search" htmlFor="work-search"><span>搜索作品</span><input id="work-search" type="search" value={state.search} onChange={(event) => { setFilterNotice(""); dispatch({ type: "search", value: event.target.value }); }} placeholder="中文或原文标题" /></label>
      <label className="filter-field" htmlFor="genre-filter"><span>类型</span><select id="genre-filter" value={state.genre} onChange={(event) => { setFilterNotice(""); dispatch({ type: "genre", value: event.target.value }); }}><option value="">全部类型</option>{genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}</select></label>
      <label className="filter-field" htmlFor="studio-filter"><span>制作公司</span><select id="studio-filter" value={state.studio} onChange={(event) => { setFilterNotice(""); dispatch({ type: "studio", value: event.target.value }); }}><option value="">全部制作</option>{studios.map((studio) => <option key={studio} value={studio}>{studio}</option>)}</select></label>
      <label className="filter-field" htmlFor="status-filter"><span>本地状态</span><select id="status-filter" value={state.status} onChange={(event) => { setFilterNotice(""); dispatch({ type: "status", value: event.target.value as PrivateStatusFilter }); }}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="filter-field" htmlFor="sort-field"><span>排序</span><select id="sort-field" value={state.sortField} onChange={(event) => { setFilterNotice(""); dispatch({ type: "sortField", value: event.target.value as RankingSortField }); }}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="filter-field" htmlFor="sort-direction"><span>方向</span><select id="sort-direction" value={state.sortDirection} onChange={(event) => { setFilterNotice(""); dispatch({ type: "sortDirection", value: event.target.value as SortDirection }); }}><option value="asc">升序</option><option value="desc">降序</option></select></label><button type="button" className="text-button" onClick={() => { setFilterNotice(""); dispatch({ type: "reset" }); }}>重置筛选</button>
    </form>
    <><p className="ranking-result" aria-live="polite">显示 {visibleWorks.length} 部作品</p><div className="ranking-table-region" aria-label="榜单结果"><table><colgroup><col className="rank-column" /><col className="work-column" /><col className="year-column" /><col className="genre-column" /><col className="score-column" /><col className="marks-column" /></colgroup><thead><tr><th>排名</th><th>作品</th><th>年份</th><th>类型</th><th>综合分</th><th>我的标记</th></tr></thead><tbody>{visibleWorks.map((work) => <DesktopRow key={work.workId} work={work} record={records.find((record) => record.workId === work.workId)} jumpTargetRef={work.workId === lastOperationWorkId ? setLastOperationDesktopRef : undefined} onPatch={savePatch} onOpen={(trigger) => openDetail(work.workId, trigger)} onGenreSelect={applyInsightGenre} onStudioSelect={applyStudioFilter} />)}</tbody></table></div><div className="ranking-mobile-list" aria-label="榜单结果（紧凑视图）">{visibleWorks.map((work) => <MobileRow key={work.workId} work={work} record={records.find((record) => record.workId === work.workId)} jumpTargetRef={work.workId === lastOperationWorkId ? setLastOperationMobileRef : undefined} onPatch={savePatch} onOpen={(trigger) => openDetail(work.workId, trigger)} onGenreSelect={applyInsightGenre} onStudioSelect={applyStudioFilter} />)}</div>{visibleWorks.length === 0 && <p className="ranking-empty">没有符合条件的作品。</p>}<div ref={resultsEndRef} data-page-jump-target="results-end" /></>
    <nav className="page-jump-controls" aria-label="页面导航"><button type="button" onClick={() => scrollTo(workspaceRef.current, "start")}>回到页首</button><button type="button" onClick={() => scrollTo(resultsEndRef.current, "end")}>跳到页尾</button><button type="button" disabled={!lastOperationWorkId} title={lastOperationWorkId ? "跳到最后一次个人操作的作品" : "还没有个人操作记录"} onClick={jumpToLastOperation}>最后操作</button></nav>
    {selectedWork && <WorkDialog work={selectedWork} record={selectedRecord} onPatch={savePatch} onClose={closeDetail} onGenreSelect={applyInsightGenre} onStudioSelect={applyStudioFilter} />}
  </section>;
}

function PrivateSummary({ works, records, onStatusSelect, onGenreSelect, onStudioSelect }: { works: readonly RankedWork[]; records: readonly ProgressRecord[]; onStatusSelect: (status: PrivateStatusFilter, label: string) => void; onGenreSelect: (genre: string) => void; onStudioSelect: (studio: string) => void }) {
  const watched = records.filter((record) => record.watched).length;
  const reviewed = records.filter((record) => record.reviewed).length;
  const recommended = records.filter((record) => record.recommended).length;
  const notInterested = records.filter((record) => record.notInterested).length;
  const insights = deriveProgressInsights(works, records);
  return <section className="private-summary" aria-label="我的进度"><div className="summary-heading"><h2>我的进度</h2><p>你的所有偏好仅保存在本地。</p></div><div className="summary-stats"><div className="summary-stat"><span>总收录</span><strong>{works.length}<small> 部</small></strong></div><button type="button" className="summary-stat" onClick={() => onStatusSelect("watched", "已看作品")}><span>已看</span><strong>{watched}<small> 部</small></strong></button><button type="button" className="summary-stat" onClick={() => onStatusSelect("reviewed", "已评价作品")}><span>已评价</span><strong>{reviewed}<small> 部</small></strong></button><button type="button" className="summary-stat" onClick={() => onStatusSelect("recommended", "推荐作品")}><span>推荐</span><strong>{recommended}<small> 部</small></strong></button><button type="button" className="summary-stat" onClick={() => onStatusSelect("notInterested", "不感兴趣作品")}><span>不感兴趣</span><strong>{notInterested}<small> 部</small></strong></button></div><section className="progress-insights" aria-label="进度洞察"><section className="completion-insight" data-progress-insight="completion"><button type="button" className="completion-ring" aria-label={`查看 ${works.length - watched} 部未看作品`} onClick={() => onStatusSelect("unwatched", "未看作品")} style={{ background: `conic-gradient(var(--accent) ${insights.completion * 3.6}deg, var(--surface-hover) 0deg)` }}><span>{insights.completion}%</span><small>完成</small></button><div><h3>完成度</h3><p>已看 {insights.watchedCount} / {works.length} 部</p><button type="button" className="insight-link" onClick={() => onStatusSelect("unwatched", "未看作品")}>查看未看作品</button></div></section><section className="preference-insight" data-progress-insight="genres"><div className="insight-heading"><h3>观看偏好</h3><span>{insights.watchedCount === 0 ? "开始标记后解锁" : "按已看作品统计"}</span></div>{insights.topGenres.length > 0 ? <div className="genre-insights">{insights.topGenres.map((genre) => <button key={genre.label} type="button" className="genre-insight" onClick={() => onGenreSelect(genre.label)}><span>{genre.label}</span><i><b style={{ width: `${genre.percentage}%` }} /></i><em>{genre.count} 部</em></button>)}</div> : <p className="insight-empty">还没有已看作品，先从榜单里标记一部吧。</p>}<div className="insight-footer"><span>常看制作</span>{insights.topStudio ? <button type="button" className="insight-studio-link" data-progress-insight="favorite-studio" onClick={() => onStudioSelect(insights.topStudio!.label)}>{insights.topStudio.label} · {insights.topStudio.count} 部</button> : <strong data-progress-insight="favorite-studio">—</strong>}</div></section></section></section>;
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) { return <button type="button" className="theme-toggle" data-theme-toggle aria-label={theme === "light" ? "切换至深色模式" : "切换至浅色模式"} onClick={onToggle}>{theme === "light" ? "深色模式" : "浅色模式"}</button>; }

function DesktopRow({ work, record, jumpTargetRef, onPatch, onOpen, onGenreSelect, onStudioSelect }: { work: RankedWork; record?: ProgressRecord; jumpTargetRef?: Ref<HTMLTableRowElement>; onPatch: (workId: string, patch: ProgressPatch) => Promise<void>; onOpen: (trigger: HTMLElement) => void; onGenreSelect: (genre: string) => void; onStudioSelect: (studio: string) => void }) { return <tr ref={jumpTargetRef} data-page-jump-target={jumpTargetRef ? work.workId : undefined} tabIndex={0} onClick={(event) => onOpen(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(event.currentTarget); } }}><td>{work.rank}</td><td><button type="button" className="work-title" onClick={(event) => { event.stopPropagation(); onOpen(event.currentTarget); }}><strong>{work.titleZh}</strong><span>{work.titleOriginal}</span></button><StudioLinks studios={work.studios} onSelect={onStudioSelect} /></td><td>{work.year}</td><td><GenreTags genres={work.genres} onSelect={onGenreSelect} /></td><td><ScoreBreakdown work={work} /></td><td><ProgressControls workId={work.workId} record={record} onPatch={onPatch} /></td></tr>; }
function MobileRow({ work, record, jumpTargetRef, onPatch, onOpen, onGenreSelect, onStudioSelect }: { work: RankedWork; record?: ProgressRecord; jumpTargetRef?: Ref<HTMLDivElement>; onPatch: (workId: string, patch: ProgressPatch) => Promise<void>; onOpen: (trigger: HTMLElement) => void; onGenreSelect: (genre: string) => void; onStudioSelect: (studio: string) => void }) { return <div ref={jumpTargetRef} data-page-jump-target={jumpTargetRef ? work.workId : undefined} className="mobile-work-row"><button type="button" className="mobile-work-title" onClick={(event) => onOpen(event.currentTarget)}><span>#{work.rank}</span><strong>{work.titleZh}</strong><span>{work.year}</span></button><ProgressControls workId={work.workId} record={record} onPatch={onPatch} /><details><summary>展开公开资料</summary><div className="mobile-work-detail"><p>{work.titleOriginal}</p><StudioLinks studios={work.studios} onSelect={onStudioSelect} /><GenreTags genres={work.genres} onSelect={onGenreSelect} /><ScoreBreakdown work={work} /></div></details></div>; }

function StudioLinks({ studios, onSelect }: { studios: readonly string[]; onSelect: (studio: string) => void }) { return <span className="studio-links" aria-label="制作公司">{studios.map((studio) => <button key={studio} type="button" onClick={(event) => { event.stopPropagation(); onSelect(studio); }}>{studio}</button>)}</span>; }
function GenreTags({ genres, onSelect }: { genres: readonly string[]; onSelect: (genre: string) => void }) { return <span className="genre-tags">{genres.map((genre) => <button key={genre} type="button" onClick={(event) => { event.stopPropagation(); onSelect(genre); }}>{genre}</button>)}</span>; }
function ScoreBreakdown({ work }: { work: RankedWork }) { const { anilist, mal, bangumi } = work.sourceScores; return <span className="score-breakdown" title={`AniList ${anilist.score.toFixed(0)} / 100；MAL ${mal.score.toFixed(2)} / 10；Bangumi ${bangumi.score.toFixed(1)} / 10`}><strong>{work.compositeScore.toFixed(1)}</strong><small>Ani {anilist.score.toFixed(0)} · MAL {mal.score.toFixed(2)} · Bgm {bangumi.score.toFixed(1)}</small></span>; }

function ProgressControls({ workId, record, onPatch }: { workId: string; record?: ProgressRecord; onPatch: (workId: string, patch: ProgressPatch) => Promise<void> }) {
  const progress = record ?? emptyProgress(workId);
  return <span className="progress-controls" aria-label="个人标记">{([['watched', '已看'], ['reviewed', '已评价'], ['recommended', '推荐'], ['notInterested', '不感兴趣']] as const).map(([key, label]) => <button key={key} type="button" className={progress[key] ? `progress-control is-active progress-control-${key}` : "progress-control"} data-progress-action={key} aria-pressed={progress[key]} onClick={(event) => { event.stopPropagation(); void onPatch(workId, { [key]: !progress[key] }); }}>{label}</button>)}</span>;
}

function WorkDialog({ work, record, onPatch, onClose, onGenreSelect, onStudioSelect }: { work: RankedWork; record?: ProgressRecord; onPatch: (workId: string, patch: ProgressPatch) => Promise<void>; onClose: () => void; onGenreSelect: (genre: string) => void; onStudioSelect: (studio: string) => void }) {
  const labelId = `work-detail-${work.workId}`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const progress = record ?? emptyProgress(work.workId);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return <dialog ref={dialogRef} aria-labelledby={labelId} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }} onClose={onClose}><div className="dialog-heading"><h2 id={labelId}>{work.titleZh}详情</h2><button type="button" aria-label="关闭详情" onClick={() => dialogRef.current?.close()}>×</button></div><p className="original-title">{work.titleOriginal}</p><dl className="work-facts"><div><dt>排名</dt><dd>{work.rank}</dd></div><div><dt>年份</dt><dd>{work.year}</dd></div><div><dt>制作</dt><dd><StudioLinks studios={work.studios} onSelect={onStudioSelect} /></dd></div><div><dt>类型</dt><dd><GenreTags genres={work.genres} onSelect={onGenreSelect} /></dd></div><div><dt>综合分</dt><dd><ScoreBreakdown work={work} /></dd></div></dl><fieldset className="private-progress"><legend>我的本地进度</legend>{([['watched', '已看'], ['reviewed', '已评价'], ['recommended', '推荐'], ['notInterested', '不感兴趣']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={progress[key]} onChange={(event) => void onPatch(work.workId, { [key]: event.target.checked })} />{label}</label>)}<label className="progress-note">备注<textarea value={progress.note ?? ""} onChange={(event) => void onPatch(work.workId, { note: event.target.value })} /></label></fieldset></dialog>;
}

function emptyProgress(workId: string): ProgressRecord { return { workId, watched: false, reviewed: false, recommended: false, notInterested: false, updatedAt: "", revision: 0 }; }

function readThemePreference(): Theme {
  try { return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}

function saveThemePreference(theme: Theme) {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
}
