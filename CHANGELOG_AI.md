# AI 变更记录（自动维护）

> 本文件用于记录 AI 助手在本仓库内做出的重要结构/逻辑变更，方便你审计、回顾与回滚。
> 按时间倒序追加；同一天多次修改可在同一日期下追加小节。

## 2025-12-31

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

## 2025-12-30


### leads-lifecycle-stage-limits: 线索生命周期阶段约束与推进规则

**变更点**
- 新增 `supabase/migrations/025_lead_stage_lifecycle.sql`：
  - 将历史数据中 `stage = 'new'` 的线索统一迁移为 `L1`，与当前前端默认阶段保持一致，避免旧数据游离在标准生命周期之外；
  - 为 `public.leads.stage` 增加 `leads_stage_valid` 校验约束，仅允许 `L1/L2/L3/L4/Won` 五个阶段值，并将默认值设置为 `L1`，将生命周期“写死”在数据库层；
  - 重新定义 `iwish.rpc_lead_update(uuid, jsonb, text)` 与 `public.rpc_lead_update` 包装：
    - 在更新前对阶段变更做校验，禁止在通用更新 RPC 中对已关闭线索修改阶段；
    - 建立简单的阶段顺序（L1→L2→L3→L4→Won），只允许“向前”推进，禁止任何形式的降级（否则抛出 `ERR_INVALID_STAGE_TRANSITION:cannot_downgrade`）；
    - 若检测到阶段从低阶推进到高阶，则强制要求 `p_reason` 非空（否则抛出 `ERR_VALIDATION:stage_reason_required`），确保每次升级都有审计理由；
    - 保留并复用原有字段级权限校验（敏感字段、内部字段）与“退回公海”专有权限 `leads.pool.return` 的逻辑。
  - 重新定义 `iwish.rpc_lead_close(uuid, text, text)`：
    - 仍然要求 `p_result` 只能为 `won/lost`，并通过 `leads.close` 权限与 `iwish.in_scope_for_lead` 进行范围校验；
    - 在关闭线索时，将 `status` 置为 `closed`，并在 `p_result = 'won'` 时自动将 `stage` 更新为 `Won`，使已成交线索在生命周期与看板上落到“成交”阶段，而丢单线索保留原阶段便于复盘；
    - 所有关闭操作继续写入 `audit_logs`，包含前后镜像与关闭原因。

**变更原因（对应 PRD/原型）**
- PRD 要求线索生命周期采用标准化阶段（L1 询盘 → L2 意向 → L3 关键意向 → L4 谈判 → 成交），且阶段推进必须“有凭有据”，不可随意来回拖动；
- 现有实现中 `stage` 为自由文本，既可以降级也缺少后端级约束，前端看板虽然有 L1–L4+成交 UI，但无法防止绕过 UI 的错误写入或脚本修改；
- 通过在 DB 层限制合法阶段集合、在 RPC 中禁止降级并强制记录升级原因，同时在成交时自动把阶段落到 `Won`，可以让生命周期成为一个可审计、可依赖的“骨架”，为后续在设置页配置“阶段必填字段规则”和在报表中做 L1→L4→成交漏斗分析提供可靠基础。

**影响范围**
- DB / RLS / RPC：
  - `public.leads.stage` 现在受 `leads_stage_valid` 约束，任何直接 SQL 或 RPC 试图写入非 L1–L4/Won 的阶段值都会失败，避免出现非标准状态；
  - `iwish.rpc_lead_update` 与 `iwish.rpc_lead_close` 的调用签名保持不变（前者仍为 `(uuid, jsonb, text)`，后者为 `(uuid, text, text)`），但在阶段相关更新时会多抛出几类业务错误码（例如阶段无效、禁止降级、缺少推进原因）；
  - 不修改现有 RLS 与权限点集合，只在现有权限体系之上增强了生命周期的状态机和审计约束。
- 前端 / 业务体验：
  - `components/lead-kanban.tsx` 中“推进阶段”按钮本身已经要求用户填写推进原因，并通过 `p_reason` 传给 `rpc_lead_update`，与本次后端约束天然兼容；
  - 成交/丢单操作继续通过 `rpc_lead_close` 完成，但成交后该线索会自动进入“成交”列，并从风险提醒统计中排除，更贴近销售看板的直觉；
  - 若后续有脚本或后台工具试图对 closed 线索重新调整阶段，将被数据库拒绝，避免生命周期被静默篡改。

**回滚方式**
- 如需回滚生命周期约束，可在新的迁移中：
  - 执行 `alter table public.leads drop constraint if exists leads_stage_valid;` 取消阶段合法值校验，并视需要将默认值改回 `new` 或其他值；
  - 使用 `create or replace function` 将 `iwish.rpc_lead_update` 与 `iwish.rpc_lead_close` 恢复为本次修改前的定义（可从 Git 历史或 004/017/023 迁移文件中还原）；
  - 如不再需要 `Won` 阶段，也可以配合前端调整，从看板阶段配置中移除对应列。

### leads-structured-fields: 线索结构化字段（客户级别、来源分层、标签）

### leads-grade-and-source-settings: 客户级别与来源渠道配置默认种子


**变更点**
- 新增 `supabase/migrations/024_leads_grade_and_source_settings.sql`：
  - 向 `public.settings` 中插入 `leads.grade_definitions` 配置项（仅在不存在时插入），包含 S/A/B/C 四个客户级别的 `key/label/description`，分别描述“强成交 / 立即跟进、重点培育 / 近期可成交、普通意向 / 需持续教育、低优先级 / 长期培育”的业务含义；
  - 向 `public.settings` 中插入 `leads.source_tree` 配置项（仅在不存在时插入），以树形 JSON 形式预置一级渠道（广告投放、内容与私域、线下活动、官网与表单、渠道合作/代理商、老客与转介绍、内部线索）及其二级子项（如抖音广告、视频号广告、展会、官网表单等），用于前端线索录入时提供标准的来源分层选项。

**变更原因（对应 PRD/原型）**
- PRD 要求客户级别 S/A/B/C 与来源渠道枚举都应“可配置”，而不是写死在代码里，以便随着业务发展调整各级别说明和渠道列表；
- 现有系统中尚未存在这两类配置项，导致线索分层和来源统计只能依赖自由文本或硬编码判断，不利于后续按级别/来源维度做意向分层、保护策略和 ROI 分析；
- 通过在 `settings` 中预置这两类配置，后续只需在 SystemSettings 中提供编辑 UI，即可让你或上级在不改代码的情况下，灵活调整客户级别文案与渠道树结构。

**影响范围**
- DB / 配置：
  - 仅向 `public.settings` 表插入两条新配置记录，使用 `on conflict (key) do nothing` 保证不会覆盖你手动调整后的配置；
  - 触发 `iwish.audit_settings_change` 审计函数，在 `audit_logs` 中记录新增配置，满足“设置变更必须可追溯”的要求。
- UI / 业务逻辑：
  - 当前前端尚未读取 `leads.grade_definitions` 和 `leads.source_tree`，所有现有页面与接口行为保持不变；
  - 为后续在 SystemSettings 中增加“客户级别配置”和“来源渠道配置”入口、以及在线索表单中用下拉选择替代自由文本输入提供了数据基础。

**回滚方式**
- 如需回滚，可在后续迁移中执行 `delete from public.settings where key in ('leads.grade_definitions','leads.source_tree');` 删除这两条配置记录，并视需要删除 `024_leads_grade_and_source_settings.sql` 迁移文件或在数据库层手动清理；
- 回滚后，线索结构字段 `customer_grade/source_level1/source_level2` 仍然存在，但前端若开始依赖这些配置项，需要对应恢复或改为使用本地枚举。


**变更点**
- 新增 `supabase/migrations/023_leads_structured_fields.sql`：
  - 为 `public.leads` 增加 `customer_grade text`（S/A/B/C 客户级别）、`source_level1 text`（一级来源渠道）、`source_level2 text`（二级活动/行业/合作方）以及 `tags text[]`（标签数组，默认空数组），用于支撑后续的客户分层、来源分层与多标签管理；
  - 基于现有实现重新定义 `public.leads_secure_view`，在保持电话/邮箱/地址/预算脱敏逻辑不变的前提下，追加暴露 `customer_grade/source_level1/source_level2/tags` 字段，避免影响依赖旧列顺序的客户端；
  - 基于 `017_lead_stage_reason_audit.sql` 的版本重写 `iwish.rpc_lead_update`，在保留退回公海专有权限与 `p_reason` 审计原因的基础上，支持通过 `patch` 更新上述新字段（含 tags 数组），并保证仍然走同一套权限与审计流程。

**变更原因（对应 PRD/原型）**
- 上级在 PRD 中强调需要按“客户级别 S/A/B/C + 标签 + 来源渠道（一级/二级）”进行结构化管理，以支撑后续按级别、渠道、责任人维度的意向分层、转化率与 ROI 分析；
- 现有实现仅有单一 `source` 文本字段与少量基础信息，无法直接表达来源层级、客户分级与多标签，导致在报表和业务规则（比如不同等级不同保护期）上需要大量硬编码判断，不利于后续扩展；
- 通过在 DB 层添加结构化字段并在 secure view 中统一暴露，为之后在前端表单/看板/报表中逐步接入这些字段、以及在 RLS/RPC 中基于来源/级别做更精细控制打下基础。

**影响范围**
- DB / RLS / 视图：
  - `public.leads` 表结构向后兼容扩展，旧数据的 `customer_grade/source_level* /tags` 默认为 null/空数组，不影响现有查询与统计；
  - `public.leads_secure_view` 列表尾部新增 4 个字段，保持敏感字段脱敏策略与现有 RLS 策略不变，所有前端仍通过视图访问线索数据，不会绕开字段级控制；
- RPC：
  - `iwish.rpc_lead_update` 的签名保持为 `(uuid, jsonb, text)`，所有已有调用方无需修改；
  - 新增只是在 update 语句中允许通过 `patch` 写入 `customer_grade/source_level1/source_level2/tags`，且继续复用原有的权限校验与审计逻辑。

**回滚方式**
- DB：
  - 如需彻底回滚，可在后续迁移中执行 `alter table public.leads drop column customer_grade, drop column source_level1, drop column source_level2, drop column tags;`，并重新创建 `public.leads_secure_view` 与 `iwish.rpc_lead_update` 为 017 之前的定义；
  - 或直接通过 Git 回滚 `023_leads_structured_fields.sql` 并重新运行迁移，使数据库恢复到本次变更前的结构。

### roles-role-type-and-recommended-templates: 角色类型字段与推荐权限模板


**变更点**
- 新增 `supabase/migrations/022_roles_role_type_and_templates.sql`：
  - 定义枚举类型 `role_type_enum`，包含 `sales_rep`（销售顾问/一线销售）、`sales_manager`（销售经理/主管）、`marketing`（市场角色）、`biz_owner`（业务负责人/总经理）、`tech_maintainer`（技术维护/系统维护）、`other`（其他）。
  - 为 `public.roles` 表增加非空字段 `role_type role_type_enum NOT NULL DEFAULT 'other'`，不影响既有数据；
  - 根据中文名称做一次启发式归类，将名称中包含“销售经理/主管/总监”的角色标记为 `sales_manager`，包含“销售顾问/销售/BD/商务”的标记为 `sales_rep`，包含“市场/投放/运营”的标记为 `marketing`，包含“总经理/负责人/老板/合伙人”的标记为 `biz_owner`，包含“技术维护/系统管理/运维”的标记为 `tech_maintainer`，其余保持为 `other`，后续可在前端手动调整。
- 更新 `components/system-settings.tsx` 权限 Tab：
  - 在 `Role` 类型中新增 `roleType` 字段（与 `role_type_enum` 对应），加载角色列表时从 Supabase 选择并映射 `role_type`，新建角色默认类型为 `sales_rep`；
  - 在“编辑角色权限”侧边栏的“基本信息”区域新增“角色类型”下拉框，可在销售顾问/销售经理/市场/业务负责人/技术维护/其他之间切换，保存时若名称或类型发生变化，会通过 `update public.roles set name=..., role_type=... where id=...` 落库；
  - 定义 `RECOMMENDED_ROLE_TEMPLATES` 常量，为不同 `roleType` 提供一份推荐的数据范围（DataScope）与权限开关组合（基于现有 `RolePermissionFlags`），例如：销售顾问默认仅本人数据 + 不导出/不分配/可退回公海，销售经理默认团队数据 + 可分配/可退回公海/可看报表等；
  - 打开角色编辑时，根据当前 `roleType` 与推荐模板计算出“数据范围 + 权限开关”与模板的差异数量，在“业务 & 管理操作权限”区域展示 Badge 提示（“当前配置与推荐模板一致”或“与推荐模板有 N 项差异”）；
  - 在权限矩阵标题下增加“应用推荐配置”按钮，点击后会根据当前 `roleType` 将推荐的数据范围与权限开关一键写入 `editingRole`，并重新计算差异计数，便于你在模板基础上做少量增删。

**变更原因（对应 PRD/原型）**
- 上级需求中对“销售顾问/销售经理/市场/业务负责人与技术维护”等角色的责任边界有较清晰的默认划分，但同时希望将来可以根据团队发展自由调整每个角色实际拥有哪些权限；
- 原有实现只提供了通用的权限开关矩阵，没有角色类型与推荐模板的概念，导致：
  - 新增或调整角色时缺乏一个清晰的“官方建议 baseline”，你需要记住每个权限点的含义然后从零勾选；
  - 角色边界更多体现在“能不能点某个按钮”，而不是“这个角色一般负责哪段业务链路 + 默认可以做什么”，产品感较弱。
- 通过为 `roles` 引入 `role_type` 并在前端叠加推荐模板与差异提示，可以：
  - 明确表达“这个角色大致是哪一类（销售顾问/经理/市场/业务负责人/技术维护）”；
  - 让你在创建/编辑角色时快速一键套用产品级的“推荐边界”，再按个别需求细调开关；
  - 保持完全的可配置性——实际生效的权限仍然只由权限矩阵 + RLS 决定，角色名称和类型不会改变安全语义。

**影响范围**
- DB / RLS / RPC：
  - 新增枚举类型 `role_type_enum` 与 `roles.role_type` 字段，不改变现有 RLS 策略与权限校验，`iwish.has_permission` 及相关 RPC 逻辑保持不变；
  - 通过一次性 `UPDATE public.roles ...` 语句对现有数据做启发式初始归类，仅影响展示与前端加载，不改变任何 `role_permissions`/`user_permissions` 记录；
  - 新建或编辑角色时额外更新 `role_type` 字段，不引入新的表或 RPC。
- UI：
  - SystemSettings → 角色权限页中，角色列表与编辑抽屉现在都包含“角色类型”的概念，帮助你和上级快速确认“这个角色大致扮演什么职责”；
  - 编辑角色时可以看到与推荐模板的差异数量，以及一键应用推荐配置的按钮，使“产品级”的默认边界与“业务侧的灵活调整”同时存在；
  - 对已有角色，不修改其当前实际权限，只是在你打开编辑时展示其 `roleType`（若未匹配则为 “其他”）和与模板的差异提示，方便逐步按推荐模型收敛。

**回滚方式**
- DB：
  - 如需回滚，可在数据库中执行 `ALTER TABLE public.roles DROP COLUMN role_type;` 并按需删除 `role_type_enum` 类型（前提是没有其他对象依赖），同时删除本次新增的迁移文件或在后续迁移中显式回退。
- UI：
  - 可在 `components/system-settings.tsx` 中移除与 `roleType` 相关的类型字段、下拉框、`RECOMMENDED_ROLE_TEMPLATES` 常量及差异计算逻辑，将角色编辑恢复为仅基于数据范围与权限开关的简单矩阵；
  - 如仅想暂时隐藏推荐模板功能，可保留 `role_type` 字段与后端结构，仅注释掉“角色类型”下拉和“应用推荐配置”按钮，让现有角色继续按当前权限运行。

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
...
