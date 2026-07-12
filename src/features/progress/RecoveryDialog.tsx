"use client";

import { useEffect, useRef, useState } from "react";

import { createRecoveryVault, type RecoveryVault } from "../../sync/crypto.ts";

interface RecoveryDialogProps {
  onClose: () => void;
  onContinue: (vault: RecoveryVault) => Promise<void>;
  createVault?: () => Promise<RecoveryVault>;
}

export function RecoveryDialog({ onClose, onContinue, createVault = createRecoveryVault }: RecoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [vault, setVault] = useState<RecoveryVault | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  useEffect(() => {
    let active = true;
    void createVault().then(
      (nextVault) => { if (active) setVault(nextVault); },
      () => { if (active) setCopyStatus("无法生成恢复短语，请关闭后重试"); },
    );
    return () => { active = false; };
  }, [createVault]);

  const close = () => dialogRef.current?.close();
  const copyPhrase = async () => {
    if (!vault) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(vault.phrase);
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败，请手动抄写");
    }
  };
  const downloadPhrase = () => {
    if (!vault) return;
    const blob = new Blob([`AI Anim Rank 恢复短语\n\n${vault.phrase}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-anim-rank-recovery.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const continueWithVault = async () => {
    if (!vault) return;
    setIsSaving(true);
    try {
      await onContinue(vault);
      close();
    } catch {
      setCopyStatus("无法保存本地凭证，请检查浏览器存储后重试");
    } finally {
      setIsSaving(false);
    }
  };

  return <dialog ref={dialogRef} aria-labelledby="recovery-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }} onClose={onClose}>
    <div className="dialog-heading"><h2 id="recovery-dialog-title">保存恢复短语</h2><button type="button" aria-label="关闭恢复短语" onClick={close}>×</button></div>
    <p className="recovery-warning">恢复短语是唯一凭证</p>
    <p className="recovery-copy">请在离线且安全的地方保存。短语不会出现在链接、日志或网络请求中。</p>
    {vault ? <><output className="recovery-phrase" data-recovery-phrase>{vault.phrase}</output><div className="recovery-actions"><button type="button" onClick={() => void copyPhrase()}>复制短语</button><button type="button" onClick={downloadPhrase}>下载恢复文本</button></div></> : <p className="recovery-copy">正在生成恢复短语…</p>}
    <p className="copy-status" role="status" aria-live="polite">{copyStatus}</p>
    <label className="recovery-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已保存恢复短语</label>
    <button type="button" disabled={!vault || !acknowledged || isSaving} onClick={() => void continueWithVault()}>我已安全保存，继续</button>
  </dialog>;
}
