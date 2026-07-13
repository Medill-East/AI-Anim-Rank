import assert from "node:assert/strict";
import test from "node:test";

import type { ProgressRecord } from "../src/domain/progress.ts";
import { createRecoveryVault, encryptProgressPayload } from "../src/sync/crypto.ts";
import { mergeRecords, SyncClient } from "../src/sync/client.ts";
import type { EncryptedProgressPayload, SyncTransport } from "../src/sync/types.ts";

const base: ProgressRecord = {
  workId: "frieren",
  watched: true,
  reviewed: false,
  recommended: false,
  notInterested: false,
  updatedAt: "2026-07-12T00:00:00.000Z",
  revision: 1,
};

test("mergeRecords keeps the latest record per work and keeps local on a timestamp tie", () => {
  const newerRemote = { ...base, reviewed: true, updatedAt: "2026-07-12T01:00:00.000Z", revision: 2 };
  const localTie = { ...base, workId: "bocchi", note: "local tie" };
  const remoteTie = { ...localTie, note: "remote tie", revision: 3 };

  assert.deepEqual(mergeRecords([base, localTie], [newerRemote, remoteTie]), [localTie, newerRemote]);
});

test("mergeRecords retains an unseen work marked not interested", () => {
  const unseenNotInterested = { ...base, watched: false, notInterested: true };

  assert.deepEqual(mergeRecords([unseenNotInterested], []), [unseenNotInterested]);
});

test("SyncClient fetches, merges, and retries once after a version conflict", async () => {
  const vault = await createRecoveryVault();
  const remote = { ...base, reviewed: true, updatedAt: "2026-07-12T01:00:00.000Z", revision: 2 };
  const remotePayload = await encryptProgressPayload([remote], vault);
  const puts: Array<{ payload: EncryptedProgressPayload; ifMatch: number | null }> = [];
  let fetches = 0;
  const transport: SyncTransport = {
    async fetch() {
      fetches += 1;
      return { payload: remotePayload, version: fetches === 1 ? 4 : 5 };
    },
    async put(payload, ifMatch) {
      puts.push({ payload, ifMatch });
      return puts.length === 1 ? { status: 409 } : { status: 200, version: 6 };
    },
  };

  const result = await new SyncClient(transport, vault).sync([base]);

  assert.equal(result.state, "synced");
  assert.deepEqual(result.records, [remote]);
  assert.deepEqual(puts.map(({ ifMatch }) => ifMatch), [4, 5]);
  assert.equal(fetches, 2);
});

test("SyncClient preserves local records and reports unsynced on transport errors", async () => {
  const vault = await createRecoveryVault();
  const remotePayload = await encryptProgressPayload([{ ...base, updatedAt: "2026-07-12T01:00:00.000Z", revision: 2 }], vault);
  const transport: SyncTransport = {
    async fetch() {
      return { payload: remotePayload, version: 3 };
    },
    async put() {
      throw new Error("offline");
    },
  };

  const result = await new SyncClient(transport, vault).sync([base]);

  assert.deepEqual(result, { state: "unsynced", records: [base] });
});

test("SyncClient preserves local records when a remote payload is malformed", async () => {
  const vault = await createRecoveryVault();
  const payload = await encryptProgressPayload([base], vault);
  let puts = 0;
  const transport: SyncTransport = {
    async fetch() {
      return { payload: { ...payload, ciphertext: "!" }, version: 3 };
    },
    async put() {
      puts += 1;
      return { status: 200, version: 4 };
    },
  };

  const result = await new SyncClient(transport, vault).sync([base]);

  assert.deepEqual(result, { state: "unsynced", records: [base] });
  assert.equal(puts, 0);
});
