import { openRecoveryVault, type RecoveryVault } from "../sync/crypto.ts";

const STORAGE_KEY = "ai-anim-rank:sync-vault:v1";
const PAIRING_PREFIX = "ai-anim-rank:pairing:v1:";

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface StoredSyncVault {
  phrase: string;
  salt: string;
}

export function serializeRecoveryPayload(vault: Pick<RecoveryVault, "phrase" | "salt">): string {
  return PAIRING_PREFIX + bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ phrase: vault.phrase, salt: vault.salt })));
}

export async function parseRecoveryPayload(payload: string): Promise<RecoveryVault | null> {
  try {
    if (!payload.startsWith(PAIRING_PREFIX)) return null;
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload.slice(PAIRING_PREFIX.length))));
    if (!isStoredSyncVault(value)) return null;
    return await openRecoveryVault(value.phrase, value.salt);
  } catch {
    return null;
  }
}

export class SyncVaultStore {
  private readonly storage: BrowserStorage | undefined;

  constructor(storage: BrowserStorage | undefined = browserStorage()) {
    this.storage = storage;
  }

  async load(): Promise<RecoveryVault | null> {
    try {
      const serialized = this.storage?.getItem(STORAGE_KEY);
      if (!serialized) return null;
      const value: unknown = JSON.parse(serialized);
      if (!isStoredSyncVault(value)) throw new Error("Stored sync vault is invalid");
      return await openRecoveryVault(value.phrase, value.salt);
    } catch {
      this.clear();
      return null;
    }
  }

  save(vault: Pick<RecoveryVault, "phrase" | "salt">): void {
    if (!this.storage) throw new Error("浏览器本地存储不可用");
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ phrase: vault.phrase, salt: vault.salt }));
  }

  clear(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {}
  }
}

function browserStorage(): BrowserStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isStoredSyncVault(value: unknown): value is StoredSyncVault {
  return typeof value === "object" && value !== null &&
    typeof (value as StoredSyncVault).phrase === "string" && (value as StoredSyncVault).phrase !== "" &&
    typeof (value as StoredSyncVault).salt === "string" && (value as StoredSyncVault).salt !== "";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Pairing payload is invalid");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
