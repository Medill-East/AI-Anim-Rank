import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { RankingWorkspace } from "../src/features/ranking/RankingWorkspace.tsx";
import type { RankedWork } from "../src/data/schema.ts";
import { ProgressRepository } from "../src/storage/progress-db.ts";
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
