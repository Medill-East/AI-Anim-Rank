# AnimeRank

可安装的动画作品排行榜。公开榜单与个人本地进度分离；恢复短语和进度数据不进入 PWA 的离线缓存。

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

它仅接受 `sample: false` 且**恰好 300 条**作品的已验证快照。

## 私密同步 Worker（可选）

1. 用 `npx wrangler d1 create ai-anim-rank-sync` 创建 D1 数据库，并将返回的 ID 写入 `worker/wrangler.toml` 的 `database_id`（默认占位值禁止意外部署）。
2. 执行 `npm run worker:migrate` 应用 `worker/migrations/`。
3. 用 `npx wrangler secret put ALLOWED_ORIGIN` 设置唯一的应用 origin；不要使用 `*`。
4. 执行 `npm run worker:deploy` 部署 Worker。

若要让应用展示“端点已配置”的状态，可在应用构建环境设置 `VITE_SYNC_BASE_URL` 为 Worker 基础地址。这个变量目前只表达配置存在；没有已配置端点时界面会明确说明个人进度仅保存在本机，也不会声称已经远程同步。

恢复短语等同于数据访问权：不要将其提交到仓库、放进环境变量、截图或通过不受信任的渠道发送。

## 公开部署

公开地址为 [ai-anim-rank.play-with-experiences.workers.dev](https://ai-anim-rank.play-with-experiences.workers.dev)。它运行在免费的 Cloudflare Workers 托管上，不需要传统服务器或用户登录。

发布经过数据守卫的版本：

```bash
npm run site:deploy
```

该命令会先验证 300 条正式快照，再构建并部署现有 Vinext Worker 与客户端资源。个人进度默认仍只保存在浏览器；可选同步 Worker 与公开站点相互独立。
