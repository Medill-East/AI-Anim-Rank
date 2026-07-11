import type { ProgressRecord } from "../domain/progress.ts";

export interface ProgressBackup {
  version: 1;
  exportedAt: string;
  records: ProgressRecord[];
}

export type ProgressBackupImportMode = "merge" | "replace";

export function exportProgressBackup(
  records: readonly ProgressRecord[],
  exportedAt = new Date().toISOString(),
): ProgressBackup {
  return {
    version: 1,
    exportedAt,
    records: records.map(copyProgressRecord),
  };
}

export function parseProgressBackup(
  json: string,
  currentWorkIds: ReadonlySet<string>,
): ProgressBackup {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("备份文件不是有效的 JSON");
  }

  if (!isRecord(value) || value.version !== 1 || !isIsoTimestamp(value.exportedAt) || !Array.isArray(value.records)) {
    throw new Error("备份文件格式无效");
  }

  const records = value.records.map((record, index) => parseProgressRecord(record, index));
  const seenWorkIds = new Set<string>();
  for (const record of records) {
    if (!currentWorkIds.has(record.workId)) {
      throw new Error(`未知作品：${record.workId}`);
    }
    if (seenWorkIds.has(record.workId)) {
      throw new Error(`备份中存在重复作品：${record.workId}`);
    }
    seenWorkIds.add(record.workId);
  }

  return { version: 1, exportedAt: value.exportedAt, records };
}

export function applyProgressBackup(
  existingRecords: readonly ProgressRecord[],
  backup: ProgressBackup,
  mode: ProgressBackupImportMode,
): ProgressRecord[] {
  if (mode === "replace") {
    return backup.records.map(copyProgressRecord);
  }

  const importedByWorkId = new Map(backup.records.map((record) => [record.workId, record]));
  const merged = existingRecords.map((record) =>
    copyProgressRecord(importedByWorkId.get(record.workId) ?? record),
  );
  for (const record of backup.records) {
    if (!existingRecords.some((existing) => existing.workId === record.workId)) {
      merged.push(copyProgressRecord(record));
    }
  }
  return merged;
}

function copyProgressRecord(record: ProgressRecord): ProgressRecord {
  return {
    workId: record.workId,
    watched: record.watched,
    reviewed: record.reviewed,
    recommended: record.recommended,
    notInterested: record.notInterested,
    ...(record.note === undefined ? {} : { note: record.note }),
    updatedAt: record.updatedAt,
    revision: record.revision,
  };
}

function parseProgressRecord(value: unknown, index: number): ProgressRecord {
  const path = `records[${index}]`;
  if (!isRecord(value) ||
    !isNonEmptyString(value.workId) ||
    typeof value.watched !== "boolean" ||
    typeof value.reviewed !== "boolean" ||
    typeof value.recommended !== "boolean" ||
    typeof value.notInterested !== "boolean" ||
    !isIsoTimestamp(value.updatedAt) ||
    typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0 ||
    (value.note !== undefined && typeof value.note !== "string")) {
    throw new Error(`${path} 格式无效`);
  }

  if (
    (!value.watched && (value.reviewed || value.recommended || value.notInterested)) ||
    (value.recommended && value.notInterested)
  ) {
    throw new Error(`${path} 格式无效`);
  }

  return {
    workId: value.workId,
    watched: value.watched,
    reviewed: value.reviewed,
    recommended: value.recommended,
    notInterested: value.notInterested,
    ...(value.note === undefined ? {} : { note: value.note }),
    updatedAt: value.updatedAt,
    revision: value.revision,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) {
    return false;
  }

  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
}
