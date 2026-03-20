import { NextRequest, NextResponse } from "next/server"
import {
  IMPORT_FIELD_KEYS,
  sanitizeImportColumnMapping,
  sanitizeImportFieldValue,
  sanitizeImportFieldValues,
  type ImportAiNormalizedRow,
  type ImportColumnMapping,
  type ImportFieldConfidenceMap,
  type ImportFieldValueMap,
} from "@/lib/public-pool-import-mapping"

export const runtime = "edge"

const DEFAULT_KIE_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const DEFAULT_KIE_MODEL = "openai/gpt-5.4"

const DEFAULT_AI_PROXY_PATH = "/ai-import-mapping-proxy"

function getKieApiUrl(): string {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim()
  if (supabaseUrl) {
    const base = supabaseUrl.replace(/\/+$/, "").replace(".supabase.co", ".functions.supabase.co")
    return `${base}${DEFAULT_AI_PROXY_PATH}`
  }

  const raw = (process.env.SILICONFLOW_API_URL ?? process.env.KIE_API_URL ?? DEFAULT_KIE_API_URL).trim()
  return raw || DEFAULT_KIE_API_URL
}




function stripJsonFence(text: string): string {
  let t = text.trim()
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim()
  }
  return t
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }

  return Math.max(0, Math.min(1, Number(value)))
}

function sanitizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => sanitizeImportFieldValue(item))
    .filter((item) => item.length > 0)
    .slice(0, 8)
}

function sanitizeFieldConfidence(value: unknown): ImportFieldConfidenceMap {
  const raw = typeof value === "object" && value ? (value as Record<string, unknown>) : {}
  const result: ImportFieldConfidenceMap = {}

  for (const field of IMPORT_FIELD_KEYS) {
    result[field] = clampConfidence(raw[field])
  }

  return result
}

function sanitizeNormalizedRows(value: unknown, previewLength: number): ImportAiNormalizedRow[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      const raw = typeof item === "object" && item ? (item as Record<string, unknown>) : {}
      const rawRowIndex = typeof raw.rowIndex === "number" && Number.isFinite(raw.rowIndex) ? Math.floor(raw.rowIndex) : index
      const rowIndex = Math.max(0, Math.min(previewLength - 1, rawRowIndex))
      const normalizedRaw = typeof raw.normalized === "object" && raw.normalized ? (raw.normalized as ImportFieldValueMap) : {}

      return {
        rowIndex,
        confidence: clampConfidence(raw.confidence),
        issues: sanitizeWarnings(raw.issues),
        normalized: sanitizeImportFieldValues(normalizedRaw),
      }
    })
    .slice(0, previewLength)
}

function tryParseJson(text: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null
  } catch {
    return null
  }
}

function buildKieOutputFromText(text: string): Record<string, unknown> {
  return {
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text,
          },
        ],
        status: "completed",
      },
    ],
    status: "completed",
  }
}

function extractKiePayloadFromSse(rawText: string): Record<string, unknown> | null {
  let deltaText = ""
  let completedPayload: Record<string, unknown> | null = null
  const blocks = rawText.split(/\r?\n\r?\n/)

  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    let eventName = ""
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim()
        continue
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim())
      }
    }

    const dataText = dataLines.join("\n").trim()
    if (!dataText || dataText === "[DONE]") {
      continue
    }

    const dataJson = tryParseJson(dataText)
    if (!dataJson) {
      continue
    }

    const resolvedEventName = eventName || String(dataJson.type ?? "")
    const responsePayload = dataJson.response

    if (responsePayload && typeof responsePayload === "object" && !Array.isArray(responsePayload)) {
      completedPayload = responsePayload as Record<string, unknown>
    }

    if (Array.isArray(dataJson.output)) {
      completedPayload = dataJson
    }

    if (resolvedEventName === "response.output_text.delta" && typeof dataJson.delta === "string") {
      deltaText += dataJson.delta
    }
  }

  if (completedPayload) {
    return completedPayload
  }

  if (deltaText.trim()) {
    return buildKieOutputFromText(deltaText)
  }

  return null
}

function extractKiePayload(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim()
  if (!trimmed) {
    throw new Error("empty_llm_response")
  }

  const directJson = tryParseJson(trimmed)
  if (directJson) {
    return directJson
  }

  const ssePayload = extractKiePayloadFromSse(trimmed)
  if (ssePayload) {
    return ssePayload
  }

  throw new Error("invalid_llm_response")
}

function extractKieTextContent(payload: Record<string, any>): string | null {
  const outputItems = Array.isArray(payload?.output) ? payload.output : []

  for (const item of outputItems) {
    const contentItems = Array.isArray(item?.content) ? item.content : []
    for (const contentItem of contentItems) {
      if (typeof contentItem?.text === "string" && contentItem.text.trim()) {
        return contentItem.text
      }
    }
  }

  return typeof payload?.output_text === "string" && payload.output_text.trim() ? payload.output_text : null
}

async function requestKieResponses(
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  const llmRes = await fetch(getKieApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_KIE_MODEL,
      messages,
      temperature: 0,
      response_format: "json",
    }),
    cache: "no-store",
  })


  const rawText = await llmRes.text().catch(() => "")

  if (!llmRes.ok) {
    console.error("OpenRouter chat completion call failed", {
      status: llmRes.status,
      contentType: llmRes.headers.get("content-type"),
      bodyPreview: rawText.slice(0, 1000),
    })
    throw new Error(`llm_error:${llmRes.status}:${rawText.slice(0, 1000)}`)
  }

  return {
    rawText,
  }
}



async function getLlmJsonContent(messages: Array<{ role: "system" | "user"; content: string }>) {
  const { rawText } = await requestKieResponses(messages)


  if (!rawText.trim()) {
    throw new Error("empty_llm_response:OpenRouter returned 200 with empty body")
  }

  let parsed: any
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    console.error("SiliconFlow response is not valid JSON", {
      bodyPreview: rawText.slice(0, 1000),
    })
    throw err
  }

  const content = parsed?.choices?.[0]?.message?.content

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("invalid_llm_response")
  }

  return JSON.parse(stripJsonFence(content)) as Record<string, unknown>
}





export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as any

    const headers = (body?.headers ?? []) as unknown
    const sampleRows = (body?.sampleRows ?? []) as unknown
    const previewRows = (body?.previewRows ?? body?.sampleRows ?? []) as unknown

    if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(sampleRows) || !Array.isArray(previewRows)) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
    }

    const headerValues = (headers as any[]).map((h) => sanitizeImportFieldValue(h))
    const rowsValues = (sampleRows as any[][]).map((row) => (row ?? []).map((cell) => sanitizeImportFieldValue(cell)))
    const previewValues = (previewRows as any[][]).map((row) => (row ?? []).map((cell) => sanitizeImportFieldValue(cell)))

    const limitedSample = rowsValues.slice(0, 50)
    const limitedPreview = previewValues.slice(0, 20)

    const systemPrompt =
      "你是一个 B2B CRM 智能导入助手，负责在表头可能错误、内容可能串列、格式可能不规范的情况下，尽量把市场导入表理解为标准 CRM 线索数据。" +
      "\n标准字段只有 7 个：company（公司名称）、website（网址）、contact（联系人）、phone（电话）、wechat（微信号）、sourceLabel（来源渠道）、budget（预算）。" +
      "\n你必须优先根据整列语义、单元格内容模式、中文业务语境进行判断，而不是机械相信表头。" +
      "\n请输出：1）字段到列的映射 columnMapping；2）每个字段的置信度 fieldConfidence（0~1）；3）整体置信度 overallConfidence（0~1）；4）一句 summary；5）warnings 数组；6）对 previewRows 中每一行给出标准化 normalizedRows。" +
      "\nnormalizedRows 中每项格式必须是：{ rowIndex, confidence, issues, normalized }，其中 normalized 必须包含 7 个标准字段；若无法判断可填空字符串。" +
      "\nissues 用简短中文描述问题，例如：\"预算疑似写在网址列\"、\"来源根据内容推断\"、\"电话缺失\"。" +
      "\n如果某个字段没有把握，columnMapping 返回 null，但 normalizedRows 仍要尽量基于语义做标准化。" +
      "\n严格输出 JSON，不要输出解释、Markdown 或代码块。"

    const userPayload = {
      headers: headerValues,
      sampleRows: limitedSample,
      previewRows: limitedPreview,
    }

    const parsed = await getLlmJsonContent([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: "请根据下面的表结构和样本数据返回 JSON：\n" + JSON.stringify(userPayload, null, 2),
      },
    ])


    const columnMapping = sanitizeImportColumnMapping(
      (typeof parsed.columnMapping === "object" && parsed.columnMapping ? parsed.columnMapping : {}) as ImportColumnMapping,
      Math.max(headerValues.length, ...rowsValues.map((row) => row.length), 0),
    )

    const normalizedRows = sanitizeNormalizedRows(parsed.normalizedRows, limitedPreview.length)
    const fieldConfidence = sanitizeFieldConfidence(parsed.fieldConfidence)
    const overallConfidence = clampConfidence(parsed.overallConfidence)
    const summary = sanitizeImportFieldValue(parsed.summary)
    const warnings = sanitizeWarnings(parsed.warnings)

    return NextResponse.json({
      ok: true,
      columnMapping,
      fieldConfidence,
      overallConfidence,
      summary,
      warnings,
      normalizedRows,
    })
  } catch (err: any) {
    const message = String(err?.message ?? "")
    console.error("/api/ai/import-mapping POST failed", err)

    if (message.startsWith("llm_error:")) {
      const [, status, detail] = message.split(":", 3)
      return NextResponse.json({ ok: false, error: "llm_error", status: Number(status), detail }, { status: 502 })
    }

    if (message.startsWith("llm_task_detail_error:")) {
      const [, status, detail] = message.split(":", 3)
      return NextResponse.json({ ok: false, error: "llm_task_detail_error", status: Number(status), detail }, { status: 502 })
    }

    if (message.startsWith("llm_task_failed:")) {
      return NextResponse.json({ ok: false, error: "llm_task_failed", detail: message.slice("llm_task_failed:".length) }, { status: 502 })
    }

    if (message.startsWith("llm_task_timeout:")) {
      return NextResponse.json({ ok: false, error: "llm_task_timeout", detail: message.slice("llm_task_timeout:".length) }, { status: 504 })
    }

    if (message === "invalid_llm_response") {
      return NextResponse.json({ ok: false, error: "invalid_llm_response" }, { status: 502 })
    }

    if (message.startsWith("empty_llm_response:")) {
      return NextResponse.json(
        { ok: false, error: "empty_llm_response", detail: message.slice("empty_llm_response:".length) },
        { status: 502 },
      )
    }

    if (message === "empty_llm_response") {
      return NextResponse.json({ ok: false, error: "empty_llm_response" }, { status: 502 })
    }

    if (message === "fetch failed") {
      return NextResponse.json(
        {
          ok: false,
          error: "llm_network_error",
          detail: "调用 AI 服务网络失败（fetch failed），请检查服务器到 SiliconFlow API 的网络连通性或代理配置",
        },
        { status: 502 },
      )
    }

    if (err instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_llm_json" }, { status: 502 })
    }

    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
