export const DEAL_CONTRACT_SERVICES = [
  { key: "performance", label: "效果营销服务", options: [
    ["google", "Google"], ["meta", "Meta"], ["criteo", "Criteo"], ["bing", "Bing"],
    ["pinterest", "Pinterest"], ["tiktok", "TikTok"], ["ctv", "CTV 电视广告"],
  ] },
  { key: "brand", label: "品牌营销服务", options: [
    ["influencer", "红人营销服务"], ["social", "社媒营销服务"], ["edm", "EDM 营销服务"],
    ["pr", "PR 营销服务"], ["full_service", "全案营销服务"],
  ] },
  { key: "seo", label: "SEO营销服务", options: [["seo", "SEO营销服务"], ["sem", "SEM营销服务"]] },
  { key: "website", label: "网站建站服务", options: [] },
  { key: "creative", label: "素材服务", options: [] },
] as const

export const DEAL_COOPERATION_MODES = [
  ["fixed_quarter", "固定季度服务费"],
  ["spend_ratio", "消耗比例服务费"],
  ["base_bonus", "基础服务费+激励奖金"],
] as const

export const DEAL_CURRENCIES = ["CNY", "USD"] as const

export function isDealCurrency(value: string | undefined): value is (typeof DEAL_CURRENCIES)[number] {
  return DEAL_CURRENCIES.some(currency => currency === value)
}

export const DEAL_CONTRACT_IDENTITY_FIELDS = [
  ["signedOn", "签订合同时间", "date"],
  ["expectedPaymentOn", "预计到款时间", "date"],
  ["actualPayment", "实际到款时间", "text"],
  ["handoffOn", "服务对接时间", "date"],
  ["serviceStartsOn", "合同服务开始计算日期", "date"],
  ["salesperson", "销售人员", "text"],
  ["shortName", "客户简称", "text"],
  ["mainlandCompanyName", "大陆公司", "text"],
  ["hongKongCompanyName", "香港公司", "text"],
  ["contractNumber", "合同编号", "text"],
  ["website", "网址", "website"],
  ["category", "品类", "text"],
  ["contactName", "客户联系人姓名", "text"],
  ["contactTitle", "客户联系人职位", "text"],
  ["phone", "客户联系人电话", "tel"],
  ["email", "客户联系人邮箱", "email"],
  ["address", "公司地址", "text"],
] as const

export const DEAL_CONTRACT_FIELDS = [
  ...DEAL_CONTRACT_IDENTITY_FIELDS,
  ["cooperation", "合作模式", "cooperation"],
  ["spendRatio", "消耗比例", "percentage"],
  ["baseFee", "合同基础服务费总金额", "amount"],
  ["serviceFees", "各项服务板块对应的基础服务费金额", "multiline"],
  ["bonusAmount", "激励奖金的金额", "amount"],
  ["bonusTerms", "激励奖金的条件", "multiline"],
  ["needs", "客户初期目标及主要需求", "multiline"],
  ["currency", "币种", "currency"],
] as const

export const DEAL_FINANCE_FIELDS = [
  ["legalName", "合同签署主体全称（唯一值）"],
  ["receivedOn", "确认到账日期"],
  ["receivedAmount", "确认到账金额"],
] as const

export const DEAL_ALLOCATION_FIELDS = [
  ["department", "部门分配"],
  ["manager", "项目负责人"],
  ["google", "Google优化师"],
  ["meta", "Meta优化师"],
  ["criteo", "Criteo优化师"],
  ["bing", "Bing优化师"],
  ["edm", "EDM营销优化经理/优化师"],
  ["influencer", "红人/联盟营销/社媒营销项目经理"],
] as const

export const NO_WEBSITE = "暂无网站"
export const NOT_PAID = "未到账"
export const NO_CONTRACT_ATTACHMENTS = "none"
export const MAX_BONUS_TERMS_HTML_LENGTH = 20_000
export const CONTRACT_FILE_SIZE_LIMIT = 20 * 1024 * 1024
export type DealContractField = (typeof DEAL_CONTRACT_FIELDS)[number][0]
export type DealContractData = Partial<Record<DealContractField | "companyName", string>> & {
  services: Record<string, string[]>
  attachmentStatus?: typeof NO_CONTRACT_ATTACHMENTS | ""
  bonusTermsHtml?: string
}
export type DealContractFinance = Partial<Record<DealContractField | (typeof DEAL_FINANCE_FIELDS)[number][0], string>>
export type DealContractAllocation = Partial<Record<(typeof DEAL_ALLOCATION_FIELDS)[number][0], string>>

export function isDealContractFieldVisible(field: DealContractField, cooperation: string | undefined): boolean {
  if (field === "bonusAmount" || field === "bonusTerms") return cooperation === "base_bonus"
  if (field === "spendRatio") return cooperation === "spend_ratio"
  return true
}

export function normalizeDealWebsite(value: string): string | null {
  const input = value.trim()
  if (input === NO_WEBSITE) return input
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`)
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null
    const labels = parsed.hostname.toLowerCase().replace(/\.$/, "").split(".")
    if (labels.length < 2 || !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
    if (!/[a-z]/.test(labels[labels.length - 1])) return null
    return `https://${labels.join(".")}`
  } catch {
    return null
  }
}

/** 选填：客户简称（运营系统用它当客户名 / 项目名，2026-11-25 新增，旧合同没有）。 */
const DEAL_CONTRACT_OPTIONAL_FIELDS = new Set<string>(["shortName"])

export function dealContractSubmissionErrors(data: DealContractData, attachmentCount: number): string[] {
  const errors: string[] = []
  for (const [key, label, kind] of DEAL_CONTRACT_FIELDS) {
    if (!isDealContractFieldVisible(key, data.cooperation)) continue
    const value = data[key]?.trim() ?? ""
    if (!value && DEAL_CONTRACT_OPTIONAL_FIELDS.has(key)) continue
    if (!value) {
      errors.push(label)
      continue
    }
    if (kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) errors.push(label)
    if (kind === "amount" && !/^\d{1,14}(\.\d{1,2})?$/.test(value)) errors.push(label)
    if (kind === "percentage" && (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ||
      Number(value) <= 0 || Number(value) > 100)) errors.push(label)
    if (kind === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) errors.push(label)
    if (kind === "website" && !normalizeDealWebsite(value)) errors.push(label)
    if (kind === "cooperation" && !DEAL_COOPERATION_MODES.some(([key]) => key === value)) errors.push(label)
    if (kind === "currency" && !isDealCurrency(value)) errors.push(label)
  }
  if (Object.keys(data.services).length === 0) errors.push("服务内容")
  for (const group of DEAL_CONTRACT_SERVICES) {
    const selected = data.services[group.key]
    if (selected && group.options.length && selected.length === 0) errors.push(`${group.label}小类`)
  }
  if (!attachmentCount && data.attachmentStatus !== NO_CONTRACT_ATTACHMENTS) errors.push("客户售前信息和售后目标附件")
  return errors
}
