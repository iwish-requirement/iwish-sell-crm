export type ImportFieldKey = "company" | "website" | "contact" | "phone" | "wechat" | "sourceLabel" | "budget"

export type ImportColumnMapping = Partial<Record<ImportFieldKey, number | null>>
export type ImportFieldValueMap = Partial<Record<ImportFieldKey, string | null>>
export type ImportFieldConfidenceMap = Partial<Record<ImportFieldKey, number | null>>

export type ImportAiMapping = {
  columnMapping?: ImportColumnMapping | null
  fieldConfidence?: ImportFieldConfidenceMap | null
  overallConfidence?: number | null
  summary?: string | null
  warnings?: string[] | null
} | null

export type ImportAiNormalizedRow = {
  rowIndex: number
  confidence: number | null
  issues: string[]
  normalized: ImportFieldValueMap
}

export const IMPORT_FIELD_KEYS: ImportFieldKey[] = ["company", "website", "contact", "phone", "wechat", "sourceLabel", "budget"]

const IMPORT_FIELD_HEADER_ALIASES: Record<ImportFieldKey, string[]> = {
  company: ["公司名称", "企业名称", "客户名称", "公司", "企业", "公司名", "客户公司", "商家名称", "店铺名称"],
  website: ["网址", "网站", "官网", "官网地址", "公司网址", "网站链接", "url", "website", "domain", "域名"],
  contact: ["联系人", "联系人姓名", "姓名", "客户姓名", "联系人名", "对接人", "负责人"],
  phone: ["电话", "联系电话", "手机号", "手机", "联系方式", "联系电话手机", "联系人电话", "联系人手机"],
  wechat: ["微信", "微信号", "wechat", "vx", "wechatid"],
  sourceLabel: ["来源渠道", "渠道", "来源", "二级来源", "来源类型", "获客渠道", "source", "sourcelabel"],
  budget: ["预算", "预算元", "预算金额", "金额", "项目预算", "费用预算", "budget"],
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_—–/\\|,:：;；，。·•（）()【】\[\]<>《》'"`]/g, "")
}

function sanitizeIndex(value: unknown, maxLength: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }

  const idx = Math.floor(value)
  if (idx < 0 || idx >= maxLength) {
    return null
  }

  return idx
}

function findHeaderMatchIndex(headers: string[], aliases: string[], usedIndexes: Set<number>) {
  const normalizedAliases = aliases.map(normalizeText).filter(Boolean)

  for (const alias of normalizedAliases) {
    const exactIndex = headers.findIndex((header, index) => !usedIndexes.has(index) && normalizeText(header) === alias)
    if (exactIndex >= 0) {
      return exactIndex
    }
  }

  for (const alias of normalizedAliases) {
    const fuzzyIndex = headers.findIndex((header, index) => {
      if (usedIndexes.has(index)) return false
      const normalizedHeader = normalizeText(header)
      return normalizedHeader.includes(alias) || alias.includes(normalizedHeader)
    })
    if (fuzzyIndex >= 0) {
      return fuzzyIndex
    }
  }

  return null
}

export function sanitizeImportColumnMapping(mapping: ImportColumnMapping | null | undefined, maxLength: number): ImportColumnMapping {
  const sanitized: ImportColumnMapping = {}

  for (const field of IMPORT_FIELD_KEYS) {
    sanitized[field] = sanitizeIndex(mapping?.[field], maxLength)
  }

  return sanitized
}

function buildHeaderBasedMapping(headers: string[]): ImportColumnMapping {
  const headerBasedMapping: ImportColumnMapping = {}
  const usedIndexes = new Set<number>()

  for (const field of IMPORT_FIELD_KEYS) {
    const index = findHeaderMatchIndex(headers, IMPORT_FIELD_HEADER_ALIASES[field], usedIndexes)
    headerBasedMapping[field] = index
    if (index != null) {
      usedIndexes.add(index)
    }
  }

  return headerBasedMapping
}

function mergeColumnMappings(primary: ImportColumnMapping, secondary: ImportColumnMapping): ImportColumnMapping {
  const merged: ImportColumnMapping = {}
  const usedIndexes = new Set<number>()

  const assignFrom = (mapping: ImportColumnMapping) => {
    for (const field of IMPORT_FIELD_KEYS) {
      if (merged[field] != null) {
        continue
      }

      const idx = mapping[field]
      if (idx == null || usedIndexes.has(idx)) {
        continue
      }

      merged[field] = idx
      usedIndexes.add(idx)
    }
  }

  assignFrom(primary)
  assignFrom(secondary)

  return merged
}

export function resolveImportColumnMapping(
  headers: string[],
  sampleRows: string[][],
  aiMapping?: ImportColumnMapping | null,
  options?: { preferAi?: boolean },
): ImportColumnMapping {
  const normalizedHeaders = Array.isArray(headers) ? headers.map((header) => String(header ?? "")) : []
  const maxLength = Math.max(
    normalizedHeaders.length,
    ...((Array.isArray(sampleRows) ? sampleRows : []).map((row) => row?.length ?? 0)),
    0,
  )

  const headerBasedMapping = buildHeaderBasedMapping(normalizedHeaders)
  const sanitizedAiMapping = sanitizeImportColumnMapping(aiMapping, maxLength)

  if (options?.preferAi) {
    return mergeColumnMappings(sanitizedAiMapping, headerBasedMapping)
  }

  return mergeColumnMappings(headerBasedMapping, sanitizedAiMapping)
}

export function sanitizeImportFieldValue(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim()
}

export function sanitizeImportFieldValues(values: ImportFieldValueMap | null | undefined): ImportFieldValueMap {
  const normalized: ImportFieldValueMap = {}

  for (const field of IMPORT_FIELD_KEYS) {
    normalized[field] = sanitizeImportFieldValue(values?.[field])
  }

  return normalized
}

export function buildImportPreviewValues(values: ImportFieldValueMap | null | undefined): string[] {
  const normalized = sanitizeImportFieldValues(values)
  return IMPORT_FIELD_KEYS.map((field) => normalized[field] ?? "")
}

export function pickImportCell(row: string[], columnMapping: ImportColumnMapping | null | undefined, key: ImportFieldKey, fallbackIndex: number): string {
  const idx = sanitizeIndex(columnMapping?.[key], row.length)
  if (idx != null) {
    return sanitizeImportFieldValue(row[idx])
  }

  const cols = [...row]
  while (cols.length <= fallbackIndex) cols.push("")
  return sanitizeImportFieldValue(cols[fallbackIndex])
}
