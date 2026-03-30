# AI 变更记录（自动维护）

> 本文件用于记录 AI 助手在本仓库内做出的重要结构/逻辑变更，方便你审计、回顾与回滚。
> 按时间倒序追加；同一天多次修改可在同一日期下追加小节。

## 2026-03-20

### public-pool-ai-import-timeout-hardening: 公海池导入 AI 超时治理与链路收敛

**变更点**
- 更新 [app/api/ai/import-mapping/route.ts](/e:/iwish-sell-crm/app/api/ai/import-mapping/route.ts)：
  - 将默认 `max_tokens` 从 `800` 下调为 `400`，减少模型生成体积。
  - 将服务端 AI 请求默认超时从 `30000ms` 提升到 `55000ms`。
  - 将送给 AI 的样本行数从 `25` 行缩减到 `8` 行，预览行数从 `12` 行缩减到 `6` 行，降低 prompt 长度与上游耗时。
- 更新 [components/public-pool.tsx](/e:/iwish-sell-crm/components/public-pool.tsx)：
  - 将前端等待 `/api/ai/import-mapping` 的超时从 `40000ms` 提升到 `65000ms`，与后端超时策略更一致，减少前端过早中断。
- 更新 [supabase/functions/ai-import-mapping-proxy/index.ts](/e:/iwish-sell-crm/supabase/functions/ai-import-mapping-proxy/index.ts)：
  - 将 Supabase Edge Function 默认上游超时从 `25000ms` 提升到 `55000ms`，避免真实导入 prompt 在上游未返回前被代理层提前切断。

**变更原因**
- 实测公海池导入在上传文件后会稳定命中 AI 调用失败；排查链路后确认不是文件解析问题，而是 `Cloudflare/Next -> Supabase Edge Function -> SiliconFlow` 在真实导入映射 prompt 下容易超过原来的 `25s/30s/40s` 多层超时阈值，最终前端统一回退到“AI 调用失败”。

**影响范围**
- 导入 AI 识别的成功率会明显依赖新的超时与 prompt 尺寸控制；功能协议不变，仍返回 `columnMapping/normalizedRows/fieldConfidence/overallConfidence/warnings/summary`。
- 部署时建议同时在 Supabase Edge Function Secret 中配置 `SILICONFLOW_TIMEOUT_MS=55000`，以便与代码默认值保持一致。

**回滚方式**
- 如需回滚，可将以上 3 处超时与采样参数恢复到原值：`25000ms / 30000ms / 40000ms` 与 `25/12` 行采样策略。

### public-pool-ai-import-via-supabase-edge-function-siliconflow: 公海导入 AI 统一走 Supabase Edge Function 并切换硅基流动上游

**变更点**
- 更新 Supabase Edge Function `ai-import-mapping-proxy`（`supabase/functions/ai-import-mapping-proxy/index.ts`）：
  - 将默认上游地址从 `https://openrouter.ai/api/v1/chat/completions` 调整为硅基流动 Chat Completions 入口 `https://cloud.siliconflow.cn/inference/v1/chat/completions`，并优先读取 `SILICONFLOW_API_URL`/`KIE_API_URL` 作为可配置覆盖。
  - 调整 API Key 读取优先级为 `SILICONFLOW_API_KEY` → `KIE_API_KEY` → `OPENROUTER_API_KEY`，缺失时返回 `missing_api_key` 并在 Supabase 日志中输出详细错误。
  - 在请求头中同时携带 `Authorization: Bearer <SILICONFLOW_API_KEY>` 与 `X-API-Key`，对齐硅基流动推荐用法，保持与 OpenAI 兼容的 JSON 请求/响应协议。
- 更新 `/api/ai/import-mapping` 路由实现（`app/api/ai/import-mapping/route.ts`）：
  - 将默认直连上游地址从 OpenRouter Chat Completions 切换为硅基流动 Chat Completions，同样支持通过 `SILICONFLOW_API_URL` 覆盖，但在存在 Supabase URL 时仍优先走 Edge Function 代理。
  - 将默认模型常量改为可配置形式：`DEFAULT_KIE_MODEL = (process.env.SILICONFLOW_MODEL ?? "Pro/deepseek-ai/DeepSeek-V3.2").trim()`，默认使用 DeepSeek V3.2 模型，仍可在部署环境中按硅基流动控制台实际提供的其他模型 ID 进行切换，而不用改代码。
  - 清理与特定厂商绑定的日志文案（如 `OpenRouter chat completion call failed`/`SiliconFlow response is not valid JSON`），统一改为中性描述 `AI chat completion call failed`/`AI provider response is not valid JSON`，避免后续更换上游时误导排查。

**变更原因（对应 PRD/原型）**
- 你希望导入 AI 功能在不增加架构复杂度的前提下，从 OpenRouter 切换到硅基流动提供的大模型能力，以获得更稳定的国内网络、成本和可观测性，同时沿用现有的“AI 生成 JSON 字段映射 + 行级标准化预览”逻辑。
- 现有实现已经通过 Supabase Edge Function 集中出网，本次调整只需更换上游地址与 Key/模型配置，便于今后根据业务需要在硅基流动侧切换 DeepSeek/Qwen 等不同主模型，而不会影响前端协议与导入链路。

**影响范围**
- AI 接口：`/api/ai/import-mapping` 的请求/响应结构保持不变（`columnMapping/normalizedRows/fieldConfidence/overallConfidence/warnings/summary`），仅内部 LLM 调用链路变更为 `Cloudflare → Supabase Edge Function → SiliconFlow Chat Completions`；在未配置 `SILICONFLOW_API_KEY` 时接口会返回 `missing_api_key` 并提示需要配置上游 Key。
- 运维与配置：
  - Supabase 项目环境需要新增或调整 Edge Function Secret：`SILICONFLOW_API_KEY`（必填）以及可选的 `SILICONFLOW_API_URL`（如需自定义域名）和 `KIE_API_KEY`/`OPENROUTER_API_KEY` 作为后备；
  - Cloudflare/Next 部署环境可选配置 `SILICONFLOW_MODEL`，用于控制默认使用的硅基流动模型（例如 `qwen3.5-chat` 或具体 DeepSeek 模型 ID），未配置时会回退到文档示例模型；
  - 现有依赖 OpenRouter 的环境变量不会立即失效，但推荐在完成切换后逐步下线以避免混淆。

**回滚方式**
- 如需回滚到 OpenRouter：
  - 在 `supabase/functions/ai-import-mapping-proxy/index.ts` 中将 `DEFAULT_KIE_API_URL` 改回 `https://openrouter.ai/api/v1/chat/completions`，并调整 `getKieApiKey` 优先级为 `OPENROUTER_API_KEY` → `SILICONFLOW_API_KEY` → `KIE_API_KEY`。
  - 在 `app/api/ai/import-mapping/route.ts` 中将 `DEFAULT_KIE_API_URL` 与 `DEFAULT_KIE_MODEL` 恢复为原有 OpenRouter 配置（例如 `https://openrouter.ai/api/v1/chat/completions` + `openai/gpt-5.4`），同时根据需要恢复旧的日志文案。
  - 在 Supabase/Cloudflare 部署环境中重新配置 `OPENROUTER_API_KEY` 并移除或停用 `SILICONFLOW_API_KEY/SILICONFLOW_MODEL` 等与硅基流动相关的变量。

## 2026-03-20

### public-pool-ai-import-via-supabase-edge-function: 公海导入 AI 调用集中到 Supabase Edge Function

**变更点**
- 新增 Supabase Edge Function `ai-import-mapping-proxy`（`supabase/functions/ai-import-mapping-proxy/index.ts`），负责在 Supabase 侧以 OpenRouter Chat Completions 协议代理调用第三方大模型，并在函数日志中输出上游状态码与错误信息。
- 更新 `app/api/ai/import-mapping/route.ts`：不再直接从 Cloudflare Edge 访问 OpenRouter，而是将原本构造的 `model + messages + response_format` 请求转发到 `https://<project>.functions.supabase.co/ai-import-mapping-proxy`，由 Supabase 统一出网；原有字段置信度/标准化预览等处理逻辑保持不变。

**变更原因（对应 PRD/原型）**
- 你反馈在 Cloudflare 免费版环境下 AI 导入经常出现 502 且缺乏可用日志，导致定位是“网络问题 / Key 问题 / 上游模型问题”非常困难；本次将 AI 调用集中到 Supabase Edge Functions，利用 Supabase 的函数日志能力提升可观测性，并把 Cloudflare 仅作为 UI + 轻量代理。

**影响范围**
- AI 接口：`/api/ai/import-mapping` 在接口协议和返回结构上对前端保持兼容（仍然返回 `ok/columnMapping/normalizedRows/fieldConfidence/overallConfidence/warnings/summary`），但内部 LLM 调用链路变为 `Cloudflare → Supabase Edge Function → OpenRouter`。
- 运维：需要在 Supabase 项目环境中配置 `OPENROUTER_API_KEY`（或 `SILICONFLOW_API_KEY/KIE_API_KEY`）供 Edge Function 使用，Cloudflare 侧不再强依赖这些 Key；AI 调用相关错误可直接在 Supabase 函数日志中查看。

**回滚方式**
- 将 `app/api/ai/import-mapping/route.ts` 中的 `getKieApiUrl/requestKieResponses` 恢复为直接指向 OpenRouter（或 SiliconFlow/KIE）的实现，并在 Cloudflare 环境重建相应的 API Key 配置；可选择保留或删除 `supabase/functions/ai-import-mapping-proxy` 函数文件。

## 2026-03-19


### public-pool-siliconflow-gml5-migration: 公海导入 AI 从 KIE responses 切换为 SiliconFlow GML-5 Chat Completions

**变更点**
- 更新 `app/api/ai/import-mapping/route.ts`：不再调用 KIE `responses` 接口，改为直连 SiliconFlow Chat Completions（`https://api.siliconflow.cn/v1/chat/completions`），使用 `model: "Pro/zai-org/GLM-5"` 并按 OpenAI 兼容的 `messages`/`choices[0].message.content` 协议解析返回 JSON。
- 简化 LLM 响应解析逻辑：移除对 SSE/`output`/`output_text.delta` 的专用解析，改为直接解析标准 JSON 响应并从首条 `choice` 的 `message.content` 中抽取严格 JSON，再复用原有的字段置信度/预览标准化处理逻辑。
- 环境变量调整：新增优先使用 `SILICONFLOW_API_KEY`/`SILICONFLOW_API_URL`，保留对 `KIE_API_KEY`/`KIE_API_URL` 的向后兼容读取；当服务端未配置任一可用 key 时，`/api/ai/import-mapping` 会返回 `missing_api_key` 错误并在前端明确提示。

**变更原因（对应 PRD/原型）**
- 你在实际联调中发现 KIE `responses` 接口在当前账号/环境下经常返回 `HTTP 200 + 空 body`，即使请求体与官方文档对齐且已兼容 SSE，也无法稳定拿到内容；为保证导入 AI 能在生产环境里长期可用，本次改为接入硅基流动的 GML-5 模型，并继续复用现有的“AI 主导列映射 + 行级标准化 + 风险提示”能力。

**影响范围**
- AI 接口：`/api/ai/import-mapping` 现在完全依赖 SiliconFlow 提供的 Chat Completions 能力，不再对 KIE `responses` 进行任何调用；成功时的返回结构和前端使用方式保持不变（`columnMapping/normalizedRows/fieldConfidence/overallConfidence/warnings/summary`）。
- 环境配置：运维需要在部署环境中配置 `SILICONFLOW_API_KEY`（推荐）或沿用 `KIE_API_KEY`，否则导入弹窗会明确提示“AI 服务未配置”并退回到规则兜底预览逻辑。

**回滚方式**
- 将 `app/api/ai/import-mapping/route.ts` 中的 LLM 调用恢复为原来的 KIE `responses` 实现（包括 `DEFAULT_KIE_API_URL`/`DEFAULT_KIE_MODEL`、SSE 解析与错误映射），并在 `.env` 中重新配置 `KIE_API_KEY`/`KIE_API_URL` 作为唯一来源；如无需保留 SiliconFlow，可同时删除对 `SILICONFLOW_API_KEY`/`SILICONFLOW_API_URL` 的读取逻辑。

### public-pool-kie-sse-node-runtime-fix: 修复 KIE responses 接口在服务端的 SSE/空响应兼容问题


**变更点**
- 更新 `app/api/ai/import-mapping/route.ts`：将 KIE 导入识别接口从 `edge` 改为 `nodejs` 运行时，并把请求策略改为优先走 `stream: true + text/event-stream`，兼容 KIE `responses` 接口的 SSE 返回。
- 为 KIE 响应新增双通道解析：优先解析 SSE 事件流（含 `response.output_text.delta` / `response.completed`），同时兼容直接返回 JSON 的情况，避免再因空响应或流式格式导致 `empty_llm_response`。

**变更原因（对应 PRD/原型）**
- 你在官方文档 Playground 中已验证同一 API Key 可正常返回，说明账号本身可用；进一步排查发现项目服务端把 KIE 当普通 JSON 接口读取，而官方 `responses` 文档实际以 `text/event-stream` 为主，导致本地/部署环境里 AI 调用经常拿到空 body，最终退回规则兜底预览。

**影响范围**
- AI 接口：`/api/ai/import-mapping` 现在会优先按 KIE 官方 `responses` 协议消费输出，正常情况下应恢复 AI 行级标准化与列映射返回。
- 导入预览：当 KIE 成功返回时，公海导入弹窗将重新显示真实 AI 识别结果，而不是长期停留在规则兜底预览。

**回滚方式**
- 将 `app/api/ai/import-mapping/route.ts` 恢复为 `edge` 运行时，并删除 SSE 解析/双模式请求逻辑，退回到单次 `stream: false` + 直接 `JSON.parse` 的旧实现。

### public-pool-kie-endpoint-fix-and-ai-fallback-warning: 修复 KIE 接口路径并显式提示 AI 是否生效


**变更点**
- 修复 `app/api/ai/import-mapping/route.ts` 中 KIE GPT-5.4 调用地址与模型名：改为 KIE Common API 的正确异步入口与任务详情轮询逻辑，兼容 `task_id/status/result` 顶层返回结构。
- 更新 `components/public-pool.tsx`：新增 AI 调用失败状态提示；当 AI 未成功返回时，不再继续用“AI 预检查完成”误导用户，而是明确展示当前为规则兜底预览。

**变更原因（对应 PRD/原型）**
- 你反馈导入预览明显错位，且 KIE 平台没有任何调用记录；排查后确认前端确实发起了 `/api/ai/import-mapping`，但服务端请求的是错误的 KIE 路径与模型名，导致 AI 实际未生效，前端却仍显示 AI 完成文案，造成误导。

**影响范围**
- AI 接口：KIE GPT-5.4 调用恢复为真实异步任务模式，成功时才会返回 AI 行级标准化结果。
- UI/前端：用户可直接看到本次导入到底是否真的走了 AI；AI 失败时会展示原因并回退到规则预览，不再假装 AI 已成功。

**回滚方式**
- 恢复 `app/api/ai/import-mapping/route.ts` 中原来的 KIE market 路径与旧解析逻辑；删除 `public-pool.tsx` 中的 `importAiError` 状态与 AI 失败提示文案。

### public-pool-ai-first-import-assistant: 公海导入升级为 AI 主导识别与风险提示


**变更点**
- 重写 `app/api/ai/import-mapping/route.ts`：AI 不再只返回简单列映射，而是同时返回字段置信度、整体置信度、预警信息，以及前 20 行的标准化预览结果，让 AI 从“猜列”升级为“理解表格语义并做行级标准化”。
- 扩展 `lib/public-pool-import-mapping.ts`：新增字段值标准化、预览值构建与 AI 优先映射合并逻辑，支持在 AI 识别结果存在时优先按 AI 方案驱动导入，同时保留规则兜底。
- 更新 `components/public-pool.tsx`：导入弹窗新增“AI 主导识别”信息区，展示整体置信度、字段级置信度、AI 预警与需重点关注的行；预览表改为优先展示 AI 标准化结果，并对低置信度/异常行做高亮提示。

**变更原因（对应 PRD/原型）**
- 你明确要求 AI 必须作为导入主导，因为真实业务文件里表头和内容都可能是错的，单靠固定模板或人工前置清洗效率太低；本次改造的目标就是让 AI 先理解数据，再把人工关注点收缩到少量低置信度异常项。

**影响范围**
- UI/前端：导入预览从“静态映射表”升级成“AI 智能识别面板 + 风险高亮预览”，用户能直接看到 AI 对这份表的理解质量。
- AI 接口：`/api/ai/import-mapping` 的响应结构扩展为 richer JSON，现有调用方仍可读取 `columnMapping`，同时可以消费新增的 `fieldConfidence`、`overallConfidence`、`warnings`、`normalizedRows`。
- 导入链路：实际后台导入继续复用 Worker + 分批 RPC，但字段映射合并策略已切换为 AI 优先、规则兜底。

**回滚方式**
- 恢复 `app/api/ai/import-mapping/route.ts` 为仅返回 `columnMapping` 的旧实现；删除 `public-pool.tsx` 中的 AI 置信度/风险提示 UI 和 `lib/public-pool-import-mapping.ts` 中的 AI 优先合并逻辑。

### public-pool-import-preview-mapping-stability: 公海导入预览改为表头优先映射，避免 AI 错位


**变更点**
- 新增 `lib/public-pool-import-mapping.ts`：集中封装导入字段映射规则，先按标准模板和常见表头别名做确定性匹配，再用 AI 返回结果补齐未识别字段。
- 更新 `components/public-pool.tsx`：上传预检查完成后，不再直接信任 AI 列映射；改为先解析表头、再合并 AI 建议，确保导入预览和最终导入 payload 使用同一份稳定映射。
- 更新 `lib/workers/public-pool-import.worker.ts`：导入 payload 构造改为复用统一字段取值逻辑，保证预览与实际入库字段一致。

**变更原因（对应 PRD/原型）**
- 你反馈当前导入预览字段明显错位，说明单纯依赖 AI 猜列在真实市场表格上不稳定；对标准模板和常见业务表头，产品上必须优先保证“预览可信”，不能让 AI 把预算、联系人、来源猜乱后直接误导用户。

**影响范围**
- UI/前端：导入预览会优先按表头稳定对齐，标准模板和常见中文表头下不再出现明显串列；AI 继续保留，但降级为补充识别而不是唯一判断来源。
- Worker/导入链路：实际后台导入与预览共享同一映射策略，减少“预览正常但入库错位”或“预览错位导致误导确认”的风险。

**回滚方式**
- 删除 `lib/public-pool-import-mapping.ts`，恢复 `public-pool.tsx` 和 Worker 内原来的内联取值与 AI 直连映射逻辑。

**后续历史记录保持不变，略**
## 2026-03-27

### public-pool-openrouter-api-migration: 公海导入 AI 切换为 OpenRouter API 接入

**变更点**
- 更新 [app/api/ai/import-mapping/route.ts](/e:/iwish-sell-crm/app/api/ai/import-mapping/route.ts)：
  - 将默认上游地址恢复为 `https://openrouter.ai/api/v1/chat/completions`。
  - 默认模型改为优先读取 `OPENROUTER_MODEL`，未配置时回退到 `openai/gpt-5-mini`，并保留对旧 `SILICONFLOW_MODEL` 的兼容。
  - 超时与 token 配置优先读取 `OPENROUTER_EDGE_TIMEOUT_MS` / `OPENROUTER_MAX_TOKENS`，仍兼容旧 `SILICONFLOW_*` 变量。
- 更新 [supabase/functions/ai-import-mapping-proxy/index.ts](/e:/iwish-sell-crm/supabase/functions/ai-import-mapping-proxy/index.ts)：
  - 将 Edge Function 默认上游切换为 OpenRouter。
  - API Key 优先读取 `OPENROUTER_API_KEY`，同时兼容 `SILICONFLOW_API_KEY` / `KIE_API_KEY` 作为回退。
  - 增加 OpenRouter 推荐的 `HTTP-Referer` / `X-Title` 请求头，便于平台识别应用来源。
- 调整导入 AI 的网络报错提示，使线上排查指向 OpenRouter 而不是旧的 SiliconFlow。

**原因**
- 当前导入公海池的 AI 识别链路已经抽象成 OpenAI 兼容协议，本次改造的重点不是前端协议，而是把内部上游重新收口到 OpenRouter，方便后续在同一入口下灵活切换更合适的模型。

**影响**
- `/api/ai/import-mapping` 的请求/响应结构保持不变，前端导入弹窗与后台导入流程不需要联动修改。
- 部署时建议在 Supabase Edge Function 配置 `OPENROUTER_API_KEY`，可选再补充 `OPENROUTER_API_URL`、`OPENROUTER_TIMEOUT_MS`、`OPENROUTER_APP_NAME`、`OPENROUTER_SITE_URL`；Next 侧可选配置 `OPENROUTER_MODEL`、`OPENROUTER_MAX_TOKENS`、`OPENROUTER_EDGE_TIMEOUT_MS`。

### public-pool-openrouter-qwen-default-and-fallback: 公海导入 AI 默认模型切到 Qwen 并增加 OpenRouter 受限兜底

**变更点**
- 更新 [app/api/ai/import-mapping/route.ts](/e:/iwish-sell-crm/app/api/ai/import-mapping/route.ts)：
  - 将默认 `OPENROUTER_MODEL` 回退值从 `openai/gpt-5-mini` 调整为 `qwen/qwen3-235b-a22b`，更贴合当前账号可用性和中文导入识别场景。
  - 新增 `OPENROUTER_FALLBACK_MODEL` 支持，默认回退到 `google/gemini-2.5-flash-lite`。
  - 当 OpenRouter 返回 `403` 且错误内容包含 `author/provider banned/restricted` 等限制信号时，服务端会自动改用备用模型重试一次，减少导入预检查直接失败的概率。

**原因**
- 实际联调发现当前 OpenRouter 账号对 `openai/*` 作者存在限制，导致公海池导入在默认模型为 OpenAI 系列时会稳定返回 `403 Author openai is banned`。与其继续依赖账号不稳定的作者访问权限，不如直接切到更适合中文表格语义识别的 Qwen，并在供应商受限时自动降级。

**影响**
- 部署时建议在 Cloudflare/Next 侧显式配置：
  - `OPENROUTER_MODEL=qwen/qwen3-235b-a22b`
  - `OPENROUTER_FALLBACK_MODEL=google/gemini-2.5-flash-lite`
- Supabase Edge Function 无需修改协议代码，只要继续配置 `OPENROUTER_API_KEY` 等既有 secrets 即可。

### public-pool-openrouter-speed-first-model-tuning: 公海导入 AI 改为速度优先模型与更轻量 prompt

**变更点**
- 更新 [app/api/ai/import-mapping/route.ts](/e:/iwish-sell-crm/app/api/ai/import-mapping/route.ts)：
  - 将默认主模型调整为 `google/gemini-2.5-flash-lite`，把 `qwen/qwen3-235b-a22b` 改为备用模型，优先保证导入预检查在同步弹窗链路里的返回速度。
  - 将默认 `OPENROUTER_MAX_TOKENS` 回退值从 `400` 进一步压缩到 `220`，减少模型输出体积。
  - 将默认 `OPENROUTER_EDGE_TIMEOUT_MS` 回退值从 `55000ms` 调整为 `45000ms`，避免上游虽然最终返回成功，但前面的 Cloudflare/站点层已先超时断开。
  - 将送给模型的 `sampleRows` / `previewRows` 从 `8/6` 进一步压缩为 `4/4`，降低 prompt 规模和推理延迟。

**原因**
- 实测 `qwen/qwen3-235b-a22b` 在当前导入预检查场景下，虽然能成功返回，但单次耗时接近 `45s`，已经逼近并穿透站点同步请求链路的容忍范围，最终前端仍表现为 `502`。该链路更适合“快而足够准”的模型，而不是偏重的深度推理模型。

**影响**
- 部署时建议在 Cloudflare/Next 侧显式配置：
  - `OPENROUTER_MODEL=google/gemini-2.5-flash-lite`
  - `OPENROUTER_FALLBACK_MODEL=qwen/qwen3-235b-a22b`
  - `OPENROUTER_MAX_TOKENS=220`
  - `OPENROUTER_EDGE_TIMEOUT_MS=45000`
- Supabase Edge Function 代码仍无需修改，仅继续保留 `OPENROUTER_API_KEY`、`OPENROUTER_TIMEOUT_MS` 等 secrets。

### public-pool-import-ai-background-locking: 公海导入 AI 改为后台分析并在完成前锁定导入

**变更点**
- 更新 [components/public-pool.tsx](/e:/iwish-sell-crm/components/public-pool.tsx)：
  - 上传文件后先快速生成规则预览并展示给用户，不再同步阻塞等待站点层 `/api/ai/import-mapping` 返回。
  - 前端改为直接调用 Supabase Edge Function `ai-import-mapping-proxy` 跑 AI 分析，绕开 `sell.iwishweb.com -> Cloudflare -> Next API` 这一层较容易出现的 502 超时瓶颈。
  - 在 AI 分析进行中，导入按钮保持禁用，文案明确提示“等待 AI 分析完成”；只有 AI 完成或明确失败后才允许用户继续下一步。
  - AI 成功返回后自动刷新预览和字段映射；AI 失败时保留规则兜底预览，并允许用户手动按规则导入。

**原因**
- 实测长达 40~45 秒的 AI 调用虽然在 Supabase Edge Function 侧能最终返回 200，但站点同步请求链路会先在 Cloudflare/Next 层表现为 502，导致功能卡死。改成“规则预览秒出 + AI 后台分析 + 完成前锁定导入”能同时满足可用性和业务正确性。

**影响**
- 部署时需要在 Cloudflare/Next 侧补充公开环境变量，供浏览器直连 Supabase Function 时读取：
  - `NEXT_PUBLIC_OPENROUTER_MODEL=google/gemini-2.5-flash-lite`
  - `NEXT_PUBLIC_OPENROUTER_FALLBACK_MODEL=qwen/qwen3-235b-a22b`
  - `NEXT_PUBLIC_OPENROUTER_MAX_TOKENS=220`
- Supabase Edge Function 代码仍无需修改，只需继续保留现有 OpenRouter secrets。
