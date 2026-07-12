import assert from "node:assert/strict";
import test from "node:test";

import { createRecoveryVault, encryptProgressPayload } from "../src/sync/crypto.ts";
import { parseRecoveryPayload, serializeRecoveryPayload, SyncVaultStore } from "../src/storage/sync-vault.ts";

test("sync vault safely disables when browser storage read is blocked", async () => {
  const store = new SyncVaultStore({
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  });

  assert.equal(await store.load(), null);
});

test("sync vault clears corrupt or invalid stored credentials", async () => {
  let value = JSON.stringify({ phrase: "not a mnemonic", salt: "not-a-salt" });
  let removeCalls = 0;
  const store = new SyncVaultStore({
    getItem: () => value,
    setItem: () => {},
    removeItem: () => { removeCalls += 1; value = null as unknown as string; },
  });

  assert.equal(await store.load(), null);
  assert.equal(removeCalls, 1);
});

test("sync vault restores a usable RecoveryVault from valid browser credentials", async () => {
  const entries = new Map<string, string>();
  const store = new SyncVaultStore({
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  });
  const vault = await createRecoveryVault();
  store.save(vault);

  const restored = await store.load();
  assert.ok(restored);
  assert.equal(restored.phrase, vault.phrase);
  assert.equal(restored.salt, vault.salt);
  assert.equal((await encryptProgressPayload([], restored)).vaultId, vault.vaultId);
});

test("recovery pairing payload validates before it can restore a vault", async () => {
  const vault = await createRecoveryVault();
  const restored = await parseRecoveryPayload(serializeRecoveryPayload(vault));

  assert.ok(restored);
  assert.equal(restored.phrase, vault.phrase);
  assert.equal(await parseRecoveryPayload("not-a-pairing-payload"), null);
});
