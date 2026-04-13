export type CompanyResourceAssignmentMode = "uniform_owner" | "file_owner"

export type TeamImportMember = {
  id: string
  fullName: string
  teamId: number | null
}

export type TeamImportBusinessType = {
  id: number
  name: string
  categoryId: number | null
  categoryName?: string | null
}

export type CompanyResourceImportRow = {
  rowIndex: number
  company: string
  website: string
  contact: string
  phone: string
  wechat: string
  responsibilityType: string
  responsibilityLabel: string
  sourceLabel: string
  sourceKey: string
  sourceDepartmentKey: string
  sourceDepartmentLabel: string
  devMethodKey: string
  devMethodLabel: string
  referralCustomerName: string
  referralTypeKey: string
  referralTypeLabel: string
  activityName: string
  budget: string
  businessTypeNames: string[]
  businessTypeIds: number[]
  businessCategoryIds: number[]
  grade: string
  tags: string[]
  ownerId: string | null
  ownerName: string
  duplicate: boolean
  errors: string[]
  canImport: boolean
  payload: Record<string, unknown> | null
}

export async function parseSpreadsheetFile(file: Blob & { name?: string }) {
  const fileName = file.name ?? "import_file"
  const ext = fileName.toLowerCase().split(".").pop() ?? ""

  if (!["csv", "xlsx", "xls"].includes(ext)) {
    throw new Error("当前仅支持 CSV 或 Excel 文件")
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
      throw new Error("导入文件为空或只有表头")
    }

    headerRow = (lines[0] ?? "").split(",").map((cell) => cell.trim())
    dataRows = lines.slice(1).map((line) => line.split(",").map((cell) => cell.trim()))
  } else {
    const XLSX = await import("xlsx")
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: "array" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const sheetData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 }) as any[][]

    const rows = (sheetData ?? [])
      .map((row) => (row ?? []).map((cell) => normalizeCell(cell)))
      .filter((row) => row.some((cell: string) => cell.length > 0))

    if (rows.length <= 1) {
      throw new Error("导入文件为空或只有表头")
    }

    headerRow = rows[0] ?? []
    dataRows = rows.slice(1)
  }

  return {
    fileName,
    headerRow,
    dataRows,
    totalCount: dataRows.length,
  }
}

export const COMPANY_RESOURCE_TEMPLATE_HEADERS = [
  "公司名称",
  "网址",
  "联系人",
  "电话",
  "微信号",
  "责任归因",
  "二级来源",
  "来源责任部门",
  "开发方式",
  "转介绍客户名称",
  "转介绍类型",
  "活动名称",
  "预算",
  "业务类型",
  "客户级别",
  "标签",
  "负责人",
] as const

type HeaderName = (typeof COMPANY_RESOURCE_TEMPLATE_HEADERS)[number]

type LabeledOption = {
  key: string
  label: string
  aliases?: string[]
}

type SourceGroup = {
  key: string
  label: string
  children: LabeledOption[]
}

export const COMPANY_RESOURCE_RESPONSIBILITY_TYPES: LabeledOption[] = [
  { key: "company_resource", label: "公司分配资源", aliases: ["公司资源", "公海资源"] },
  { key: "sales_self", label: "销售自主开发", aliases: ["自主开发", "销售开发"] },
  { key: "customer_referral", label: "客户转介绍", aliases: ["转介绍", "客户推荐"] },
]

export const COMPANY_RESOURCE_DEV_METHODS: LabeledOption[] = [
  { key: "email_outreach", label: "邮件开发", aliases: ["邮件"] },
  { key: "private_domain", label: "私域运营/朋友圈", aliases: ["私域运营", "朋友圈", "私域"] },
  { key: "old_customer_mining", label: "老客户挖掘", aliases: ["老客挖掘", "老客户"] },
  { key: "short_video", label: "短视频/内容引流", aliases: ["短视频", "内容引流"] },
  { key: "other", label: "其他" },
]

export const COMPANY_RESOURCE_REFERRAL_TYPES: LabeledOption[] = [
  { key: "old_customer", label: "老客户转介绍", aliases: ["老客户"] },
  { key: "friend", label: "朋友推荐", aliases: ["朋友"] },
  { key: "partner", label: "合作伙伴推荐", aliases: ["合作伙伴", "伙伴"] },
  { key: "other", label: "其他" },
]

export const COMPANY_RESOURCE_SOURCE_DEPARTMENTS: LabeledOption[] = [
  { key: "market", label: "市场部", aliases: ["市场"] },
  { key: "operation", label: "运营部", aliases: ["运营"] },
  { key: "sales", label: "销售部", aliases: ["销售"] },
  { key: "founder_ip", label: "创始人IP", aliases: ["创始人ip"] },
  { key: "hz_sales", label: "杭州销售团队", aliases: ["杭州销售"] },
]

export const COMPANY_RESOURCE_GROUPS: SourceGroup[] = [
  {
    key: "social_media",
    label: "社媒渠道",
    children: [
      { key: "wechat_company", label: "视频号（公司号）", aliases: ["公司号", "企业视频号"] },
      { key: "wechat_ip_1", label: "视频号（IP号）", aliases: ["ip号", "视频号ip1"] },
      { key: "wechat_ip_2", label: "视频号（IP号2）", aliases: ["ip号2", "视频号ip2"] },
      { key: "xiaohongshu", label: "小红书" },
      { key: "douyin", label: "抖音" },
      { key: "official_account", label: "公众号" },
      { key: "community", label: "社群" },
    ],
  },
  {
    key: "website",
    label: "官网来源",
    children: [
      { key: "website_form", label: "官网表单", aliases: ["官网", "网站表单"] },
      { key: "website_wechat", label: "官网加微信", aliases: ["官网微信"] },
    ],
  },
  {
    key: "offline_events",
    label: "线下活动",
    children: [
      { key: "strategy_course", label: "战略课" },
      { key: "traffic_course", label: "流量课" },
      { key: "brand_course", label: "品牌课" },
      { key: "seo_course", label: "SEO课", aliases: ["seo"] },
      { key: "expo", label: "展会" },
      { key: "public_workshop", label: "公开课分享会", aliases: ["公开课"] },
      { key: "other_event", label: "其他活动" },
    ],
  },
  {
    key: "livestream",
    label: "直播",
    children: [{ key: "livestream_lead", label: "直播间线索", aliases: ["直播"] }],
  },
]

function normalizeCell(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim()
}

function normalizeHeader(value: unknown): string {
  return normalizeCell(value).replace(/\s+/g, "")
}

function normalizeLooseText(value: unknown): string {
  return normalizeCell(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function splitMultiValue(value: string) {
  return normalizeCell(value)
    .split(/[、，,；;\n]+/)
    .map((item) => normalizeCell(item))
    .filter(Boolean)
}

function extractWebsite(value: string): string {
  const normalized = normalizeCell(value)
  if (!normalized) return ""

  const withProtocolMatch = normalized.match(/https?:\/\/[^\s]+/i)
  if (withProtocolMatch) return withProtocolMatch[0]

  const domainMatch = normalized.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/i)
  return domainMatch?.[0] ?? ""
}

function extractPhone(value: string): string {
  const normalized = normalizeCell(value)
  if (!normalized) return ""

  const cleaned = normalized.replace(/[^\d+]/g, "")
  const digitCount = cleaned.replace(/\D/g, "").length
  if (digitCount < 7) return ""

  if (cleaned.startsWith("+")) {
    return `+${cleaned.slice(1).replace(/\+/g, "")}`
  }

  return cleaned
}

function extractBudget(value: string): string {
  const normalized = normalizeCell(value)
  if (!normalized) return ""

  const compact = normalized.replace(/,/g, "").replace(/\s+/g, "")
  const numericMatch = compact.match(/(\d+(?:\.\d+)?)/)
  if (!numericMatch) return ""

  const amount = Number(numericMatch[1])
  if (!Number.isFinite(amount) || amount <= 0) return ""

  let multiplier = 1
  const lower = compact.toLowerCase()
  if (compact.includes("亿")) multiplier = 100000000
  else if (compact.includes("万") || lower.includes("w")) multiplier = 10000
  else if (compact.includes("千") || lower.includes("k")) multiplier = 1000
  else if (lower.includes("m")) multiplier = 1000000

  return String(Math.round(amount * multiplier))
}

function resolveOption(input: string, options: LabeledOption[]) {
  const normalized = normalizeLooseText(input)
  if (!normalized) return null

  for (const option of options) {
    const aliases = [option.key, option.label, ...(option.aliases ?? [])].map((item) => normalizeLooseText(item))
    if (aliases.includes(normalized)) return option
  }

  for (const option of options) {
    const aliases = [option.key, option.label, ...(option.aliases ?? [])].map((item) => normalizeLooseText(item))
    if (aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))) {
      return option
    }
  }

  return null
}

function resolveSourceOption(input: string) {
  const normalized = normalizeLooseText(input)
  if (!normalized) return null

  for (const group of COMPANY_RESOURCE_GROUPS) {
    for (const child of group.children) {
      const aliases = [child.key, child.label, ...(child.aliases ?? [])].map((item) => normalizeLooseText(item))
      if (aliases.includes(normalized)) {
        return { ...child, groupKey: group.key, groupLabel: group.label }
      }
    }
  }

  for (const group of COMPANY_RESOURCE_GROUPS) {
    for (const child of group.children) {
      const aliases = [child.key, child.label, ...(child.aliases ?? [])].map((item) => normalizeLooseText(item))
      if (aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))) {
        return { ...child, groupKey: group.key, groupLabel: group.label }
      }
    }
  }

  return null
}

function resolveSourceLabel(responsibilityType: string, sourceOption: ReturnType<typeof resolveSourceOption>) {
  const responsibility = COMPANY_RESOURCE_RESPONSIBILITY_TYPES.find((item) => item.key === responsibilityType)
  if (!responsibility) return sourceOption?.label ?? "其他"
  if (responsibilityType === "company_resource" && sourceOption) return sourceOption.label
  return responsibility.label
}

function buildMemberIndex(members: TeamImportMember[]) {
  const byId = new Map<string, TeamImportMember>()
  const byName = new Map<string, TeamImportMember[]>()

  for (const member of members) {
    byId.set(member.id, member)
    const normalizedName = normalizeLooseText(member.fullName)
    if (!normalizedName) continue
    byName.set(normalizedName, [...(byName.get(normalizedName) ?? []), member])
  }

  return { byId, byName }
}

function buildBusinessTypeIndex(businessTypes: TeamImportBusinessType[]) {
  const byName = new Map<string, TeamImportBusinessType[]>()

  for (const item of businessTypes) {
    const aliases = new Set<string>()
    const nameOnly = normalizeLooseText(item.name)
    if (nameOnly) {
      aliases.add(nameOnly)
    }

    const categoryName = normalizeCell(item.categoryName ?? "")
    if (categoryName) {
      aliases.add(normalizeLooseText(`${categoryName}/${item.name}`))
      aliases.add(normalizeLooseText(`${categoryName} / ${item.name}`))
      aliases.add(normalizeLooseText(`${categoryName}-${item.name}`))
      aliases.add(normalizeLooseText(`${categoryName}_${item.name}`))
      aliases.add(normalizeLooseText(`${categoryName}${item.name}`))
    }

    for (const alias of aliases) {
      if (!alias) continue
      byName.set(alias, [...(byName.get(alias) ?? []), item])
    }
  }

  return { byName }
}

function withDefinedFields(base: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(base).filter(([, value]) => {
      if (value == null) return false
      if (typeof value === "string") return value.trim().length > 0
      if (Array.isArray(value)) return value.length > 0
      return true
    }),
  )
}

export function validateCompanyResourceTemplateHeaders(headers: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader)
  const missingHeaders = COMPANY_RESOURCE_TEMPLATE_HEADERS.filter(
    (header) => !normalizedHeaders.includes(normalizeHeader(header)),
  )

  return {
    isValid: missingHeaders.length === 0,
    missingHeaders,
  }
}

export function getCompanyResourceTemplateIndex(headers: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader)
  const indexMap = new Map<string, number>()

  for (const header of COMPANY_RESOURCE_TEMPLATE_HEADERS) {
    indexMap.set(header, normalizedHeaders.indexOf(normalizeHeader(header)))
  }

  return indexMap
}

export function analyzeCompanyResourceRows(input: {
  headers: string[]
  rows: string[][]
  assignmentMode: CompanyResourceAssignmentMode
  uniformOwnerId: string | null
  members: TeamImportMember[]
  businessTypes: TeamImportBusinessType[]
  duplicatePhones: Set<string>
  actorTeamId?: number | null
  createScopeType?: "self" | "team" | "org" | "custom"
}) {
  const headerValidation = validateCompanyResourceTemplateHeaders(input.headers)
  const headerIndex = getCompanyResourceTemplateIndex(input.headers)
  const memberIndex = buildMemberIndex(input.members)
  const businessTypeIndex = buildBusinessTypeIndex(input.businessTypes)
  const uniformOwner =
    input.assignmentMode === "uniform_owner" && input.uniformOwnerId
      ? memberIndex.byId.get(input.uniformOwnerId) ?? null
      : null

  const resultRows: CompanyResourceImportRow[] = []

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index] ?? []
    const getCell = (header: HeaderName) => {
      const headerIdx = headerIndex.get(header) ?? -1
      return headerIdx >= 0 ? normalizeCell(row[headerIdx]) : ""
    }

    const company = getCell("公司名称")
    const website = extractWebsite(getCell("网址"))
    const contact = getCell("联系人")
    const phone = extractPhone(getCell("电话"))
    const wechat = getCell("微信号")
    const responsibilityInput = getCell("责任归因")
    const secondarySourceInput = getCell("二级来源")
    const sourceDepartmentInput = getCell("来源责任部门")
    const devMethodInput = getCell("开发方式")
    const referralCustomerName = getCell("转介绍客户名称")
    const referralTypeInput = getCell("转介绍类型")
    const activityName = getCell("活动名称")
    const budget = extractBudget(getCell("预算"))
    const businessTypeInput = getCell("业务类型")
    const grade = getCell("客户级别")
    const tags = splitMultiValue(getCell("标签"))
    const ownerText = getCell("负责人")

    const responsibilityOption = resolveOption(responsibilityInput, COMPANY_RESOURCE_RESPONSIBILITY_TYPES)
    const sourceOption = resolveSourceOption(secondarySourceInput)
    const sourceDepartmentOption = resolveOption(sourceDepartmentInput, COMPANY_RESOURCE_SOURCE_DEPARTMENTS)
    const devMethodOption = resolveOption(devMethodInput, COMPANY_RESOURCE_DEV_METHODS)
    const referralTypeOption = resolveOption(referralTypeInput, COMPANY_RESOURCE_REFERRAL_TYPES)
    const errors: string[] = []

    let ownerId: string | null = null
    let ownerName = ""
    let ownerTeamId: number | null = null

    const businessTypeNames = splitMultiValue(businessTypeInput)
    const matchedBusinessTypes: TeamImportBusinessType[] = []

    for (const item of businessTypeNames) {
      const normalized = normalizeLooseText(item)
      if (!normalized) continue
      const matches = businessTypeIndex.byName.get(normalized) ?? []
      if (matches.length === 1) {
        matchedBusinessTypes.push(matches[0])
      } else if (matches.length > 1) {
        errors.push(`业务类型“${item}”匹配到多个子类型，请使用“一级分类 / 业务类型”的完整名称`)
      } else {
        errors.push(`业务类型“${item}”未匹配到系统中的有效业务类型`)
      }
    }

    if (!headerValidation.isValid) {
      errors.push(`模板缺少列：${headerValidation.missingHeaders.join("、")}`)
    }

    if (!company && !website) {
      errors.push("公司名称和网址至少填写一个")
    }

    if (!phone && !wechat) {
      errors.push("电话和微信号至少填写一个")
    }

    if (!responsibilityOption) {
      errors.push("责任归因不能为空，且必须使用模板中的可识别选项")
    }

    if (responsibilityOption?.key === "company_resource" && !sourceOption) {
      errors.push("责任归因为公司分配资源时，必须填写可识别的二级来源")
    }

    if (responsibilityOption?.key === "sales_self" && !devMethodOption) {
      errors.push("责任归因为销售自主开发时，必须填写开发方式")
    }

    if (responsibilityOption?.key === "customer_referral") {
      if (!referralCustomerName) {
        errors.push("责任归因为客户转介绍时，必须填写转介绍客户名称")
      }
      if (!referralTypeOption) {
        errors.push("责任归因为客户转介绍时，必须填写转介绍类型")
      }
    }

    if (matchedBusinessTypes.length === 0) {
      errors.push("业务类型不能为空，且至少匹配一个系统中的业务类型")
    }

    if (input.assignmentMode === "uniform_owner") {
      if (!uniformOwner) {
        errors.push("未找到统一负责人，请重新选择")
      } else if (uniformOwner.teamId == null) {
        errors.push("统一负责人未加入任何团队，无法导入到线索看板")
      } else if (
        (input.createScopeType === "self" || input.createScopeType === "team") &&
        input.actorTeamId != null &&
        uniformOwner.teamId !== input.actorTeamId
      ) {
        errors.push("当前账号仅能导入到本团队，统一负责人必须与当前账号属于同一团队")
      } else {
        ownerId = uniformOwner.id
        ownerName = uniformOwner.fullName
        ownerTeamId = uniformOwner.teamId
      }
    } else {
      const normalizedOwner = normalizeLooseText(ownerText)
      if (!normalizedOwner) {
        errors.push("负责人不能为空")
      } else {
        const matchedMembers = memberIndex.byName.get(normalizedOwner) ?? []
        if (matchedMembers.length === 1) {
          ownerId = matchedMembers[0].id
          ownerName = matchedMembers[0].fullName
          ownerTeamId = matchedMembers[0].teamId
          if (ownerTeamId == null) {
            errors.push("负责人未加入任何团队，无法导入到线索看板")
          } else if (
            (input.createScopeType === "self" || input.createScopeType === "team") &&
            input.actorTeamId != null &&
            ownerTeamId !== input.actorTeamId
          ) {
            errors.push("当前账号仅能导入到本团队，文件内负责人必须与当前账号属于同一团队")
          }
        } else if (matchedMembers.length > 1) {
          errors.push("负责人重名，请使用系统中唯一可识别的成员姓名")
        } else {
          errors.push("负责人未匹配到系统中的有效成员")
        }
      }
    }

    const duplicate = phone ? input.duplicatePhones.has(phone) : false
    if (duplicate) {
      errors.push("该手机号已存在于线索看板，不能重复导入")
    }

    const businessTypeIds = Array.from(new Set(matchedBusinessTypes.map((item) => item.id)))
    const businessCategoryIds = Array.from(
      new Set(matchedBusinessTypes.map((item) => item.categoryId).filter((value): value is number => value != null)),
    )

    const responsibilityType = responsibilityOption?.key ?? ""
    const sourceKey = responsibilityType === "company_resource" ? sourceOption?.key ?? "" : ""
    const sourceLabel = resolveSourceLabel(responsibilityType, sourceOption)
    const payload =
      errors.length === 0
        ? withDefinedFields({
            team_id: ownerTeamId,
            owner_id: ownerId,
            name: company || website || "未命名线索",
            website,
            source: sourceLabel,
            stage: "L1",
            status: "open",
            customer_name: contact || "新联系人",
            customer_phone: phone || undefined,
            wechat: wechat || undefined,
            budget: budget ? Number(budget) : undefined,
            customer_grade: grade || undefined,
            source_level1: responsibilityType,
            source_level2: sourceKey || undefined,
            responsibility_type: responsibilityType,
            dev_method_key: responsibilityType === "sales_self" ? devMethodOption?.key ?? undefined : undefined,
            referral_customer_name:
              responsibilityType === "customer_referral" ? referralCustomerName || undefined : undefined,
            referral_type_key:
              responsibilityType === "customer_referral" ? referralTypeOption?.key ?? undefined : undefined,
            activity_name: activityName || undefined,
            source_department_key: sourceDepartmentOption?.key ?? undefined,
            tags,
            business_type_ids: businessTypeIds,
            business_category_ids: businessCategoryIds,
            last_contact_at: new Date().toISOString(),
          })
        : null

    resultRows.push({
      rowIndex: index + 1,
      company,
      website,
      contact,
      phone,
      wechat,
      responsibilityType,
      responsibilityLabel: responsibilityOption?.label ?? "",
      sourceLabel: responsibilityType === "company_resource" ? secondarySourceInput : sourceLabel,
      sourceKey,
      sourceDepartmentKey: sourceDepartmentOption?.key ?? "",
      sourceDepartmentLabel: sourceDepartmentOption?.label ?? sourceDepartmentInput,
      devMethodKey: devMethodOption?.key ?? "",
      devMethodLabel: devMethodOption?.label ?? devMethodInput,
      referralCustomerName,
      referralTypeKey: referralTypeOption?.key ?? "",
      referralTypeLabel: referralTypeOption?.label ?? referralTypeInput,
      activityName,
      budget,
      businessTypeNames: matchedBusinessTypes.map((item) =>
        item.categoryName ? `${item.categoryName} / ${item.name}` : item.name,
      ),
      businessTypeIds,
      businessCategoryIds,
      grade,
      tags,
      ownerId,
      ownerName,
      duplicate,
      errors,
      canImport: errors.length === 0,
      payload,
    })
  }

  const duplicateCount = resultRows.filter((row) => row.duplicate).length
  const validCount = resultRows.filter((row) => row.canImport).length
  const errorCount = resultRows.length - validCount

  return {
    rows: resultRows,
    duplicateCount,
    validCount,
    errorCount,
    missingHeaders: headerValidation.missingHeaders,
  }
}
