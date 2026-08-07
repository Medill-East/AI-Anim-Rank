import type { ProgressRecord } from "../domain/progress.ts";
import { decryptProgressPayload, encryptProgressPayload, type RecoveryVault } from "./crypto.ts";
import type { EncryptedProgressPayload, RemoteVault, SyncResult, SyncTransport } from "./types.ts";

export class HttpSyncTransport implements SyncTransport {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(normalized)) throw new Error("同步端点地址无效");
    this.baseUrl = normalized;
  }

  async fetch(vaultId: string): Promise<RemoteVault | undefined> {
    const response = await globalThis.fetch(this.url(vaultId), { headers: { Accept: "application/json" } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`同步读取失败（${response.status}）`);
    const version = parseVersion(response.headers.get("etag"));
    if (version === null) throw new Error("同步响应缺少版本号");
    return { payload: await response.json() as EncryptedProgressPayload, version };
  }

  async put(payload: EncryptedProgressPayload, ifMatch: number | null): Promise<{ status: 200 | 201; version: number } | { status: 409 }> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (ifMatch !== null) headers["If-Match"] = `"${ifMatch}"`;
    const response = await globalThis.fetch(this.url(payload.vaultId), { method: "PUT", headers, body: JSON.stringify(payload) });
    if (response.status === 409) return { status: 409 };
    if (response.status !== 200 && response.status !== 201) throw new Error(`同步写入失败（${response.status}）`);
    const version = parseVersion(response.headers.get("etag"));
    if (version === null) throw new Error("同步响应缺少版本号");
    return { status: response.status, version };
  }

  private url(vaultId: string): string {
    return `${this.baseUrl}/v1/vaults/${encodeURIComponent(vaultId)}`;
  }
}

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

    let records: ProgressRecord[];
    try {
      records = remote
        ? mergeRecords(localRecords, await decryptProgressPayload(remote.payload, this.vault))
        : copyRecords(localRecords);
    } catch {
      return unsynced(localRecords);
    }
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

    let merged: ProgressRecord[];
    try {
      merged = mergeRecords(records, await decryptProgressPayload(latest.payload, this.vault));
    } catch {
      return unsynced(localRecords);
    }
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
    (!record.reviewed && !record.recommended || record.watched) &&
    !(record.recommended && record.notInterested) &&
    typeof record.updatedAt === "string" && !Number.isNaN(Date.parse(record.updatedAt)) &&
    Number.isInteger(record.revision) && record.revision >= 0 &&
    (record.note === undefined || typeof record.note === "string");
}

function unsynced(records: readonly ProgressRecord[]): SyncResult {
  return { state: "unsynced", records: copyRecords(records) };
}

function parseVersion(value: string | null): number | null {
  const match = /^"([1-9][0-9]*)"$/.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

function copyRecords(records: readonly ProgressRecord[]): ProgressRecord[] {
  return records.map(copyRecord);
}

function copyRecord(record: ProgressRecord): ProgressRecord {
  return { ...record, ...(record.note === undefined ? {} : { note: record.note }) };
}
