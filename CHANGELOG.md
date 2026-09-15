# 更新记录

本文件记录仓库 Git 历史中的每一次提交，按时间正序排列。新增功能、修复、迁移、部署和文档变更都必须在提交时留下可追溯记录；面向业务的重点说明同步维护在 [README.md](README.md)。

## 2026-09-15

- `20260915060000_global_public_pool_access.sql`：公海池改为所有已启用成员可见，移除本人/团队/组织数据范围；认领只校验认领权限、原负责人再次认领开关和 60 条硬上限。
- `f372d8a` fix: remove duplicate pool assignment update；生产版本提升到 `2026-09-15-02` 并部署 Cloudflare Worker。
- `20260915043000_unify_lead_quota_paths.sql`：统一有效客户配额口径，新增数据库级有效线索判定函数，覆盖新增/导入、认领公海、分配、转移和状态变更；公海认领现在会在原子更新前执行 60 条配额校验，并防止并发认领绕过上限。
- `20260915050000_atomic_pool_assignment_quota.sql`：修复公海分配的两步写入漏洞，分配给成员时直接原子切换为有效客户并执行配额校验，避免满额后留下“已分配但仍在公海”的中间状态。
- `877d79c` fix: harden crm security and integrity flows
- `f6f4d84` docs: record security and integrity fixes
- `d844deb` chore: bump production application version
- 完成安全审计修复：付款视图改为调用者权限范围，撤销匿名内部 RPC 执行权限，并补充函数 `search_path` 防护。
- 修复线索配额并发超限、创建字段丢失、已删除线索可修改和无效成员分配问题。
- 补齐多团队成员转移、移除、审批和恢复的数据写入链路。
- 续费提醒 API 加入公开路由白名单并继续使用任务 Token 鉴权。
- 修复 TypeScript 检查和生命周期 E2E 假通过问题。

## 2025-12-30

- `4597408` chore: initial commit
- `8b4fb81` chore: initial commit
- `235c4df` chore: sync latest changes

## 2025-12-31

- `07f54e6` chore: sync latest changes
- `2971211` chore: sync latest changes

## 2026-01-06

- `4f196ac` chore: sync latest changes
- `ba68426` chore: sync latest changes
- `016ff78` chore: sync latest changes
- `98263a8` chore: sync latest changes

## 2026-01-07

- `be6629e` chore: 上线版本
- `d8a3a3a` chore: 上线版本
- `3c9c401` chore: 上线版本

## 2026-01-23

- `93a2fb2` feat: 新增业务类型
- `eeedb37` feat: 企微通知上线
- `84658da` feat: 企微通知上线
- `2c42088` feat: 企微通知上线

## 2026-01-26

- `1ce13c5` chore: 企微通知调试
- `5e443d9` fix: 企微通知调试
- `117ff58` chore: 企微通知调试
- `ff03a71` chore: 企微通知调试
- `9f87c51` chore: 企微通知调试
- `489b4ee` chore: 企微通知调试
- `12c9681` feat: 企微通知上线
- `2ccfdbf` feat: 企微通知上线
- `cd175b4` feat: 企微通知上线

## 2026-02-05

- `addffe2` feat: 续费通知上线

## 2026-02-10

- `5ff8732` fix: 权限功能修复

## 2026-02-26

- `0bbf37a` fix: 线索看板修复/成交业绩统计逻辑修改

## 2026-03-09

- `27aacef` feat(leads): 增强我的线索责任归因前端表单
- `322ff72` Merge branch 'dev' into main: leads 责任归因前端改造
- `983e6cb` feat(leads): 新增线索支持电话/微信二选一并统一一级来源文案
- `91d1725` Merge branch 'dev'

## 2026-03-10

- `d9444ee` feat(leads): add website field for leads and public pool
- `622485d` Merge branch 'dev'
- `3dbca20` feat: 调整公海池与线索卡片字段展示
- `4788802` Merge branch 'dev'

## 2026-03-11

- `b9463fa` fix: 团队权限线索可见范围收紧
- `e30c4c3` Merge branch 'dev'
- `d6b6a99` feat: 应用版本检测与刷新提示
- `3074154` Merge branch 'dev'
- `ac7f735` feat: 支持在系统设置配置来源责任部门
- `70c54c1` Merge branch 'main' of https://github.com/iwish-requirement/iwish-sell-crm into dev
- `df84be0` fix: set /api/version to edge runtime

## 2026-03-17

- `253a276` feat(analytics): 客户产品类型分布与公海导入AI映射
- `3bb4b9e` Merge branch 'dev' into main: 客户产品类型分布与公海导入AI映射
- `4d095d3` fix(import): 公海导入 AI 字段映射超时兜底与状态提示
- `452e83c` Merge branch 'dev' into main: 公海导入 AI 字段映射超时兜底与状态提示
- `f37048b` fix(import): 更新 KIE GPT-5-4 正确 API URL
- `5e27b5b` Merge branch 'dev' into main: 更新 KIE GPT-5-4 正确 API URL
- `0a89468` fix: adjust KIE AI import mapping integration and timeout handling
- `ff1ae81` Merge branch 'dev'

## 2026-03-18

- `d5f1af0` feat(public-pool-import): integrate AI column mapping into import flow
- `0b296e9` chore(public-pool-import): switch import API routes to edge runtime for Cloudflare
- `b361982` refactor(public-pool-import): move preview parsing + AI mapping to browser for Cloudflare limits
- `ded5faf` refactor(public-pool-import): run import execution in browser instead of Cloudflare worker
- `b188976` feat(public-pool-import): use Supabase batch RPC for import execution

## 2026-03-20

- `174ef7f` feat: AI接入
- `40378ec` fix: AI修复
- `55941fc` fix: AI修复
- `7d0eb5b` fix: AI接入修复
- `02384d1` feat: AI接入
- `677a718` feat: AI接入硅基流动
- `c69489f` feat: 硅基流动deepseek

## 2026-03-23

- `94800e5` fix: stabilize ai import mapping proxy
- `0faa14e` Merge pull request #1 from iwish-requirement/dev
- `a1bb754` chore(ai): simplify siliconflow proxy
- `793c07f` Merge remote-tracking branch 'origin/main' into dev
- `5b21ed5` Merge pull request #2 from iwish-requirement/dev
- `7557c96` fix(ai): add timeouts and reduce payload
- `d099589` Merge remote-tracking branch 'origin/main' into dev
- `feb4fb7` Merge pull request #3 from iwish-requirement/dev
- `aa0bfd4` Merge pull request #4 from iwish-requirement/main
- `50ae496` Merge pull request #5 from iwish-requirement/dev

## 2026-03-25

- `4217bfd` fix: harden public pool AI import timeout handling
- `4e44a19` Merge remote-tracking branch 'origin/main'

## 2026-03-27

- `ce73740` chore: migrate public pool AI import to OpenRouter

## 2026-03-30

- `8625770` fix: default public pool AI import to qwen with fallback
- `90fb543` fix: move import AI analysis to background and lock import
- `ed1e175` fix: ?????? AI ??? CORS ????
- `444570e` fix: 收口导入 AI 模型决策到 Supabase Edge Function
- `58e6316` 合并 PR #9: 收口导入 AI 模型决策到 Supabase Edge Function
- `2339d49` fix: 加固导入 AI 返回 JSON 解析
- `ed7faf3` 合并 PR #10: 加固导入 AI 返回 JSON 解析
- `ecd6be1` fix: 修复导入 AI 伪 JSON 解析失败
- `7522d49` 合并 PR #11: 修复导入 AI 伪 JSON 解析失败
- `fd646b4` feat: 升级公海池导入为全量 AI 标准化
- `0c50584` fix: 修复公海池导入预览解析与来源归一化
- `ef16fca` feat: add ai import review before persistence
- `53f6307` fix: 修正全量AI结果生成阶段的权限拦截位置
- `746695c` fix: 回退导入预览AI为直连Supabase函数
- `dddf3cf` fix: 收敛导入预览AI样本规模避免JSON截断

## 2026-04-13

- `4aae463` feat: tighten leads import and transfer feedback
- `3d27835` Merge pull request #14 from iwish-requirement/codex/leads-import-strict-and-transfer-fixes
- `2e28153` fix: make leads import template edge-compatible

## 2026-05-06

- `8703e50` fix: delete auth user when rejecting registration
- `ea2e85c` fix: delete auth user when rejecting registration
- `d9bb353` fix: move reject auth cleanup into database rpc
- `ab35dda` chore: clean reject rpc error handling

## 2026-05-11

- `8359f0a` feat: add role dashboard and lead table workspace
- `5081624` feat: add dashboard time filters and customer details
- `77aea19` fix: align dashboard details with selected date range
- `201d884` fix: simplify dashboard management copy

## 2026-05-13

- `3e73a93` merge: role dashboard and lead table workspace

## 2026-06-04

- `b90bb5b` fix: scope lead kanban queries
- `8547d6f` fix: scope lead kanban queries

## 2026-08-31

- `a55fad8` feat: add allocation center and category compatibility
- `8b3649c` feat: add allocation center and category compatibility

## 2026-09-01

- `7e9392b` merge: synchronize main dashboard with dev allocation flow
- `5ba0e3d` fix: migrate Cloudflare deployment to OpenNext
- `1819c3c` fix: add OpenNext deployment scripts
- `ef57371` chore: rebuild with Cloudflare environment
- `ed691e7` fix: provide public Supabase config for builds
- `d67729b` chore: migrate Pages runtime configuration to Worker
- `7ac6cfd` chore: retrigger worker build after env sync
- `b45d314` fix allocation visibility and product category field
- `007e2a1` fix allocation access for technical admins
- `7d89f09` fix allocation page shell navigation
- `17d58e6` fix product category display across crm
- `3bf4dd4` fix analytics product category statistics
- `563c1de` fix renewal customer identity scope
- `54f38ca` read renewal contracts through rls
- `4d8510e` add all time renewal filter

## 2026-09-03

- `79f256f` feat: stage allocation center for lin88 on workers
- `0823f3b` docs: document allocation rollout and worker domain cutover

## 2026-09-09

- `e1ccb3d` fix worker deploy while pages owns domain
- `c723dad` enable worker production custom domain
- `94b52bf` show product category in my leads table
- `34e4bfe` add separate public pool claim permission
- `8b324aa` clarify public pool reclaim error
- `2dc9f3f` make public pool reclaim rule configurable

## 2026-09-11

- `b4cd0cc` feat: add lead pipeline quota and pool rules
- `26a7855` feat: make follow-up stages the lead lifecycle UI
- `579226e` feat: link stage changes to lead actions
- `cec6b0d` fix: preserve legacy stages in public pool
- `6066793` feat: align analytics with follow-up stages

## 2026-09-14

- `b7637d9` feat: sync lead pool and team membership workflows
