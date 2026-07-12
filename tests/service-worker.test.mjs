import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadWorker({ cachedShell = true } = {}) {
  const listeners = new Map();
  const cachedResponses = new Map([
    ["/offline.html", new Response("offline fallback")],
    ...(cachedShell ? [["/", new Response("ranking app shell")]] : []),
  ]);
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const precache = { version: "test", assets: ["/", "/offline.html"] };
  const context = {
    caches: {
      delete: async () => true,
      keys: async () => [],
      match: async (request) => cachedResponses.get(typeof request === "string" ? request : new URL(request.url).pathname),
      open: async () => ({ addAll: async () => {} }),
    },
    fetch: async () => { throw new Error("offline"); },
    importScripts() { context.self.__AI_ANIM_RANK_PRECACHE__ = precache; },
    self: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
    },
  };

  vm.runInNewContext(worker, context, { filename: "sw.js" });
  return listeners;
}

async function offlineNavigation(listeners) {
  let responsePromise;
  listeners.get("fetch")({
    request: { mode: "navigate" },
    respondWith(response) { responsePromise = response; },
  });
  return responsePromise;
}

test("offline navigation serves the cached ranking app shell before the generic fallback", async () => {
  const response = await offlineNavigation(await loadWorker());

  assert.equal(await response.text(), "ranking app shell");
});

test("offline navigation falls back when no cached ranking app shell exists", async () => {
  const response = await offlineNavigation(await loadWorker({ cachedShell: false }));

  assert.equal(await response.text(), "offline fallback");
});
