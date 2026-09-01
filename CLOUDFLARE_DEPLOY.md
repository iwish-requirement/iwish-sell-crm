# Cloudflare 部署

本项目使用 Cloudflare Workers 的 OpenNext 适配器运行 Next.js 16。请不要再使用已弃用的 `npx @cloudflare/next-on-pages@1` 构建命令。

## Git 集成

- 部署目标：Cloudflare Workers（不是 Pages 的 Next.js 旧适配器）
- 构建命令：`pnpm run cf:build`
- 部署命令：`pnpm run deploy`（或在 Workers Git 集成中由 Cloudflare 自动部署）
- Node.js：20 或更高版本
- 包管理器：pnpm（按仓库 `pnpm-lock.yaml` 安装）

项目根目录的 `wrangler.jsonc` 已声明 Worker 入口、静态资源目录和 `nodejs_compat`。Supabase 的 URL、匿名 key、服务端 key 以及其他运行时密钥请在 Cloudflare Worker 的 Variables and Secrets 中配置，不要提交到 Git。

## 本地验证

```bash
pnpm install
pnpm run build
pnpm run cf:build
pnpm run preview
```

`cf:build` 在 Windows 上可能因符号链接权限失败；Cloudflare 的 Linux 构建环境不受此限制。Windows 本地可在 WSL 中运行 OpenNext 预览。
