import type { ProgressRecord } from "../domain/progress.ts";
import { decryptProgressPayload, encryptProgressPayload, type RecoveryVault } from "./crypto.ts";
import type { SyncResult, SyncTransport } from "./types.ts";

export class SyncClient {
  private readonly transport: SyncTransport;
  private readonly vault: RecoveryVault;

  constructor(
    transport: SyncTransport,
    vault: RecoveryVault,
  ) {
    this.transport = transport;
    this.vault = vault;
  }

  async sync(localRecords: readonly ProgressRecord[]): Promise<SyncResult> {
    let remote;
    try {
      remote = await this.transport.fetch(this.vault.vaultId);
    } catch {
      return unsynced(localRecords);
    }

    const records = remote
      ? mergeRecords(localRecords, await decryptProgressPayload(remote.payload, this.vault))
      : copyRecords(localRecords);
    const firstResult = await this.put(records, remote?.version ?? null);
    if (firstResult.state === "synced") return firstResult;
    if (firstResult.state === "unsynced") return unsynced(localRecords);

    let latest;
    try {
      latest = await this.transport.fetch(this.vault.vaultId);
    } catch {
      return unsynced(localRecords);
    }
    if (!latest) return unsynced(localRecords);

    const merged = mergeRecords(records, await decryptProgressPayload(latest.payload, this.vault));
    const retryResult = await this.put(merged, latest.version);
    return retryResult.state === "synced" ? retryResult : unsynced(localRecords);
  }

  private async put(records: ProgressRecord[], ifMatch: number | null): Promise<SyncResult | { state: "conflict" }> {
    const payload = await encryptProgressPayload(records, this.vault);
    try {
      const response = await this.transport.put(payload, ifMatch);
      return response.status === 409
        ? { state: "conflict" }
        : { state: "synced", records, version: response.version };
    } catch {
      return unsynced(records);
    }
  }
}

export function mergeRecords(
  localRecords: readonly ProgressRecord[],
  remoteRecords: readonly ProgressRecord[],
): ProgressRecord[] {
  const records = new Map<string, ProgressRecord>();
  for (const record of localRecords) addRecord(records, record, false);
  for (const record of remoteRecords) addRecord(records, record, true);
  return [...records.values()].sort((left, right) => left.workId.localeCompare(right.workId)).map(copyRecord);
}

function addRecord(records: Map<string, ProgressRecord>, candidate: ProgressRecord, isRemote: boolean): void {
  if (!isValidRecord(candidate)) return;
  const existing = records.get(candidate.workId);
  if (!existing || Date.parse(candidate.updatedAt) > Date.parse(existing.updatedAt)) {
    records.set(candidate.workId, copyRecord(candidate));
    return;
  }
  if (!isRemote && candidate.updatedAt === existing.updatedAt) {
    records.set(candidate.workId, copyRecord(candidate));
  }
}

function isValidRecord(record: ProgressRecord): boolean {
  return typeof record.workId === "string" && record.workId !== "" &&
    typeof record.watched === "boolean" && typeof record.reviewed === "boolean" &&
    typeof record.recommended === "boolean" && typeof record.notInterested === "boolean" &&
    (!record.reviewed && !record.recommended && !record.notInterested || record.watched) &&
    !(record.recommended && record.notInterested) &&
    typeof record.updatedAt === "string" && !Number.isNaN(Date.parse(record.updatedAt)) &&
    Number.isInteger(record.revision) && record.revision >= 0 &&
    (record.note === undefined || typeof record.note === "string");
}

function unsynced(records: readonly ProgressRecord[]): SyncResult {
  return { state: "unsynced", records: copyRecords(records) };
}

function copyRecords(records: readonly ProgressRecord[]): ProgressRecord[] {
  return records.map(copyRecord);
}

function copyRecord(record: ProgressRecord): ProgressRecord {
  return { ...record, ...(record.note === undefined ? {} : { note: record.note }) };
}
