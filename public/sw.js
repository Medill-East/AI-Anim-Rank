importScripts("/precache-manifest.js");

const precache = self.__AI_ANIM_RANK_PRECACHE__;
const CACHE_NAME = `ai-anim-rank-shell-${precache.version}`;
const APP_SHELL = precache.assets;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("ai-anim-rank-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch {
      return await caches.match("/") ?? await caches.match("/offline.html");
    }
  })());
});
