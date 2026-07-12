import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { Miniflare } from "miniflare";

const vaultId = "a".repeat(43);
const payload = {
  ciphertext: "b".repeat(32),
  iv: "c".repeat(16),
  salt: "d".repeat(43),
};

test("encrypted vault worker creates, fetches, rejects stale writes, and validates input", async () => {
  const directory = await mkdtemp(resolve(".wrangler", "sync-worker-test-"));
  const output = resolve(directory, "worker.mjs");
  let mf: Miniflare | undefined;

  try {
    await build({
      bundle: true,
      entryPoints: [resolve("worker/sync-api.ts")],
      format: "esm",
      outfile: output,
      platform: "neutral",
      target: "es2022",
    });
    mf = new Miniflare({
      modules: true,
      scriptPath: output,
      compatibilityDate: "2026-05-22",
      d1Databases: { DB: "sync-test" },
      bindings: { ALLOWED_ORIGIN: "https://app.example" },
    });
    const db = await mf.getD1Database("DB");
    await db.exec("CREATE TABLE vaults (vault_id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, salt TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");

    const created = await mf.dispatchFetch(`https://sync.example/v1/vaults/${vaultId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://app.example" },
      body: JSON.stringify(payload),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("etag"), '"1"');
    assert.equal(created.headers.get("access-control-allow-origin"), "https://app.example");

    const fetched = await mf.dispatchFetch(`https://sync.example/v1/vaults/${vaultId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get("etag"), '"1"');
    assert.deepEqual(await fetched.json(), payload);

    const updatedPayload = { ...payload, ciphertext: "e".repeat(32) };
    const updated = await mf.dispatchFetch(`https://sync.example/v1/vaults/${vaultId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify(updatedPayload),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.headers.get("etag"), '"2"');

    const stale = await mf.dispatchFetch(`https://sync.example/v1/vaults/${vaultId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({ ...payload, ciphertext: "f".repeat(32) }),
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), updatedPayload);
    assert.equal(stale.headers.get("etag"), '"2"');

    const invalidId = await mf.dispatchFetch("https://sync.example/v1/vaults/not-valid!");
    assert.equal(invalidId.status, 400);
    const invalidPayload = await mf.dispatchFetch(`https://sync.example/v1/vaults/${vaultId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"2"' },
      body: JSON.stringify({ ...payload, iv: "!" }),
    });
    assert.equal(invalidPayload.status, 400);

    const untrustedOrigin = await mf.dispatchFetch(`https://sync.example/v1/vaults/${vaultId}`, {
      headers: { origin: "https://untrusted.example" },
    });
    assert.equal(untrustedOrigin.headers.get("access-control-allow-origin"), null);
  } finally {
    await mf?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
