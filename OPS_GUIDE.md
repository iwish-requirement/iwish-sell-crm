## Iwish 运维与上线说明（草案）

> 面向对象：系统管理员 / 运维 / 销售运营负责人
> 目标：在不依赖个人经验的前提下，安全、稳定地上线和维护 Iwish 销售 CRM。

---

### 1. 环境与发布流程

**推荐环境划分：**
- **开发环境（dev）**：开发者本地 + 共享 Supabase dev 实例，用于日常开发调试。
- **测试/预发环境（staging）**：与生产配置一致，用于跑自动化测试和业务验收。
- **生产环境（prod）**：正式对销售团队开放的环境。

**代码与数据库发布建议：**
- 所有结构/RLS/RPC/Seed 改动必须通过 `supabase/migrations/` 管理；
- 发布顺序：
  1. 在本地或 CI 上执行：`supabase db push` 或对应迁移命令，确保迁移文件无语法问题；
  2. 在 **staging** 上执行迁移，并手动做一次完整自测（认证、线索、公海、分析、设置、审计）；
  3. 在 **prod** 上执行迁移后，立刻跑一遍 e2e 核心用例（见下文 Playwright 部分）。

---

### 2. 关键数据表与安全边界

**核心业务表：**
- `profiles` / `profiles_public`：用户资料表（含团队、角色、状态）与公开下拉用表；
- `leads` / `leads_secure_view`：线索原表与安全视图（所有前端读取线索必须经由视图）；
- `lead_notes`：跟进记录；
- `lead_import_jobs` / `lead_export_jobs`：导入/导出任务；
- `roles` / `permissions` / `role_permissions` / `user_permissions`：角色与权限矩阵；
- `field_policies` / `custom_scope_sets`：字段级策略与自定义范围；
- `audit_logs`：所有敏感动作的审计记录。

**安全原则：**
- 所有线索读取必须来自 `public.leads_secure_view`，不要直接对 `leads` 做 `select`；
- 所有关键写操作（创建/更新/分配/转移/关闭/退回公海、审批/禁用账号、权限调整）必须通过 `rpc_*` 函数执行；
- RLS 决定“能否看到/写入某行”，前端的按钮/入口只作为体验控制，不能作为安全边界。

---

### 3. 导入 / 导出 / 公海自动回收运维

#### 3.1 线索导入（Import）

**业务入口：**
- 前端在 `公海池` 页的导入弹窗中，上传 CSV 文件，经过预检查后提交导入任务。

**数据落点：**
- 导入任务记录在 `public.lead_import_jobs` 表；
- 每条创建的线索实际写入 `public.leads`，通过 RPC（如 `rpc_lead_create`）完成；
- 关键操作会写入 `audit_logs`，包括导入请求和批量创建行为。

**排查步骤：**
- 用户反馈“导入失败/没有数据”时：
  1. 在前端（如有）或直接查询 `lead_import_jobs` 按 `created_by` 和时间排序，查看最近任务的 `status` 和 `error_message`；
  2. 在 `audit_logs` 中按 `actor_id` + 时间范围过滤，查看是否出现导入相关动作；
  3. 若任务记录不存在，多半是权限或网络问题，检查该账号是否具备 `leads.import` / `leads.create` 权限。

#### 3.2 线索导出（Export）

**类型：**
- 公海导出：公海池页的导出按钮；
- 报表导出：数据分析页各图表的“导出 → 下载 CSV”。

**后台行为：**
- 前端在导出时会调用 `public.rpc_leads_export_request(source, format, filters)`：
  - `source` 标记导出来源（如 `public_pool`、`analytics_funnel` 等）；
  - `format` 一般为 `csv`；
  - `filters` 包含时间范围、scope、团队等信息；
  - 函数内部会校验 `leads.export` 权限，并写入 `lead_export_jobs` 与 `audit_logs`（action=`request_leads_export`）。

**排查步骤：**
- 用户反馈“点了导出没反应”：
  1. 在 `audit_logs` 中按账号和时间过滤 `action = 'request_leads_export'`：
     - 若没有记录，多半是 `leads.export` 权限缺失或 RPC 调用失败；
     - 若有记录，再看 `lead_export_jobs` 中对应任务的 `status` 与 `error_message`。
  2. 若后端一切正常但浏览器没有下载文件，检查浏览器下载策略或前端控制台错误。

#### 3.3 公海自动回收

**行为说明：**
- 按 PRD 定义，长时间未跟进或触发特定业务规则的线索会自动 `status='pool'` 并退回公海池；
- 对应的动作会写入 `audit_logs`，动作一般为 `return_lead_to_pool`。

**排查步骤：**
- 销售反馈“线索突然不见了”：
  1. 在 `audit_logs` 中按 `target_type='lead'` + 线索 ID 查询最近记录；
  2. 判断是手动退回（`actor_id` 为某个销售/经理）还是自动回收；
  3. 按需要调整自动回收策略或给出业务解释。

---

### 4. 权限与审计运维

#### 4.1 权限调整入口

- 统一在前端的 `系统设置 → 角色权限` 中进行：
  - 角色数据范围：`self / team / org / custom`，影响 `leads.read` 等；
  - 敏感字段权限：`leads.fields.read_sensitive` / `leads.fields.write_sensitive`；
  - 公海权限：`leads.pool.return`；
  - 导入/导出：`leads.import` / `leads.export` / `reports.export`；
  - 审计访问：`audit.read`。

#### 4.2 审计日志使用

- 审计日志统一在 `audit_logs` 中保存，也可以通过前端“审计”页面查看：
  - 用户审批/驳回/禁用/恢复；
  - 角色和权限矩阵调整；
  - 字段策略与自定义范围变更；
  - 线索创建/更新/分配/退回公海/关闭/导入/导出。

**排查范式：**
- 现象：“某人突然看不到某些数据了” → 优先查权限和 scope：
  1. 在 SystemSettings 确认其角色配置与用户覆盖权限；
  2. 在 `audit_logs` 中看是否有近期权限调整记录；
  3. 必要时复盘 RLS 策略，确保没有误改。

- 现象：“某条线索信息被错误修改或删除” → 优先查审计：
  1. 在 `audit_logs` 中按 `target_type='lead'` + 线索 ID 查询；
  2. 看是哪位用户、在什么时间，以什么 RPC 做了修改；
  3. 如属误操作，通过业务流程或数据回滚策略处理。

---

### 5. 常见故障排查清单

**登录/Onboarding 相关：**
- 无法登录或总是被重定向到 Onboarding：
  - 检查 `profiles.status` 是否为 `pending/disabled/rejected`；
  - 在 SystemSettings 的“组织架构 → 待审核”里确认审批是否完成；
  - 如为 `disabled`，确认禁用原因并按需要恢复账号。

**数据范围与可见性：**
- 用户看不到某些线索/公海/报表数据：
  1. 检查其角色的 `scope_type`（self/team/org/custom）；
  2. 检查是否有用户级覆盖权限（user_permissions）；
  3. 确认其团队归属是否正确（profiles.team_id）。

**导入/导出问题：**
- 导入失败或数据不完整：
  - 看 `lead_import_jobs` 状态 + `audit_logs` 中的导入动作；
  - 检查模板格式和必填字段（公司/联系人/电话等）。
- 导出没反应：
  - 看 `audit_logs` 中是否存在 `request_leads_export`；
  - 检查是否开通 `leads.export` / `reports.export` 权限；
  - 检查浏览器下载设置。

---

### 6. Playwright e2e 测试使用说明

**安装依赖：**（仓库里已安装）
- 确保在项目根目录执行过：
  - `npm install`
  - `npx playwright install`

**重要环境变量：**
- 在本地或 CI 中，配置以下变量以便 e2e 登录：
  - `PW_ADMIN_EMAIL` / `PW_ADMIN_PASSWORD`：具有审批权限的管理员账号；
  - `PW_SALES_EMAIL` / `PW_SALES_PASSWORD`：普通销售账号；
  - `PW_MANAGER_EMAIL` / `PW_MANAGER_PASSWORD`：具有公海与报表导出权限的管理账号。

**运行测试：**
- 启动应用并运行所有 e2e 用例：
  - `npm run test:e2e`
- 带界面的调试模式：
  - `npm run test:e2e:headed`

**推荐上线前检查：**
- 在 staging 和 prod 迁移后，至少跑一遍：
  - 注册+审批+登录用例；
  - 线索生命周期用例；
  - 公海与导出用例。

> 只要严格遵守以上发布和排查流程，这套系统在日常使用和后续迭代中都能保持“可控、可追踪、可回滚”，不会因为某个隐蔽的权限或导出问题而在生产环境里“突然翻车”。
