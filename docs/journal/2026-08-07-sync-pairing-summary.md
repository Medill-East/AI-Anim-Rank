# AnimeRank 决策摘要：跨设备同步

日期：2026-08-07（Asia/Shanghai）

## 当前状态

- 排行榜主站已部署在 `https://ai-anim-rank.play-with-experiences.workers.dev`。
- 原有二维码只迁移 `phrase + salt` 到另一台设备；客户端没有实例化 `SyncClient`，也没有调用同步 Worker，因此实际只能依赖 IndexedDB 或 JSON 备份。
- `ai-anim-rank-sync` Worker 与 APAC D1 已创建并部署，主站 origin 的 CORS 预检已返回 204。

## 决策与理由

- 保留二维码作为“迁移恢复凭证”，不把进度数据放进二维码。
- 保险库接入后：首次自动拉取并合并远端密文；本地标记保存后异步上传；提供“立即同步”和明确的同步状态。
- 无同步端点时，界面必须明确说明二维码只能迁移凭证，不能同步标记，避免造成错误安全感。
- 同步数据继续端到端加密，Cloudflare 只接收密文；冲突沿用条目级最后修改时间合并。

## 本次改动与验证

- 增加 HTTP `SyncTransport`，支持 Worker 的 GET/PUT、ETag 版本和 409 冲突。
- `RankingWorkspace` 接入保险库和同步队列；同步结果回写本地进度库。
- `SyncSettings` 增加同步状态、立即同步按钮和准确的二维码说明。
- 已补齐 D1、迁移和同步 Worker，并使用固定主站 origin 配置 CORS。
- 已通过：TypeScript、同步核心测试、32 个同步/排行榜 DOM 测试；重新发布前再次通过 97 个核心测试、27 个 DOM 测试、lint 与 diff 检查。
- 发布冒烟检查发现 Vinext/Vite 不会用 `process.env.VITE_SYNC_BASE_URL` 注入浏览器端配置；已改为 `import.meta.env.VITE_SYNC_BASE_URL`，并补充 `vite-env.d.ts` 类型声明，待重新发布确认线上状态文案。

## 事故教训

- “二维码导入成功”只代表本地恢复凭证有效，不代表远端同步已经建立；必须同时验证客户端调用、端点配置和 Worker/D1 部署状态。
- `VITE_SYNC_BASE_URL` 过去只用于显示配置状态，文档措辞曾暗示同步能力，需让 UI 状态和真实链路一致。

## 未决问题与下一步

- 重新发布主站，确认线上页面显示同步已启用，并在两台浏览器使用同一二维码后能看到彼此的标记。
- 观察首次同步失败时的提示，以及冲突合并后的结果。

完整会话证据（当前运行时可取得的已清洗部分）：[2026-08-07-sync-pairing-transcript-partial.md](./2026-08-07-sync-pairing-transcript-partial.md)
