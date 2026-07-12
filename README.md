# AI Anim Rank

可安装的 AI 动画作品排行榜。公开榜单与个人本地进度分离；恢复短语和进度数据不进入 PWA 的离线缓存。

## 本地开发与检查

```bash
npm install
npm run dev
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run validate:data
```

`npm run build` 是普通开发构建。发布构建必须显式开启数据守卫：

```bash
VITE_RELEASE_BUILD=true npm run build
```

它仅接受 `sample: false` 且**恰好 300 条**作品的已验证快照。当前仓库的 `src/data/ranking.json` 仍是零条 sample fixture，因此上述发布命令应失败；请不要将其当作真实 Top 300 发布。

## 私密同步 Worker（可选）

1. 用 `npx wrangler d1 create ai-anim-rank-sync` 创建 D1 数据库，并将返回的 ID 写入 `worker/wrangler.toml` 的 `database_id`（默认占位值禁止意外部署）。
2. 执行 `npm run worker:migrate` 应用 `worker/migrations/`。
3. 用 `npx wrangler secret put ALLOWED_ORIGIN` 设置唯一的 Sites 应用 origin；不要使用 `*`。
4. 执行 `npm run worker:deploy` 部署 Worker。

若要让应用展示“端点已配置”的状态，可在 Sites 构建环境设置 `VITE_SYNC_BASE_URL` 为 Worker 基础地址。这个变量目前只表达配置存在；没有已配置端点时界面会明确说明个人进度仅保存在本机，也不会声称已经远程同步。

恢复短语等同于数据访问权：不要将其提交到仓库、放进环境变量、截图或通过不受信任的渠道发送。

## Sites 托管

将仓库连接到 Cloudflare Sites，使用 `npm run build` 作为构建命令，并按 Sites/Vinext 集成读取生成的 `dist/` Worker 与客户端资源。先在预览环境确认 manifest、两个 PNG 应用图标和离线页面可访问；真实发布前必须通过上面的 300 条快照发布守卫。这里不包含生产 URL 或部署操作。
