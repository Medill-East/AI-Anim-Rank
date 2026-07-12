"use client";

import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { useEffect, useRef, useState } from "react";

interface RecoveryDialogProps {
  onClose: () => void;
  onContinue: () => void;
}

export function RecoveryDialog({ onClose, onContinue }: RecoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [phrase] = useState(() => generateMnemonic(wordlist, 128));
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const close = () => dialogRef.current?.close();
  const copyPhrase = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(phrase);
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败，请手动抄写");
    }
  };
  const downloadPhrase = () => {
    const blob = new Blob([`AI Anim Rank 恢复短语\n\n${phrase}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-anim-rank-recovery.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <dialog ref={dialogRef} aria-labelledby="recovery-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }} onClose={onClose}>
    <div className="dialog-heading"><h2 id="recovery-dialog-title">保存恢复短语</h2><button type="button" aria-label="关闭恢复短语" onClick={close}>×</button></div>
    <p className="recovery-warning">恢复短语是唯一凭证</p>
    <p className="recovery-copy">请在离线且安全的地方保存。短语不会出现在链接、日志或网络请求中。</p>
    <output className="recovery-phrase" data-recovery-phrase>{phrase}</output>
    <div className="recovery-actions"><button type="button" onClick={() => void copyPhrase()}>复制短语</button><button type="button" onClick={downloadPhrase}>下载恢复文本</button></div>
    <p className="copy-status" role="status" aria-live="polite">{copyStatus}</p>
    <label className="recovery-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已保存恢复短语</label>
    <button type="button" disabled={!acknowledged} onClick={() => { onContinue(); close(); }}>我已安全保存，继续</button>
  </dialog>;
}
