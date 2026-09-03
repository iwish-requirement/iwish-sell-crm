# Cloudflare 部署

本项目使用 Cloudflare Workers 的 OpenNext 适配器运行 Next.js 16。请不要再使用已弃用的 `npx @cloudflare/next-on-pages@1` 构建命令。

## Git 集成

- 部署目标：Cloudflare Workers（不是 Pages 的 Next.js 旧适配器）
- 构建命令：`pnpm run cf:build`
- 部署命令：`pnpm run deploy`（或在 Workers Git 集成中由 Cloudflare 自动部署）
- Node.js：20 或更高版本
- 包管理器：pnpm（按仓库 `pnpm-lock.yaml` 安装）

项目根目录的 `wrangler.jsonc` 已声明 Worker 入口、静态资源目录和 `nodejs_compat`。Supabase 的 URL、匿名 key、服务端 key 以及其他运行时密钥请在 Cloudflare Worker 的 Variables and Secrets 中配置，不要提交到 Git。

## 成交中心灰度

分配中心目前默认关闭导航，仅允许 `lin88@iwishweb.com` 在直接访问 `/allocations` 时进行灰度测试。灰度开关位于 `lib/feature-flags.ts`：

- `NEXT_PUBLIC_ALLOCATION_CENTER_NAV_ENABLED=true`：重新显示有权限账号的导航；
- `NEXT_PUBLIC_ALLOCATION_CENTER_BETA_EMAILS`：逗号分隔的灰度账号邮箱；
- `NEXT_PUBLIC_ALLOCATION_CENTER_BETA_USER_IDS`：逗号分隔的 Supabase 用户 ID；
- `NEXT_PUBLIC_ALLOCATION_CENTER_BETA_NAMES`：没有邮箱可用时的显示名匹配。

这些变量参与前端构建，应配置在 Workers Git 集成的构建环境中，而不是只配置为 Worker 运行时 Secret。数据库权限仍由 `allocations.read` / `allocations.manage` 控制。

## 将生产域名切到 Worker

`wrangler.jsonc` 已声明 `sell.iwishweb.com` 为 Worker Custom Domain。切换前需要在 Pages 项目中移除同名自定义域名，并确保 `iwishweb.com` Zone 对当前 Cloudflare 账号可见；随后在 Linux/WSL 或 Workers Git 集成中执行 `npm run deploy`。Windows 本机的 OpenNext 符号链接构建可能失败。

## 本地验证

```bash
pnpm install
pnpm run build
pnpm run cf:build
pnpm run preview
```

`cf:build` 在 Windows 上可能因符号链接权限失败；Cloudflare 的 Linux 构建环境不受此限制。Windows 本地可在 WSL 中运行 OpenNext 预览。
