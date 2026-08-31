/// <reference lib="webworker" />

import * as XLSX from "xlsx"
import {
  deriveImportFieldValues,
  mergeImportFieldValues,
  normalizeStrictImportSourceKey,
  normalizeStrictImportSourceLabel,
  sanitizeImportSourceGroups,
  type ImportAiMapping,
  type ImportAiNormalizedRow,
  type ImportColumnMapping,
  type ImportFieldValueMap,
  type ImportSourceGroupOption,
} from "../public-pool-import-mapping"

type WorkerRequest = {
  requestId: string
  action: "parse-file" | "build-payloads" | "reset-cache"
  payload?: Record<string, unknown>
}

type ImportReviewRow = {
  rowIndex: number
  company: string
  website: string
  contact: string
  phone: string
  wechat: string
  sourceLabel: string
  sourceKey: string
  budget: string
  category: string
  confidence: number | null
  issues: string[]
  aiEnhanced: boolean
  canImport: boolean
}

let cachedRows: string[][] | null = null
let cachedHeaderRow: string[] | null = null

const IMPORT_AI_FUNCTION_PATH = "/ai-import-mapping-proxy"
const IMPORT_AI_BATCH_SIZE = 20
const IMPORT_AI_IMPORT_MAX_TOKENS = 1800

function normalizeCell(value: unknown): string {
  if (value == null) return ""
  return String(value).trim()
}

async function parseFile(file: File) {
  const ext = file.name.toLowerCase().split(".").pop() ?? ""

  if (!["csv", "xlsx", "xls"].includes(ext)) {
    throw new Error("Unsupported file type. Please use CSV or Excel.")
  }

  let headerRow: string[] = []
  let dataRows: string[][] = []

  if (ext === "csv") {
    const text = await file.text()
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length <= 1) {
      throw new Error("Import file is empty or only contains a header row.")
    }

    headerRow = (lines[0] ?? "").split(",").map((cell) => cell.trim())
    dataRows = lines.slice(1).map((line) => line.split(",").map((cell) => cell.trim()))
  } else {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: "array" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const sheetData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 }) as any[][]

    const rows = (sheetData ?? [])
      .map((row) => (row ?? []).map((cell) => normalizeCell(cell)))
      .filter((row) => row.some((cell: string) => cell.length > 0))

    if (rows.length <= 1) {
      throw new Error("Import file is empty or only contains a header row.")
    }

    headerRow = rows[0] ?? []
    dataRows = rows.slice(1)
  }

  cachedHeaderRow = headerRow
  cachedRows = dataRows

  return {
    headerRow,
    sampleRows: dataRows.slice(0, 300),
    previewSourceRows: dataRows.slice(0, 50),
    totalCount: dataRows.length,
  }
}

function buildSupabaseFunctionUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "").replace(".supabase.co", ".functions.supabase.co")}${path}`
}

function stripImportAiJsonFence(text: string) {
  let t = text.trim()
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim()
  }
  return t
}

function extractImportAiJsonObject(text: string) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1)
  }
  return text
}

function repairImportAiJsonText(text: string) {
  const source = extractImportAiJsonObject(stripImportAiJsonFence(text))
  let result = ""
  let inString = false
  let escaping = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (escaping) {
      result += char
      escaping = false
      continue
    }

    if (char === "\\") {
      result += char
      escaping = true
      continue
    }

    if (char === "\"") {
      if (!inString) {
        inString = true
        result += char
        continue
      }

      let nextIndex = index + 1
      while (nextIndex < source.length && /\s/.test(source[nextIndex])) {
        nextIndex += 1
      }
      const nextChar = source[nextIndex] ?? ""

      if (nextChar === "," || nextChar === "}" || nextChar === "]" || nextChar === ":") {
        inString = false
        result += char
      } else {
        result += "\\\""
      }
      continue
    }

    if (inString) {
      if (char === "\n") {
        result += "\\n"
        continue
      }
      if (char === "\r") {
        result += "\\r"
        continue
      }
      if (char === "\t") {
        result += "\\t"
        continue
      }
    }

    result += char
  }

  return result.replace(/,\s*([}\]])/g, "$1")
}

function parseImportAiJsonContent(text: string) {
  const normalized = stripImportAiJsonFence(text)
  try {
    return JSON.parse(normalized) as Record<string, unknown>
  } catch {
    const extracted = extractImportAiJsonObject(normalized)
    try {
      return JSON.parse(extracted) as Record<string, unknown>
    } catch {
      return JSON.parse(repairImportAiJsonText(extracted)) as Record<string, unknown>
    }
  }
}

async function callImportAiProxyDirect(input: {
  supabaseUrl: string
  anonKey: string
  headers: string[]
  sourceGroups: ImportSourceGroupOption[]
  rows: Array<{ rowIndex: number; cells: string[]; ruleHints: ImportFieldValueMap }>
}) {
  const functionUrl = buildSupabaseFunctionUrl(input.supabaseUrl, IMPORT_AI_FUNCTION_PATH)
  const systemPrompt =
    "You are a B2B CRM import normalization assistant. Normalize each messy spreadsheet row into exactly 8 fields: company, website, contact, phone, wechat, sourceLabel, budget, category." +
    "\nUse headers, row cells, and ruleHints together. ruleHints are deterministic extraction hints and should be kept when they are obviously correct." +
    "\nsourceLabel must be normalized to one of the allowed business labels whenever possible. If no allowed label matches, return an empty string." +
    "\nNever put a website, phone number, or WeChat ID into budget. budget should be a numeric amount only when it is clearly a budget." +
    "\nTreat every row independently. If a field is missing, return an empty string. Do not invent unavailable facts." +
    "\nReturn strict JSON only with a top-level key normalizedRows." +
    "\nEach normalizedRows item must be: { rowIndex, confidence, issues, normalized }." +
    "\nnormalized must include all 8 fields as strings."

  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: input.anonKey,
      Authorization: `Bearer ${input.anonKey}`,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            headers: input.headers,
            allowedSourceGroups: input.sourceGroups,
            rows: input.rows,
          }),
        },
      ],
      response_format: {
        type: "json_object",
      },
      temperature: 0,
      max_tokens: IMPORT_AI_IMPORT_MAX_TOKENS,
    }),
  })

  const rawText = await res.text().catch(() => "")
  if (!res.ok) {
    throw new Error(`llm_error:${res.status}:${rawText.slice(0, 1000)}`)
  }

  const parsed = parseImportAiJsonContent(rawText) as {
    choices?: Array<{ message?: { content?: string } }>
  } | null
  const content = parsed?.choices?.[0]?.message?.content
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("invalid_llm_response")
  }

  return parseImportAiJsonContent(content)
}

async function buildAiNormalizedRows(params: {
  headers: string[]
  rows: string[][]
  columnMapping: ImportColumnMapping | null | undefined
  supabaseUrl: string
  anonKey: string
  sourceGroups: ImportSourceGroupOption[]
}) {
  const normalizedByIndex = new Map<number, ImportAiNormalizedRow>()

  for (let start = 0; start < params.rows.length; start += IMPORT_AI_BATCH_SIZE) {
    const batchRows = params.rows.slice(start, start + IMPORT_AI_BATCH_SIZE)
    const batchPayload = batchRows.map((row, offset) => ({
      rowIndex: start + offset,
      cells: row,
      ruleHints: deriveImportFieldValues(row, params.columnMapping ?? null),
    }))

    try {
      const parsed = await callImportAiProxyDirect({
        supabaseUrl: params.supabaseUrl,
        anonKey: params.anonKey,
        headers: params.headers,
        sourceGroups: params.sourceGroups,
        rows: batchPayload,
      })

      const normalizedRows = Array.isArray((parsed as any)?.normalizedRows)
        ? ((parsed as any).normalizedRows as ImportAiNormalizedRow[])
        : []

      for (const item of normalizedRows) {
        if (typeof item?.rowIndex !== "number" || !item?.normalized || typeof item.normalized !== "object") {
          continue
        }
        normalizedByIndex.set(item.rowIndex, item)
      }
    } catch {
      continue
    }
  }

  return normalizedByIndex
}

async function buildPayloads(payload: Record<string, unknown> | undefined) {
  if (!cachedRows || cachedRows.length === 0) {
    throw new Error("No cached rows to import. Please re-run preview.")
  }

  if (!cachedHeaderRow || cachedHeaderRow.length === 0) {
    throw new Error("No cached headers to import. Please re-run preview.")
  }

  const aiMapping = (payload?.aiMapping as ImportAiMapping | undefined) ?? null
  const columnMapping = aiMapping?.columnMapping ?? null
  const supabaseUrl = typeof payload?.supabaseUrl === "string" ? payload.supabaseUrl.trim() : ""
  const anonKey = typeof payload?.anonKey === "string" ? payload.anonKey.trim() : ""
  const sourceGroups = sanitizeImportSourceGroups(payload?.sourceGroups)

  const aiNormalizedByIndex =
    columnMapping && supabaseUrl && anonKey
      ? await buildAiNormalizedRows({
          headers: cachedHeaderRow,
          rows: cachedRows,
          columnMapping,
          supabaseUrl,
          anonKey,
          sourceGroups,
        })
      : new Map<number, ImportAiNormalizedRow>()

  const reviewRows: ImportReviewRow[] = []
  let invalidBasicInfoCount = 0

  for (const [rowIndex, row] of cachedRows.entries()) {
    if (!row || row.length === 0) continue

    const ruleValues = deriveImportFieldValues(row, columnMapping)
    const aiRow = aiNormalizedByIndex.get(rowIndex)
    const mergedValues = mergeImportFieldValues(aiRow?.normalized, ruleValues)

    const company = mergedValues.company ?? ""
    const website = mergedValues.website ?? ""
    const contact = mergedValues.contact ?? ""
    const phone = mergedValues.phone ?? ""
    const wechat = mergedValues.wechat ?? ""
    const rawSourceLabel = mergedValues.sourceLabel ?? ""
    const budgetStr = mergedValues.budget ?? ""
    const category = mergedValues.category ?? ""
    const sourceKey = normalizeStrictImportSourceKey(rawSourceLabel, sourceGroups)
    const sourceLabel = normalizeStrictImportSourceLabel(rawSourceLabel, sourceGroups)

    const hasIdentity = Boolean((company || website).trim())
    const hasContact = Boolean((phone || wechat).trim())
    const hasSource = Boolean(sourceKey.trim() && sourceLabel.trim())
    const issues = [...(aiRow?.issues ?? [])]

    if (!hasIdentity) {
      issues.push("缺少公司名称或网址")
    }
    if (!hasContact) {
      issues.push("缺少电话或微信号")
    }
    if (!hasSource) {
      issues.push("未命中系统二级来源")
    }

    const canImport = hasIdentity && hasContact && hasSource
    if (!canImport) {
      invalidBasicInfoCount += 1
    }

    reviewRows.push({
      rowIndex,
      company,
      website,
      contact,
      phone,
      wechat,
      sourceLabel,
      sourceKey,
      budget: budgetStr,
      category,
      confidence: aiRow?.confidence ?? null,
      issues,
      aiEnhanced: Boolean(aiRow),
      canImport,
    })
  }

  return {
    reviewRows,
    invalidBasicInfoCount,
    totalCount: cachedRows.length,
  }
}

function resetCache() {
  cachedRows = null
  cachedHeaderRow = null
  return { ok: true }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { requestId, action, payload } = event.data

  try {
    let result: unknown

    if (action === "parse-file") {
      const file = payload?.file
      if (!(file instanceof File)) {
        throw new Error("Missing import file.")
      }
      result = await parseFile(file)
    } else if (action === "build-payloads") {
      result = await buildPayloads(payload)
    } else {
      result = resetCache()
    }

    self.postMessage({ requestId, ok: true, result })
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Import processing failed.",
    })
  }
}

export {}
