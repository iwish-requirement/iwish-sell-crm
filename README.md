# IWISH Sell CRM

IWISH Sell CRM 是面向销售团队的线索、客户公海、成交、合同回款、续费提醒和组织权限管理系统。

## 当前版本

- 生产入口：`https://sell.iwishweb.com`
- 运行平台：Next.js + OpenNext + Cloudflare Workers
- 数据平台：Supabase Auth、Postgres、RLS 和 RPC
- Pages 旧部署已停止作为业务入口，生产验证以 Worker 域名为准

## 主要功能

- 线索创建、跟进阶段、客户属性、分配、转移、关闭和回收公海
- 公海线索认领、批量退回和退回原因记录
- 有效线索配额校验，数据库侧保证并发安全
- 多团队成员关系、成员审批、转移和移除
- 合同、回款、续费中心和企微提醒
- 报表、CSV 导入导出和审计日志

## 本地开发

```powershell
npm install
npm run dev
```

需要在 `.env.local` 中配置 Supabase URL、匿名 Key，以及服务端使用的 Supabase Service Role Key 和企微任务 Token。不要把任何密钥提交到 Git。

## 检查与构建

```powershell
npx tsc --noEmit --pretty false
npm run build
npx playwright test --list
npm run test:e2e
```

E2E 测试使用 `PW_SALES_EMAIL`、`PW_SALES_PASSWORD` 等测试环境变量。没有测试账号时，相关用例会跳过。

## 数据库迁移

迁移文件位于 `supabase/migrations`。涉及权限、配额、组织关系和敏感数据的改动必须通过迁移提交，并在目标 Supabase 项目验证。当前审计修复包括：

- `20260915023134_harden_views_and_internal_rpcs.sql`：收紧付款视图、内部 RPC、配额并发检查和已删除线索保护
- `20260915030000_team_membership_write_paths.sql`：补齐多团队转移、移除、审批和恢复写入链路
- `20260915033000_lead_create_pipeline_fields.sql`：保存新建线索的客户属性和跟进阶段

## 部署

```powershell
npm run cf:build
npm run cf:deploy
```

部署后至少验证 `/api/version`、登录、线索创建、公海操作和续费提醒任务接口。定时任务接口使用 `x-job-token`，不会通过浏览器登录态鉴权。

## 项目文档

- `OPS_GUIDE.md`：运维和发布说明
- `CLOUDFLARE_DEPLOY.md`：Cloudflare Workers 部署说明
- `CHANGELOG.md`：按版本记录每次功能和修复更新
