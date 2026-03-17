import { NextRequest, NextResponse } from "next/server"

export const runtime = "edge"

const DEFAULT_KIE_API_URL = "https://api.kie.ai/codex/v1/responses"


function getKieApiUrl(): string {
  const raw = (process.env.KIE_API_URL ?? DEFAULT_KIE_API_URL).trim()
  return raw || DEFAULT_KIE_API_URL
}

function getKieApiKey(): string | null {
  const raw = (process.env.KIE_API_KEY ?? "").trim()
  return raw.length > 0 ? raw : null
}


function stripJsonFence(text: string): string {
  let t = text.trim()
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim()
  }
  return t
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = getKieApiKey()
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "missing_api_key", detail: "KIE_API_KEY is not configured on the server" },
        { status: 500 },
      )
    }

    const body = (await req.json().catch(() => null)) as any
    const headers = (body?.headers ?? []) as unknown
    const sampleRows = (body?.sampleRows ?? []) as unknown

    if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(sampleRows)) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
    }

    const headerValues = (headers as any[]).map((h) => (h == null ? "" : String(h)))
    const rowsValues = (sampleRows as any[][]).map((row) =>
      (row ?? []).map((cell) => (cell == null ? "" : String(cell))),
    )

    const limitedSample = rowsValues.slice(0, 50)

    const systemPrompt =
      "你是一个 B2B CRM 公海池导入助手，负责根据用户上传表格的表头和示例数据，推断列与标准导入字段之间的映射关系。" +
      "\n标准导入字段固定为 7 列（按顺序）：" +
      "\n1. company: 公司名称（企业名称、客户名称等）" +
      "\n2. website: 公司网址（官网域名、网站链接等）" +
      "\n3. contact: 联系人姓名" +
      "\n4. phone: 联系人电话（手机号或座机，若存在多列电话，用更常用的那一列）" +
      "\n5. wechat: 联系人微信号" +
      "\n6. sourceLabel: 二级来源/渠道（例如 抖音、小红书、展会、官网表单 等中文渠道名）" +
      "\n7. budget: 预算金额（数字或金额字符串）" +
      "\n\n你会收到一个 JSON，包含 headers（表头字符串数组）和 sampleRows（若干行示例数据）。" +
      "\n你的任务是根据中文/英文表头名和示例数据，推断每个标准字段对应哪一列（用 0-based 下标）。" +
      "\n如果某个字段在表格中不存在或无法可靠判断，请返回 null。" +
      "\n\n严格按照下面格式，仅输出 JSON，不要包含任何解释性文字或 Markdown 代码块：" +
      "\n{\n  \"columnMapping\": {\n    \"company\": 0 或 null,\n    \"website\": 1 或 null,\n    \"contact\": 2 或 null,\n    \"phone\": 3 或 null,\n    \"wechat\": 4 或 null,\n    \"sourceLabel\": 5 或 null,\n    \"budget\": 6 或 null\n  }\n}"

    const userPayload = {
      headers: headerValues,
      sampleRows: limitedSample,
    }

    const chatRequest = {
      model: "gpt-5-4",
      messages: [
        { role: "system" as const, content: systemPrompt },
        {
          role: "user" as const,
          content:
            "下面是表头和示例数据，请根据前述规则返回 JSON：\n" +
            JSON.stringify(userPayload, null, 2),
        },
      ],
      temperature: 0,
      stream: false,
    }

    const llmRes = await fetch(getKieApiUrl(), {

      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatRequest),
    })

    if (!llmRes.ok) {
      const text = await llmRes.text().catch(() => "")
      console.error("KIE gpt-5-4 mapping call failed", llmRes.status, text)
      return NextResponse.json(
        { ok: false, error: "llm_error", status: llmRes.status, detail: text.slice(0, 1000) },
        { status: 502 },
      )
    }

    const llmJson: any = await llmRes.json().catch(() => null)
    const content = llmJson?.choices?.[0]?.message?.content
    if (typeof content !== "string") {
      return NextResponse.json({ ok: false, error: "invalid_llm_response" }, { status: 502 })
    }

    let parsed: any
    try {
      const jsonText = stripJsonFence(content)
      parsed = JSON.parse(jsonText)
    } catch (err) {
      console.error("Failed to parse LLM JSON content", err, content)
      return NextResponse.json({ ok: false, error: "invalid_llm_json" }, { status: 502 })
    }

    const mapping = parsed?.columnMapping
    if (!mapping || typeof mapping !== "object") {
      return NextResponse.json({ ok: false, error: "missing_column_mapping" }, { status: 502 })
    }

    const sanitizeIndex = (value: unknown): number | null => {
      if (typeof value !== "number") return null
      if (!Number.isFinite(value)) return null
      const idx = Math.floor(value)
      if (idx < 0 || idx >= headerValues.length) return null
      return idx
    }

    const columnMapping = {
      company: sanitizeIndex(mapping.company),
      website: sanitizeIndex(mapping.website),
      contact: sanitizeIndex(mapping.contact),
      phone: sanitizeIndex(mapping.phone),
      wechat: sanitizeIndex(mapping.wechat),
      sourceLabel: sanitizeIndex(mapping.sourceLabel),
      budget: sanitizeIndex(mapping.budget),
    }

    return NextResponse.json({ ok: true, columnMapping })
  } catch (err: any) {
    console.error("/api/ai/import-mapping POST failed", err)
    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
