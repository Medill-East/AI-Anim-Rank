import type { RecoveryVault } from "../sync/crypto.ts";

const STORAGE_KEY = "ai-anim-rank:sync-vault:v1";

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface StoredSyncVault {
  phrase: string;
  salt: string;
}

export class SyncVaultStore {
  private readonly storage: BrowserStorage | undefined;

  constructor(storage: BrowserStorage | undefined = browserStorage()) {
    this.storage = storage;
  }

  load(): StoredSyncVault | null {
    const serialized = this.storage?.getItem(STORAGE_KEY);
    if (!serialized) return null;
    try {
      const value: unknown = JSON.parse(serialized);
      return isStoredSyncVault(value) ? { phrase: value.phrase, salt: value.salt } : null;
    } catch {
      return null;
    }
  }

  save(vault: Pick<RecoveryVault, "phrase" | "salt">): void {
    if (!this.storage) throw new Error("浏览器本地存储不可用");
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ phrase: vault.phrase, salt: vault.salt }));
  }

  clear(): void {
    this.storage?.removeItem(STORAGE_KEY);
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
