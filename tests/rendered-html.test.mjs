import assert from "node:assert/strict";
import test from "node:test";

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

test("server-renders the ranking app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AI Anim Rank<\/title>/i);
  assert.match(html, /<h1>AI Anim Rank<\/h1>/i);
  assert.match(
    html,
    /<label[^>]*for="work-search"[^>]*>搜索作品<\/label>/i,
  );
  assert.match(html, /<input[^>]*id="work-search"[^>]*type="search"/i);
  assert.match(html, /榜单数据准备中/i);
});
