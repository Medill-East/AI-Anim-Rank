import assert from "node:assert/strict";
import test from "node:test";

import type { ProgressRecord } from "../src/domain/progress.ts";
import {
  createRecoveryVault,
  decryptProgressPayload,
  encryptProgressPayload,
  openRecoveryVault,
} from "../src/sync/crypto.ts";

const record: ProgressRecord = {
  workId: "frieren",
  watched: true,
  reviewed: true,
  recommended: true,
  notInterested: false,
  note: "只给熟悉的朋友推荐",
  updatedAt: "2026-07-12T00:00:00.000Z",
  revision: 2,
};

test("recovery vault uses a 12-word phrase and encrypts private progress without plaintext", async () => {
  const vault = await createRecoveryVault();
  const payload = await encryptProgressPayload([record], vault);

  assert.equal(vault.phrase.trim().split(/\s+/).length, 12);
  assert.equal(payload.iv.length > 0, true);
  assert.equal(payload.salt, vault.salt);
  assert.deepEqual(Object.keys(payload).sort(), ["ciphertext", "iv", "salt", "vaultId", "version"]);
  assert.equal(JSON.stringify(payload).includes(record.note!), false);
  assert.equal(JSON.stringify(payload).includes(vault.phrase), false);
  assert.deepEqual(await decryptProgressPayload(payload, vault), [record]);
});

test("encrypted progress rejects a different recovery phrase", async () => {
  const vault = await createRecoveryVault();
  const payload = await encryptProgressPayload([record], vault);
  const wrongVault = await openRecoveryVault("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", vault.salt);

  await assert.rejects(decryptProgressPayload(payload, wrongVault));
});
