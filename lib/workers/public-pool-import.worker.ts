/// <reference lib="webworker" />

import * as XLSX from "xlsx"
import { pickImportCell, type ImportAiMapping } from "../public-pool-import-mapping"


type WorkerRequest = {
  requestId: string
  action: "parse-file" | "build-payloads" | "reset-cache"
  payload?: Record<string, unknown>
}

let cachedRows: string[][] | null = null

function normalizeCell(value: unknown): string {
  if (value == null) return ""
  return String(value).trim()
}


async function parseFile(file: File) {
  const ext = file.name.toLowerCase().split(".").pop() ?? ""

  if (!["csv", "xlsx", "xls"].includes(ext)) {
    throw new Error("当前版本仅支持 CSV 或 Excel 模板导入，请使用下载的模板文件")
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
      throw new Error("导入文件为空或只有表头，请检查模板内容")
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
      throw new Error("导入文件为空或只有表头，请检查模板内容")
    }

    headerRow = rows[0] ?? []
    dataRows = rows.slice(1)
  }

  cachedRows = dataRows

  return {
    headerRow,
    sampleRows: dataRows.slice(0, 300),
    previewSourceRows: dataRows.slice(0, 50),
    totalCount: dataRows.length,
  }
}

async function buildPayloads(payload: Record<string, unknown> | undefined) {
  if (!cachedRows || cachedRows.length === 0) {
    throw new Error("找不到待导入的数据行，请重新选择文件进行预检查")
  }

  const teamId = payload?.teamId
  const ownerId = payload?.ownerId
  if (typeof teamId !== "number" || !Number.isFinite(teamId) || typeof ownerId !== "string" || ownerId.length === 0) {
    throw new Error("缺少导入所需的团队或负责人信息")
  }

  const aiMapping = (payload?.aiMapping as ImportAiMapping | undefined) ?? null
  const columnMapping = aiMapping?.columnMapping ?? null

  const payloads: Record<string, unknown>[] = []
  let invalidBasicInfoCount = 0

  for (const row of cachedRows) {
    if (!row || row.length === 0) continue

    const company = pickImportCell(row, columnMapping, "company", 0)
    const website = pickImportCell(row, columnMapping, "website", 1)
    const contact = pickImportCell(row, columnMapping, "contact", 2)
    const phone = pickImportCell(row, columnMapping, "phone", 3)
    const wechat = pickImportCell(row, columnMapping, "wechat", 4)
    const sourceLabel = pickImportCell(row, columnMapping, "sourceLabel", 5)
    const budgetStr = pickImportCell(row, columnMapping, "budget", 6)

    const hasIdentity = Boolean((company || website).trim())
    const hasContact = Boolean((phone || wechat).trim())
    const hasSource = Boolean(sourceLabel.trim())

    if (!hasIdentity || !hasContact || !hasSource) {
      invalidBasicInfoCount += 1
      continue
    }

    const budget = budgetStr ? Number(budgetStr.replace(/[^0-9.]/g, "")) : null

    const primarySource = "company_resource"
    const secondarySourceKey = {
      抖音: "douyin",
      "视频号（公司号）": "wechat_company",
      "视频号（IP号）": "wechat_ip_1",
      "视频号（IP号2）": "wechat_ip_2",
      小红书: "xiaohongshu",
      公众号: "official_account",
      社群: "community",
      官网表单: "website_form",
      官网加微信: "website_wechat",
      一号位战略课: "strategy_course",
      流量系列课: "traffic_course",
      品牌系列课: "brand_course",
      SEO系列课: "seo_course",
      展会: "expo",
      公开课分享会: "public_workshop",
      其他活动: "other_event",
      直播间线索: "livestream_lead",
    }[sourceLabel] ?? "other_event"

    const leadPayload: Record<string, unknown> = {
      team_id: teamId,
      owner_id: ownerId,
      name: company || website || "未命名线索",
      website: website || null,
      source: sourceLabel || "公司分配资源",
      stage: "L1",
      status: "pool",
      customer_name: contact || "未填写联系人",
      customer_phone: phone || null,
      wechat: wechat || null,
      responsibility_type: primarySource,
      source_level1: primarySource,
      source_level2: secondarySourceKey,
    }

    if (budget !== null && !Number.isNaN(budget)) {
      leadPayload.budget = budget
    }

    payloads.push(leadPayload)
  }

  return {
    payloads,
    invalidBasicInfoCount,
    totalCount: cachedRows.length,
  }
}

function resetCache() {
  cachedRows = null
  return { ok: true }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { requestId, action, payload } = event.data

  try {
    let result: unknown

    if (action === "parse-file") {
      const file = payload?.file
      if (!(file instanceof File)) {
        throw new Error("未收到有效的导入文件")
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
      error: error instanceof Error ? error.message : "导入处理失败",
    })
  }
}

export {}
