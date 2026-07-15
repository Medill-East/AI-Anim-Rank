import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import { RankingWorkspace } from "../src/features/ranking/RankingWorkspace.tsx";
import { SyncSettings } from "../src/features/progress/SyncSettings.tsx";
import { AppStatus } from "../src/features/app/AppStatus.tsx";
import type { RankedWork } from "../src/data/schema.ts";
import type { ProgressRecord } from "../src/domain/progress.ts";
import { ProgressRepository } from "../src/storage/progress-db.ts";
import { serializeRecoveryPayload, SyncVaultStore } from "../src/storage/sync-vault.ts";
import { createRecoveryVault, type RecoveryVault } from "../src/sync/crypto.ts";
import { IDBFactory } from "fake-indexeddb";

const work: RankedWork = {
  workId: "frieren",
  rank: 1,
  titleZh: "葬送的芙莉莲",
  titleOriginal: "Sousou no Frieren",
  year: 2023,
  studios: ["Madhouse"],
  genres: ["冒险"],
  compositeScore: 91.2,
  sourceScores: {
    anilist: { score: 90, votes: 100 },
    mal: { score: 9.1, votes: 200 },
    bangumi: { score: 9.2, votes: 300 },
  },
};

test("app status explains offline availability without claiming unconfigured remote sync", () => {
  const html = renderToStaticMarkup(<AppStatus syncBaseUrl="" />);

  assert.match(html, /role="status"/);
  assert.match(html, /本机保存/);
  assert.match(html, /未配置远程同步端点/);
  assert.doesNotMatch(html, /已同步/);
});

test("workspace explains the auditable three-source ranking methodology and source snapshot date", () => {
  const html = renderToStaticMarkup(<RankingWorkspace works={[work]} methodologyVersion="v1-auditable-three-source" sourceSnapshotVersion="2026-07-12" />);

  assert.match(html, /排名依据/);
  assert.match(html, /AniList/);
  assert.match(html, /MyAnimeList/);
  assert.match(html, /Bangumi/);
  assert.match(html, /统一换算为 0–100/);
  assert.match(html, /三个来源等权/);
  assert.match(html, /v1-auditable-three-source/);
  assert.match(html, /数据快照日期：2026-07-12/);
});

test("workspace groups filters and declares stable table columns", () => {
  const html = renderToStaticMarkup(<RankingWorkspace works={[work]} />);
  const dom = new JSDOM(html);

  assert.equal(dom.window.document.querySelectorAll(".ranking-controls .filter-field").length, 6);
  assert.ok(dom.window.document.querySelector(".ranking-table-region colgroup"));
  assert.equal(dom.window.document.querySelectorAll(".progress-controls button").length, 8);
  assert.equal(dom.window.document.querySelectorAll(".score-breakdown small span").length, 6);
});

test("workspace reserves a compact interactive insights area for private progress", () => {
  const html = renderToStaticMarkup(<RankingWorkspace works={[work]} />);
  const dom = new JSDOM(html);

  assert.equal(dom.window.document.querySelectorAll(".summary-stat").length, 5);
  assert.ok(dom.window.document.querySelector("[data-progress-insight='favorite-studio']"));
  assert.ok(dom.window.document.querySelector("section.progress-insights"));
  assert.ok(dom.window.document.querySelector("[data-progress-insight='completion']"));
  assert.ok(dom.window.document.querySelector("[data-progress-insight='genres']"));
  assert.ok(dom.window.document.querySelector("[data-progress-insight='favorite-studio']"));
});

test("workspace keeps backup actions and ranking methodology in the primary flow", () => {
  const html = renderToStaticMarkup(<RankingWorkspace works={[work]} />);
  const dom = new JSDOM(html);

  assert.ok(dom.window.document.querySelector("section.data-tools"));
  assert.ok(dom.window.document.querySelector("section.data-tool-backup"));
  const syncPanel = dom.window.document.querySelector("section.data-tool-sync");
  assert.ok(syncPanel);
  assert.equal(syncPanel?.querySelector(".sync-settings h2"), null);
  assert.match(syncPanel?.textContent ?? "", /正在检查本地保险库/);
  assert.ok(dom.window.document.querySelector("section.ranking-methodology"));
  assert.equal(dom.window.document.querySelector("details.ranking-methodology"), null);
  assert.equal(dom.window.document.querySelector(".data-tools details"), null);
  assert.deepEqual(
    [...dom.window.document.querySelectorAll(".ranking-methodology a")].map((link) => link.getAttribute("href")),
    ["https://anilist.co/", "https://myanimelist.net/", "https://bgm.tv/"],
  );
});

test("workspace offers floating jumps to the page start, end, and last private operation", () => {
  const html = renderToStaticMarkup(<RankingWorkspace works={[work]} />);
  const dom = new JSDOM(html);

  const jumpControls = dom.window.document.querySelector(".page-jump-controls");
  assert.ok(jumpControls);
  assert.match(jumpControls.textContent ?? "", /回到页首/);
  assert.match(jumpControls.textContent ?? "", /跳到页尾/);
  assert.match(jumpControls.textContent ?? "", /最后操作/);
});

test("workspace scrolls to the requested page boundary from floating jumps", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const scrollTargets: Array<{ target: string | null; block: string }> = [];
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement, options: ScrollIntoViewOptions) { scrollTargets.push({ target: this.dataset.pageJumpTarget ?? null, block: String(options.block) }); },
  });
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} />));
    const topButton = [...document.querySelectorAll<HTMLButtonElement>(".page-jump-controls button")].find((button) => button.textContent === "回到页首");
    const endButton = [...document.querySelectorAll<HTMLButtonElement>(".page-jump-controls button")].find((button) => button.textContent === "跳到页尾");
    const reviewedButton = [...document.querySelectorAll<HTMLButtonElement>(".page-jump-controls button")].find((button) => button.textContent === "最后操作");
    assert.ok(topButton);
    assert.ok(endButton);
    assert.ok(reviewedButton);
    assert.equal(reviewedButton.disabled, true);

    await act(async () => topButton.click());
    await act(async () => endButton.click());

    assert.deepEqual(scrollTargets, [{ target: "page-start", block: "start" }, { target: "results-end", block: "end" }]);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace jumps to the work with the latest private operation", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const repository = new ProgressRepository(new IDBFactory());
  const latestWork = { ...work, workId: "latest-work", rank: 2, titleZh: "最后操作作品" };
  await repository.save({ workId: work.workId, watched: true, reviewed: false, recommended: false, notInterested: false, updatedAt: "2026-07-14T00:00:00.000Z", revision: 1 });
  await repository.save({ workId: latestWork.workId, watched: false, reviewed: false, recommended: false, notInterested: true, updatedAt: "2026-07-14T00:01:00.000Z", revision: 1 });
  const scrollTargets: string[] = [];
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement) { scrollTargets.push(this.dataset.pageJumpTarget ?? ""); },
  });
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work, latestWork]} progressRepository={repository} />));
    await act(async () => { await flush(); });
    const reviewedButton = [...document.querySelectorAll<HTMLButtonElement>(".page-jump-controls button")].find((button) => button.textContent === "最后操作");
    assert.ok(reviewedButton);
    assert.equal(reviewedButton.disabled, false);

    await act(async () => reviewedButton.click());

    assert.deepEqual(scrollTargets, ["latest-work"]);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace resets hidden filters before jumping to the last private operation", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const repository = new ProgressRepository(new IDBFactory());
  await repository.save({ workId: work.workId, watched: true, reviewed: false, recommended: false, notInterested: false, updatedAt: "2026-07-14T00:00:00.000Z", revision: 1 });
  const scrollTargets: string[] = [];
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement) { scrollTargets.push(this.dataset.pageJumpTarget ?? ""); },
  });
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} progressRepository={repository} />));
    await act(async () => { await flush(); });
    const statusFilter = document.getElementById("status-filter") as unknown as { value: string; dispatchEvent(event: unknown): boolean } | null;
    assert.ok(statusFilter);
    await act(async () => {
      statusFilter.value = "unwatched";
      statusFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    const lastOperationButton = [...document.querySelectorAll<HTMLButtonElement>(".page-jump-controls button")].find((button) => button.textContent === "最后操作");
    assert.ok(lastOperationButton);
    assert.equal(lastOperationButton.disabled, false);

    await act(async () => lastOperationButton.click());
    await act(async () => { await flush(); });

    assert.equal(statusFilter.value, "all");
    assert.match(document.querySelector(".filter-status")?.textContent ?? "", /已重置筛选，定位最后操作/);
    assert.deepEqual(scrollTargets, [work.workId]);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace opens a named modal from a Chinese title and restores focus on close", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  let modalOpenCount = 0;
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      modalOpenCount += 1;
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new dom.window.Event("close"));
    },
  });
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} />));
    await act(async () => { await flush(); });
    const trigger = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(work.titleZh));
    assert.ok(trigger);

    await act(async () => trigger.click());

    const dialog = document.querySelector("dialog");
    assert.ok(dialog);
    assert.equal(dialog?.querySelector("h2")?.textContent, `${work.titleZh}详情`);
    assert.equal(dialog?.hasAttribute("open"), true);
    assert.equal(modalOpenCount, 1);

    const closeButton = dialog?.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]');
    assert.ok(closeButton);
    await act(async () => closeButton.click());

    assert.equal(document.querySelector("dialog"), null);
    assert.equal(document.activeElement, trigger);

  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace closes a work dialog when its backdrop is clicked", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  installDialogStub(dom);
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} />));
    await act(async () => { await flush(); });
    const trigger = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(work.titleZh));
    assert.ok(trigger);
    await act(async () => trigger.click());

    const dialog = document.querySelector<HTMLDialogElement>("dialog");
    assert.ok(dialog);
    await act(async () => dialog.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));

    assert.equal(document.querySelector("dialog"), null);
    assert.equal(document.activeElement, trigger);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace renders private progress controls and saves a normalized recommendation", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const repository = new ProgressRepository(new IDBFactory());
  installDialogStub(dom);
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => {
      root.render(<RankingWorkspace works={[work]} progressRepository={repository} />);
      await flush();
    });
    const trigger = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(work.titleZh));
    assert.ok(trigger);
    await act(async () => trigger.click());

    for (const label of ["已看", "已评价", "推荐", "不感兴趣"]) {
      assert.ok([...document.querySelectorAll("label")].some((element) => element.textContent === label));
    }

    const recommend = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent === "推荐");
    assert.ok(recommend);
    await act(async () => {
      recommend.click();
      await flush();
    });

    assert.deepEqual(await repository.loadAll(), [{
      workId: work.workId,
      watched: true,
      reviewed: false,
      recommended: true,
      notInterested: false,
      updatedAt: (await repository.loadAll())[0]?.updatedAt,
      revision: 1,
    }]);
    assert.equal(document.querySelector('[role="status"]')?.textContent, "已保存");
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace shows saved private statuses as row controls before opening work details", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const repository = new ProgressRepository(new IDBFactory());
  await repository.save({
    workId: work.workId,
    watched: true,
    reviewed: true,
    recommended: true,
    notInterested: false,
    updatedAt: "2026-07-13T00:00:00.000Z",
    revision: 1,
  });
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} progressRepository={repository} />));
    await act(async () => { await flush(); });

    const controls = document.querySelector('[aria-label="个人标记"]');
    assert.ok(controls);
    assert.equal(document.querySelector('[data-progress-action="watched"]')?.getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector('[data-progress-action="reviewed"]')?.getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector('[data-progress-action="recommended"]')?.getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector("dialog"), null);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace lets people update private statuses directly from a ranking row", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const repository = new ProgressRepository(new IDBFactory());
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} progressRepository={repository} />));
    const recommend = document.querySelector<HTMLButtonElement>('[data-progress-action="recommended"]');
    assert.ok(recommend);
    assert.equal(recommend.getAttribute("aria-pressed"), "false");

    await act(async () => {
      recommend.click();
      await flush();
    });

    assert.equal((await repository.loadAll())[0]?.recommended, true);
    assert.equal((await repository.loadAll())[0]?.watched, true);
    assert.equal(document.querySelector("dialog"), null);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace toggles the saved light and dark theme preference", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} />));
    const themeToggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
    assert.ok(themeToggle);
    assert.equal(document.documentElement.dataset.theme, "light");

    await act(async () => themeToggle.click());

    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(window.localStorage.getItem("ai-anim-rank-theme"), "dark");
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace preserves rapid private progress patches for the same work", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const saves: Array<{ record: ProgressRecord; resolve: () => void }> = [];
  const repository = {
    loadAll: async () => [],
    save: (record: ProgressRecord) => new Promise<void>((resolve) => { saves.push({ record, resolve }); }),
    replaceAll: async () => {},
  };
  installDialogStub(dom);
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => {
      root.render(<RankingWorkspace works={[work]} progressRepository={repository} />);
      await flush();
    });
    const trigger = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(work.titleZh));
    assert.ok(trigger);
    await act(async () => trigger.click());

    const reviewed = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent === "已评价");
    const recommended = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent === "推荐");
    assert.ok(reviewed);
    assert.ok(recommended);
    await act(async () => {
      reviewed.click();
      recommended.click();
    });
    assert.equal(saves.length, 1);

    await act(async () => {
      saves[0].resolve();
      await flush();
    });
    assert.equal(saves.length, 2);
    assert.equal(saves[1].record.reviewed, true);
    assert.equal(saves[1].record.recommended, true);
    await act(async () => {
      saves[1].resolve();
      await flush();
    });

    const stats = document.querySelector(".summary-stats")?.textContent ?? "";
    assert.match(stats, /已评价1 部/);
    assert.match(stats, /推荐1 部/);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace shows private progress summary counts", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} />));
    const summary = document.querySelector(".private-summary")?.textContent ?? "";
    assert.match(summary, /总收录1 部[\s\S]*已看0 部[\s\S]*已评价0 部[\s\S]*推荐0 部[\s\S]*不感兴趣0 部/);
    assert.match(summary, /0%完成[\s\S]*常看制作/);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("progress insights filter the ranking from completion and genre controls", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const repository = new ProgressRepository(new IDBFactory());
  let scrollCalls = 0;
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value() { scrollCalls += 1; },
  });
  const secondWork = { ...work, workId: "music-work", rank: 2, titleZh: "音乐作品", genres: ["音乐"] };
  await repository.save({ workId: work.workId, watched: true, reviewed: false, recommended: false, notInterested: false, updatedAt: "2026-07-13T00:00:00.000Z", revision: 1 });
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => { root.render(<RankingWorkspace works={[work, secondWork]} progressRepository={repository} />); });
    await act(async () => { await flush(); });
    const genre = [...document.querySelectorAll<HTMLButtonElement>(".genre-insight")].find((button) => button.textContent?.includes("冒险"));
    assert.ok(genre);
    await act(async () => genre.click());
    assert.equal((document.querySelector("#genre-filter") as HTMLSelectElement | null)?.value, "冒险");
    assert.match(document.querySelector('.filter-status')?.textContent ?? "", /已筛选：冒险/);

    const completion = document.querySelector<HTMLButtonElement>(".completion-ring");
    assert.ok(completion);
    await act(async () => completion.click());
    assert.equal((document.querySelector("#status-filter") as HTMLSelectElement | null)?.value, "unwatched");
    assert.match(document.querySelector('.filter-status')?.textContent ?? "", /已筛选：未看作品/);
    assert.equal(scrollCalls, 2);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace filters the ranking when a listed studio is selected", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const otherStudioWork = { ...work, workId: "other-studio", rank: 2, titleZh: "另一部作品", studios: ["CloverWorks"] };
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work, otherStudioWork]} />));
    const studio = [...document.querySelectorAll<HTMLButtonElement>(".studio-links button")].find((button) => button.textContent === "Madhouse");
    assert.ok(studio);

    await act(async () => studio.click());

    assert.equal((document.querySelector("#studio-filter") as HTMLSelectElement | null)?.value, "Madhouse");
    assert.equal(document.querySelectorAll(".ranking-table-region tbody tr").length, 1);
    assert.match(document.querySelector(".filter-status")?.textContent ?? "", /已筛选制作：Madhouse/);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("workspace keeps the empty ranking state free of private controls", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[]} />));
    assert.match(document.body.textContent ?? "", /榜单数据准备中/);
    assert.equal(document.querySelector('[aria-label="我的进度"]'), null);
    assert.equal(document.querySelector('[aria-label="本地备份"]'), null);
    assert.equal(document.querySelector('[role="search"]'), null);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("sync onboarding requires recovery acknowledgement and removes the phrase when closed", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  installDialogStub(dom);
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<RankingWorkspace works={[work]} />));
    const enable = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "启用私密同步");
    assert.ok(enable);

    await act(async () => enable.click());
    await act(async () => { await flush(500); });
    const phrase = document.querySelector("[data-recovery-phrase]");
    assert.ok(phrase?.textContent);
    assert.equal(document.body.textContent?.includes("恢复短语是唯一凭证"), true);

    const copy = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "复制短语");
    assert.ok(copy);
    await act(async () => copy.click());
    assert.equal(document.body.textContent?.includes("复制失败，请手动抄写"), true);

    const continueButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "我已安全保存，继续");
    assert.ok(continueButton);
    assert.equal(continueButton.disabled, true);

    const acknowledgement = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent === "我已保存恢复短语");
    assert.ok(acknowledgement);
    await act(async () => acknowledgement.click());
    assert.equal(continueButton.disabled, false);

    const close = document.querySelector<HTMLButtonElement>('button[aria-label="关闭恢复短语"]');
    assert.ok(close);
    await act(async () => close.click());
    assert.equal(document.querySelector("[data-recovery-phrase]"), null);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("sync vault survives remount in browser storage and disconnect removes the local credential", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  installDialogStub(dom);
  const vaultStore = new SyncVaultStore(dom.window.localStorage);
  const vault = await createRecoveryVault();
  const createVault = async () => vault;
  let root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<SyncSettings vaultStore={vaultStore} createVault={createVault} />));
    await act(async () => { await flush(); });
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "启用私密同步")?.click());
    await act(async () => { await flush(); });
    const acknowledgement = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent === "我已保存恢复短语");
    assert.ok(acknowledgement);
    await act(async () => acknowledgement.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "我已安全保存，继续")?.click());
    await act(async () => { await flush(50); });
    const storedVault = await vaultStore.load();
    assert.equal(storedVault?.phrase, vault.phrase);
    assert.equal(storedVault?.salt, vault.salt);

    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<SyncSettings vaultStore={vaultStore} createVault={createVault} />));
    await act(async () => { await flush(300); });
    assert.equal(document.body.textContent?.includes("本地保险库已启用"), true);

    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "断开本地保险库")?.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认断开本地访问")?.click());
    assert.equal(await vaultStore.load(), null);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("sync settings does not read browser storage during server render and hydrates to disabled on blocked storage", async () => {
  let getItemCalls = 0;
  const blockedStore = new SyncVaultStore({
    getItem() { getItemCalls += 1; throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  });
  const markup = renderToStaticMarkup(<SyncSettings vaultStore={blockedStore} />);
  assert.equal(getItemCalls, 0);
  assert.match(markup, /正在检查本地保险库/);
  assert.doesNotMatch(markup, /启用私密同步|导入配对二维码|断开本地保险库/);
  assert.doesNotMatch(markup, /data-recovery-phrase/);

  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => { root.render(<SyncSettings vaultStore={blockedStore} />); await flush(); });
    assert.equal(getItemCalls, 1);
    assert.equal(document.body.textContent?.includes("启用私密同步"), true);
    assert.equal(document.querySelector("[data-recovery-phrase]"), null);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("pairing import validates a QR recovery payload before saving it locally", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const vaultStore = new SyncVaultStore(dom.window.localStorage);
  const vault = await createRecoveryVault();
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<SyncSettings vaultStore={vaultStore} />));
    await act(async () => { await flush(); });
    const importButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "导入配对二维码");
    assert.ok(importButton);
    await act(async () => importButton.click());
    const input = document.querySelector<HTMLTextAreaElement>("#pairing-payload");
    assert.ok(input);
    setTextAreaValue(dom, input, "invalid");
    await act(async () => input.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认导入")?.click());
    assert.equal(await vaultStore.load(), null);

    setTextAreaValue(dom, input, serializeRecoveryPayload(vault));
    await act(async () => input.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认导入")?.click());
    await act(async () => { await flush(700); });
    assert.equal((await vaultStore.load())?.vaultId, vault.vaultId);
    assert.equal(document.location.href.includes(vault.phrase), false);
    assert.equal(document.querySelector("[data-recovery-phrase]"), null);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

test("sync settings keeps controls unavailable until deferred vault hydration preserves the existing vault", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
  const originalGlobals = installDom(dom);
  const existingVault = await createRecoveryVault();
  let resolveLoad: (vault: RecoveryVault | null) => void = () => {};
  const pendingLoad = new Promise<RecoveryVault | null>((resolve) => { resolveLoad = resolve; });
  let saveCalls = 0;
  const deferredStore = {
    load: () => pendingLoad,
    save: () => { saveCalls += 1; },
    clear: () => {},
  } as unknown as SyncVaultStore;
  const root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<SyncSettings vaultStore={deferredStore} />));
    assert.match(document.body.textContent ?? "", /正在检查本地保险库/);
    assert.equal([...document.querySelectorAll("button")].some((button) => /启用私密同步|导入配对二维码|断开本地保险库/.test(button.textContent ?? "")), false);

    await act(async () => { resolveLoad(existingVault); await flush(); });
    assert.equal(document.body.textContent?.includes("本地保险库已启用"), true);
    assert.equal(saveCalls, 0);
  } finally {
    await act(async () => root.unmount());
    originalGlobals.restore();
  }
});

function installDialogStub(dom: JSDOM) {
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new dom.window.Event("close"));
    },
  });
}

function flush(delay = 20) {
  return new Promise<void>((resolve) => setTimeout(resolve, delay));
}

function setTextAreaValue(dom: JSDOM, input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
}

function installDom(dom: JSDOM) {
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      clearRect: () => {},
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: () => {},
    }),
  });
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLDialogElement", "Node", "Event", "MouseEvent"] as const;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of globals) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

  return {
    restore() {
      for (const name of globals) {
        const original = originals.get(name);
        if (original) Object.defineProperty(globalThis, name, original);
        else Reflect.deleteProperty(globalThis, name);
      }
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      dom.window.close();
    },
  };
}
