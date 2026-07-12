"use client";

import { useMemo, useState } from "react";

import { type RecoveryVault } from "../../sync/crypto.ts";
import { SyncVaultStore } from "../../storage/sync-vault.ts";
import { RecoveryDialog } from "./RecoveryDialog.tsx";

interface SyncSettingsProps {
  vaultStore?: SyncVaultStore;
  createVault?: () => Promise<RecoveryVault>;
}

export function SyncSettings({ vaultStore: providedVaultStore, createVault }: SyncSettingsProps) {
  const vaultStore = useMemo(() => providedVaultStore ?? new SyncVaultStore(), [providedVaultStore]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [hasLocalVault, setHasLocalVault] = useState(() => vaultStore.load() !== null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [storageError, setStorageError] = useState("");

  const saveVault = async (vault: RecoveryVault) => {
    vaultStore.save(vault);
    setHasLocalVault(true);
  };
  const disconnect = () => {
    try {
      vaultStore.clear();
      setHasLocalVault(false);
      setConfirmDisconnect(false);
    } catch {
      setStorageError("无法移除本地凭证，请检查浏览器存储设置");
    }
  };

  if (hasLocalVault) {
    return <section className="sync-settings" aria-label="私密同步设置">
      <h2>私密同步</h2>
      <p>本地保险库已启用。恢复短语仅保存在此浏览器的本地存储中；持有恢复短语的人可以读取和更改这些数据。</p>
      {confirmDisconnect ? <div className="disconnect-warning" role="alert"><p>断开只会移除这台设备上的本地访问，不会删除远端密文。</p><button type="button" onClick={disconnect}>确认断开本地访问</button><button type="button" onClick={() => setConfirmDisconnect(false)}>取消</button></div> : <button type="button" onClick={() => setConfirmDisconnect(true)}>断开本地保险库</button>}
      {storageError && <p role="status">{storageError}</p>}
    </section>;
  }

  return <section className="sync-settings" aria-label="私密同步设置">
    <h2>私密同步</h2>
    <p>无需账户。Cloudflare 只存储密文，无法读取你的进度。</p>
    <p>如果所有浏览器的本地数据都被清除且恢复短语丢失，数据将不可逆地无法恢复。持有恢复短语的人可以读取和更改数据。</p>
    <button type="button" onClick={() => setShowRecovery(true)}>启用私密同步</button>
    {showRecovery && <RecoveryDialog onClose={() => setShowRecovery(false)} onContinue={saveVault} createVault={createVault} />}
  </section>;
}
