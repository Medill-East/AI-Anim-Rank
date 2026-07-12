"use client";

import { useEffect, useState } from "react";

interface AppStatusProps {
  syncBaseUrl: string;
}

export function AppStatus({ syncBaseUrl }: AppStatusProps) {
  const [online, setOnline] = useState(true);
  const [offlineShell, setOfflineShell] = useState<"checking" | "ready">("checking");
  const remoteSyncConfigured = syncBaseUrl.trim() !== "";

  useEffect(() => {
    const updateNetworkStatus = () => setOnline(navigator.onLine);
    updateNetworkStatus();
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").then(
        () => setOfflineShell("ready"),
        () => {},
      );
    }

    return () => {
      window.removeEventListener("online", updateNetworkStatus);
      window.removeEventListener("offline", updateNetworkStatus);
    };
  }, []);

  const offlineMessage = offlineShell === "ready"
    ? "排行榜与公开资料可离线查看；恢复短语和本机进度不会写入离线缓存。"
    : "离线排行榜尚未就绪。";
  const syncMessage = remoteSyncConfigured
    ? "远程同步端点已配置，自动同步尚未启用。"
    : "未配置远程同步端点；个人进度仅本机保存。";

  return <p className="app-status" role="status" aria-live="polite">
    {online ? "网络可用。" : "当前离线。"}{offlineMessage}{syncMessage}
  </p>;
}
