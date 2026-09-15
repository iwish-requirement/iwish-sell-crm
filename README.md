# IWISH 销售线索 CRM

IWISH 销售线索 CRM 是面向销售团队的线索、公海、客户跟进、成交、续费、权限和审计系统。项目把业务规则放在 Supabase 的 RLS、视图和 RPC 中强制执行，前端负责工作台和操作体验，生产环境运行在 Cloudflare Workers。

生产地址：[https://sell.iwishweb.com](https://sell.iwishweb.com)

## 当前版本

- 应用版本：`2026-09-15-01`
- 当前主分支：`main`
- 生产运行时：Cloudflare Workers + Next.js 16 + OpenNext
- 数据库：Supabase PostgreSQL
- 当前生产提交：见 [GitHub main 分支](https://github.com/iwish-requirement/iwish-sell-crm/tree/main)
- 完整逐提交历史：见 [CHANGELOG.md](CHANGELOG.md)
- AI 结构化变更记录：见 [CHANGELOG_AI.md](CHANGELOG_AI.md)

## 业务能力

### 线索与销售流程

- 我的线索看板、列表、详情、搜索、筛选和批量处理。
- 线索创建、编辑、分配、转移、跟进记录、下一次联系时间和关闭/丢单。
- 跟进阶段从线索阶段统一到销售生命周期，并将阶段变化和行动记录关联。
- 公司、联系人、电话/微信、官网、产品类型、来源、等级等结构化字段。
- 导入模板、导入预览、严格校验、分批写入和导出任务。

### 公海池

- 公海认领、认领权限、认领原因和防止重复认领。
- 线索退回公海必须填写原因，并将原因、时间和操作人写回线索及审计记录。
- 支持批量退回公海。
- 长时间未跟进的线索按业务规则自动回收。
- 公海导入支持确定性表头映射、AI 映射、标准化预览、置信度和风险提示。
- 公海导出通过权限校验和导出任务记录执行。

### 组织、权限与审计

- 注册审批、待审核、禁用、拒绝和账号全生命周期管理。
- 团队、角色、动作权限、数据范围和字段级权限。
- 一个成员可以同时属于多个团队；`profiles.team_id` 作为主团队保留兼容，额外团队关系存储在 `profile_team_memberships`。
- 关键写操作通过 `rpc_*` 函数执行，敏感操作写入 `audit_logs`。
- 续费合同、付款、企微通知、分配中心和技术维护权限。

### 数据分析与运营

- 仪表盘、线索漏斗、产品类型分布、成交和续费分析。
- 时间范围、团队、来源、产品类型等筛选。
- 报表导出和审计页面。
- 分配中心目前保留灰度开关和权限控制。

## 重要业务规则

- 单个销售的有效线索配额默认是 `60`。新建、导入、认领、分配、转移以及将线索重新变为有效状态，统一使用同一套后端校验；公海线索不计入配额，标记无效、成交、关闭、删除的线索不计入配额；具备覆盖权限的管理员可以按权限处理例外。
- 退回公海必须提供非空原因，数据库会拒绝缺少原因的请求。
- 批量退回公海使用 `public.rpc_leads_return_to_pool_batch(uuid[], text)`，逐条返回失败 ID，避免部分失败时无法定位。
- 线索读取统一使用 `public.leads_secure_view`，不要直接从 `public.leads` 读取业务数据。
- 团队数据范围同时识别主团队和 `profile_team_memberships`，确保多团队成员可以在正确范围内工作。

## 技术架构

```text
Browser
  │
  ▼
Next.js 16 / React 19
  │  Cloudflare OpenNext Worker
  ▼
Supabase Auth + PostgreSQL
  │  RLS / secure views / security-definer RPC / audit logs
  ▼
Supabase Edge Functions（AI 导入代理、后台任务）
```

主要目录：

```text
app/                  Next.js 页面、认证页面和 API 路由
components/           线索、公海、设置、报表等业务组件
lib/                  Supabase 客户端、RPC 封装、权限和业务工具
supabase/migrations/  数据表、RLS、视图、RPC 和索引迁移
supabase/functions/   Supabase Edge Functions
tests/                Playwright e2e 用例
docs/                 产品和工程文档
```

## 本地开发

要求 Node.js 20 或更高版本，推荐使用 pnpm。Windows 如果 `corepack enable` 因权限失败，可以使用：

```bash
npx pnpm@10.12.4 install
```

安装依赖并启动开发环境：

```bash
pnpm install
pnpm run dev
```

常用命令：

```bash
pnpm run build          # Next.js 构建
pnpm run cf:build       # OpenNext Cloudflare 构建
pnpm run cf:preview     # Worker 本地预览
pnpm run lint           # ESLint
pnpm run test:e2e       # Playwright e2e
pnpm run test:e2e:headed
```

Windows 本机执行 `cf:build` 可能因 OpenNext 需要创建符号链接而触发 `EPERM`；请在 WSL 或 Linux CI 中执行 Cloudflare 构建。普通 Next.js 构建不代表 OpenNext 构建一定成功。

## 环境变量

不要把密钥提交到 Git。开发环境使用 `.env.local`，生产环境在 Cloudflare Worker Variables and Secrets 与 Supabase Edge Function Secrets 中配置。

常用配置包括：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- 服务端 Supabase Key
- `APP_PUBLIC_URL`
- `NEXT_PUBLIC_SYSTEM_KEY`
- 企微网关地址和系统标识
- AI 导入代理所需的 `SILICONFLOW_API_KEY`、`SILICONFLOW_MODEL` 等变量
- Playwright 测试账号：`PW_ADMIN_EMAIL`、`PW_ADMIN_PASSWORD`、`PW_SALES_EMAIL`、`PW_SALES_PASSWORD`、`PW_MANAGER_EMAIL`、`PW_MANAGER_PASSWORD`

## 数据库迁移

所有结构、RLS、视图、RPC、索引和种子数据改动都必须进入 `supabase/migrations/`。迁移按文件名时间戳顺序执行，提交代码前先在测试环境验证，再发布生产数据库。

本次线索、公海和多团队改造对应：

```text
20260914000113_lead_pool_return_and_batch.sql
20260914000114_profile_team_memberships.sql
```

生产环境已直接执行并登记从 `20260901000108` 到 `20260914000114` 的相关迁移。仓库仍缺少远端历史中的一批旧迁移文件，因此 `supabase db push` 可能先报远端历史与本地文件不一致；处理历史同步前，不要用 `--include-all` 或随意把远端旧版本标记为 reverted。

数据库安全边界：

- 线索读取使用 `leads_secure_view`。
- 创建、更新、分配、认领、转移、退回、关闭、导入、导出和权限变更使用 RPC。
- RLS 是最终安全边界，前端按钮隐藏不能代替数据库权限。
- 生产迁移后必须核验 RPC、视图、RLS 和审计日志。

## Cloudflare 发布

生产使用 Worker，不使用 Pages 的旧 Next.js 运行时：

```bash
pnpm run cf:build
pnpm run deploy
```

生产域名是 `sell.iwishweb.com`，由 `wrangler.jsonc` 中的 Worker Custom Domain 接管。发布后验证：

```bash
curl https://sell.iwishweb.com/api/version
```

Pages 不再作为业务入口或回滚入口使用；生产部署和验证只针对 Cloudflare Worker 的 `sell.iwishweb.com`。

完整发布说明见 [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md)，日常排查见 [OPS_GUIDE.md](OPS_GUIDE.md)。

## 测试与上线检查

上线前至少检查：

1. 登录、注册审批、禁用和密码重置。
2. 线索创建、分配、转移、跟进、阶段推进和关闭。
3. 公海认领、退回原因、批量退回、自动回收、导入和导出。
4. 配额 60、权限覆盖、团队范围和多团队成员可见性。
5. 合同、续费、企微通知、分析和审计日志。
6. `/api/version` 返回当前版本，Worker 生产域名可访问。

## 更新记录规范

项目的每一次提交都记录在 [CHANGELOG.md](CHANGELOG.md) 中，按日期、提交短 SHA 和提交说明排列。以后每次更新必须同时做到：

1. 提交信息说明变更目的和影响范围。
2. 涉及数据库的改动新增迁移文件，不直接修改已发布迁移。
3. 涉及部署、权限或回滚的改动同步更新 [OPS_GUIDE.md](OPS_GUIDE.md) 或 [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md)。
4. 面向业务的重大功能在本 README 的“业务能力”或“重要业务规则”中补充说明。
5. AI 辅助完成的结构性变更同步写入 [CHANGELOG_AI.md](CHANGELOG_AI.md)。

### 当前迭代重点

截至 `2026-09-14`，最近完成的更新包括：

- 线索生命周期与跟进阶段统一，阶段变化关联行动记录，保留旧阶段兼容。
- 新增线索配额、公海自动回收规则和公海认领独立权限。
- 公海退回原因持久化，支持批量退回公海。
- 支持同一成员加入多个团队，并让数据范围识别多团队关系。
- 增加应用版本接口和旧 Tab 刷新提示。
- 将生产域名从 Pages 运行时切换到 Cloudflare Workers/OpenNext，同时保留 Pages 历史入口。
- 公海导入持续完善 AI 映射、规则兜底、标准化预览、超时治理和 Supabase Edge Function 代理。
- 增加分配中心、产品类型、续费、合同、企微通知、报表和审计能力。

截至 `2026-09-15`，本轮审计修复包括：

- 收紧合同回款视图和内部批处理 RPC，匿名请求无法读取付款数据或触发自动回收。
- 配额检查增加事务级并发锁，创建线索时持久化客户属性和跟进阶段。
- 补齐成员多团队转移、移除、审批和恢复写入链路。
- 修复续费提醒路由、软删除线索修改、无效成员分配和前端 TypeScript 错误。

## 许可证

这是 IWISH 内部业务系统，未经授权不得复制、分发或对外部署。
