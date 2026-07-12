import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

import type { ProgressRecord } from "../domain/progress.ts";
import type { EncryptedProgressPayload } from "./types.ts";

const PROTOCOL_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 32;
const IV_BYTES = 12;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface RecoveryVault {
  phrase: string;
  salt: string;
  vaultId: string;
  key: CryptoKey;
}

export async function createRecoveryVault(): Promise<RecoveryVault> {
  return openRecoveryVault(generateMnemonic(wordlist, 128), randomBase64Url(SALT_BYTES));
}

export async function openRecoveryVault(phrase: string, salt: string): Promise<RecoveryVault> {
  const normalizedPhrase = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(normalizedPhrase, wordlist)) {
    throw new Error("Recovery phrase is invalid");
  }

  const saltBytes = base64UrlToBytes(salt);
  if (saltBytes.length !== SALT_BYTES) {
    throw new Error("Vault salt is invalid");
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(normalizedPhrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: bytesToArrayBuffer(saltBytes), iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const vaultId = bytesToBase64Url(await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`ai-anim-rank:v1:vault:${normalizedPhrase}:${salt}`),
  ));

  return { phrase: normalizedPhrase, salt, vaultId, key };
}

export async function encryptProgressPayload(
  records: readonly ProgressRecord[],
  vault: RecoveryVault,
): Promise<EncryptedProgressPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = textEncoder.encode(JSON.stringify({ version: PROTOCOL_VERSION, records }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(iv), additionalData: bytesToArrayBuffer(associatedData(vault.vaultId)) },
    vault.key,
    plaintext,
  );

  return {
    vaultId: vault.vaultId,
    ciphertext: bytesToBase64Url(ciphertext),
    iv: bytesToBase64Url(iv),
    salt: vault.salt,
    version: PROTOCOL_VERSION,
  };
}

export async function decryptProgressPayload(
  payload: EncryptedProgressPayload,
  vault: RecoveryVault,
): Promise<ProgressRecord[]> {
  if (payload.version !== PROTOCOL_VERSION || payload.vaultId !== vault.vaultId || payload.salt !== vault.salt) {
    throw new Error("Recovery vault does not match this payload");
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytesToArrayBuffer(base64UrlToBytes(payload.iv)),
      additionalData: bytesToArrayBuffer(associatedData(payload.vaultId)),
    },
    vault.key,
    bytesToArrayBuffer(base64UrlToBytes(payload.ciphertext)),
  );
  const decoded: unknown = JSON.parse(textDecoder.decode(plaintext));
  if (!isEncryptedProgressDocument(decoded)) {
    throw new Error("Encrypted progress payload is invalid");
  }
  return decoded.records;
}

function associatedData(vaultId: string): Uint8Array {
  return textEncoder.encode(`ai-anim-rank:v${PROTOCOL_VERSION}:${vaultId}`);
}

function isEncryptedProgressDocument(value: unknown): value is { version: 1; records: ProgressRecord[] } {
  return typeof value === "object" && value !== null &&
    (value as { version?: unknown }).version === PROTOCOL_VERSION &&
    Array.isArray((value as { records?: unknown }).records);
}

function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Base64url value is invalid");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
