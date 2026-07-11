import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

import { applyProgressPatch, type ProgressRecord } from "../src/domain/progress.ts";
import { ProgressRepository } from "../src/storage/progress-db.ts";

const initial: ProgressRecord = {
  workId: "work-1",
  watched: false,
  reviewed: false,
  recommended: false,
  notInterested: false,
  updatedAt: "2026-07-12T00:00:00.000Z",
  revision: 1,
};

test("applyProgressPatch normalizes dependent and exclusive flags without mutation", () => {
  const updated = applyProgressPatch(
    initial,
    { reviewed: true, recommended: true },
    "2026-07-12T01:00:00.000Z",
  );

  assert.deepEqual(updated, {
    ...initial,
    watched: true,
    reviewed: true,
    recommended: true,
    notInterested: false,
    updatedAt: "2026-07-12T01:00:00.000Z",
    revision: 2,
  });
  assert.deepEqual(initial, {
    workId: "work-1",
    watched: false,
    reviewed: false,
    recommended: false,
    notInterested: false,
    updatedAt: "2026-07-12T00:00:00.000Z",
    revision: 1,
  });
});

test("applyProgressPatch leaves timestamp and revision intact for a no-op", () => {
  assert.equal(
    applyProgressPatch(initial, { watched: false }, "2026-07-12T01:00:00.000Z"),
    initial,
  );
});

test("applyProgressPatch clears the opposite interest choice", () => {
  const recommended = applyProgressPatch(
    initial,
    { recommended: true },
    "2026-07-12T01:00:00.000Z",
  );
  const notInterested = applyProgressPatch(
    recommended,
    { notInterested: true },
    "2026-07-12T02:00:00.000Z",
  );

  assert.equal(notInterested.watched, true);
  assert.equal(notInterested.recommended, false);
  assert.equal(notInterested.notInterested, true);
  assert.equal(notInterested.revision, 3);
});

test("ProgressRepository is SSR-safe when IndexedDB is unavailable", async () => {
  const repository = new ProgressRepository(undefined);

  await assert.rejects(repository.loadAll(), /IndexedDB is unavailable/);
});

test("ProgressRepository persists only private progress records locally", async () => {
  const repository = new ProgressRepository(new IDBFactory());
  const second: ProgressRecord = {
    ...initial,
    workId: "work-2",
    watched: true,
    updatedAt: "2026-07-12T01:00:00.000Z",
    revision: 2,
  };

  await repository.save(initial);
  await repository.save(second);
  assert.deepEqual(await repository.loadAll(), [initial, second]);

  await repository.replaceAll([second]);
  assert.deepEqual(await repository.loadAll(), [second]);

  await repository.clear();
  assert.deepEqual(await repository.loadAll(), []);
});
