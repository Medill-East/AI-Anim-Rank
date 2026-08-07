"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

import { type RecoveryVault } from "../../sync/crypto.ts";
import { parseRecoveryPayload, serializeRecoveryPayload, SyncVaultStore } from "../../storage/sync-vault.ts";
import type { SyncStatus } from "../../sync/types.ts";
import { RecoveryDialog } from "./RecoveryDialog.tsx";

interface SyncSettingsProps {
  vaultStore?: SyncVaultStore;
  createVault?: () => Promise<RecoveryVault>;
  heading?: boolean;
  syncBaseUrl?: string;
  syncStatus?: SyncStatus;
  onSyncNow?: () => void;
  onVaultChange?: (vault: RecoveryVault | null) => void;
}

export function SyncSettings({ vaultStore: providedVaultStore, createVault, heading = true, syncBaseUrl = "", syncStatus = "disabled", onSyncNow, onVaultChange }: SyncSettingsProps) {
  const vaultStore = useMemo(() => providedVaultStore ?? new SyncVaultStore(), [providedVaultStore]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [localVault, setLocalVault] = useState<RecoveryVault | null>(null);
  const [hydrationState, setHydrationState] = useState<"loading" | "ready">("loading");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    let active = true;
    void vaultStore.load().then((vault) => {
      if (!active) return;
      setLocalVault(vault);
      onVaultChange?.(vault);
      setHydrationState("ready");
    });
    return () => { active = false; };
  }, [onVaultChange, vaultStore]);
  const saveVault = async (vault: RecoveryVault) => {
    vaultStore.save(vault);
    setLocalVault(vault);
    onVaultChange?.(vault);
  };
  const disconnect = () => {
    try {
      vaultStore.clear();
      setLocalVault(null);
      onVaultChange?.(null);
      setConfirmDisconnect(false);
    } catch {
      setStorageError("无法移除本地凭证，请检查浏览器存储设置");
    }
  };

  return <section className="sync-settings" aria-label="私密同步设置">
    {heading && <h2>私密同步</h2>}
    {hydrationState === "loading" ? <p role="status">正在检查本地保险库…</p> : localVault ? <>
      <p>本地保险库已启用。连接密钥仅用于解锁同一个保险库；持有连接密钥的人可以读取和更改这些数据。{syncBaseUrl ? "云端同步已连接，标记会自动加密同步。" : "当前部署未配置云端同步，标记不会上传。"}</p>
      {syncBaseUrl && <SyncStatusRow status={syncStatus} onSyncNow={onSyncNow} />}
      <SyncSharePanel vault={localVault} />
      {confirmDisconnect ? <div className="disconnect-warning" role="alert"><p>断开只会移除这台设备上的本地访问，不会删除远端密文。</p><button type="button" onClick={disconnect}>确认断开本地访问</button><button type="button" onClick={() => setConfirmDisconnect(false)}>取消</button></div> : <button type="button" onClick={() => setConfirmDisconnect(true)}>断开本地保险库</button>}
      {storageError && <p role="status">{storageError}</p>}
    </> : <>
    <p>无需账户；Cloudflare 只存储密文，无法读取你的进度。{syncBaseUrl ? "创建或连接后会自动同步到云端保险库。" : "当前部署未配置云端同步，个人进度仅保存在本机。"}连接密钥丢失且本地数据被清除时无法恢复，持有者可以读取和更改数据。</p>
    <div className="sync-choice-actions"><button type="button" onClick={() => { setShowRecovery(true); setShowConnection(false); }}>创建私密保险库</button><button type="button" onClick={() => { setShowConnection(true); setShowRecovery(false); }}>连接已有保险库</button></div>
    {showConnection && <SyncConnectionForm onImported={async (vault) => { await saveVault(vault); setShowConnection(false); }} onCancel={() => setShowConnection(false)} />}
    {showRecovery && <RecoveryDialog onClose={() => setShowRecovery(false)} onContinue={saveVault} createVault={createVault} />}
    </>}
  </section>;
}

function SyncStatusRow({ status, onSyncNow }: { status: SyncStatus; onSyncNow?: () => void }) {
  const copy = status === "syncing" ? "正在同步…" : status === "synced" ? "已同步" : status === "error" ? "同步失败，仍已保存在本机。可点击重试" : "等待同步";
  return <div className="sync-status-row"><p role="status" aria-live="polite">{copy}</p><button type="button" onClick={onSyncNow} disabled={status === "syncing"}>立即同步</button></div>;
}

function SyncSharePanel({ vault }: { vault: RecoveryVault }) {
  const syncKey = serializeRecoveryPayload(vault);
  const [showQr, setShowQr] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const copySyncKey = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(syncKey);
      setCopyStatus("连接密钥已复制");
    } catch {
      setCopyStatus("复制失败，请选择上方文本手动复制");
    }
  };

  return <section className="sync-share-panel" aria-label="连接其他设备">
    <div className="sync-share-heading"><h3>连接其他设备</h3><span>同一个保险库</span></div>
    <p>把下面的连接密钥粘贴到另一台设备即可。二维码只是可选的传递方式，不是同步本身。</p>
    <label htmlFor="sync-key">连接密钥</label>
    <textarea id="sync-key" readOnly spellCheck={false} value={syncKey} onFocus={(event) => event.currentTarget.select()} />
    <div className="sync-share-actions"><button type="button" onClick={() => void copySyncKey()}>复制连接密钥</button><button type="button" onClick={() => setShowQr((visible) => !visible)}>{showQr ? "隐藏二维码" : "显示二维码"}</button></div>
    <p className="sync-copy-status" role="status" aria-live="polite">{copyStatus}</p>
    {showQr && <PairingQr vault={vault} />}
  </section>;
}

function PairingQr({ vault }: { vault: RecoveryVault }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) void QRCode.toCanvas(canvas, serializeRecoveryPayload(vault), { errorCorrectionLevel: "M", margin: 1, width: 180 });
  }, [vault]);

  return <section className="pairing-panel" aria-label="设备配对二维码">
    <h3>二维码传递</h3>
    <p>扫描后把得到的连接密钥粘贴到新设备；不会写入本页 URL。</p>
    <canvas ref={canvasRef} width="180" height="180" aria-label="用于设备配对的恢复载荷二维码" />
  </section>;
}

function SyncConnectionForm({ onImported, onCancel }: { onImported: (vault: RecoveryVault) => Promise<void>; onCancel: () => void }) {
  const [payload, setPayload] = useState("");
  const [status, setStatus] = useState("");
  const connect = async () => {
    const vault = await parseRecoveryPayload(payload.trim());
    if (!vault) {
      setStatus("连接密钥无效，未保存任何本地凭证");
      return;
    }
    try {
      await onImported(vault);
      setPayload("");
      setStatus("");
    } catch {
      setStatus("无法保存本地凭证，请检查浏览器存储设置");
    }
  };

  return <section className="sync-connection-form" aria-label="连接已有保险库">
    <h3>连接已有保险库</h3>
    <p>粘贴另一台设备复制的连接密钥。它包含恢复凭证，不是云端密文；持有它的人可以读取和修改这个保险库。</p>
    <label htmlFor="sync-key-payload">连接密钥</label>
    <textarea id="sync-key-payload" value={payload} spellCheck={false} placeholder="粘贴以 AnimeRank 开头的连接密钥" onInput={(event) => setPayload(event.currentTarget.value)} />
    <div className="sync-connection-actions"><button type="button" onClick={() => void connect()}>连接保险库</button><button type="button" onClick={onCancel}>取消</button></div>
    <p role="status">{status}</p>
  </section>;
}
