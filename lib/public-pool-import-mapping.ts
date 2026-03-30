export type ImportFieldKey = "company" | "website" | "contact" | "phone" | "wechat" | "sourceLabel" | "budget"

export type ImportColumnMapping = Partial<Record<ImportFieldKey, number | null>>
export type ImportFieldValueMap = Partial<Record<ImportFieldKey, string | null>>
export type ImportFieldConfidenceMap = Partial<Record<ImportFieldKey, number | null>>
export type ImportSourceChildOption = {
  key: string
  label: string
}

export type ImportSourceGroupOption = {
  key: string
  label: string
  children: ImportSourceChildOption[]
}

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

function normalizeSourceText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_()/\\|,:，。；、]+/g, "")
}

function buildSourceAliases(item: ImportSourceChildOption): string[] {
  const aliases = new Set<string>()
  aliases.add(item.key)
  aliases.add(item.label)

  if (item.key === "douyin") aliases.add("抖音")
  if (item.key === "xiaohongshu") aliases.add("小红书")
  if (item.key === "official_account") aliases.add("公众号")
  if (item.key === "community") aliases.add("社群")
  if (item.key === "website_form") {
    aliases.add("官网表单")
    aliases.add("官网")
    aliases.add("网站表单")
  }
  if (item.key === "website_wechat") {
    aliases.add("官网加微信")
    aliases.add("官网微信")
  }
  if (item.key === "wechat_company") aliases.add("视频号公司号")
  if (item.key === "wechat_ip_1") aliases.add("视频号ip号")
  if (item.key === "wechat_ip_2") aliases.add("视频号ip号2")
  if (item.key === "strategy_course") aliases.add("战略课")
  if (item.key === "traffic_course") aliases.add("流量课")
  if (item.key === "brand_course") aliases.add("品牌课")
  if (item.key === "seo_course") aliases.add("seo课")
  if (item.key === "expo") aliases.add("展会")
  if (item.key === "public_workshop") aliases.add("公开课")
  if (item.key === "other_event") aliases.add("其他活动")
  if (item.key === "livestream_lead") aliases.add("直播线索")

  return [...aliases].map(normalizeSourceText).filter(Boolean)
}

export function sanitizeImportSourceGroups(value: unknown): ImportSourceGroupOption[] {
  if (!Array.isArray(value)) return []

  return value
    .map((group) => {
      const raw = typeof group === "object" && group ? (group as Record<string, unknown>) : {}
      const childrenRaw = Array.isArray(raw.children) ? raw.children : []
      return {
        key: String(raw.key ?? "").trim(),
        label: String(raw.label ?? "").trim(),
        children: childrenRaw
          .map((child) => {
            const childRaw = typeof child === "object" && child ? (child as Record<string, unknown>) : {}
            return {
              key: String(childRaw.key ?? "").trim(),
              label: String(childRaw.label ?? "").trim(),
            }
          })
          .filter((child) => child.key && child.label),
      }
    })
    .filter((group) => group.key && group.label && group.children.length > 0)
}

export function normalizeImportSourceLabelToKey(
  sourceLabel: string,
  groups: ImportSourceGroupOption[] | null | undefined,
): string {
  const normalized = normalizeSourceText(sourceLabel)
  if (!normalized) return "other_event"

  const children = (groups ?? []).flatMap((group) => group.children)

  for (const child of children) {
    const aliases = buildSourceAliases(child)
    if (aliases.includes(normalized)) {
      return child.key
    }
  }

  for (const child of children) {
    const aliases = buildSourceAliases(child)
    if (aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))) {
      return child.key
    }
  }

  if (normalized.includes("抖音") || normalized.includes("douyin")) return "douyin"
  if (normalized.includes("小红书") || normalized.includes("xiaohongshu")) return "xiaohongshu"
  if (normalized.includes("公众号")) return "official_account"
  if (normalized.includes("社群")) return "community"
  if (normalized.includes("官网")) return "website_form"
  if (normalized.includes("直播")) return "livestream_lead"
  if (normalized.includes("展会")) return "expo"
  if (normalized.includes("seo")) return "seo_course"

  return "other_event"
}

function extractWebsite(value: string): string {
  const normalized = sanitizeImportFieldValue(value)
  if (!normalized) return ""

  const withProtocolMatch = normalized.match(/https?:\/\/[^\s]+/i)
  if (withProtocolMatch) {
    return withProtocolMatch[0]
  }

  const domainMatch = normalized.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/i)
  if (domainMatch) {
    return domainMatch[0]
  }

  return ""
}

function extractPhone(value: string): string {
  const normalized = sanitizeImportFieldValue(value)
  if (!normalized) return ""

  const cleaned = normalized.replace(/[^\d+]/g, "")
  const digitCount = cleaned.replace(/\D/g, "").length
  if (digitCount < 7) {
    return ""
  }

  if (cleaned.startsWith("+")) {
    return `+${cleaned.slice(1).replace(/\+/g, "")}`
  }

  return cleaned
}

function looksLikeBudget(value: string): boolean {
  const normalized = sanitizeImportFieldValue(value).toLowerCase()
  if (!normalized) return false
  return /预算|￥|¥|元|万|千|预算金额|usd|rmb|k|m/.test(normalized)
}

function extractBudget(value: string): string {
  const normalized = sanitizeImportFieldValue(value)
  if (!normalized) return ""
  if (!looksLikeBudget(normalized)) return ""
  return normalized
}

function looksLikeWechat(value: string): boolean {
  const normalized = sanitizeImportFieldValue(value)
  if (!normalized) return false
  if (/wechat|wx|微信/i.test(normalized)) return true
  return /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(normalized)
}

function looksLikeNoiseForCompany(value: string): boolean {
  const normalized = sanitizeImportFieldValue(value)
  if (!normalized) return true
  if (extractWebsite(normalized)) return true
  if (extractPhone(normalized)) return true
  if (looksLikeBudget(normalized)) return true
  if (looksLikeWechat(normalized)) return true
  return /^[\d\s+().-]+$/.test(normalized)
}

function findFirstCell(row: string[], predicate: (value: string) => boolean): string {
  for (const cell of row) {
    const normalized = sanitizeImportFieldValue(cell)
    if (normalized && predicate(normalized)) {
      return normalized
    }
  }
  return ""
}

export function deriveImportFieldValues(
  row: string[],
  columnMapping: ImportColumnMapping | null | undefined,
): ImportFieldValueMap {
  const mappedCompany = pickImportCell(row, columnMapping, "company", 0)
  const mappedWebsite = pickImportCell(row, columnMapping, "website", 1)
  const mappedContact = pickImportCell(row, columnMapping, "contact", 2)
  const mappedPhone = pickImportCell(row, columnMapping, "phone", 3)
  const mappedWechat = pickImportCell(row, columnMapping, "wechat", 4)
  const mappedSourceLabel = pickImportCell(row, columnMapping, "sourceLabel", 5)
  const mappedBudget = pickImportCell(row, columnMapping, "budget", 6)

  const website =
    extractWebsite(mappedWebsite) ||
    extractWebsite(mappedCompany) ||
    findFirstCell(row, (value) => Boolean(extractWebsite(value)))

  const phone =
    extractPhone(mappedPhone) ||
    extractPhone(mappedCompany) ||
    findFirstCell(row, (value) => Boolean(extractPhone(value)))

  const wechat =
    (looksLikeWechat(mappedWechat) ? mappedWechat : "") ||
    findFirstCell(row, (value) => looksLikeWechat(value) && !extractWebsite(value) && !extractPhone(value))

  const budget =
    extractBudget(mappedBudget) ||
    findFirstCell(row, (value) => Boolean(extractBudget(value)))

  const company = looksLikeNoiseForCompany(mappedCompany) ? "" : sanitizeImportFieldValue(mappedCompany)
  const contact = looksLikeNoiseForCompany(mappedContact) ? "" : sanitizeImportFieldValue(mappedContact)
  const sourceLabel = sanitizeImportFieldValue(mappedSourceLabel)

  return sanitizeImportFieldValues({
    company,
    website,
    contact,
    phone,
    wechat,
    sourceLabel,
    budget,
  })
}

export function mergeImportFieldValues(
  primary: ImportFieldValueMap | null | undefined,
  fallback: ImportFieldValueMap | null | undefined,
): ImportFieldValueMap {
  const normalizedPrimary = sanitizeImportFieldValues(primary)
  const normalizedFallback = sanitizeImportFieldValues(fallback)
  const merged: ImportFieldValueMap = {}

  for (const field of IMPORT_FIELD_KEYS) {
    merged[field] = normalizedPrimary[field] || normalizedFallback[field] || ""
  }

  return merged
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
