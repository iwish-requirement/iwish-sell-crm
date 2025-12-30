# AI 变更记录（自动维护）

> 本文件用于记录 AI 助手在本仓库内做出的重要结构/逻辑变更，方便你审计、回顾与回滚。
> 按时间倒序追加；同一天多次修改可在同一日期下追加小节。

## 2025-12-30

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
