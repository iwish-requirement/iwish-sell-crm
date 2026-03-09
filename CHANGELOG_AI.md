# AI 变更记录（自动维护）

> 本文件用于记录 AI 助手在本仓库内做出的重要结构/逻辑变更，方便你审计、回顾与回滚。
> 按时间倒序追加；同一天多次修改可在同一日期下追加小节。

## 2026-03-09

### lead-source-model-alignment: 线索来源模型重定义为“一级来源 / 二级来源”，并兼容历史渠道数据

**变更点**
- 新增迁移 `supabase/migrations/042_lead_source_model_alignment.sql`：
  - 新增 `settings.key = 'leads.company_resource_source_groups'`，用于承载“公司分配资源”场景下的二级来源配置（社媒渠道 / 官网来源 / 线下活动 / 直播类）；
  - 修正 `leads.responsibility_types` 预置文案，将 `company_resource` 对齐为“公司分配资源”；
  - 重写 `iwish.rpc_lead_create` 与 `iwish.rpc_lead_update` 的来源校验语义：`source_level1` 统一表示一级来源（责任归因），`source_level2` 仅在 `company_resource` 场景下作为二级来源（渠道归因）使用；
  - 取消 `company_resource` 场景对 `source_department_key` 的强制要求，不再把“来源责任部门”作为主流程必填；
  - 保留历史数据兼容策略：不对旧线索做强制回填，旧 `source_level1/source_level2` 仍可按历史渠道含义继续展示；只有当用户显式修改来源时，才会按新版模型写入并锁定 `source_locked_at`。
- 更新 `components/lead-kanban.tsx`：
  - “新增线索”弹窗改为以“一级来源（责任归因）/ 二级来源（渠道归因）/ 条件字段”为核心录入模型；
  - 公司分配资源时展示二级来源，销售自主开发时展示开发方式，客户转介绍时展示来源客户与转介绍类型，活动名称仅在线下活动类二级来源下展示且为选填；
  - 详情页编辑态同样切换为新版来源模型，并在历史线索上显示“修改后将按新版模型保存”的兼容提示；
  - 高级筛选文案改为“一级来源 / 二级来源”，同时继续兼容历史渠道树和旧视图预设。
- 更新 `components/lead-grades-and-sources-settings-card.tsx`：
  - 配置项由旧的通用 `leads.source_tree` 迁移为面向新模型的 `leads.company_resource_source_groups`，用于维护“公司分配资源”的来源分类与二级来源；
  - 文案同步改为“来源分类 / 二级来源”，保留历史渠道树仅用于旧数据展示。
- 更新 `lib/rpc-error-mapper.ts` 与 `lib/services/leads.ts`：
  - 补充新版来源校验错误码的中文提示；
  - 为 `leads_secure_view` 的来源相关字段补全前端类型声明。

**变更原因（对应 PRD/原型）**
- 你明确纠正当前需求并强调：旧的“一级渠道 / 二级渠道”已经被新的来源模型替代，最终结构应为“一级来源 = 责任归因；二级来源 = 渠道归因；条件字段 = 细分归因；锁定时间 = 数据保护”；
- 现有实现把 `responsibility_type` 当作附加字段，仍要求“来源责任部门”等旧语义字段，和业务实际不一致；
- 同时线上已存在大量历史线索仍使用旧渠道结构，不能直接粗暴回填或覆盖，因此采用“前端兼容展示 + 修改时迁移”的渐进式兼容方案。

**影响范围**
- DB / RPC：创建与编辑线索时，来源字段的校验和落库语义已对齐新版模型；历史线索在未被修改来源前保持原样；
- 前端 / 交互：新增、详情编辑、筛选与配置后台的来源文案和录入方式均切换为新版模型；
- 兼容性：旧 `leads.source_tree` 继续作为历史数据显示字典存在，但不再作为新录入模型的主配置来源。

**回滚方式**
- DB：回滚 `042_lead_source_model_alignment.sql` 中的函数覆盖和新配置 key，恢复 `041` 的旧校验逻辑；
- 前端：恢复 `components/lead-kanban.tsx` 中旧的“一级渠道 / 二级渠道”表单与详情编辑逻辑，并将设置卡片重新指向 `leads.source_tree`；
- 若只需停止新版来源配置，可删除 `settings.key = 'leads.company_resource_source_groups'`，前端会回退到内置 fallback 配置。

## 2026-03-06


### leads-responsibility-and-source: 线索责任归因 + 来源条件必填 + 可配置枚举

**变更点**
- 新增迁移 `supabase/migrations/041_lead_responsibility_and_source.sql`：
  - 为 `public.leads` 增加责任归因相关字段：`responsibility_type/dev_method_key/referral_customer_name/referral_type_key/activity_name/source_department_key/source_locked_at`，并为 `responsibility_type` 增加枚举约束，仅允许 `company_resource/sales_self/customer_referral` 或为空；
  - 重建 `public.leads_secure_view`，在不改变原有列顺序与脱敏策略的前提下，在末尾追加上述责任归因字段，保证前端继续只读视图、不直接 select 底表；
  - 基于最新版本的 `iwish.rpc_lead_create(payload jsonb)` 扩展：在原有权限、scope 以及业务类型校验逻辑不变的前提下，新增解析并校验责任归因相关字段：
    - `responsibility_type` 必填；
    - `company_resource` 场景下 `source_level1` 与 `source_department_key` 必填，一级渠道为 `offline` 时 `activity_name` 也必填；
    - `sales_self` 场景下 `dev_method_key` 必填；
    - `customer_referral` 场景下 `referral_customer_name` 与 `referral_type_key` 必填；
    - 成功创建时同时写入 `source_locked_at = now()` 以锁定首次来源归因；
  - 基于最新版本的 `iwish.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)` 扩展：在保留现有“自范围 override + 阶段前进校验 + 公海退回权限 + 审计”逻辑基础上新增：
    - 对 `status='closed'` 的成交线索，禁止修改任何责任归因或来源字段（`responsibility_type/source_level1/source_level2/dev_method_key/referral_*/activity_name/source_department_key`），否则抛出 `ERR_INVALID_STATUS:cannot_change_source_when_closed`；
    - 对“已进入新来源体系”的线索（已有 `responsibility_type` 或本次 patch 带上）强制执行与创建时一致的条件必填校验，避免通过补丁更新绕过前端校验；
    - 在从“无责任归因”首次写入 `responsibility_type` 时自动填充 `source_locked_at = now()`，其余场景不回写该字段，保证来源锁定时间单调；
  - 重建 `public.rpc_lead_create` 与 `public.rpc_lead_update` 包装函数，保持签名与权限不变，仅透传到新的 `iwish.*` 实现。
- 新增 4 个 `public.settings` 配置 key，用于承载可配置枚举并与前端的 fallback 对齐：
  - `leads.responsibility_types`：`company_resource/sales_self/customer_referral` 三种责任归因；
  - `leads.dev_methods`：邮件开发、私域/朋友圈、老客挖掘、短视频引流、其他；
  - `leads.referral_types`：老客户介绍、渠道伙伴介绍、朋友/人脉介绍；
  - `leads.source_departments`：示例预置为深圳销售团队、深圳客服团队、杭州销售团队；所有插入均使用 `on conflict (key) do nothing`，不会覆盖线上已经存在的自定义配置。
- 前端（已在此前对话中完成落地，仅在此补充记录）：
  - `components/lead-kanban.tsx` 的“新增线索”弹窗新增“责任归因”区域及联动字段（开发方式、转介绍客户名称与类型、来源责任部门、活动名称），并基于责任类型实现条件必填校验，与新的 RPC 字段一一对应；
  - 新增本地 fallback 列表 `FALLBACK_RESPONSIBILITY_TYPES/FALLBACK_DEV_METHODS/FALLBACK_REFERRAL_TYPES/FALLBACK_SOURCE_DEPARTMENTS`，并在加载 `public.settings` 成功时自动覆盖，保证在未配置 settings 的环境下也能直接使用你领导提供的字段语义。

**变更原因（对应 PRD/原型）**
- PRD 明确要求“来源责任归因 + 渠道归因 + 条件必填”必须在后端层面强制执行，而不是只在前端做表单校验，同时需要支持后续按业务调整责任类型、开发方式、转介绍类型与来源部门枚举；
- 现有实现中，线索的 `source/source_level1/source_level2` 虽然已结构化，但无法表达“公司资源 vs 销售自拓 vs 客户转介绍”的责任边界，也缺少对成交后来源信息的锁定与审计；
- 通过在 `public.leads` 上新增责任归因字段、将其暴露到 `leads_secure_view` 并在 `rpc_lead_create/update` 中集中校验，可以在不破坏既有 UI 结构的前提下，将“责任归因 + 来源条件必填 + 锁定时间”落到数据库层，同时保持枚举值在 `public.settings` 中可配置，满足领导对灵活性与安全性的双重要求。

**影响范围**
- DB / 视图 / RPC：
  - `public.leads` 表结构发生向后兼容式扩展，新字段默认允许为 null，不对历史数据做强制回填；
  - `public.leads_secure_view` 的列集扩展，所有既有消费方可以无感继续使用旧列，新列仅供需要责任归因信息的新功能读取；
  - `iwish.rpc_lead_create` 与 `iwish.rpc_lead_update` 的签名保持不变，但新增对责任归因与来源字段的强校验和 `source_locked_at` 写入逻辑，调用方在传入不符合业务规则的 payload 时会收到更细粒度的 `ERR_VALIDATION:*` 或 `ERR_INVALID_STATUS:*` 错误码；
  - `public.settings` 新增 4 个与线索责任/来源相关的配置 key，可通过 Settings UI 后续接入管理界面。
- 前端 / 交互：
  - “新增线索”表单在责任归因选择后会动态展示/隐藏相关字段，并在提交前进行前端校验，减少触发后端错误的频率，同时与 RPC 校验规则保持一致；
  - 由于 `leads_secure_view` 返回了责任相关字段，后续可以在看板卡片、详情抽屉或报表中展示“责任归因 + 渠道 + 活动 + 来源部门”，用于内部复盘和 ROI 归因。

**回滚方式**
- DB：
  - 可在后续迁移中对 `public.leads` 执行 `alter table public.leads drop column ...` 逐个删除本次新增的责任归因相关字段，并还原旧版 `public.leads_secure_view` 定义；
  - 可从 `004_rpc_and_audit.sql/030_leads_update_self_scope_override.sql/031_business_types_and_wecom.sql` 中拷贝旧版 `iwish.rpc_lead_create` 与 `iwish.rpc_lead_update` 定义，在新的迁移中 `create or replace function` 覆盖当前实现；
  - 若不再需要可配置枚举，可删除 `public.settings` 中 `key in ('leads.responsibility_types','leads.dev_methods','leads.referral_types','leads.source_departments')` 的记录。
- 前端：
  - 在 `components/lead-kanban.tsx` 中移除“责任归因”相关字段状态与表单 UI，并恢复原有的新增线索校验逻辑；
  - 删除 fallback 列表与从 `public.settings` 读取责任归因配置的代码，使新增线索回退到仅依赖 `source_level1/source_level2` 的旧版来源模型。

## 2026-02-02

### wecom-renewal-notify: 续费预警企微自动通知 + 设置开关

**变更点**
- 新增迁移 `supabase/migrations/039_wecom_notifications_and_renewal_job.sql`：
  - 定义 `iwish.get_wecom_notifications_settings()` 与公开包装 `public.rpc_get_wecom_notifications_settings()`，从 `public.settings` 的 `wecom.notifications` 配置中读取 WeCom 通知相关设置，并提供 `renewal_upcoming.enabled/days_before` 两个字段，未配置时默认开启且提前 30 天；
  - 新增 `iwish.get_renewal_upcoming_wecom_targets()` 与 `public.rpc_get_renewal_upcoming_wecom_targets()`：按当前日期 + 提前天数计算目标到期日，筛选 `contracts` 中 `status='active'` 且在该日到期的合同，关联 `leads` 与 `profiles`，仅返回负责人已绑定企微(`wecom_bind_status='bound'` 且有 `wecom_user_id`) 且最近一次 `wecom_last_notified_at` 早于今天的记录，并按负责人聚合合同列表，以 JSON 形式返回给调用方；
  - 新增 `iwish.rpc_wecom_mark_notified(p_profile_ids uuid[])` 与公开包装 `public.rpc_wecom_mark_notified(uuid[])`，用于在发送通知成功后批量更新对应 `profiles.wecom_last_notified_at = now()`，避免同一负责人在短时间内被重复提醒。
- 新增 Edge API 路由 `/api/jobs/renewal-wecom-notify`：
  - 使用 `SUPABASE_SERVICE_ROLE_KEY` 通过 `createAdminSupabaseClient` 调用 `rpc_get_renewal_upcoming_wecom_targets` 获取“今天应发送续费预警”的负责人及其合同列表；
  - 通过 `x-job-token` 请求头 + 环境变量 `RENEWAL_WECHAT_JOB_TOKEN/WECOM_RENEWAL_JOB_TOKEN` 做最小化的 job 调用鉴权，防止外部未授权触发；
  - 对每个负责人生成一条聚合文案（包含客户名称、合同编号、到期日期、金额，并附上续费中心链接 `buildPublicUrl("/renewals")`），调用 `sendWecomGatewayText` 通过统一网关发送企微文本消息；
  - 对发送成功的负责人收集 `profile_id` 列表，最后调用 `rpc_wecom_mark_notified` 更新 `wecom_last_notified_at`；接口返回 `ok/notifiedProfiles/totalContracts` 便于运维在外部 Cron 或监控系统中查看执行效果。
- 更新 `components/system-settings.tsx` 中的 `BusinessRulesTab`：
  - 在原有“公海池掉落天数 + 预警/风险阈值”基础上，新增本地状态 `renewalNotifyEnabled` 与 `renewalNotifyDaysBefore`，并在加载时同时从 `settings` 读取 `pipeline.business_rules` 与 `wecom.notifications` 两个配置 key，对应填充原有线索业务规则和续费预警配置；
  - 在“业务规则配置”卡片中增加“续费预警企微通知”区域：提供一个开关用于控制是否启用续费预警企微消息，以及一个“提前天数”数字输入框（仅在开关开启时可编辑），提示说明系统会在合同到期前指定天数自动给负责人发送续费提醒，且只对已绑定企微的负责人生效；
  - 保存逻辑调整为一次性 `upsert` 两条 `settings` 记录：`pipeline.business_rules`（原字段不变）与新的 `wecom.notifications`（当前仅包含 `renewal_upcoming.enabled/days_before`），并在校验时要求所有数值型字段为大于 0 的有效数字，保持与既有 `settings.pipeline.manage` 权限和错误提示一致。

**变更原因（对应需求）**
- 你明确提出续费预警的业务需求是“根据系统设置的提前天数（例如合同到期前 30 天）自动通知”，而不是简单地在已经到期或临近到期时做静态视图统计；
- 现有系统已经有合同实体、续费中心视图及 WeCom 绑定和统一网关发送能力，但缺少“通知配置 + 自动触发”的闭环；
- 通过在 `settings` 中引入 `wecom.notifications` 配置、在 Supabase 写 RPC 计算“到期前 N 天”的目标合同列表，再由 Next.js job 路由调用统一网关发企微消息，可以在不破坏现有 UI 结构的前提下实现真正的“提前续费预警”，同时保留扩展空间为其他通知类型预设配置。

**影响范围**
- DB / RPC：
  - 新增 3 个函数（含公开包装）：`get_wecom_notifications_settings`、`get_renewal_upcoming_wecom_targets`、`rpc_wecom_mark_notified`，依赖现有的 `public.settings`、`contracts`、`leads`、`profiles` 结构和 `wecom_last_notified_at` 字段，不改变既有 RLS 与权限点，仅通过 `security definer` 在受控场景下暴露给 `authenticated/service_role`；
  - 续费预警通知的候选合同筛选逻辑完全在数据库层完成，前端/服务端仅消费聚合后的 JSON 结果，有利于后续在报表与审计中复用相同口径。
- 后端服务：
  - 新增 `/api/jobs/renewal-wecom-notify` 作为自动任务入口，需要在 Cloudflare/Supabase Edge Functions 等外部调度系统中配置定时请求（携带正确的 `x-job-token`），推荐每日固定时间触发，使“到期前 N 天”判断语义稳定；
  - 统一网关环境变量需保证已正确配置 `WECOM_GATEWAY_BASE_URL`、`SYSTEM_KEY`、`SYSTEM_TOKEN` 以及公共访问地址 `PUBLIC_BASE_URL/APP_PUBLIC_URL`，否则 job 执行时会在日志中输出错误并返回 `ok=false`，但不会影响其它业务接口；
  - `wecom_last_notified_at` 现在正式用于控制通知频率：同一负责人在同一天内不会重复收到续费预警企微消息。
- 前端 / 设置页：
  - SystemSettings → 业务规则 Tab 中新增“续费预警企微通知”小节，权限与错误提示复用 `settings.pipeline.manage`，管理员可随时调整是否开启通知以及提前天数（如 15/30/45 天）；
  - 续费中心 `components/renewal-center.tsx` 的行为保持不变，仍然作为“视图库”和手工跟进工作台使用，但在 job 与配置生效后，销售会在合同到期前预设天数收到企微提醒，并可通过续费中心跳转查看详情。

**回滚方式**
- DB：
  - 可在新的迁移中执行 `drop function if exists public.rpc_get_wecom_notifications_settings(); drop function if exists iwish.get_wecom_notifications_settings(); drop function if exists public.rpc_get_renewal_upcoming_wecom_targets(); drop function if exists iwish.get_renewal_upcoming_wecom_targets(); drop function if exists public.rpc_wecom_mark_notified(uuid[]); drop function if exists iwish.rpc_wecom_mark_notified(uuid[]);` 取消此次新增的 RPC 和 helper 函数；
  - 如不再需要 WeCom 通知配置，可在迁移中删除 `public.settings` 中 `key = 'wecom.notifications'` 的记录（注意这会清空所有通知开关与参数）。
- 后端服务 / UI：
  - 删除 `app/api/jobs/renewal-wecom-notify/route.ts` 文件或将其导出的 `POST` 置为空实现，让外部 Cron 调用不再触发任何动作；
  - 在 `components/system-settings.tsx` 中移除 `renewalNotifyEnabled/renewalNotifyDaysBefore` 相关状态、加载和保存逻辑，以及“续费预警企微通知” UI 区域即可，将业务规则页恢复为仅配置公海与线索预警阈值的版本。

## 2026-01-23

### wecom-gateway-bind: 企微统一网关接入（扫码绑定 + 回调落库 + 统一发消息）

**变更点**
- 新增个人资料页 `/profile`：提供“企业微信绑定”区块，点击后按网关标准生成一次性 `bindToken` 并跳转网关扫码授权。
- 新增 API：
  - `/api/wecom/bind-token`：为当前登录用户生成一次性 `bindToken`（默认 10 分钟有效期）。
  - `/api/wecom/bind-callback`：实现网关回调落库协议（校验 `X-Wecom-Gateway-Token`、校验 `bindToken` 一次性/过期、写入 `profiles.wecom_user_id` 并写审计）。
- 新增 DB 迁移 `supabase/migrations/038_wecom_gateway_bind_tokens.sql`：新增 `wecom_bind_tokens` 表 + RLS + `iwish.rpc_wecom_bind_callback`（仅 `service_role` 可执行，防止绕过回调）。
- 新增 `lib/wecom/gateway.ts`：统一网关发消息封装（`SYSTEM_KEY/SYSTEM_TOKEN` 鉴权、收件人去重、内容前缀强制）。
- 调整 `lib/wecom/client.ts`：改为基于网关的兼容层，避免业务系统直连企微 API 受“固定出口 IP 白名单”影响。

**变更原因（对应需求）**
- 你提供了统一网关标准：扫码绑定必须使用一次性 `bindToken` + 回调落库鉴权；消息发送必须走网关统一鉴权入口。

**影响范围**
- 前端：新增 `/profile` 页面入口（TopBar 下拉菜单可进入）。
- 服务端：新增两个 API 路由；需配置 `YOUR_BIND_CALLBACK_TOKEN` 与 `SUPABASE_SERVICE_ROLE_KEY` 才能完成回调落库。
- DB：新增 `wecom_bind_tokens` 表与绑定回调 RPC（需要执行迁移）。


## 2026-01-04


### contracts-entity-and-permissions: 新增合同实体并接入权限与 RLS

**变更点**
- 新增 `supabase/migrations/031_contracts_entity_and_permissions.sql`：
  - 创建 `public.contracts` 表，作为与 `public.leads` 一对一关联的合同实体，字段包含 `contract_number/title/amount/currency/signed_at/start_date/end_date/is_renewal/original_contract_id/status`，并记录 `created_by/created_at/updated_at`，通过触发器复用通用的 `iwish.set_updated_at`；
  - 定义枚举类型 `contract_status`（`pending/active/closed/cancelled`）用于约束合同状态字段，并为 `lead_id` 建立唯一约束与索引，确保每条线索至少可以挂一个主合同，后续如需多合同可以通过新增关联表扩展；
  - 新增权限点 `contracts.read` 与 `contracts.manage`，并在 `role_permissions` 中为 `Sales/Manager/Admin/SuperAdmin` 预置合适的 scope：销售可在 self 范围读取合同，经理在 team 范围读写，Admin/SuperAdmin 在 org 范围读写；
  - 启用 `public.contracts` 的 RLS，读策略要求当前用户具备 `contracts.read` 且对关联线索拥有 `leads.read` 和 in-scope 权限，写策略（插入/更新/删除）要求具备 `contracts.manage` 且仅能在对线索有 `leads.update` scope 的前提下操作，保证合同数据与线索范围强绑定；
  - 提供只读视图 `public.contracts_secure_view`，用于前端统一从安全视图读取合同信息，避免直接暴露底表，实现方式与 `public.leads_secure_view` 保持一致风格。

**变更原因（对应 PRD/原型）**
- PRD 提出“独立成交与合同实体支撑提成和渠道 ROI 统计”，现有实现仅在 `leads` 上记录预算与成交结果，无法表达真实签约金额、起止日期、是否续费等合同语义，也不利于按合同维度做 ROI 分析和后续续费视图；
- 通过将合同拆成独立实体并复用现有的权限与范围体系（`has_permission + in_scope_for_lead`），可以在不破坏现有线索生命周期的前提下，为后续的“合同详情页”“续费中心”“ROI 报表”提供稳定的数据骨架；
- 新增的 `contracts.read/contracts.manage` 权限点也会自动出现在 SystemSettings 的角色权限矩阵中，方便你在不同角色之间细化“谁能看合同、谁能编辑合同”的边界。

**影响范围**
- DB / 权限 / RLS：
  - 数据库新增 `public.contracts` 表和 `contract_status` 枚举类型，并开启 RLS，所有合同的读取/写入都需同时满足合同权限和线索范围校验；
  - `permissions` 与 `role_permissions` 增加了两条合同相关权限及其默认角色绑定，不会影响现有 leads/notes 等模块的权限配置；
  - 新建的 `public.contracts_secure_view` 为前端后续接入合同信息提供了统一入口，避免直接对底表做 select；
- 前端 / 业务逻辑：
  - 当前前端尚未读取或写入 `contracts` 表，成交中心与看板的行为保持不变；
  - 后续在 DealCenter 或客户详情页中加“合同信息”区块时，可以直接基于 `contracts_secure_view` 查询合同数据，并在创建/编辑时遵循本次新增的权限与 RLS 规则。

**回滚方式**
- 如需回滚，可在新的迁移中依次执行：
  - `drop view if exists public.contracts_secure_view;`
  - `drop table if exists public.contracts;`
  - `delete from public.role_permissions where permission_key in ('contracts.read','contracts.manage');`
  - `delete from public.permissions where key in ('contracts.read','contracts.manage');`
  - 如无其他依赖，可选择性删除 `contract_status` 枚举类型；
- 同时从仓库中移除 `031_contracts_entity_and_permissions.sql` 或在后续迁移中覆盖其效果，前端如已接入合同视图，则需要一并调整，恢复为仅依赖 leads 的成交字段。

## 2025-12-31


### leads-create-structured-fields: 新增线索时写入客户级别与标签

**变更点**
- 新增 `supabase/migrations/035_lead_create_structured_fields.sql`：
  - 使用 `create or replace function iwish.rpc_lead_create(payload jsonb)` 扩展线索创建 RPC，在原有权限与范围校验不变的前提下，新增写入 `customer_grade/source_level1/source_level2/tags` 四类结构化字段，并将默认阶段由 `new` 对齐为标准生命周期的 `L1`；
  - 对 `tags` 字段从 `payload->'tags'` 中安全解析为 `text[]`，未传入时使用空数组，保持与 `023_leads_structured_fields` 中的字段定义一致，避免出现 null/类型不一致问题；
  - 继续通过 `iwish.audit` 记录创建前后镜像（after snapshot 包含新字段），满足“线索创建必须可审计”的要求。
- 前端 `components/lead-kanban.tsx` 保持现有 `handleAddLead` 逻辑不变，新建线索时传入的客户级别与标签会通过上述 RPC 落库，刷新后仍能在卡片徽标和详情页中看到。

**变更原因（对应 PRD/原型）**
- PRD 要求“客户级别 S/A/B/C + 来源分层 + 多标签”形成闭环字段体系，且必须由后端结构化持久化，不能只停留在前端本地状态，否则刷新页面或切换设备时会丢失这些关键信息；
- 之前只在 `rpc_lead_update` 中支持更新结构化字段，而创建 RPC 仍然只写入基础字段，导致“新增时选了客户级别/标签，刷新后就消失”的体验，与产品预期不符；
- 通过统一在创建与更新 RPC 中支持这些字段，后续可以安全地在报表、保护期规则以及视图筛选中依赖它们。

**影响范围**
- DB / RPC：
  - `iwish.rpc_lead_create` 的签名保持为 `(payload jsonb)`，所有既有调用方无需调整，只是新增解析结构化字段并写入 `public.leads`；
  - 线索创建时若传入 `customer_grade/source_level1/source_level2/tags`，会与 `023_leads_structured_fields` 定义的字段保持一致，并出现在 `public.leads_secure_view` 的对应列中；
- 前端 / 业务体验：
  - 在“新增线索”弹窗中选择的客户级别和填写的标签，在创建成功并刷新数据后会稳定显示在看板卡片与详情页中，不再出现“只在当次会话生效”的情况；
  - 视图筛选与保存（包括按客户级别和标签关键词筛选）逻辑保持不变，只是其背后的数据现在真正落在数据库中，更适合作为筛选与分析维度。

**回滚方式**
- 如需回滚，可在后续迁移中用早期版本的 `iwish.rpc_lead_create` 覆盖当前定义（可从 `004_rpc_and_audit.sql` 中还原），并视需要删除或标记 `035_lead_create_structured_fields.sql` 迁移文件；
- 回滚后，创建线索时的客户级别、来源分层和标签将不再写入底表，但 update RPC 仍然保留对这些字段的支持，前端若需要一致行为需一并协调。

### leads-lock-and-protection: 锁单与保护期、公海保护规则

**变更点**
- 新增 `supabase/migrations/034_lead_lock_and_protection.sql`：
  - 为 `public.leads` 增加 `first_contact_at/locked_by/locked_until/protected_until` 字段，并为 `first_contact_at/locked_until/protected_until` 建立索引；
  - 新增配置项 `settings.leads.lock_and_protection`（如首次有效联系锁单小时数、按阶段/客户级别的保护期天数），并提供 `iwish.get_lead_lock_and_protection_config()` 读取默认/自定义配置；
  - 定义触发器函数 `iwish.leads_apply_lock_and_protection`，在 open 线索首次写入 `last_contact_at` 时记录 `first_contact_at/locked_by`，并按配置自动计算 `locked_until/protected_until`，后续更新阶段或客户级别时只做“向前延长”，不回缩已有的锁单/保护期；
  - 重写 `public.leads_secure_view`，在原有字段与脱敏逻辑不变的前提下，追加暴露只读的 `first_contact_at/locked_by/locked_until/protected_until` 字段，供前端展示锁单与保护期状态；
  - 调整 `public.leads` 的 update/delete RLS 策略：对于 `status='open'` 且仍在 `protected_until` 之前的线索，仅允许 `owner_id = auth.uid()` 的本人更新或删除，其他人需等待保护期结束后才可操作。
- 更新 `components/system-settings.tsx`：
  - 在“业务规则” Tab 下新增“锁单与保护期”配置卡片，从 `settings.leads.lock_and_protection` 读取并保存首次有效联系锁单小时数、按阶段保护期天数（L1/L2/L3/L4/Won）和按客户级别保护期天数（S/A/B/C），权限错误时复用 `settings.pipeline.manage` 的提示逻辑；
  - 管理员调整配置后，后端会在下一次首触达或阶段/级别变更时按新规则向后延长保护期，前端详情页实时展示更新后的锁单/保护期时间。
- 更新 `components/lead-kanban.tsx`：

  - 从 `leads_secure_view` 拉取 `first_contact_at/locked_until/protected_until` 并映射到本地 `Lead` 类型，在详情抽屉顶部新增“锁单与保护期状态”条，直观展示首次有效联系时间、锁单结束时间与保护期结束日期；
  - 计算 `isSelectedLeadProtectedForOthers`，用于判断“当前线索为 open 且仍在保护期内、且当前用户不是负责人”的场景，并在这种情况下：
    - 在详情顶部状态条中显示黄色提示文案，说明“当前线索处于保护期，仅负责人可在保护期内重新分配、跨团队转移或退回公海”；
    - 在“重新分配”“跨团队转移”“退回公海”按钮点击时，前端直接弹出友好提示并阻止打开弹窗，避免用户在保护期内频繁收到低层错误；
    - 在实际执行退回公海的 `handleReturnToPool` 中再次加一层保护期判断，确保并发/状态变化下也不会误发请求。
- 公海池 `components/public-pool.tsx` 不改变既有行为：
  - 继续只展示 `status = 'pool'` 的线索，认领/分配操作仍通过 `rpc_lead_claim_from_pool` 与 `rpc_lead_update` 完成；
  - 保护期约束仅对非公海的 open 线索生效，保证“未退回公海的保护期线索只能由本人处理”，而一旦退回公海则回到当前的公海规则。

**变更原因（对应 PRD/原型）**
- PRD 强调“首次有效联系锁单 + 多维保护期”（按阶段、客户级别等），确保销售在完成首触达后的一段时间内对线索有稳定的归属，避免同一线索在保护期内被频繁争抢或退回公海；
- 需要在后端通过字段 + 触发器 + RLS 强制保护期规则，而不是仅在前端做按钮禁用，否则可以通过脚本或绕过 UI 写入不符合保护期的更新；
- 为了让一线销售和主管能感知锁单/保护期状态，需在线索详情中提供清晰的时间信息和操作提示；同时对于处于保护期但又不在本人名下的线索，应在分配/退回入口给出明确的“不允许操作”原因，降低“莫名其妙失败”的体验。

**影响范围**
- DB / RLS / 视图：
  - `public.leads` 新增锁单/保护期相关字段并随 open 线索的首次有效联系与阶段/级别变化自动维护，保证保护期计算在数据库层统一、可审计；
  - `public.leads_secure_view` 增加只读的锁单/保护期字段，前端继续从视图而非底表读取线索信息，敏感字段脱敏策略保持不变；
  - 更新后的 RLS 策略使得在保护期内，除负责人外任何账号（包括团队经理）都无法直接通过通用 update/delete 操作修改 open 线索，前端若强行调用将收到 RLS 拒绝。
- 前端 / 业务体验：
  - 线索详情顶部可以清晰看到“首次有效联系”“锁单至 / 保护期至”的时间信息，帮助销售判断当前线索是否在锁单/保护期内；
  - 在保护期且不属于当前账户的线索上尝试“重新分配/跨团队转移/退回公海”时，前端会直接提示“当前线索处于保护期，仅负责人可操作”，避免频繁触发底层错误；
  - 公海池的认领与分配流程保持不变，保护期更多作用于“从公海分配出去之后”的持有阶段，不影响现有的导入、公海认领体验。

**回滚方式**
- 如需回滚锁单与保护期规则，可在新的迁移中移除 `first_contact_at/locked_by/locked_until/protected_until` 字段及相关索引，并恢复旧版 `public.leads_secure_view` 定义；
- 同时可删除触发器及函数 `trg_leads_lock_and_protection/iwish.leads_apply_lock_and_protection`，并将 `leads_update_scope/leads_delete_scope` RLS 策略还原为本次变更前的版本；
- 前端如不再需要显示锁单/保护期状态，可在 `components/lead-kanban.tsx` 中移除相关字段映射与状态条、保护期前端拦截逻辑，恢复原有的操作入口行为。

### leads-team-and-owner-consistency: 线索团队归属与负责人一致性收紧


**变更点**
- 新增 `supabase/migrations/033_leads_team_consistency_enforcement.sql`：
  - 将 `iwish.rpc_lead_create` 改为永远根据 `owner_id` 推导 `team_id`，不再信任前端传入的团队字段，并在 `self/team` scope 下强制要求“创建人和负责人在同一团队”；
  - 将 `iwish.rpc_lead_assign` 收紧为仅允许“同团队内换负责人”，若尝试跨团队分配则抛出 `ERR_VALIDATION:assign_cross_team_use_transfer`，引导使用跨团队转移；
  - 将 `iwish.rpc_lead_transfer` 收紧为“新负责人必须属于目标团队”，否则抛出 `ERR_VALIDATION:new_owner_team_mismatch`，同时统一更新 `team_id + owner_id` 并写入审计；
  - 扩展 `iwish.rpc_profile_update_org`，在成员调组时自动把其名下所有未关闭线索的 `team_id` 一并迁移到新团队，避免再次依赖一次性脚本修脏数据；
  - 新增触发器 `iwish.leads_sync_team_with_owner`，对所有非公海/非关闭线索，在 `owner_id/status` 变更时自动将 `team_id` 同步为当前负责人团队，作为防御性兜底。
- 更新 `lib/rpc-error-mapper.ts`：
  - 针对上述 RPC 抛出的 `ERR_VALIDATION:*` 错误码（如 `assign_cross_team_use_transfer/assign_requires_team/new_owner_team_mismatch/team_mismatch_on_create/owner_requires_team/transfer_requires_team`），返回更贴近业务的中文文案，明确提示“请使用跨团队转移”“先为成员配置团队”等具体操作建议，而不再只是笼统的“参数校验失败”。
- 更新 `components/lead-kanban.tsx` 与 `components/public-pool.tsx` 所在的交互：
  - 保留 Supabase Realtime 订阅，修复了详情抽屉在同步最新数据时的无限更新问题，并在列表刷新时同步更新已打开的详情内容；
  - 调整看板加载逻辑，仅在首次进入页面时显示骨架屏，后续 Realtime 或轮询触发的数据刷新都在后台静默完成，避免整页频繁“闪一下”的非产品级体验；
  - 为公海池和看板的分配/认领/删除等操作统一使用 `mapRpcError` 的增强文案，让权限/范围/校验失败时，前端提示更符合业务语义。

**变更原因（对应 PRD/原型）**
- PRD 明确要求“线索归属团队与负责人必须在后端层面强一致”，不能通过 UI 或脚本制造出“看起来归我团队、实际 team_id 还在别的团队”的脏状态，尤其是在人员调组、跨团队转移和公海往返这些高风险操作下；
- 之前依赖一次性修复脚本 + 宽松的 assign/transfer 规则，容易在团队结构变化后再次出现 out-of-scope 报错，本次通过 RLS/RPC/触发器从结构上锁死“team_id = owner.team”的不变式；
- 在多人实时协作场景下，原有 Realtime 刷新会让整个看板频繁切换骨架屏，给人“页面一直在刷新”的不稳定感，需要通过“首屏 skeleton + 后台静默刷新”的方式，做到既实时又不打断视线；
- 对于这些更严格的校验和权限规则，产品希望在 UI 中用更贴近业务的话解释（例如明确告诉销售“跨团队分配请用转移”，而不是一行技术向错误码），降低学习成本。

**影响范围**
- DB / RLS / RPC：
  - 所有线索创建/指派/跨团队转移/成员调组入口现在都会确保非公海线索满足 `team_id = owner 当前团队`，并在违反规则时抛出结构化错误码供前端解析，`in_scope_for_lead` 与 RLS 的 team 范围判定因此更可靠；
  - 触发器 `leads_sync_team_with_owner` 提供了“最后一道防线”，即便有遗漏入口错误写入，也会在写入时自动纠正 team_id，减少人工修复的机会；
- 前端 / 用户体验：
  - 看板与公海在多人操作时会在几秒内自动同步最新数据，但不会再整页闪烁，仅更新受影响的卡片和详情内容；
  - 当因为团队配置缺失或错误用法（用 assign 做跨团队分配）导致操作失败时，提示文案会直接告诉用户应该怎么做，而不是让你去猜错误含义；
- 审计与排查：
  - 所有调组、跨团队转移、公海退回/认领等操作仍然写入 `audit_logs`，结合新的错误码和更清晰的前端提示，便于后续定位问题来源和回溯历史变动。

**回滚方式**
- 如需回滚团队一致性收紧，可在后续迁移中用 `create or replace function` 恢复 `iwish.rpc_lead_create/iwish.rpc_lead_assign/iwish.rpc_lead_transfer/iwish.rpc_profile_update_org` 为本次修改前版本，并删除触发器 `trg_leads_sync_team_with_owner` 与函数 `iwish.leads_sync_team_with_owner`；
- 如不再需要细分的校验错误文案，可在 `lib/rpc-error-mapper.ts` 中移除针对 `ERR_VALIDATION:*` 的特例分支，让所有校验错误重新回退为统一的“参数校验失败”提示；
- 若认为 Realtime 行为不再需要，也可在 `components/lead-kanban.tsx` 和 `components/public-pool.tsx` 中移除订阅与静默刷新逻辑，改为完全手动刷新（不推荐，会明显降低多人协作体验）。

### dashboard-recent-activities-permission-aware: 仪表盘最近动态按权限与关联度返回

**变更点**
- 新增 `supabase/migrations/021_rpc_recent_activities_feed.sql`，定义内部函数 `iwish.rpc_recent_activities(p_limit integer)` 与公开包装 `public.rpc_recent_activities(p_limit integer)`：
  - 返回字段包括 `id, actor_id, actor_name, action, target_type, target_id, reason, created_at, before, after`，数据源为 `audit_logs`，并通过 `profiles_public` 补充操作者姓名。
  - 若当前用户具备 `audit.read` 权限，则按时间倒序返回最近 N 条审计记录（等价于全局审计视角，适用于管理员/安全 Owner）。
  - 若不具备 `audit.read` 权限，则仅返回与当前用户强相关的动态：由其本人触发的操作（`actor_id = auth.uid()`），以及针对其有 `leads.read` scope 的线索产生的审计记录（通过 `iwish.in_scope_for_lead` 判定）。
- 更新 `lib/services/audit.ts`：
  - 将 `fetchAuditLogs` 改为调用 `rpc_recent_activities`，不再直接从 `audit_logs` 表查询和手动 join `profiles_public`，而是直接消费 RPC 返回的 `actor_name` 字段，构造原有 `AuditLogEntry` 结构。
- 更新 `components/recent-activity-table.tsx`：
  - 仍然依赖 `fetchAuditLogs` 加载数据，但错误提示从“当前账号无权查看系统审计动态，仅管理员可见最近动态”调整为通用的“最近动态加载失败，请稍后重试”。
  - 空状态文案从“最近 200 条审计记录中没有可以展示的关键活动”改为“最近没有可以展示的关键动态，可以在看板、公海或设置中多做一些操作后再回来看看”，不再直接暴露审计实现细节。

**变更原因（对应 PRD/原型）**
- 仪表盘“最近动态”最初直接读 `audit_logs`，对于具备 `audit.read` 的管理员来说是合理的，但对于普通销售/主管，则出现“完全无权限看到任何动态”或看到一堆与自己无直接关系的全局审计记录，与“仪表盘应展示与当前角色和本人强相关的关键事件”的产品预期不符。
- PRD 中已有完备的权限与 scope 体系（`leads.read` + `scope_type` + `iwish.in_scope_for_lead`），且所有业务关键动作都写入了 `audit_logs`，因此通过一个 RPC 在后端基于权限与数据范围过滤最近动态，比前端在客户端粗粒度过滤更安全、也更符合“后端强制”的原则。

**影响范围**
- DB / RLS / RPC：
  - 新增 `rpc_recent_activities`，以 `security definer` 方式在后端集中封装“最近动态”逻辑，内部使用 `iwish.has_permission` 与 `iwish.in_scope_for_lead` 计算当前用户可见范围，未修改现有 RLS/policy 定义。
  - 对具备 `audit.read` 的账号，行为等价于原来在仪表盘中直接读取最近的审计记录；对不具备该权限的账号，则只返回本人及其有权查看线索相关的事件，不会暴露其他团队/组织的敏感操作。
- UI：
  - 仪表盘卡片“最近动态”现在对普通销售/主管也会展示他们自己的近期关键动态，而不再一概提示“无审计权限”；管理员仍然看到覆盖全局的关键事件流。
  - 空状态与错误提示的文案更加贴近“业务动态”的产品语义，而不是暴露底层实现为审计表的细节。

**回滚方式**
- DB：
  - 如需回退，可删除或注释掉 `021_rpc_recent_activities_feed.sql` 中的函数定义，重新部署数据库后，前端的 `fetchAuditLogs` 将因 RPC 缺失而报错；
  - 或保留 RPC 但修改其实现，使之始终等价于“管理员视角”（不区分 `audit.read` 权限，直接返回最近 N 条 `audit_logs`）。
- UI：
  - 如希望恢复为“仪表盘最近动态只在管理员下可用”，可在 `components/recent-activity-table.tsx` 中重新引入对 `ERR_NO_PERMISSION:audit.read` 的错误分支，并在普通账号的 dashboard 中隐藏该卡片或用占位提示替代。

## 2025-12-24

### dashboard-and-kanban-risk-thresholds-config-aligned: 仪表盘与看板风险阈值对齐业务规则配置

**变更点**
- 更新 `lib/services/dashboard.ts` 中 `fetchDashboardSummary` 的风险线索统计逻辑：
  - 在原有排除 analytics.excluded_teams / analytics.excluded_profiles 的基础上，增加读取 `settings.key = 'pipeline.business_rules'`；
  - 若配置中存在 `danger_hours` 且为正数，则将“风险线索” KPI 统计口径从固定的“最近 7 天未跟进”调整为“超过配置的红色风险阈值未跟进”的 open 线索；
  - 未配置或无权限读取时回退到默认 168 小时（7 天），避免打断现有使用。
- 更新 `components/lead-kanban.tsx` 中的风险/需跟进标记与顶部风险提醒：
  - 在加载线索列表时并行读取 `pipeline.business_rules`，将 `warning_hours` / `danger_hours` 注入当前会话的风险配置；
  - 卡片上的“风险/需跟进” Badge 以及顶部横幅统计不再使用硬编码的 3 天/7 天，而是基于配置的黄色预警阈值与红色风险阈值按小时精确判断，未配置时分别回退为 72 小时与 168 小时；
  - 文案说明从“超过 7 天未互动视为高风险，3–6 天需跟进”调整为“超过配置的红色风险阈值视为高风险，超过黄色预警但未达红色风险的线索需跟进”，以与配置保持一致。

**变更原因（对应 PRD/原型）**
- PRD 与 SystemSettings 中已经提供 `pipeline.business_rules` 配置项用于控制公海掉落、预警与风险阈值，但仪表盘“风险线索”卡片与线索看板仍然使用固定的 3 天/7 天规则，导致当你修改阈值配置后界面指标与实际期望严重不符；
- 将所有风险相关的前端计算统一挂靠在同一套业务规则上，可以避免“改了配置但 UI 还是旧逻辑”的隐性 Bug，也便于后续只通过调整配置来收紧或放宽风险判断标准。

**影响范围**
- UI / 统计口径：
  - 仪表盘“风险线索”卡片数值将随 `danger_hours` 配置变化而变化，统计范围始终限定为当前非公海且状态为 open 的线索；
  - 线索看板上“风险/需跟进”小标记与顶部风险提醒横幅的数量会随预警/风险阈值调整，项级标识与整体提示保持一致；
  - 对未配置或无读取权限的账号，行为与之前保持一致（3 天预警、7 天风险）。
- DB / RLS：
  - 仅新增对 `public.settings` 中 `pipeline.business_rules` 的读取，不修改任何表结构、RLS 策略或 RPC 定义，仍然依赖现有 `settings.read` 权限控制。 

**回滚方式**
- 如需恢复为固定 3 天/7 天逻辑，可在后续提交中：
  - 将 `fetchDashboardSummary` 中关于 `pipeline.business_rules` 的读取与 `danger_hours` 应用逻辑移除或注释，直接回退到基于 `diffDays >= 7` 的判断；
  - 将 `components/lead-kanban.tsx` 中风险配置相关的 Supabase 调用与小时级计算去除，重新使用 `lead.lastInteraction` 的 3 天/7 天硬编码阈值；

### roles-rename-system-allowed: 系统角色名称支持自定义


**变更点**
- 更新 `components/system-settings.tsx`：
  - 在“编辑角色权限”侧边栏中，移除了对系统角色（`isSystem=true`）的名称输入框禁用逻辑，允许修改 `roles.name` 作为显示名称，仅保留“系统”徽标用于标识其为预置角色。
- 保持 `roles` 表结构与权限矩阵逻辑不变，本次仅放开对 `name` 字段的 UI 编辑能力：
  - 仍通过 `handleSaveRole` 中的 Supabase 更新语句 `update { name: editingRole.name } where id = ...` 将更名写回数据库；
  - 不新增/修改任何与 `role_permissions`、`user_permissions` 或 RLS 相关的逻辑。

**变更原因（对应 PRD/原型）**
- 产品要求“角色名称可以按销售团队习惯自定义”，而当前实现中对于 Admin/Manager/Sales/SuperAdmin 这类系统预置角色，将名称输入框灰显禁用，导致你无法在 UI 中把它们改成“销售代表/销售主管/销售运营”等更贴近业务的叫法。
- 鉴于后端使用的是 `roles.id` 和权限矩阵中的 `permission_key`/`scope_type` 作为真正的安全与逻辑依据，`roles.name` 仅作为展示文案，因此放开对名称的编辑不会破坏安全边界和权限语义。

**影响范围（略）**
- ...
