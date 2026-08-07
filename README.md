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

应用构建时通过 `VITE_SYNC_BASE_URL` 指向同步 Worker。保险库启用或导入后，客户端会先拉取并合并远端密文；之后每次本地标记都会异步上传，页面也提供“立即同步”入口。没有配置端点时，二维码只迁移恢复凭证，个人进度仍仅保存在本机。

当前同步端点为 `https://ai-anim-rank-sync.play-with-experiences.workers.dev`。`npm run site:deploy` 已包含该地址，会在主站发布时一起启用跨设备同步。

恢复短语等同于数据访问权：不要将其提交到仓库、放进环境变量、截图或通过不受信任的渠道发送。

## 公开部署

公开地址为 [ai-anim-rank.play-with-experiences.workers.dev](https://ai-anim-rank.play-with-experiences.workers.dev)。它运行在免费的 Cloudflare Workers 托管上，不需要传统服务器或用户登录。

发布经过数据守卫的版本：

```bash
npm run site:deploy
```

该命令会先验证 300 条正式快照，再构建并部署现有 Vinext Worker 与客户端资源。个人进度默认仍只保存在浏览器；可选同步 Worker 与公开站点相互独立。
