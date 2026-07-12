import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { RankingWorkspace } from "../src/features/ranking/RankingWorkspace.tsx";
import { SyncSettings } from "../src/features/progress/SyncSettings.tsx";
import type { RankedWork } from "../src/data/schema.ts";
import type { ProgressRecord } from "../src/domain/progress.ts";
import { ProgressRepository } from "../src/storage/progress-db.ts";
import { SyncVaultStore } from "../src/storage/sync-vault.ts";
import type { RecoveryVault } from "../src/sync/crypto.ts";
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

    assert.match(document.body.textContent ?? "", /已评价 1[\s\S]*推荐 1/);
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
    assert.match(document.body.textContent ?? "", /我的进度[\s\S]*共 1 部[\s\S]*已看 0[\s\S]*完成 0%[\s\S]*已评价 0[\s\S]*推荐 0[\s\S]*不感兴趣 0/);
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
  const vault: RecoveryVault = {
    phrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    salt: "test-salt",
    vaultId: "test-vault",
    key: {} as CryptoKey,
  };
  const createVault = async () => vault;
  let root = createRoot(document.getElementById("root")!);

  try {
    await act(async () => root.render(<SyncSettings vaultStore={vaultStore} createVault={createVault} />));
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "启用私密同步")?.click());
    await act(async () => { await flush(); });
    const acknowledgement = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent === "我已保存恢复短语");
    assert.ok(acknowledgement);
    await act(async () => acknowledgement.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "我已安全保存，继续")?.click());
    assert.deepEqual(vaultStore.load(), { phrase: vault.phrase, salt: vault.salt });

    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await act(async () => { root.render(<SyncSettings vaultStore={vaultStore} createVault={createVault} />); await flush(); });
    assert.equal(document.body.textContent?.includes("本地保险库已启用"), true);

    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "断开本地保险库")?.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认断开本地访问")?.click());
    assert.equal(vaultStore.load(), null);
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

function installDom(dom: JSDOM) {
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
