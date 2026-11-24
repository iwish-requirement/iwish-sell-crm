# CRM 运营对接第二批

CRM 确认分配后，在同一个数据库事务中按承接部门更新交接快照。定时任务向运营收单接口发送快照并保存运营工单号。回执丢失、超时、HTTP 429 和 5xx 会以相同交接 ID、版本及报文重试。重试间隔从 1 分钟开始翻倍，最多尝试 5 次。可用受保护的任务接口手动重试已失败的交接。部门服务范围发生变化时更新原工单，先前范围的人员回传返回 409。财务补录后沿用原工单和当前范围的人员名单。 [双向接口契约](https://github.com/iwish-requirement/iwish-sell-crm/tree/codex/operations-handoff-api)

分配中心显示各部门的收单、重试和人员确认状态。分配中心与成交中心的合同资料中都能看到运营工单号、项目负责人和按服务划分的人员。详情打开后按需刷新，失败时保留上一次成功读取结果。销售人员继续使用原有资料权限。运营名单以运营系统为准。

## 本地预览

运行 `node tests/local/operations-phase-two.mjs` 后访问 [成交中心](http://127.0.0.1:4185/deals)、[分配中心](http://127.0.0.1:4185/allocations)和[模拟运营](http://127.0.0.1:4185/operations)。预览使用正式 CRM 组件和路由处理逻辑、PGlite 演示数据库及协议格式的模拟运营入口。PGlite 可通过 `CRM_PGLITE_MODULE` 指定本地安装的模块入口。预览进程的数据库、凭据和附件都是一次性的。

在成交中心确认预填的演示合同，进入分配中心为 Google 和 Meta 选择承接部门并保存。第一次发送模拟回执丢失，预览约 5 秒后自动重试。运营页可以确认演示人员及换人，两个 CRM 详情均回显。追加 `--verify` 运行 Chromium 和数据库自动验收。

## 联调与回退

正式环境开启前须完成双方测试地址、部门和服务 ID、附件授权及字段范围的确认。附件目前按契约传递引用与名称，联调时确认运营授权读取方式。运营工单号需长期稳定，双方分别管理交接内容版本与人员版本。若人员回传早于收单回执，CRM 返回 `HANDOFF_RECEIPT_PENDING` 和 HTTP 409，运营待 CRM 记录回执后原样补发。

v1.1.0 交接快照使用当前 CRM 的有效公司名称规则，按需发送大陆公司、香港公司、合同币种及明确的暂无附件标记。财务正式签署主体和已到账信息分别更新原工单，实际到账币种由财务数据提供。旧表财务值仅在 CRM 查看，历史成交正式财务确认另行接通。正式开启前先核对重复合同与待发范围。

部署阶段的配置包括以下内容。

- `CRM_OPERATIONS_ENABLED=true` 开启服务端路由。数据库 `crm_allocation.operations_release.enabled` 按环境独立开启。新迁移默认关闭，已有分配不会批量入队。
- `CRM_OPERATIONS_BASE_URL` 配置运营系统 HTTPS 地址。 `CRM_OPERATIONS_INTAKE_TOKEN` 用于 CRM 发起送单，`CRM_OPERATIONS_CALLBACK_TOKEN` 用于接收人员回传，`CRM_OPERATIONS_JOB_TOKEN` 用于调用调度接口。
- 环境调度器每分钟用专用 Bearer 凭据调用 `POST /api/jobs/operations-handoffs`。按需检查失败原因后调用 `POST /api/jobs/operations-handoffs?retry=<handoff-id>`。联调完成和试单通过后再配置生产调度。
- 单独回退第二批时停止调度，将服务端开关关掉，并执行 [数据库回退](../supabase/rollbacks/crm_operations_phase_two.sql)。队列、回执和人员记录保留，第一批的合同确认及部门分配流程继续使用。暂停期间对已入队交接的改派会记录最新快照，恢复前先核对待发范围。
