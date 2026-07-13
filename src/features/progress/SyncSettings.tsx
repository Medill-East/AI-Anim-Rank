"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

import { type RecoveryVault } from "../../sync/crypto.ts";
import { parseRecoveryPayload, serializeRecoveryPayload, SyncVaultStore } from "../../storage/sync-vault.ts";
import { RecoveryDialog } from "./RecoveryDialog.tsx";

interface SyncSettingsProps {
  vaultStore?: SyncVaultStore;
  createVault?: () => Promise<RecoveryVault>;
  heading?: boolean;
}

export function SyncSettings({ vaultStore: providedVaultStore, createVault, heading = true }: SyncSettingsProps) {
  const vaultStore = useMemo(() => providedVaultStore ?? new SyncVaultStore(), [providedVaultStore]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [localVault, setLocalVault] = useState<RecoveryVault | null>(null);
  const [hydrationState, setHydrationState] = useState<"loading" | "ready">("loading");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    let active = true;
    void vaultStore.load().then((vault) => {
      if (!active) return;
      setLocalVault(vault);
      setHydrationState("ready");
    });
    return () => { active = false; };
  }, [vaultStore]);
  const saveVault = async (vault: RecoveryVault) => {
    vaultStore.save(vault);
    setLocalVault(vault);
  };
  const disconnect = () => {
    try {
      vaultStore.clear();
      setLocalVault(null);
      setConfirmDisconnect(false);
    } catch {
      setStorageError("无法移除本地凭证，请检查浏览器存储设置");
    }
  };

  return <section className="sync-settings" aria-label="私密同步设置">
    {heading && <h2>私密同步</h2>}
    {hydrationState === "loading" ? <p role="status">正在检查本地保险库…</p> : localVault ? <>
      <p>本地保险库已启用。恢复短语仅保存在此浏览器的本地存储中；持有恢复短语的人可以读取和更改这些数据。</p>
      <PairingExport vault={localVault} />
      {confirmDisconnect ? <div className="disconnect-warning" role="alert"><p>断开只会移除这台设备上的本地访问，不会删除远端密文。</p><button type="button" onClick={disconnect}>确认断开本地访问</button><button type="button" onClick={() => setConfirmDisconnect(false)}>取消</button></div> : <button type="button" onClick={() => setConfirmDisconnect(true)}>断开本地保险库</button>}
      {storageError && <p role="status">{storageError}</p>}
    </> : <>
    <p>无需账户；Cloudflare 只存储密文，无法读取你的进度。恢复短语丢失且本地数据被清除时无法恢复，持有者可以读取和更改数据。</p>
    <button type="button" onClick={() => setShowRecovery(true)}>启用私密同步</button>
    <PairingImport onImported={saveVault} />
    {showRecovery && <RecoveryDialog onClose={() => setShowRecovery(false)} onContinue={saveVault} createVault={createVault} />}
    </>}
  </section>;
}

function PairingExport({ vault }: { vault: RecoveryVault }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) void QRCode.toCanvas(canvas, serializeRecoveryPayload(vault), { errorCorrectionLevel: "M", margin: 1, width: 180 });
  }, [vault]);

  return <section className="pairing-panel" aria-label="设备配对二维码">
    <h3>设备配对二维码</h3>
    <p>在新设备扫描此二维码后导入恢复载荷；不会写入本页 URL。</p>
    <canvas ref={canvasRef} width="180" height="180" aria-label="用于设备配对的恢复载荷二维码" />
  </section>;
}

function PairingImport({ onImported }: { onImported: (vault: RecoveryVault) => Promise<void> }) {
  const [showImport, setShowImport] = useState(false);
  const [payload, setPayload] = useState("");
  const [status, setStatus] = useState("");
  const importPayload = async () => {
    const vault = await parseRecoveryPayload(payload.trim());
    if (!vault) {
      setStatus("配对二维码无效，未保存任何本地凭证");
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

  return <div className="pairing-import">
    <button type="button" onClick={() => setShowImport((visible) => !visible)}>导入配对二维码</button>
    {showImport && <div><label htmlFor="pairing-payload">粘贴扫描二维码得到的恢复载荷</label><textarea id="pairing-payload" value={payload} onInput={(event) => setPayload(event.currentTarget.value)} /><button type="button" onClick={() => void importPayload()}>确认导入</button><p role="status">{status}</p></div>}
  </div>;
}
