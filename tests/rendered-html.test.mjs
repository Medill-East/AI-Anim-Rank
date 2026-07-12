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
  assert.match(html, /<title>AI Anim Rank<\/title>/i);
  assert.match(html, /<h1>AI Anim Rank<\/h1>/i);
  assert.match(html, new RegExp(`共\\s*<!--\\s*-->${rankingSnapshot.works.length}<!--\\s*-->\\s*部`));
  assert.match(html, new RegExp(`>${topWork.rank}<\\/td>`));
  assert.match(html, new RegExp(topWork.titleZh));
  assert.doesNotMatch(html, /榜单数据准备中/i);
  assert.match(html, /<form class="ranking-controls" role="search">/i);
  assert.match(html, /未配置远程同步端点；个人进度仅本机保存。/i);
});
