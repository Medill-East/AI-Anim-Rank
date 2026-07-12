const MAX_BODY_BYTES = 1_048_576;
const VAULT_ID = /^[A-Za-z0-9_-]{43}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;

export interface SyncEnv {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
}

interface VaultPayload {
  ciphertext: string;
  iv: string;
  salt: string;
}

interface VaultRow extends VaultPayload {
  vault_id: string;
  version: number;
}

const syncApi = {
  async fetch(request: Request, env: SyncEnv): Promise<Response> {
    const url = new URL(request.url);
    const vaultId = vaultIdFromPath(url.pathname);
    if (!vaultId) {
      return url.pathname.startsWith("/v1/vaults/")
        ? new Response("Invalid vault ID", { status: 400 })
        : new Response("Not found", { status: 404 });
    }

    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return cors ? new Response(null, { status: 204, headers: cors }) : new Response("Forbidden", { status: 403 });
    }
    if (request.method === "GET") return getVault(vaultId, env, cors);
    if (request.method === "PUT") return putVault(request, vaultId, env, cors);
    return response("Method not allowed", 405, cors, { Allow: "GET, PUT, OPTIONS" });
  },
};

export default syncApi;

async function getVault(vaultId: string, env: SyncEnv, cors: HeadersInit | undefined): Promise<Response> {
  const row = await readVault(vaultId, env.DB);
  return row
    ? json(payloadFromRow(row), 200, cors, etag(row.version))
    : response("Not found", 404, cors);
}

async function putVault(request: Request, vaultId: string, env: SyncEnv, cors: HeadersInit | undefined): Promise<Response> {
  const payload = await readPayload(request);
  if (!payload) return response("Invalid encrypted payload", 400, cors);

  const existing = await readVault(vaultId, env.DB);
  if (!existing) {
    try {
      await env.DB.prepare(
        "INSERT INTO vaults (vault_id, ciphertext, iv, salt, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)",
      ).bind(vaultId, payload.ciphertext, payload.iv, payload.salt, Date.now()).run();
      return json(payload, 201, cors, etag(1));
    } catch {
      const current = await readVault(vaultId, env.DB);
      return current ? conflict(current, cors) : response("Unable to save vault", 500, cors);
    }
  }

  const expectedVersion = parseEtag(request.headers.get("if-match"));
  if (expectedVersion !== existing.version) return conflict(existing, cors);

  const nextVersion = existing.version + 1;
  const result = await env.DB.prepare(
    "UPDATE vaults SET ciphertext = ?, iv = ?, salt = ?, version = ?, updated_at = ? WHERE vault_id = ? AND version = ?",
  ).bind(payload.ciphertext, payload.iv, payload.salt, nextVersion, Date.now(), vaultId, expectedVersion).run();
  if (result.meta.changes !== 1) {
    const current = await readVault(vaultId, env.DB);
    return current ? conflict(current, cors) : response("Not found", 404, cors);
  }
  return json(payload, 200, cors, etag(nextVersion));
}

async function readVault(vaultId: string, db: D1Database): Promise<VaultRow | null> {
  return db.prepare(
    "SELECT vault_id, ciphertext, iv, salt, version FROM vaults WHERE vault_id = ?",
  ).bind(vaultId).first<VaultRow>();
}

async function readPayload(request: Request): Promise<VaultPayload | null> {
  const length = Number(request.headers.get("content-length"));
  if ((Number.isFinite(length) && length > MAX_BODY_BYTES) || !request.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isPayload(value)) return null;
  return value;
}

function isPayload(value: unknown): value is VaultPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).length === 3 &&
    typeof payload.ciphertext === "string" && isBase64Url(payload.ciphertext) &&
    typeof payload.iv === "string" && payload.iv.length === 16 && isBase64Url(payload.iv) &&
    typeof payload.salt === "string" && payload.salt.length === 43 && isBase64Url(payload.salt);
}

function isBase64Url(value: string): boolean {
  return BASE64_URL.test(value) && value.length % 4 !== 1;
}

function vaultIdFromPath(pathname: string): string | null {
  const match = /^\/v1\/vaults\/([^/]+)$/.exec(pathname);
  return match && VAULT_ID.test(match[1]) ? match[1] : null;
}

function payloadFromRow(row: VaultRow): VaultPayload {
  return { ciphertext: row.ciphertext, iv: row.iv, salt: row.salt };
}

function parseEtag(value: string | null): number | null {
  const match = /^"([1-9][0-9]*)"$/.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

function etag(version: number): HeadersInit {
  return { ETag: `"${version}"` };
}

function corsHeaders(request: Request, env: SyncEnv): HeadersInit | undefined {
  const origin = request.headers.get("origin");
  if (!origin || !isExplicitOrigin(env.ALLOWED_ORIGIN) || origin !== env.ALLOWED_ORIGIN) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-Match",
    "Access-Control-Expose-Headers": "ETag",
    Vary: "Origin",
  };
}

function isExplicitOrigin(value: string | undefined): value is string {
  if (!value || value === "*") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

function conflict(row: VaultRow, cors: HeadersInit | undefined): Response {
  return json(payloadFromRow(row), 409, cors, etag(row.version));
}

function json(body: unknown, status: number, cors?: HeadersInit, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors, ...extra } });
}

function response(body: string, status: number, cors?: HeadersInit, extra?: HeadersInit): Response {
  return new Response(body, { status, headers: { ...cors, ...extra } });
}
