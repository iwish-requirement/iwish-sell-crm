# Cloudflare 部署

本项目使用 Cloudflare Workers 的 OpenNext 适配器运行 Next.js 16。请不要再使用已弃用的 `npx @cloudflare/next-on-pages@1` 构建命令。

## Git 集成

- 部署目标：Cloudflare Workers（不是 Pages 的 Next.js 旧适配器）
- 构建命令：`pnpm run cf:build`
- 部署命令：`pnpm run deploy`（或在 Workers Git 集成中由 Cloudflare 自动部署）
- Node.js：20 或更高版本
- 包管理器：pnpm（按仓库 `pnpm-lock.yaml` 安装）

当前 Cloudflare 账号里仍保留同名 Pages 项目并连接 GitHub，供历史预览/回滚使用；生产域名 `sell.iwishweb.com` 由上面的 Worker Custom Domain 接管。不要把 `iwish-sell-crm.pages.dev` 当作生产地址，也不要在 Worker 验证完成前直接断开 Pages 的 GitHub 连接，否则会失去现有预览和回滚入口。

发布后请用 `https://sell.iwishweb.com/api/version` 验证版本接口返回 JSON。该接口已在中间件中加入公开路径，避免未登录请求被重定向到登录页，旧 Tab 才能正确提示刷新。

项目根目录的 `wrangler.jsonc` 已声明 Worker 入口、静态资源目录和 `nodejs_compat`。Supabase 的 URL、匿名 key、服务端 key 以及其他运行时密钥请在 Cloudflare Worker 的 Variables and Secrets 中配置，不要提交到 Git。

## 成交中心灰度

分配中心已于 2026-09-17 正式上线：导航默认对持有 `allocations.read` 权限的账号显示。开关位于 `lib/feature-flags.ts`：

- `NEXT_PUBLIC_ALLOCATION_CENTER_NAV_ENABLED=false`：需要临时隐藏入口时在构建环境设置（不设置或设为其他值均为显示）。

## 将生产域名切到 Worker

`wrangler.jsonc` 已声明 `sell.iwishweb.com` 为 Worker Custom Domain。正式切换前需要先在 Pages 项目中移除同名自定义域名、清理冲突的 DNS 记录，并确保 `iwishweb.com` Zone 对当前 Cloudflare 账号可见；完成后通过 Workers Git 集成部署。Windows 本机的 OpenNext 符号链接构建可能失败。

Worker 直接使用 OpenNext 生成的 fetch handler。自动回公海和续费企微通知由 Supabase `pg_cron` 调度并调用对应 RPC/HTTP 路由，Cloudflare Worker 不配置重复 Cron，也不需要为定时任务配置 `SUPABASE_SERVICE_ROLE_KEY`。

## 本地验证

```bash
pnpm install
pnpm run build
pnpm run cf:build
pnpm run preview
```

`cf:build` 在 Windows 上可能因符号链接权限失败；Cloudflare 的 Linux 构建环境不受此限制。Windows 本地可在 WSL 中运行 OpenNext 预览。
