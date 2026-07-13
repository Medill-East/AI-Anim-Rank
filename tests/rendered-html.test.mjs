import assert from "node:assert/strict";
import test from "node:test";
import rankingSnapshot from "../src/data/ranking.json" with { type: "json" };

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the published ranking app shell", async () => {
  assert.equal(rankingSnapshot.sample, false);
  const topWork = rankingSnapshot.works.find((work) => work.rank === 1);
  assert.ok(topWork, "published snapshot includes the top-ranked work");

  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AnimeRank<\/title>/i);
  assert.match(html, /<h1>AnimeRank<\/h1>/i);
  assert.match(html, new RegExp(`总收录<\\/span><strong>${rankingSnapshot.works.length}<small> 部`));
  assert.match(html, new RegExp(`>${topWork.rank}<\\/td>`));
  assert.match(html, new RegExp(topWork.titleZh));
  assert.doesNotMatch(html, /榜单数据准备中/i);
  assert.match(html, /<form class="ranking-controls" role="search">/i);
  assert.match(html, /<section class="data-tools" aria-label="备份与同步">/i);
  assert.match(html, /<section class="data-tool data-tool-backup" aria-label="本地备份">/i);
  assert.match(html, /<section class="ranking-methodology" aria-label="排名依据">/i);
  assert.match(html, /href="https:\/\/anilist\.co\/"/i);
  assert.match(html, /href="https:\/\/myanimelist\.net\/"/i);
  assert.match(html, /href="https:\/\/bgm\.tv\/"/i);
  assert.match(html, new RegExp(`数据快照日期：<!--\\s*-->${rankingSnapshot.version}`));
  assert.doesNotMatch(html, /<details class="ranking-methodology"/i);
  assert.match(html, /未配置远程同步端点；个人进度仅本机保存。/i);
});
