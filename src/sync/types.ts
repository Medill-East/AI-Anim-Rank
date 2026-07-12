import type { ProgressRecord } from "../domain/progress.ts";

export interface EncryptedProgressPayload {
  vaultId: string;
  ciphertext: string;
  iv: string;
  salt: string;
  version: 1;
}

export interface RemoteVault {
  payload: EncryptedProgressPayload;
  version: number;
}

export interface SyncTransport {
  fetch(vaultId: string): Promise<RemoteVault | undefined>;
  put(payload: EncryptedProgressPayload, ifMatch: number | null): Promise<
    | { status: 200; version: number }
    | { status: 409 }
  >;
}

export type SyncResult =
  | { state: "synced"; records: ProgressRecord[]; version: number }
  | { state: "unsynced"; records: ProgressRecord[] };
