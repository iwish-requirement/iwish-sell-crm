"use client"

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Upload,
  Search,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Download,
  Filter,
  MoreHorizontal,
  UserPlus,
  Clock,
  X,
  Users,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { TableSkeleton } from "@/components/skeleton-loaders"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { mapRpcError, type RpcErrorFriendly } from "@/lib/rpc-error-mapper"
import { RpcErrorBanner } from "@/components/rpc-error-banner"
import { MePermissionsContext } from "@/components/app-root"
import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import {
  buildImportPreviewValues,
  deriveImportFieldValues,
  mergeImportFieldValues,
  normalizeStrictImportSourceLabel,
  pickImportCell,
  resolveImportColumnMapping,
  sanitizeImportSourceGroups,
  type ImportAiMapping,
  type ImportAiNormalizedRow,
  type ImportFieldConfidenceMap,
  type ImportSourceGroupOption,
} from "@/lib/public-pool-import-mapping"





interface PoolLead {
  id: string
  company: string
  website: string
  contact: string
  phone: string
  wechat: string
  source: string
  budget: string
  lastStage: string
  returnReason: string
  daysInPool: number
  returnedAt: string
  returnedById: string | null
  importedById: string | null
  categories: { id: number; name: string }[]
}



interface SalesRep {
  id: string
  name: string
  avatar: string
  activeLeads: number
}

interface PoolLeadInteraction {
  id: number
  type: "call" | "wechat" | "visit"
  content: string
  date: string
  author: string
}

interface LeadImportJob {
  id: string
  source: string
  fileName: string
  fileSize: number | null
  status: string
  totalCount: number | null
  successCount: number | null
  duplicateCount: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

interface LeadExportJob {
  id: string
  source: string
  format: string
  status: string
  totalCount: number | null
  exportedCount: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

// 公海池销售代表列表来自 profiles_public，不再使用本地 mockSalesReps
const EMPTY_SALES_REPS: SalesRep[] = []

// 公海池列表由 Supabase 实时加载，这里不再保留历史 mock 数据，以免造成误解
const mockPoolLeads: PoolLead[] = []

// 导入模板中“二级来源(渠道)”列与内部来源 key 的映射
const IMPORT_PRIMARY_SOURCE_FOR_POOL = "company_resource" as const

const IMPORT_SECONDARY_LABEL_TO_KEY: Record<string, string> = {
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
}

const IMPORT_FALLBACK_SECONDARY_KEY = "other_event" as const
const IMPORT_BATCH_SIZE = 200
const IMPORT_AI_LOW_CONFIDENCE_THRESHOLD = 0.65
const IMPORT_AI_FUNCTION_PATH = "/ai-import-mapping-proxy"
const IMPORT_AI_PREVIEW_MAX_TOKENS = 1400

const IMPORT_FIELD_LABELS = {
  company: "公司名称",
  website: "网址",
  contact: "联系人",
  phone: "电话",
  wechat: "微信号",
  sourceLabel: "来源渠道",
  budget: "预算",
  category: "品类",
} satisfies Record<string, string>

type ImportWorkerAction = "parse-file" | "build-payloads" | "reset-cache"

type ImportWorkerParseResult = {
  headerRow: string[]
  sampleRows: string[][]
  previewSourceRows: string[][]
  totalCount: number
}

type ImportWorkerBuildPayloadsResult = {
  reviewRows: ImportReviewDraftRow[]
  invalidBasicInfoCount: number
  totalCount: number
}

type ImportSourceGroupsResponse = {
  groups?: ImportSourceGroupOption[]
}

type ImportPreviewRow = {
  rowIndex: number
  values: string[]
  confidence: number | null
  issues: string[]
  aiEnhanced: boolean
}

type ImportReviewDraftRow = {
  rowIndex: number
  company: string
  website: string
  contact: string
  phone: string
  wechat: string
  sourceLabel: string
  category: string
  sourceKey: string
  budget: string
  confidence: number | null
  issues: string[]
  aiEnhanced: boolean
  canImport: boolean
}

type ImportAiInsight = {
  summary: string | null
  warnings: string[]
  overallConfidence: number | null
  fieldConfidence: ImportFieldConfidenceMap
  aiEnhancedCount: number
  reviewNeededCount: number
}

type ImportAiStatus = "idle" | "processing" | "completed" | "failed"

type ImportAiAnalysisResponse = {
  ok?: boolean
  error?: string
  detail?: string
  columnMapping?: Record<string, number | null>
  normalizedRows?: ImportAiNormalizedRow[]
  fieldConfidence?: ImportFieldConfidenceMap
  overallConfidence?: number | null
  summary?: string | null
  warnings?: string[]
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

function parseImportAiJsonContent(text: string): ImportAiAnalysisResponse {
  const normalized = stripImportAiJsonFence(text)
  try {
    return JSON.parse(normalized) as ImportAiAnalysisResponse
  } catch {
    const extracted = extractImportAiJsonObject(normalized)
    try {
      return JSON.parse(extracted) as ImportAiAnalysisResponse
    } catch {
      return JSON.parse(repairImportAiJsonText(extracted)) as ImportAiAnalysisResponse
    }
  }
}

function buildSupabaseFunctionUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
  if (!base) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 未配置")
  }
  return `${base.replace(/\/+$/, "").replace(".supabase.co", ".functions.supabase.co")}${path}`
}

async function callImportAiProxyDirect(input: {
  headers: string[]
  sampleRows: string[][]
  previewRows: string[][]
  sourceGroups?: ImportSourceGroupOption[]
}) {
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()
  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY 未配置")
  }

  const functionUrl = buildSupabaseFunctionUrl(IMPORT_AI_FUNCTION_PATH)
  const limitedSampleRows = input.sampleRows.slice(0, 4)
  const limitedPreviewRows = input.previewRows.slice(0, 4)
  const systemPrompt =
    "你是一个 B2B CRM 智能导入助手，负责在表头可能错误、内容可能串列、格式可能不规范的情况下，尽量把市场导入表理解为标准 CRM 线索数据。" +
    "\n标准字段有 8 个：company（公司名称）、website（网址）、contact（联系人）、phone（电话）、wechat（微信号）、sourceLabel（来源渠道）、budget（预算）、category（品类）。" +
    "\n请优先根据整列语义、单元格内容模式和中文业务语境判断，而不是机械相信表头。" +
    "\n请严格输出 JSON，包含 columnMapping、fieldConfidence、overallConfidence、summary、warnings、normalizedRows。" +
    "\nnormalizedRows 中每项格式必须是：{ rowIndex, confidence, issues, normalized }，normalized 必须包含 8 个标准字段。"

  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: "请根据下面的表结构和样本数据返回 JSON：\n" + JSON.stringify({
            headers: input.headers,
            sampleRows: limitedSampleRows,
            previewRows: limitedPreviewRows,
            allowedSourceGroups: input.sourceGroups ?? [],
          }),
        },
      ],
      response_format: {
        type: "json_object",
      },
      temperature: 0,
      max_tokens: IMPORT_AI_PREVIEW_MAX_TOKENS,
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



function buildImportPreviewRow(row: string[], aiMapping: ImportAiMapping): string[] {
  const columnMapping = aiMapping?.columnMapping ?? null
  return buildImportPreviewValues(deriveImportFieldValues(row, columnMapping))
}


function summarizeImportSample(
  sampleRows: string[][],
  aiMapping: ImportAiMapping,
  sourceGroups: ImportSourceGroupOption[] = [],
) {
  const columnMapping = aiMapping?.columnMapping ?? null
  const seenPhones = new Set<string>()
  let duplicatesFound = 0
  let invalidBasicInfoCount = 0

  for (const row of sampleRows) {
    if (!row || row.length === 0) continue

    const normalized = deriveImportFieldValues(row, columnMapping)
    const company = normalized.company ?? ""
    const website = normalized.website ?? ""
    const phoneRaw = normalized.phone ?? ""
    const wechatRaw = normalized.wechat ?? ""
    const sourceLabel = normalizeStrictImportSourceLabel(normalized.sourceLabel ?? "", sourceGroups)

    const hasIdentity = Boolean((company || website).trim())
    const hasContact = Boolean((phoneRaw || wechatRaw).trim())
    const hasSource = Boolean(sourceLabel.trim())

    if (!hasIdentity || !hasContact || !hasSource) {
      invalidBasicInfoCount += 1
      continue
    }

    const normalizedPhone = phoneRaw.replace(/[^0-9+]/g, "")
    if (normalizedPhone) {
      if (seenPhones.has(normalizedPhone)) {
        duplicatesFound += 1
        continue
      }
      seenPhones.add(normalizedPhone)
    }
  }

  return {
    duplicatesFound,
    invalidBasicInfoCount,
  }
}

function isLikelyStandardPublicPoolTemplate(headers: string[], sampleRows: string[][]) {
  const mapping = resolveImportColumnMapping(headers, sampleRows, null, { preferAi: false })

  return (
    mapping.company === 0 &&
    mapping.website === 1 &&
    mapping.contact === 2 &&
    mapping.phone === 3 &&
    mapping.wechat === 4 &&
    mapping.sourceLabel === 5 &&
    mapping.budget === 6
  )
}

function formatImportConfidence(confidence: number | null | undefined) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return "待判断"
  }

  return `${Math.round(confidence * 100)}%`
}

function isImportConfidenceLow(confidence: number | null | undefined) {
  return typeof confidence === "number" && Number.isFinite(confidence) && confidence < IMPORT_AI_LOW_CONFIDENCE_THRESHOLD
}

// 责任类型枚举到展示文案（与线索看板保持一致）


const RESPONSIBILITY_TYPE_LABELS: Record<string, string> = {
  company_resource: "公司分配资源",
  sales_self: "销售自主开发",
  customer_referral: "客户转介绍",
}

// 反向映射：二级来源 key → 中文文案（用于导出/展示）
const IMPORT_SECONDARY_KEY_TO_LABEL: Record<string, string> = Object.keys(IMPORT_SECONDARY_LABEL_TO_KEY).reduce(
  (acc, label) => {
    const key = IMPORT_SECONDARY_LABEL_TO_KEY[label]
    acc[key] = label
    return acc
  },
  {} as Record<string, string>,
)

// 公海池来源展示统一格式：责任类型 / 渠道名（可带补充信息）
function formatPublicPoolSourceLabel(row: {
  source?: string | null
  responsibility_type?: string | null
  source_level1?: string | null
  source_level2?: string | null
  activity_name?: string | null
  referral_customer_name?: string | null
}): string {
  const responsibilityKey = (row.responsibility_type || row.source_level1 || "") as string
  const responsibilityLabel = responsibilityKey ? RESPONSIBILITY_TYPE_LABELS[responsibilityKey] ?? null : null

  let channelLabel: string | null = null

  // 公海导入场景：company_resource + 二级来源 key
  if (responsibilityKey === "company_resource") {
    const level2Key = row.source_level2 as string | null
    if (level2Key && IMPORT_SECONDARY_KEY_TO_LABEL[level2Key]) {
      channelLabel = IMPORT_SECONDARY_KEY_TO_LABEL[level2Key]
    }
  }

  // 其它场景兜底用 secure view 中的 source 文案
  if (!channelLabel && row.source) {
    channelLabel = String(row.source)
  }

  const extras: string[] = []
  if (row.activity_name) extras.push(String(row.activity_name))
  if (row.referral_customer_name) extras.push(String(row.referral_customer_name))
  const extraSuffix = extras.length > 0 ? `（${extras.join(" / ")}）` : ""

  if (responsibilityLabel && channelLabel) {
    return `${responsibilityLabel} / ${channelLabel}${extraSuffix}`
  }
  if (responsibilityLabel) {
    return `${responsibilityLabel}${extraSuffix}`
  }
  if (channelLabel) {
    return `${channelLabel}${extraSuffix}`
  }

  return "其他"
}

// 导出时复用同一套来源展示逻辑
function getPublicPoolExportSourceLabel(row: any): string {
  return formatPublicPoolSourceLabel(row)
}


type ImportStage = "idle" | "uploading" | "checking" | "complete"


export function PublicPool() {
  const [leads, setLeads] = useState<PoolLead[]>([])
  const mePermissions = React.useContext(MePermissionsContext)
  const canAssignLeads = mePermissions?.canAssignLeads ?? false
  const canDeleteLeads = mePermissions?.canDeleteLeads ?? false
  const canViewPublicPool = mePermissions?.canViewPublicPool ?? false
  const canImportLeads = mePermissions?.canImportLeads ?? false
  const [searchQuery, setSearchQuery] = useState("")
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [claimingLeadId, setClaimingLeadId] = useState<string | null>(null)
  const [defaultBusinessTypeId, setDefaultBusinessTypeId] = useState<number | null>(null)
  const [defaultBusinessCategoryIds, setDefaultBusinessCategoryIds] = useState<number[]>([])
  const [businessCategoryOptions, setBusinessCategoryOptions] = useState<{ id: number; name: string }[]>([])

  useEffect(() => {
    const supabase = getBrowserSupabaseClient()
    async function loadDefaultBusinessType() {
      try {
        const { data, error } = await supabase
          .from("business_types")
          .select("id, category_id, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .limit(1)
        if (!error && data && data.length > 0) {
          setDefaultBusinessTypeId(Number(data[0].id))
          setDefaultBusinessCategoryIds(data[0].category_id != null ? [Number(data[0].category_id)] : [])
        }
        const { data: categories } = await supabase
          .from("business_categories")
          .select("id, name")
          .eq("is_active", true)
          .order("sort_order")
        setBusinessCategoryOptions(
          (categories ?? [])
            .map((item: any) => ({ id: Number(item.id), name: String(item.name ?? "").trim() }))
            .filter((item) => item.name),
        )
      } catch (err) {
        console.error("Failed to load default business type for public pool", err)
      }
    }
    loadDefaultBusinessType()
  }, [])


  const [selectedLeads, setSelectedLeads] = useState<string[]>([])
  const [assignToRep, setAssignToRep] = useState("")
  const [assignmentNote, setAssignmentNote] = useState("")


  const [salesReps, setSalesReps] = useState<SalesRep[]>(EMPTY_SALES_REPS)
  const [isAssigning, setIsAssigning] = useState(false)
  const [loadSalesRepsError, setLoadSalesRepsError] = useState<string | null>(null)

  const importWorkerRef = useRef<Worker | null>(null)
  const importWorkerResolversRef = useRef(
    new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void }>(),
  )

  const [detailDialogOpen, setDetailDialogOpen] = useState(false)


  const [detailLead, setDetailLead] = useState<PoolLead | null>(null)
  const [interactions, setInteractions] = useState<PoolLeadInteraction[]>([])
  const [isLoadingInteractions, setIsLoadingInteractions] = useState(false)
  const [interactionsError, setInteractionsError] = useState<RpcErrorFriendly | null>(null)

  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [importStage, setImportStage] = useState<ImportStage>("idle")
  const [importProgress, setImportProgress] = useState(0)
  const [duplicatesFound, setDuplicatesFound] = useState(0)
  const [parsedImportRows, setParsedImportRows] = useState<ImportPreviewRow[] | null>(null)
  const [estimatedTotalCount, setEstimatedTotalCount] = useState<number | null>(null)
  const [invalidBasicInfoCount, setInvalidBasicInfoCount] = useState(0)
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [importAiMapping, setImportAiMapping] = useState<ImportAiMapping>(null)
  const [importAiInsight, setImportAiInsight] = useState<ImportAiInsight | null>(null)
  const [importAiError, setImportAiError] = useState<string | null>(null)
  const [importAiStatus, setImportAiStatus] = useState<ImportAiStatus>("idle")
  const [importBypassedAi, setImportBypassedAi] = useState(false)
  const [isSubmittingImport, setIsSubmittingImport] = useState(false)
  const [importSourceGroups, setImportSourceGroups] = useState<ImportSourceGroupOption[]>([])
  const [importReviewRows, setImportReviewRows] = useState<ImportReviewDraftRow[] | null>(null)
  const [isPreparingImportReview, setIsPreparingImportReview] = useState(false)
  const [showOnlyReviewFocusRows, setShowOnlyReviewFocusRows] = useState(true)


  const importPreviewRows = useMemo(
    () => (parsedImportRows ? parsedImportRows.slice(0, 50) : []),
    [parsedImportRows],
  )

  const importSourceOptions = useMemo(
    () => importSourceGroups.flatMap((group) => group.children.map((child) => ({ ...child, groupLabel: group.label }))),
    [importSourceGroups],
  )

  const isReviewFocusRow = useCallback(
    (row: ImportReviewDraftRow) => !row.canImport || isImportConfidenceLow(row.confidence) || row.issues.length > 0,
    [],
  )

  const importReviewSummary = useMemo(() => {
    const rows = importReviewRows ?? []
    const selectedRows = rows.filter((row) => row.canImport)
    const lowConfidenceCount = rows.filter((row) => isImportConfidenceLow(row.confidence)).length
    const issueCount = rows.filter((row) => row.issues.length > 0).length
    const focusCount = rows.filter((row) => isReviewFocusRow(row)).length
    return {
      totalCount: rows.length,
      selectedCount: selectedRows.length,
      skippedCount: rows.length - selectedRows.length,
      lowConfidenceCount,
      issueCount,
      focusCount,
    }
  }, [importReviewRows, isReviewFocusRow])

  const sortedImportReviewRows = useMemo(() => {
    const rows = [...(importReviewRows ?? [])]
    const getPriority = (row: ImportReviewDraftRow) => {
      if (!row.canImport) return 0
      if (row.issues.length > 0) return 1
      if (isImportConfidenceLow(row.confidence)) return 2
      return 3
    }
    return rows.sort((a, b) => {
      const priorityDiff = getPriority(a) - getPriority(b)
      if (priorityDiff !== 0) return priorityDiff
      return a.rowIndex - b.rowIndex
    })
  }, [importReviewRows])

  const visibleImportReviewRows = useMemo(() => {
    if (!showOnlyReviewFocusRows) {
      return sortedImportReviewRows
    }
    return sortedImportReviewRows.filter((row) => isReviewFocusRow(row))
  }, [showOnlyReviewFocusRows, sortedImportReviewRows, isReviewFocusRow])


  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const worker = new Worker(new URL("../lib/workers/public-pool-import.worker.ts", import.meta.url))
    importWorkerRef.current = worker

    worker.onmessage = (event: MessageEvent<any>) => {
      const requestId = event.data?.requestId as string | undefined
      if (!requestId) return

      const resolver = importWorkerResolversRef.current.get(requestId)
      if (!resolver) return

      importWorkerResolversRef.current.delete(requestId)

      if (event.data?.ok) {
        resolver.resolve(event.data.result)
        return
      }

      resolver.reject(new Error(event.data?.error || "导入处理失败"))
    }

    worker.onerror = (event) => {
      console.error("Public pool import worker crashed", event)
      const workerError = new Error("导入处理器异常退出，请重新选择文件后再试")
      for (const resolver of importWorkerResolversRef.current.values()) {
        resolver.reject(workerError)
      }
      importWorkerResolversRef.current.clear()
    }

    return () => {
      worker.terminate()
      importWorkerRef.current = null
      for (const resolver of importWorkerResolversRef.current.values()) {
        resolver.reject(new Error("导入处理器已关闭，请重新选择文件后重试"))
      }
      importWorkerResolversRef.current.clear()
    }
  }, [])

  const [importJobs, setImportJobs] = useState<LeadImportJob[]>([])


  const [exportJobs, setExportJobs] = useState<LeadExportJob[]>([])
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)

  const callImportWorker = useCallback((action: ImportWorkerAction, payload?: Record<string, unknown>) => {
    const worker = importWorkerRef.current
    if (!worker) {
      return Promise.reject(new Error("导入处理器尚未初始化，请刷新页面后重试"))
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    return new Promise<any>((resolve, reject) => {
      importWorkerResolversRef.current.set(requestId, { resolve, reject })
      worker.postMessage({ requestId, action, payload })
    })
  }, [])

  const [isLoading, setIsLoading] = useState(true)

  const [loadError, setLoadError] = useState<RpcErrorFriendly | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTargetLead, setDeleteTargetLead] = useState<PoolLead | null>(null)
  const retryLoad = useCallback(() => setReloadToken((t) => t + 1), [])

  useEffect(() => {
    if (!isSubmittingImport || !importJobId) {
      return
    }

    const timer = window.setInterval(() => {
      retryLoad()
    }, 3000)

    return () => {
      window.clearInterval(timer)
    }
  }, [importJobId, isSubmittingImport, retryLoad])

  useEffect(() => {
    let isMounted = true


    async function loadPoolLeads() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase
          .from("leads_secure_view")
          .select(
            "id, name, website, stage, status, source, customer_name, customer_phone, wechat, budget, updated_at, created_by, team_id, owner_id, business_categories",
          )

          .eq("status", "pool")
          .order("updated_at", { ascending: false })

        if (!isMounted) {
          return
        }

        if (error) {
          console.error("Failed to load public pool leads", error)
          const friendly = mapRpcError(error, { title: "加载公海线索失败", description: "请稍后重试" })
          setLoadError(friendly)
          toast.error(friendly.title, {
            description: friendly.description,
            ...(friendly.canRetry ? { action: { label: "重试", onClick: retryLoad } } : {}),
          })
          setLeads([])
          return
        }

        const rawRows = (data ?? []) as any[]

        const ids = rawRows.map((row: any) => row.id as string).filter((id: string | null) => !!id) ?? []


        const reasonsByLeadId: Record<
          string,
          {
            reason: string | null
            returnedAt: string | null
            returnedById: string | null
          }
        > = {}

        if (ids.length > 0) {
          const { data: auditRows, error: auditError } = await supabase
            .from("audit_logs")
            .select("target_id, reason, created_at, action, actor_id")
            .eq("target_type", "lead")
            .in("action", ["return_lead_to_pool"])
            .in("target_id", ids)
            .order("created_at", { ascending: false })

          if (auditError) {
            console.error("Failed to load pool return reasons", auditError)
          } else {
            for (const row of auditRows ?? []) {
              const leadId = (row as any).target_id as string
              if (!reasonsByLeadId[leadId]) {
                reasonsByLeadId[leadId] = {
                  reason: ((row as any).reason as string | null) ?? null,
                  returnedAt: ((row as any).created_at as string | null) ?? null,
                  returnedById: ((row as any).actor_id as string | null) ?? null,
                }
              }
            }
          }
        }

        const mapped: PoolLead[] =
          rawRows.map((row: any) => {


            const leadId = row.id as string
            const reasonInfo = reasonsByLeadId[leadId]
            const returnedAtDate =
              reasonInfo?.returnedAt != null
                ? new Date(reasonInfo.returnedAt)
                : row.updated_at
                  ? new Date(row.updated_at)
                  : null
            const daysInPool =
              returnedAtDate != null
                ? Math.max(
                    0,
                    Math.floor(
                      (Date.now() - returnedAtDate.getTime()) / (1000 * 60 * 60 * 24),
                    ),
                  )
                : 0

            return {
              id: leadId,
              company: (row.name as string) ?? "未命名线索",
              website: (row as any).website ?? "",
              contact: (row.customer_name as string) ?? "未填写联系人",
              phone: (row.customer_phone as string) ?? "",
              wechat: ((row as any).wechat as string | null) ?? "",
              source: formatPublicPoolSourceLabel(row as any),


              budget:
                row.budget != null
                  ? `¥${Number(row.budget).toLocaleString("zh-CN")}`
                  : "待确认",
              lastStage: (row.stage as string) ?? "未设置",
              returnReason: reasonInfo?.reason ?? "退回原因未记录",
              daysInPool,
              returnedAt:
                returnedAtDate != null
                  ? returnedAtDate.toISOString().split("T")[0]
                  : "",
              returnedById: reasonInfo?.returnedById ?? null,
              importedById: (row.created_by as string | null) ?? null,
              categories: Array.isArray(row.business_categories) ? row.business_categories : [],
            }
          }) ?? []

        setLeads(mapped)
      } catch (err) {
        console.error("Failed to load public pool leads", err)
        if (isMounted) {
          const friendly = mapRpcError(err as any, { title: "加载公海线索失败", description: "请稍后重试" })
          setLoadError(friendly)
          toast.error(friendly.title, {
            description: friendly.description,
            ...(friendly.canRetry ? { action: { label: "重试", onClick: retryLoad } } : {}),
          })
          setLeads([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    async function loadSalesReps() {
      try {
        const supabase = getBrowserSupabaseClient()

        const [
          { data, error },
          { data: exclusionRow, error: exclusionError },
        ] = await Promise.all([
          supabase
            .from("profiles_public")
            .select("id, full_name, status")
            .eq("status", "active"),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "analytics.excluded_profiles")
            .maybeSingle(),
        ])

        if (!isMounted) {
          return
        }

        if (error) {
          console.error("Failed to load sales reps", error)
          setLoadSalesRepsError("加载销售成员失败，请稍后重试")
          setSalesReps(EMPTY_SALES_REPS)
          return
        }

        if (exclusionError && exclusionError.code !== "PGRST116") {
          console.error(
            "Failed to load analytics excluded profiles for public pool assignees",
            exclusionError,
          )
        }

        setLoadSalesRepsError(null)

        const excludedProfileIds = new Set<string>(
          exclusionRow && (exclusionRow as any).value &&
          Array.isArray(((exclusionRow as any).value as any).profile_ids)
            ? (((exclusionRow as any).value as any).profile_ids as any[]).filter(
                (v: any) => typeof v === "string",
              )
            : [],
        )

        const { data: leadRows, error: leadsError } = await supabase
          .from("leads_secure_view")
          .select("owner_id, status")
          .eq("status", "open")

        if (leadsError) {
          console.error("Failed to load active leads for reps", leadsError)
        }

        const activeCounts: Record<string, number> = {}
        ;(leadRows ?? []).forEach((row: any) => {
          const ownerId = (row.owner_id as string | null) ?? null
          if (ownerId && !excludedProfileIds.has(ownerId)) {
            activeCounts[ownerId] = (activeCounts[ownerId] ?? 0) + 1
          }
        })

        const normalized: SalesRep[] =
          data
            ?.filter((row: any) => !excludedProfileIds.has(row.id as string))
            .map((row: any) => ({
              id: row.id as string,
              name: (row.full_name as string) ?? "未命名成员",
              avatar: "",
              activeLeads: activeCounts[row.id as string] ?? 0,
            })) ?? []


        setSalesReps(normalized)
      } catch (err) {
        console.error("Failed to load sales reps", err)
      }
    }


    async function loadJobs() {
      try {
        setIsLoadingJobs(true)
        const supabase = getBrowserSupabaseClient()

        const [importRes, exportRes] = await Promise.all([
          supabase
            .from("lead_import_jobs")
            .select("id, source, file_name, file_size, status, total_count, success_count, duplicate_count, error_message, created_at, completed_at")
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("lead_export_jobs")
            .select("id, source, format, status, total_count, exported_count, error_message, created_at, completed_at")
            .order("created_at", { ascending: false })
            .limit(20),
        ])

        if (!isMounted) return

        if (importRes.error) {
          console.error("Failed to load lead import jobs", importRes.error)
        } else {
          const mappedImport: LeadImportJob[] =
            importRes.data?.map((row: any) => ({
              id: row.id as string,
              source: (row.source as string) ?? "public_pool",
              fileName: (row.file_name as string) ?? "-",
              fileSize: (row.file_size as number | null) ?? null,
              status: (row.status as string) ?? "pending",
              totalCount: (row.total_count as number | null) ?? null,
              successCount: (row.success_count as number | null) ?? null,
              duplicateCount: (row.duplicate_count as number | null) ?? null,
              errorMessage: (row.error_message as string | null) ?? null,
              createdAt: row.created_at as string,
              completedAt: (row.completed_at as string | null) ?? null,
            })) ?? []

          setImportJobs(mappedImport)
        }

        if (exportRes.error) {
          console.error("Failed to load lead export jobs", exportRes.error)
        } else {
          const mappedExport: LeadExportJob[] =
            exportRes.data?.map((row: any) => ({
              id: row.id as string,
              source: (row.source as string) ?? "public_pool",
              format: (row.format as string) ?? "-",
              status: (row.status as string) ?? "pending",
              totalCount: (row.total_count as number | null) ?? null,
              exportedCount: (row.exported_count as number | null) ?? null,
              errorMessage: (row.error_message as string | null) ?? null,
              createdAt: row.created_at as string,
              completedAt: (row.completed_at as string | null) ?? null,
            })) ?? []

          setExportJobs(mappedExport)
        }
      } catch (err) {
        console.error("Failed to load lead import/export jobs", err)
      } finally {
        if (isMounted) {
          setIsLoadingJobs(false)
        }
      }
    }

    void loadPoolLeads()
    void loadSalesReps()
    void loadJobs()

    return () => {
      isMounted = false
    }
  }, [reloadToken, retryLoad])

  // 订阅 Supabase Realtime，监听线索状态进出公海池，实现公海池的实时刷新
  useEffect(() => {
    const supabase = getBrowserSupabaseClient()

    const channel = supabase
      .channel("public-pool-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        (payload: { new: any; old: any }) => {
          const nextStatus = (payload.new as any)?.status as string | null | undefined
          const prevStatus = (payload.old as any)?.status as string | null | undefined

          // 只在与公海池相关的状态变更时刷新：
          // - 有线索进入公海（status 变为 pool）
          // - 有线索从公海被认领/分配走（status 从 pool 变为其他）
          if (nextStatus === "pool" || prevStatus === "pool") {
            retryLoad()
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [retryLoad])

  const repNameById = useMemo(() => {
    const map: Record<string, string> = {}
    salesReps.forEach((rep) => {
      map[rep.id] = rep.name
    })
    return map
  }, [salesReps])

  const filteredLeads = leads.filter(
    (lead) =>
      lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.website.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.contact.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.phone.includes(searchQuery),
  )


  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLeads(filteredLeads.map((l) => l.id))
    } else {
      setSelectedLeads([])
    }
  }

  const handleSelectLead = (leadId: string, checked: boolean) => {
    if (checked) {
      setSelectedLeads([...selectedLeads, leadId])
    } else {
      setSelectedLeads(selectedLeads.filter((id) => id !== leadId))
    }
  }

  const openDetailDialog = async (lead: PoolLead) => {
    setDetailLead(lead)
    setDetailDialogOpen(true)
    setInteractions([])
    setInteractionsError(null)
    setIsLoadingInteractions(true)

    try {
      const supabase = getBrowserSupabaseClient()
      const { data, error } = await supabase
        .from("lead_notes")
        .select("id, content, note_type, created_at, author_id")
        .eq("lead_id", lead.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })

      if (error) {
        console.error("Failed to load lead interactions from pool", error)
        const friendly = mapRpcError(error, {
          title: "加载跟进记录失败",
          description: "请稍后重试",
        })
        setInteractionsError(friendly)
        toast.error(friendly.title, { description: friendly.description })
        return
      }

      const authorNameById: Record<string, string> = {}
      salesReps.forEach((rep) => {
        authorNameById[rep.id] = rep.name
      })

      const mapped: PoolLeadInteraction[] =
        data?.map((row: any, index: number) => {
          const authorId = (row.author_id as string | null) ?? null
          const authorName = (authorId && authorNameById[authorId]) || "未知成员"

          return {
            id: index + 1,
            type:
              row.note_type === "call" || row.note_type === "wechat" || row.note_type === "visit"
                ? (row.note_type as "call" | "wechat" | "visit")
                : "call",
            content: (row.content as string) ?? "",
            date: row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : "",
            author: authorName,
          }
        }) ?? []

      setInteractions(mapped)
    } catch (err) {
      console.error("Failed to load lead interactions from pool", err)
      const friendly = mapRpcError(err as any, {
        title: "加载跟进记录失败",
        description: "请稍后重试或联系管理员",
      })
      setInteractionsError(friendly)
      toast.error(friendly.title, { description: friendly.description })
    } finally {
      setIsLoadingInteractions(false)
    }
  }

  const isAllSelected = filteredLeads.length > 0 && selectedLeads.length === filteredLeads.length
  const isSomeSelected = selectedLeads.length > 0 && selectedLeads.length < filteredLeads.length

  const handleAssign = (leadId?: string) => {
    if (!canAssignLeads) {
      toast.error("无权分配线索", {
        description: "当前账号未获授权执行线索分配操作。如需调整相关权限，请联系系统管理员。",
      })
      return
    }


    if (leadId) {
      setSelectedLeads([leadId])
    }
    setAssignDialogOpen(true)
  }

  const handleClaimToMe = async (leadId: string) => {
    if (!leadId) return

    try {
      setClaimingLeadId(leadId)
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.rpc("rpc_lead_claim_from_pool", {
        p_lead_id: leadId,
        p_reason: "从公海池认领到我的线索",
      })

      if (error) {
        const friendly = mapRpcError(error, {
          title: "认领失败",
          description: "从公海池认领线索失败，请稍后重试",
        })
        toast.error(friendly.title, { description: friendly.description })
        return
      }

      setLeads((prev) => prev.filter((l) => l.id !== leadId))
      toast.success("认领成功", {
        description: "该线索已进入“我的线索”，并归属到当前账号",
      })
    } catch (err) {
      console.error("Failed to claim lead from pool", err)
      toast.error("认领失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setClaimingLeadId(null)
    }
  }

  const confirmAssignment = async () => {
    if (!assignToRep || selectedLeads.length === 0) {
      return
    }

    try {
      setIsAssigning(true)

      const supabase = getBrowserSupabaseClient()
      let successCount = 0

      for (const leadId of selectedLeads) {
        const { error: assignError } = await supabase.rpc("rpc_lead_assign", {
          p_lead_id: leadId,
          p_new_owner: assignToRep,
          p_reason: assignmentNote || null,
        })

        if (assignError) {
          const friendly = mapRpcError(assignError, {
            title: "分配失败",
            description: "分配线索失败，请稍后重试",
          })
          toast.error(friendly.title, { description: friendly.description })
          continue
        }

        const { error: updateError } = await supabase.rpc("rpc_lead_update", {
          p_lead_id: leadId,
          patch: {
            status: "open",
          },
        })

        if (updateError) {
          const friendly = mapRpcError(updateError, {
            title: "部分线索状态更新失败",
            description: "更新线索状态失败，请稍后重试",
          })
          toast.error(friendly.title, { description: friendly.description })
          continue
        }

        successCount += 1
      }

      const repName = salesReps.find((r) => r.id === assignToRep)?.name

      if (successCount > 0) {
        setLeads(leads.filter((l) => !selectedLeads.includes(l.id)))
        setAssignDialogOpen(false)
        toast.success("分配成功", {
          description: `已将 ${successCount} 条线索分配给 ${repName ?? "选中成员"}`,
        })
        setSelectedLeads([])
        setAssignToRep("")
        setAssignmentNote("")
      }
    } catch (err) {
      console.error("Failed to assign leads from public pool", err)
      toast.error("分配线索失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setIsAssigning(false)
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileUpload(files[0])
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const handleFileUpload = async (file: File) => {
    setUploadedFile(file)
    setImportStage("uploading")
    setImportProgress(5)
    setDuplicatesFound(0)
    setParsedImportRows(null)
    setEstimatedTotalCount(null)
    setInvalidBasicInfoCount(0)
    setImportJobId(null)
    setImportAiMapping(null)
    setImportAiInsight(null)
    setImportAiError(null)
    setImportAiStatus("idle")
    setImportBypassedAi(false)

    let slowProgressTimer: ReturnType<typeof setInterval> | null = null
    let progress = 5

    try {
      const ext = file.name.toLowerCase().split(".").pop()
      if (ext !== "csv" && ext !== "xlsx" && ext !== "xls") {
        toast.error("导入失败", {
          description: "当前版本仅支持 CSV 或 Excel 模板导入，请使用下载的模板文件",
        })
        setImportStage("idle")
        setImportProgress(0)
        return
      }

      slowProgressTimer = setInterval(() => {
        progress = Math.min(progress + 3, 90)
        setImportProgress(progress)
      }, 200)

      setImportStage("checking")

      const [parsedResult, previewResponse] = await Promise.all([
        callImportWorker("parse-file", { file }) as Promise<ImportWorkerParseResult>,
        fetch("/api/public-pool/import-preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size ?? null,
          }),
        }),
      ])

      if (!previewResponse.ok) {
        const errJson = (await previewResponse.json().catch(() => null)) as any
        console.error("import-preview failed", errJson)
        toast.error("导入预检查失败", {
          description: errJson?.detail || "预检查导入文件时出错，请稍后重试",
        })
        setImportStage("idle")
        setImportProgress(0)
        void callImportWorker("reset-cache").catch(() => undefined)
        return
      }

      const previewJson = (await previewResponse.json().catch(() => null)) as any
      if (!previewJson?.ok || !previewJson?.jobId) {
        toast.error("导入预检查失败", {
          description: previewJson?.detail || "导入预检查返回结果异常，请稍后重试",
        })
        setImportStage("idle")
        setImportProgress(0)
        void callImportWorker("reset-cache").catch(() => undefined)
        return
      }

      const headerRow = parsedResult?.headerRow ?? []
      const sampleRows = parsedResult?.sampleRows ?? []
      const previewSourceRows = parsedResult?.previewSourceRows ?? []
      const totalCount = Number(parsedResult?.totalCount ?? 0)
      const isStandardTemplate = isLikelyStandardPublicPoolTemplate(headerRow, sampleRows)

      const resolvedColumnMapping = resolveImportColumnMapping(
        headerRow,
        sampleRows,
        null,
        { preferAi: false },
      )
      const finalImportMapping: ImportAiMapping = {
        columnMapping: resolvedColumnMapping,
        fieldConfidence: null,
        overallConfidence: null,
        summary: null,
        warnings: [],
      }

      let previewSourceGroups: ImportSourceGroupOption[] = []
      try {
        const supabase = getBrowserSupabaseClient()
        const { data: sourceGroupsSetting } = await supabase
          .from("settings")
          .select("value")
          .eq("key", "leads.company_resource_source_groups")
          .maybeSingle()

        const sourceGroupsValue = (sourceGroupsSetting?.value as ImportSourceGroupsResponse | null)?.groups ?? []
        previewSourceGroups = sanitizeImportSourceGroups(sourceGroupsValue)
        setImportSourceGroups(previewSourceGroups)
      } catch (sourceGroupErr) {
        console.error("Failed to load company resource source groups for import preview", sourceGroupErr)
      }

      const sampleSummary = summarizeImportSample(sampleRows, finalImportMapping, previewSourceGroups)
      const previewRows: ImportPreviewRow[] = previewSourceRows.map((row, index) => {
        return {
          rowIndex: index,
          values: buildImportPreviewRow(row, finalImportMapping),
          confidence: null,
          issues: [],
          aiEnhanced: false,
        }
      })

      setImportJobId(previewJson.jobId as string)
      setEstimatedTotalCount(totalCount)
      setDuplicatesFound(sampleSummary.duplicatesFound)
      setInvalidBasicInfoCount(sampleSummary.invalidBasicInfoCount)
      setParsedImportRows(previewRows)
      setImportAiMapping(finalImportMapping)
      setImportAiError(null)
      setImportAiInsight(
        isStandardTemplate
          ? {
              summary: "检测到公海标准模板，本次已按规则直接解析并可立即导入公海。",
              warnings: ["标准模板已按固定列规则处理，本次未调用 AI。"],
              overallConfidence: 1,
              fieldConfidence: {},
              aiEnhancedCount: 0,
              reviewNeededCount: 0,
            }
          : null,
      )
      setImportAiStatus(
        isStandardTemplate ? "completed" : headerRow.length > 0 && sampleRows.length > 0 ? "processing" : "failed",
      )
      setImportBypassedAi(isStandardTemplate)




      if (slowProgressTimer) {
        clearInterval(slowProgressTimer)
        slowProgressTimer = null
      }

      let finalProgress = progress
      const finalTimer = setInterval(() => {
        finalProgress += 5
        if (finalProgress >= 100) {
          finalProgress = 100
          clearInterval(finalTimer)
          setImportStage("complete")
        }
        setImportProgress(finalProgress)
      }, 80)

      if (!isStandardTemplate && headerRow.length > 0 && sampleRows.length > 0) {
        const runAiAnalysis = async () => {
          try {
            const aiAnalysis = await callImportAiProxyDirect({
              headers: headerRow,
              sampleRows,
              previewRows: previewSourceRows.slice(0, 20),
              sourceGroups: previewSourceGroups,
            })

            const resolvedAiMapping = resolveImportColumnMapping(
              headerRow,
              sampleRows,
              aiAnalysis?.columnMapping ?? null,
              { preferAi: true },
            )
            const aiMapping: ImportAiMapping = {
              columnMapping: resolvedAiMapping,
              fieldConfidence: aiAnalysis?.fieldConfidence ?? null,
              overallConfidence: aiAnalysis?.overallConfidence ?? null,
              summary: aiAnalysis?.summary ?? null,
              warnings: aiAnalysis?.warnings ?? [],
            }

            const aiPreviewRows = Array.isArray(aiAnalysis?.normalizedRows) ? aiAnalysis.normalizedRows : []
            const aiPreviewByIndex = new Map(aiPreviewRows.map((row) => [row.rowIndex, row]))
            const mergedPreviewRows: ImportPreviewRow[] = previewSourceRows.map((row, index) => {
              const aiRow = aiPreviewByIndex.get(index)
              if (aiRow) {
                const mergedValues = mergeImportFieldValues(
                  aiRow.normalized,
                  deriveImportFieldValues(row, aiMapping.columnMapping ?? null),
                )
                const normalizedSourceLabel = normalizeStrictImportSourceLabel(
                  mergedValues.sourceLabel ?? "",
                  previewSourceGroups,
                )
                if (normalizedSourceLabel) {
                  mergedValues.sourceLabel = normalizedSourceLabel
                }
                return {
                  rowIndex: index,
                  values: buildImportPreviewValues(mergedValues),
                  confidence: aiRow.confidence,
                  issues: aiRow.issues,
                  aiEnhanced: true,
                }
              }

              return {
                rowIndex: index,
                values: buildImportPreviewRow(row, aiMapping),
                confidence: null,
                issues: [],
                aiEnhanced: false,
              }
            })

            const reviewNeededCount = aiPreviewRows.filter(
              (row) => row.issues.length > 0 || isImportConfidenceLow(row.confidence),
            ).length

            setParsedImportRows(mergedPreviewRows)
            setImportAiMapping(aiMapping)
            setImportAiError(null)
            setImportAiInsight({
              summary: aiAnalysis?.summary?.trim() || null,
              warnings: aiAnalysis?.warnings ?? [],
              overallConfidence: aiAnalysis?.overallConfidence ?? null,
              fieldConfidence: aiAnalysis?.fieldConfidence ?? {},
              aiEnhancedCount: aiPreviewRows.length,
              reviewNeededCount,
            })
            setImportAiStatus("completed")
          } catch (aiErr) {
            console.error("Failed to call /api/ai/import-mapping for import preview", aiErr)
            setImportAiInsight(null)
            setImportAiError(aiErr instanceof Error ? aiErr.message : "AI 服务调用失败")
            setImportAiStatus("failed")
          }
        }

        void runAiAnalysis()
      }
    } catch (err) {
      console.error("Failed to run import preview on client", err)
      toast.error("导入失败", { description: "预检查导入文件时出错，请稍后重试" })
      setImportStage("idle")
      setImportProgress(0)
      void callImportWorker("reset-cache").catch(() => undefined)
    } finally {
      if (slowProgressTimer) {
        clearInterval(slowProgressTimer)
      }
    }
  }





  const resetImport = () => {
    setUploadedFile(null)
    setImportStage("idle")
    setImportProgress(0)
    setDuplicatesFound(0)
    setParsedImportRows(null)
    setEstimatedTotalCount(null)
    setInvalidBasicInfoCount(0)
    setImportJobId(null)
    setImportAiMapping(null)
    setImportAiInsight(null)
    setImportAiError(null)
    setImportAiStatus("idle")
    setImportBypassedAi(false)
    setImportSourceGroups([])
    setImportReviewRows(null)
    setIsPreparingImportReview(false)
    setShowOnlyReviewFocusRows(true)
    void callImportWorker("reset-cache").catch(() => undefined)
  }







  const handleCancelImport = () => {
    setImportDialogOpen(false)
    setTimeout(resetImport, 300)
  }

  const updateImportReviewRow = useCallback((rowIndex: number, patch: Partial<ImportReviewDraftRow>) => {
    setImportReviewRows((current) =>
      (current ?? []).map((row) => {
        if (row.rowIndex !== rowIndex) return row
        const nextRow = { ...row, ...patch }
        const hasIdentity = Boolean((nextRow.company || nextRow.website).trim())
        const hasContact = Boolean((nextRow.phone || nextRow.wechat).trim())
        const hasSource = Boolean(nextRow.sourceKey.trim() && nextRow.sourceLabel.trim())
        return {
          ...nextRow,
          canImport: patch.canImport ?? (hasIdentity && hasContact && hasSource),
        }
      }),
    )
  }, [])

  const updateImportReviewRows = useCallback((predicate: (row: ImportReviewDraftRow) => boolean, canImport: boolean) => {
    setImportReviewRows((current) =>
      (current ?? []).map((row) => (predicate(row) ? { ...row, canImport } : row)),
    )
  }, [])

  const handleSkipFocusRows = useCallback(() => {
    updateImportReviewRows((row) => isReviewFocusRow(row), false)
  }, [isReviewFocusRow, updateImportReviewRows])

  const handleRestoreFocusRows = useCallback(() => {
    updateImportReviewRows((row) => isReviewFocusRow(row), true)
  }, [isReviewFocusRow, updateImportReviewRows])

  const buildImportPayloadsFromReviewRows = useCallback(
    (rows: ImportReviewDraftRow[], teamId: number, ownerId: string) => {
      const primarySource = "company_resource"
      return rows
        .filter((row) => row.canImport)
        .map((row) => {
          const budget = row.budget ? Number(String(row.budget).replace(/[^0-9.]/g, "")) : null
          const payload: Record<string, unknown> = {
            team_id: teamId,
            owner_id: ownerId,
            name: row.company || row.website || "Unnamed Lead",
            website: row.website || null,
            source: row.sourceLabel || "Company Resource",
            stage: "L1",
            status: "pool",
            customer_name: row.contact || "Unknown Contact",
            customer_phone: row.phone || null,
            wechat: row.wechat || null,
            responsibility_type: primarySource,
            source_level1: primarySource,
            source_level2: row.sourceKey || null,
            // Legacy public-pool spreadsheets do not contain taxonomy columns.
            // Keep them importable by applying the configured default type/category.
            business_type_ids: defaultBusinessTypeId ? [defaultBusinessTypeId] : [],
            business_category_ids: (() => {
              const matched = businessCategoryOptions.find((item) => item.name.trim() === row.category.trim())
              return matched ? [matched.id] : defaultBusinessCategoryIds
            })(),
          }

          if (budget !== null && !Number.isNaN(budget)) {
            payload.budget = budget
          }

          return payload
        })
    },
    [businessCategoryOptions, defaultBusinessCategoryIds, defaultBusinessTypeId],
  )

  const handleConfirmImport = async () => {
    if (importAiStatus === "processing") {
      toast.info("AI 正在分析表格", {
        description: "请等待 AI 智能映射完成后再生成全量导入结果",
      })
      return
    }

    const supabase = getBrowserSupabaseClient()

    if (importStage !== "complete" || isSubmittingImport || !importJobId) {
      return
    }

    try {
      setIsSubmittingImport(true)

      if (!importReviewRows) {
        setIsPreparingImportReview(true)

        let effectiveSourceGroups = importSourceGroups
        if (effectiveSourceGroups.length === 0) {
          try {
            const { data: sourceGroupsSetting } = await supabase
              .from("settings")
              .select("value")
              .eq("key", "leads.company_resource_source_groups")
              .maybeSingle()

            const sourceGroupsValue = (sourceGroupsSetting?.value as ImportSourceGroupsResponse | null)?.groups ?? []
            effectiveSourceGroups = sanitizeImportSourceGroups(sourceGroupsValue)
            setImportSourceGroups(effectiveSourceGroups)
          } catch (sourceGroupErr) {
            console.error("Failed to load company resource source groups before review", sourceGroupErr)
          }
        }

        const buildResult = (await callImportWorker("build-payloads", {
          aiMapping: importAiMapping?.columnMapping ? importAiMapping : null,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          sourceGroups: effectiveSourceGroups,
        })) as ImportWorkerBuildPayloadsResult

        const reviewRows = Array.isArray(buildResult?.reviewRows) ? buildResult.reviewRows : []
        const invalidCount = Number(buildResult?.invalidBasicInfoCount ?? 0)
        const totalCount = Number(buildResult?.totalCount ?? estimatedTotalCount ?? reviewRows.length)

        setEstimatedTotalCount(totalCount)
        setInvalidBasicInfoCount(invalidCount)
        setImportReviewRows(reviewRows)
        toast.success("AI 全量分析已完成", {
          description: "请只校准异常或低置信度行，确认后再落库。",
        })
        return
      }

      try {
        const { data: mePerms, error: permsError } = await supabase.rpc("rpc_me_permissions")
        if (!permsError) {
          const latestCanImportLeads = Boolean((mePerms as any)?.canImportLeads)
          if (!latestCanImportLeads) {
            toast.error("没有导入线索的权限", {
              description: "当前账号未开通线索导入权限，如需调整权限，请联系系统管理员。",
            })
            return
          }
        } else {
          console.error("Failed to refresh current user permissions before import", permsError)
          if (!canImportLeads) {
            toast.error("没有导入线索的权限", {
              description: "当前账号未开通线索导入权限，如需调整权限，请联系系统管理员。",
            })
            return
          }
        }
      } catch (permErr) {
        console.error("Unexpected error while refreshing permissions before import", permErr)
        if (!canImportLeads) {
          toast.error("没有导入线索的权限", {
            description: "当前账号未开通线索导入权限，如需调整权限，请联系系统管理员。",
          })
          return
        }
      }

      const currentProfile = await fetchCurrentUserProfile(supabase)
      if (!currentProfile || currentProfile.teamId == null) {
        toast.error("无法导入线索", {
          description: "当前账号未加入任何团队，无法导入公海线索",
        })
        return
      }

      const payloads = buildImportPayloadsFromReviewRows(importReviewRows, currentProfile.teamId, currentProfile.id)
      const invalidCount = importReviewRows.filter((row) => !row.canImport).length
      const totalCount = Number(estimatedTotalCount ?? importReviewRows.length)

      if (payloads.length === 0) {
        toast.error("导入失败", {
          description: "当前没有可导入的校准结果，请至少保留一条可导入数据。",
        })
        return
      }

      setImportDialogOpen(false)
      toast.info("导入任务已开始", {
        description: "系统正在按校准后的结果分批落库，你可以继续使用当前页面。",
      })

      await supabase.rpc("rpc_leads_import_mark_complete", {
        p_job_id: importJobId,
        p_status: "processing",
        p_total_count: totalCount,
        p_success_count: 0,
        p_duplicate_count: 0,
        p_error_message: null,
      })

      retryLoad()

      let importedCount = 0
      let failedCount = invalidCount
      let duplicateCount = 0

      for (let start = 0; start < payloads.length; start += IMPORT_BATCH_SIZE) {
        const batch = payloads.slice(start, start + IMPORT_BATCH_SIZE)
        const { data, error } = await supabase.rpc("rpc_leads_import_public_pool", {
          p_job_id: importJobId,
          p_rows: batch,
          p_mark_complete: false,
        })

        if (error) {
          throw error
        }

        const result = (data as any) ?? {}
        importedCount += Number(result.importedCount ?? result.successCount ?? 0)
        failedCount += Number(result.failedCount ?? 0)
        duplicateCount += Number(result.duplicateCount ?? 0)

        const processedCount = Math.min(start + batch.length + invalidCount, totalCount)
        if (processedCount < totalCount) {
          await supabase.rpc("rpc_leads_import_mark_complete", {
            p_job_id: importJobId,
            p_status: "processing",
            p_total_count: totalCount,
            p_success_count: importedCount,
            p_duplicate_count: duplicateCount,
            p_error_message: null,
          })
        }
      }

      await supabase.rpc("rpc_leads_import_mark_complete", {
        p_job_id: importJobId,
        p_status: "completed",
        p_total_count: totalCount,
        p_success_count: importedCount,
        p_duplicate_count: duplicateCount,
        p_error_message: null,
      })

      toast.success("导入任务已完成", {
        description: `本次共尝试导入 ${totalCount} 条线索，已成功导入 ${importedCount} 条，${failedCount} 条导入失败，${duplicateCount} 条重复已跳过`,
      })

      retryLoad()
      resetImport()
    } catch (err) {
      console.error("Failed to run batch import via rpc_leads_import_public_pool", err)
      try {
        await supabase.rpc("rpc_leads_import_mark_complete", {
          p_job_id: importJobId,
          p_status: "failed",
          p_total_count: estimatedTotalCount ?? null,
          p_success_count: null,
          p_duplicate_count: null,
          p_error_message: err instanceof Error ? err.message : "执行批量导入时出错",
        })
      } catch (markError) {
        console.error("Failed to mark import job as failed", markError)
      }

      toast.error("导入失败", {
        description: "执行批量导入时出错，请稍后重试",
      })
      retryLoad()
    } finally {
      setIsPreparingImportReview(false)
      setIsSubmittingImport(false)
    }
  }





const getDaysInPoolBadge = (days: number) => {
    if (days >= 14) {
      return <Badge variant="destructive" className="font-bold px-2.5 h-6">{days} 天</Badge>
    } else if (days >= 7) {
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-bold px-2.5 h-6">
          {days} 天
        </Badge>
      )
    }
    return <Badge variant="outline" className="font-semibold px-2.5 h-6 border-muted-foreground/20">{days} 天</Badge>
  }


  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">公海池</h1>
            <p className="text-sm text-muted-foreground mt-1 font-medium">加载公海数据中...</p>
          </div>
        </div>
        <TableSkeleton rows={6} />
      </div>
    )
  }

  if (!canViewPublicPool) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">公海池</h1>
          <p className="text-sm text-muted-foreground mt-2 font-medium">
            当前账号无权访问公海池，如需调整相关权限，请联系系统管理员。
          </p>
        </div>
      </div>
    )
  }


  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">公海池</h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">共 <span className="text-foreground font-bold">{leads.length}</span> 条待分配线索</p>
        </div>

        <div className="flex flex-col sm:flex-row w-full sm:w-auto items-stretch sm:items-center gap-2 sm:gap-3">
          {canAssignLeads && (
            <Button
              variant="default"
              disabled={selectedLeads.length === 0}
              onClick={() => {
                if (selectedLeads.length === 0) return
                handleAssign()
              }}
              className="font-bold shadow-sm w-full sm:w-auto justify-center"
            >
              <Users className="w-4 h-4 mr-2" />
              分配给销售 {selectedLeads.length > 0 && `(${selectedLeads.length})`}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={selectedLeads.length === 0 || !canAssignLeads}
            onClick={async () => {
              if (!canAssignLeads) {
                toast.error("没有认领线索的权限", {
                  description:
                    "请联系管理员在系统设置 → 角色权限中开启“线索分配/认领”相关权限。",
                })
                return
              }

              if (selectedLeads.length === 1) {
                await handleClaimToMe(selectedLeads[0]!)
              } else {
                for (const id of selectedLeads) {
                  await handleClaimToMe(id)
                }
              }
            }}
            className="font-semibold w-full sm:w-auto justify-center"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            认领到我的线索 {selectedLeads.length > 0 && `(${selectedLeads.length})`}
          </Button>
          <Button
            variant="outline"
            onClick={() => setImportDialogOpen(true)}
            disabled={isSubmittingImport}
            className="font-semibold w-full sm:w-auto justify-center"
          >
            <Upload className="w-4 h-4 mr-2" />
            {isSubmittingImport ? "导入处理中..." : "导入线索"}
          </Button>


          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full sm:w-auto justify-center">
                <Download className="w-4 h-4 mr-2" />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">

              <DropdownMenuItem
                onClick={async () => {
                  const supabase = getBrowserSupabaseClient()
                  try {
                    const { data: jobId, error } = await supabase.rpc("rpc_leads_export_request", {
                      p_source: "public_pool",
                      p_format: "xlsx",
                      p_filters: {
                        search: searchQuery || null,
                      },
                    })

                    if (error) {
                      const friendly = mapRpcError(error, {
                        title: "导出任务创建失败",
                        description: "创建导出任务失败，请稍后重试",
                      })
                      toast.error(friendly.title, { description: friendly.description })
                    } else {
                      // 直接导出当前公海数据为 Excel（先导出为 CSV，后续可接第三方库生成 xlsx）
                      const { data, error: leadsError } = await supabase
                        .from("leads_secure_view")
                        .select(
                          "name, website, customer_name, customer_phone, source, budget, stage, status, responsibility_type, source_level1, source_level2, activity_name, referral_customer_name, business_categories",
                        )
                        .eq("status", "pool")



                      if (leadsError) {
                        console.error("Failed to load leads for export (xlsx)", leadsError)
                        toast.error("导出失败", { description: "加载线索数据失败，请稍后重试" })
                      } else {
                        const rows = data ?? []
                        const header = ["公司名称", "网址", "联系人", "电话", "来源", "品类", "预算", "阶段", "状态"]
                        const csvLines = [
                          header.join(","),
                          ...rows.map((row: any) =>
                            [
                              row.name ?? "",
                              row.website ?? "",
                              row.customer_name ?? "",
                              row.customer_phone ?? "",
                              row.source ?? "",
                              Array.isArray(row.business_categories) ? row.business_categories.map((item: any) => item.name).join("、") : "",
                              row.budget ?? "",
                              row.stage ?? "",
                              row.status ?? "",
                            ]

                              .map((value) => {
                                const v = String(value ?? "")
                                if (v.includes(",") || v.includes("\"")) {
                                  return `"${v.replace(/"/g, '""')}"`
                                }
                                return v
                              })
                              .join(","),
                          ),
                        ]

                        const blob = new Blob([csvLines.join("\n")], {
                          type: "text/csv;charset=utf-8;",
                        })
                        const url = URL.createObjectURL(blob)
                        const link = document.createElement("a")
                        link.href = url
                        link.download = "public_pool_export.csv"
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                        URL.revokeObjectURL(url)

                        // 标记导出任务已完成
                        if (jobId) {
                          await supabase.rpc("rpc_leads_export_mark_complete", {
                            p_job_id: jobId,
                            p_status: "completed",
                            p_total_count: rows.length,
                            p_exported_count: rows.length,
                          })
                        }

                        toast.success("导出成功", {
                          description: `已导出 ${rows.length} 条公海线索到 CSV 文件`,
                        })
                      }

                      // 重新加载任务列表
                      retryLoad()
                    }
                  } catch (err) {
                    console.error("Failed to request leads export job (xlsx)", err)
                    toast.error("导出任务创建失败", {
                      description: "请稍后重试或联系管理员",
                    })
                  }
                }}
              >
                导出为 Excel
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  const supabase = getBrowserSupabaseClient()
                  try {
                    const { data: jobId, error } = await supabase.rpc("rpc_leads_export_request", {
                      p_source: "public_pool",
                      p_format: "csv",
                      p_filters: {
                        search: searchQuery || null,
                      },
                    })

                    if (error) {
                      const friendly = mapRpcError(error, {
                        title: "导出任务创建失败",
                        description: "创建导出任务失败，请稍后重试",
                      })
                      toast.error(friendly.title, { description: friendly.description })
                    } else {
                      const { data, error: leadsError } = await supabase
                        .from("leads_secure_view")
                        .select(
                          "name, website, customer_name, customer_phone, wechat, source, budget, stage, status, responsibility_type, source_level1, source_level2, business_categories",
                        )
                        .eq("status", "pool")


                      if (leadsError) {
                        console.error("Failed to load leads for export (csv)", leadsError)
                        toast.error("导出失败", { description: "加载线索数据失败，请稍后重试" })
                      } else {
                        const rows = data ?? []
                        const header = ["公司名称", "网址", "联系人", "电话", "微信号", "来源渠道", "品类", "预算(元)"]

                        const csvLines = [
                          header.join(","),
                          ...rows.map((row: any) =>
                            [
                              row.name ?? "",
                              row.website ?? "",
                              row.customer_name ?? "",
                              row.customer_phone ?? "",
                              row.wechat ?? "",
                              getPublicPoolExportSourceLabel(row),
                              Array.isArray(row.business_categories) ? row.business_categories.map((item: any) => item.name).join("、") : "",
                              row.budget ?? "",
                            ]

                              .map((value) => {
                                const v = String(value ?? "")
                                if (v.includes(",") || v.includes("\"") || v.includes("\n")) {
                                  return `"${v.replace(/"/g, '""')}"`
                                }
                                return v
                              })
                              .join(","),
                          ),
                        ]

                        const blob = new Blob([csvLines.join("\n")], {
                          type: "text/csv;charset=utf-8;",
                        })
                        const url = URL.createObjectURL(blob)
                        const link = document.createElement("a")
                        link.href = url
                        link.download = "public_pool_export.csv"
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                        URL.revokeObjectURL(url)

                        if (jobId) {
                          await supabase.rpc("rpc_leads_export_mark_complete", {
                            p_job_id: jobId,
                            p_status: "completed",
                            p_total_count: rows.length,
                            p_exported_count: rows.length,
                          })
                        }

                        toast.success("导出成功", {
                          description: `已导出 ${rows.length} 条公海线索到 CSV 文件`,
                        })
                      }

                      retryLoad()
                    }
                  } catch (err) {
                    console.error("Failed to request leads export job (csv)", err)
                    toast.error("导出任务创建失败", {
                      description: "请稍后重试或联系管理员",
                    })
                  }
                }}
              >
                导出为 CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loadError && (
        <RpcErrorBanner
          error={loadError}
          onRetry={loadError.canRetry ? retryLoad : undefined}
          onDismiss={() => setLoadError(null)}
          retryLabel="重试加载"
        />
      )}

      {isSubmittingImport && importJobId && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <Clock className="h-4 w-4" />
          <span>导入任务正在后台执行，页面可继续操作，任务列表会自动刷新。</span>
        </div>
      )}


      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索公司名称、网址、联系人、电话..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm">
              <Filter className="w-4 h-4 mr-2" />
              筛选
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedLeads.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium text-primary">已选择 {selectedLeads.length} 条线索</span>
          <Button variant="ghost" size="sm" onClick={() => setSelectedLeads([])}>
            取消选择
          </Button>
        </div>
      )}


      {/* Table - responsive with horizontal scroll on mobile */}
      <Card className="border-muted-foreground/10">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="全选"
                    className={isSomeSelected ? "data-[state=checked]:bg-primary/50" : ""}
                  />
                </TableHead>
                <TableHead className="w-[200px] min-w-[180px] font-bold text-foreground">公司名称</TableHead>
                <TableHead className="w-[260px] min-w-[200px] font-bold text-foreground">网址</TableHead>
                <TableHead className="min-w-[80px] font-bold text-foreground">联系人</TableHead>
                <TableHead className="min-w-[120px] font-bold text-foreground">电话</TableHead>
                <TableHead className="min-w-[110px] font-bold text-foreground">微信号</TableHead>
                <TableHead className="min-w-[80px] font-bold text-foreground">来源</TableHead>
                <TableHead className="min-w-[120px] font-bold text-foreground">品类</TableHead>

                <TableHead className="min-w-[80px] font-bold text-foreground">预算</TableHead>
                <TableHead className="min-w-[100px] font-bold text-foreground">最后阶段</TableHead>
                <TableHead className="min-w-[120px] font-bold text-foreground">退回原因</TableHead>
                <TableHead className="min-w-[120px] font-bold text-foreground">最近退回人</TableHead>
                <TableHead className="text-center min-w-[100px] font-bold text-foreground">
                  <div className="flex items-center justify-center gap-1">
                    <Clock className="w-4 h-4" />
                    池内天数
                  </div>
                </TableHead>
                <TableHead className="text-right min-w-[100px] font-bold text-foreground">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLeads.map((lead) => (
                <TableRow key={lead.id} className={cn("transition-colors", selectedLeads.includes(lead.id) ? "bg-primary/5" : "hover:bg-muted/20")}>
                  <TableCell>
                    <Checkbox
                      checked={selectedLeads.includes(lead.id)}
                      onCheckedChange={(checked) => handleSelectLead(lead.id, checked as boolean)}
                      aria-label={`选择 ${lead.company}`}
                    />
                  </TableCell>
                  <TableCell className="font-bold text-sm text-foreground">{lead.company}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[220px] break-all">
                    {lead.website}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{lead.contact}</TableCell>
                  <TableCell className="font-mono text-sm font-medium text-foreground/80">{lead.phone}</TableCell>
                  <TableCell className="font-mono text-xs text-foreground/80">
                    {lead.wechat || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>

                    <Badge variant="outline" className="text-xs font-medium border-muted-foreground/20">{lead.source}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {lead.categories.length > 0 ? lead.categories.map((category) => (
                        <Badge key={category.id} variant="outline" className="text-xs border-primary/30 text-primary">{category.name}</Badge>
                      )) : <span className="text-xs text-muted-foreground">历史数据未填写</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-bold text-primary">{lead.budget}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs font-semibold bg-muted/60">{lead.lastStage}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm leading-tight max-w-[150px] truncate">{lead.returnReason}</TableCell>
                  <TableCell>
                    {lead.returnedById ? (
                      <span className="text-sm font-semibold text-foreground/80">{repNameById[lead.returnedById] ?? "未知成员"}</span>
                    ) : lead.importedById ? (
                      <span className="text-xs text-muted-foreground italic">
                        由 {repNameById[lead.importedById] ?? "未知成员"} 导入
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{getDaysInPoolBadge(lead.daysInPool)}</TableCell>


                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            if (!canAssignLeads) {
                              toast.error("没有认领线索的权限", {
                                description:
                                  "请联系管理员在系统设置 → 角色权限中开启“线索分配/认领”相关权限。",
                              })
                              return
                            }
                            void handleClaimToMe(lead.id)
                          }}
                        >
                          <UserPlus className="w-4 h-4 mr-2" /> 认领到我的线索
                        </DropdownMenuItem>
                        {canAssignLeads && (
                          <DropdownMenuItem
                            onClick={() => {
                              handleAssign(lead.id)
                            }}
                          >
                            <Users className="w-4 h-4 mr-2" /> 分配给销售
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => {
                            void openDetailDialog(lead)
                          }}
                        >
                          查看详情
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            void openDetailDialog(lead)
                          }}
                        >
                          查看跟进历史
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            // 这里只负责打开删除确认弹窗，真正的权限校验交给后端 RPC
                            setDeleteTargetLead(lead)
                            setDeleteDialogOpen(true)
                          }}
                          disabled={deletingLeadId === lead.id}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> 删除线索
                        </DropdownMenuItem>

                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filteredLeads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="h-24 text-center text-muted-foreground">
                    暂无符合条件的线索
                  </TableCell>
                </TableRow>
              )}

            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">分配线索给销售</DialogTitle>
            <DialogDescription className="text-sm font-medium">
              正在分配 <strong className="text-primary">{selectedLeads.length}</strong> 条选中的线索
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-4">
            {/* Selected leads summary */}
            <div className="p-4 bg-muted/50 rounded-xl border border-muted/30">
              <p className="text-sm font-bold mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                已选择线索：
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedLeads.slice(0, 5).map((id) => {
                  const lead = leads.find((l) => l.id === id)
                  return lead ? (
                    <Badge key={id} variant="secondary" className="text-xs font-semibold px-2 py-0.5 bg-background border">
                      {lead.company}
                    </Badge>
                  ) : null
                })}
                {selectedLeads.length > 5 && (
                  <Badge variant="outline" className="text-xs font-bold">
                    +{selectedLeads.length - 5} 更多
                  </Badge>
                )}
              </div>
            </div>

            {/* Sales Rep Select */}
            <div className="space-y-2">
              <Label htmlFor="rep" className="text-sm font-bold">分配给 *</Label>
              <Select value={assignToRep} onValueChange={setAssignToRep}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="选择销售人员" />
                </SelectTrigger>
                <SelectContent>
                  {salesReps.map((rep) => (
                    <SelectItem key={rep.id} value={rep.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{rep.name}</span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">({rep.activeLeads} 条在跟进)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Assignment Note */}
            <div className="space-y-2">
              <Label htmlFor="note" className="text-sm font-bold">分配备注 (可选)</Label>
              <Textarea
                id="note"
                placeholder="例如：尽快跟进，客户预算充足..."
                value={assignmentNote}
                onChange={(e) => setAssignmentNote(e.target.value)}
                className="min-h-[100px] text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} className="font-semibold">
              取消
            </Button>
            <Button onClick={confirmAssignment} disabled={!assignToRep || selectedLeads.length === 0 || isAssigning} className="font-bold shadow-md shadow-primary/10">
              {isAssigning ? "分配中..." : "确认分配"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Lead Detail Dialog */}
      <Dialog
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open)
          if (!open) {
            setDetailLead(null)
            setInteractions([])
            setInteractionsError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold tracking-tight">
              {detailLead?.company || detailLead?.website || "线索详情"}
            </DialogTitle>
            {detailLead && (
              <DialogDescription className="text-sm font-medium flex flex-col gap-1 mt-1">
                {detailLead.website && (
                  <span className="text-xs text-muted-foreground break-all">{detailLead.website}</span>
                )}
                <div className="flex items-center gap-2">
                  {detailLead.contact && <span className="text-foreground/80">{detailLead.contact}</span>}
                  {detailLead.phone && (
                    <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded border border-muted-foreground/10 text-muted-foreground">
                      {detailLead.phone}
                    </span>
                  )}
                </div>
              </DialogDescription>
            )}
          </DialogHeader>
          {detailLead && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-5 text-sm border-y border-muted/50 py-5">
                <div>
                  <span className="text-sm font-bold text-muted-foreground block mb-1.5">来源渠道</span>
                  <Badge variant="outline" className="text-sm font-medium border-primary/20 bg-primary/5 text-primary">
                    {detailLead.source}
                  </Badge>
                </div>
                <div>
                  <span className="text-sm font-bold text-muted-foreground block mb-1.5">最后阶段</span>
                  <Badge variant="secondary" className="text-sm font-bold bg-muted/80">
                    {detailLead.lastStage}
                  </Badge>
                </div>
                <div>
                  <span className="text-sm font-bold text-muted-foreground block mb-1.5">预算规模</span>
                  <div className="text-base font-bold text-primary tracking-tight">{detailLead.budget}</div>
                </div>
                <div>
                  <span className="text-sm font-bold text-muted-foreground block mb-1.5">退回原因</span>
                  <div className="text-sm font-medium text-foreground/70 leading-relaxed">
                    {detailLead.returnReason || "退回原因未记录"}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-bold text-muted-foreground block mb-1.5">进入公海时间</span>
                  <div className="text-sm font-medium text-foreground/70">{detailLead.returnedAt || "--"}</div>
                </div>
                <div>
                  <span className="text-sm font-bold text-muted-foreground block mb-1.5">池内天数</span>
                  <div className="flex items-center gap-1.5">
                    {getDaysInPoolBadge(detailLead.daysInPool)}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold text-foreground">跟进记录回顾</span>
                </div>
                {isLoadingInteractions && (
                  <div className="flex flex-col items-center justify-center py-10 space-y-2">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-muted-foreground font-medium">深度同步历史跟进记录...</p>
                  </div>
                )}
                {interactionsError && !isLoadingInteractions && (
                  <p className="text-sm text-destructive font-medium bg-destructive/5 p-3 rounded-lg border border-destructive/10">
                    {interactionsError.description}
                  </p>
                )}
                {!isLoadingInteractions && !interactionsError && interactions.length === 0 && (
                  <div className="text-center py-10 bg-muted/20 rounded-xl border border-dashed border-muted-foreground/20">
                    <p className="text-sm text-muted-foreground font-medium">暂无历史跟进记录</p>
                  </div>
                )}
                {!isLoadingInteractions && interactions.length > 0 && (
                  <div className="space-y-4 max-h-[300px] overflow-y-auto border border-muted/50 rounded-xl p-4 bg-muted/10 shadow-inner">
                    {interactions.map((item) => (
                      <div key={item.id} className="text-sm space-y-2 pb-4 border-b border-muted/30 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-foreground/90">{item.author}</span>
                          <span className="text-xs text-muted-foreground font-medium">{item.date}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Badge variant="outline" className="w-fit text-[11px] font-bold h-5 px-1.5">
                            {item.type === "call" && "电话互动"}
                            {item.type === "wechat" && "微信沟通"}
                            {item.type === "visit" && "线下拜访"}
                          </Badge>
                          <p className="text-sm text-foreground/80 leading-relaxed pl-1 border-l-2 border-primary/20">{item.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* Delete Lead Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) {
            setDeleteTargetLead(null)
            setDeletingLeadId(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除线索</DialogTitle>
            <DialogDescription>
              确认要删除线索
              {deleteTargetLead ? (
                <span className="font-medium">「{deleteTargetLead.company}」</span>
              ) : null}
              吗？删除后该线索会从当前列表中移除，相关操作会记录在审计日志中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteTargetLead(null)
                setDeletingLeadId(null)
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteTargetLead || deletingLeadId === deleteTargetLead?.id || !canDeleteLeads}
              onClick={async () => {
                if (!deleteTargetLead) return
                if (!canDeleteLeads) {
                  toast.error("没有删除线索的权限", {
                    description: "请联系管理员在系统设置 → 角色权限中开启“删除线索”权限",
                  })
                  return
                }

                try {
                  setDeletingLeadId(deleteTargetLead.id)
                  const supabase = getBrowserSupabaseClient()
                  const { error } = await supabase.rpc("rpc_lead_delete", {
                    p_lead_id: deleteTargetLead.id,
                    p_reason: "从公海池删除线索",
                  })

                  if (error) {
                    const friendly = mapRpcError(error, {
                      title: "删除线索失败",
                      description: "删除线索失败，请稍后重试或联系管理员",
                    })
                    toast.error(friendly.title, {
                      description: friendly.description,
                    })
                    return
                  }

                  toast.success("线索已删除", {
                    description: `${deleteTargetLead.company} 已从公海池中移除，相关操作已记录`,
                  })
                  setLeads((prev) => prev.filter((l) => l.id !== deleteTargetLead.id))
                  setDeleteDialogOpen(false)
                  setDeleteTargetLead(null)
                  setDeletingLeadId(null)
                } catch (err) {
                  console.error("Failed to delete lead from public pool", err)
                  toast.error("删除线索失败", {
                    description: "请稍后重试或联系管理员",
                  })
                }
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCancelImport()
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>导入到公海池</DialogTitle>
            <DialogDescription>支持标准模板直接导入公海，也支持非标准表格通过 AI 清洗后导入公海</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {importStage === "idle" && (
              <>
                {/* Drop Zone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50",
                  )}
                >
                  <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-sm font-medium text-foreground mb-1">拖拽文件到此处上传</p>
                  <p className="text-xs text-muted-foreground mb-4">支持 .xlsx、.xls、.csv 格式</p>
                  <label>
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" />
                    <Button variant="outline" size="sm" asChild>
                      <span>选择文件</span>
                    </Button>
                  </label>
                </div>

                {/* Template Download */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">下载公海标准模板</span>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <a href="/public_pool_import_template.csv" download>
                      <Download className="w-4 h-4" />
                    </a>
                  </Button>
                </div>

              </>
            )}

            {(importStage === "uploading" || importStage === "checking" || importStage === "complete") && (
              <div className="space-y-4">
                {/* File Info */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-8 h-8 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{uploadedFile?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {uploadedFile && (uploadedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  {importStage !== "complete" && (
                    <Button variant="ghost" size="icon" onClick={resetImport}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                {/* Progress */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {importStage === "uploading" && "正在上传文件并准备 AI 分析..."}
                      {importStage === "checking" && "AI 正在理解表格结构并检查冲突..."}
                      {importStage === "complete" &&
                        (importBypassedAi
                          ? "已识别为公海标准模板，当前按规则直导公海，无需等待 AI 分析"
                          : importAiStatus === "processing"
                          ? "规则预览已生成，AI 正在后台分析，完成后才可开始导入"
                          : importAiInsight
                          ? "AI 预检查完成，导入过程将在后台执行"
                          : importAiError
                            ? "AI 调用失败，当前展示规则兜底预览"
                            : "预检查完成，当前展示规则兜底预览")}

                    </span>

                    <span className="font-medium">{importProgress}%</span>
                  </div>

                  <Progress value={importProgress} className="h-2" />
                </div>

                {/* Conflict Check Result */}
                {importStage === "complete" && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 bg-green-50 text-green-800 rounded-lg">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="text-sm font-medium">
                        已预检查 {estimatedTotalCount ?? parsedImportRows?.length ?? 0} 条线索数据
                      </span>
                    </div>
                    {importAiInsight && (
                      <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-950">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold">AI 主导识别已完成</p>
                            <p className="text-xs text-blue-900/80">
                              {importAiInsight.summary || "系统已结合表头、样本内容和业务语义完成智能识别。"}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="secondary" className="bg-white/80 text-blue-900 border border-blue-200">
                              整体置信度：{formatImportConfidence(importAiInsight.overallConfidence)}
                            </Badge>
                            <Badge variant="secondary" className="bg-white/80 text-blue-900 border border-blue-200">
                              AI 预览识别 {importAiInsight.aiEnhancedCount} 行
                            </Badge>
                            {importAiInsight.reviewNeededCount > 0 && (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-900 border border-amber-200">
                                {importAiInsight.reviewNeededCount} 行建议重点关注
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {Object.entries(IMPORT_FIELD_LABELS).map(([field, label]) => (
                            <div key={field} className="rounded-md bg-white/70 px-2 py-1.5 border border-blue-100">
                              <div className="text-[11px] text-blue-900/70">{label}</div>
                              <div className="text-xs font-semibold text-blue-950">
                                {formatImportConfidence(importAiInsight.fieldConfidence[field as keyof typeof IMPORT_FIELD_LABELS])}
                              </div>
                            </div>
                          ))}
                        </div>
                        {importAiInsight.warnings.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {importAiInsight.warnings.map((warning, index) => (
                              <span
                                key={`${warning}-${index}`}
                                className="inline-flex items-center rounded-full border border-blue-200 bg-white/80 px-2.5 py-1 text-[11px] text-blue-900"
                              >
                                {warning}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {importAiStatus === "processing" && (
                      <div className="flex items-start gap-2 p-3 bg-blue-50 text-blue-900 rounded-lg border border-blue-200">
                        <Clock className="w-5 h-5 mt-0.5" />
                        <div className="text-sm">
                          <div className="font-medium">AI 正在后台分析表格</div>
                          <div className="text-blue-800/90">
                            当前先展示规则预览，开始后台导入按钮会在 AI 分析完成后自动解锁。
                          </div>
                        </div>
                      </div>
                    )}
                    {!importAiInsight && importAiError && (
                      <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-900 rounded-lg border border-amber-200">
                        <AlertTriangle className="w-5 h-5 mt-0.5" />
                        <div className="text-sm">
                          <div className="font-medium">本次预览未成功调用 AI</div>
                          <div className="text-amber-800/90 break-all">
                            当前展示的是规则兜底结果，原因：{importAiError}
                          </div>
                        </div>
                      </div>
                    )}
                    {duplicatesFound > 0 && (

                      <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg">
                        <AlertTriangle className="w-5 h-5" />
                        <span className="text-sm font-medium">基于样本检测到约 {duplicatesFound} 条重复手机号，实际以导入结果为准</span>
                      </div>
                    )}
                    {invalidBasicInfoCount > 0 && (
                      <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg">
                        <AlertTriangle className="w-5 h-5" />
                        <span className="text-sm font-medium">样本中约有 {invalidBasicInfoCount} 条记录缺少基础信息，将在导入时跳过</span>
                      </div>
                    )}
                    {parsedImportRows && parsedImportRows.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {importAiInsight ? "AI 导入预览" : "导入预览（规则兜底）"}（前 {importPreviewRows.length} 条 / 共 {estimatedTotalCount ?? parsedImportRows.length} 条）
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {importAiInsight ? "AI 预览重点识别前 20 条；正式后台导入时会对全量数据分批做 AI 标准化后再落库" : "AI 未成功返回时，预览按规则映射和兜底逻辑生成"}
                          </span>

                        </div>
                        <div className="border rounded-md bg-background max-h-72 overflow-auto overflow-x-auto">
                          <Table>
                            <TableHeader className="bg-muted/40 sticky top-0 z-10">
                              <TableRow>
                                <TableHead className="text-xs font-semibold text-foreground/80">公司名称</TableHead>
                                <TableHead className="text-xs font-semibold text-foreground/80">网址</TableHead>
                                <TableHead className="text-xs font-semibold text-foreground/80">联系人</TableHead>
                                <TableHead className="text-xs font-semibold text-foreground/80">电话</TableHead>
                                <TableHead className="text-xs font-semibold text-foreground/80">微信号</TableHead>
                                <TableHead className="text-xs font-semibold text-foreground/80">来源渠道</TableHead>
                                <TableHead className="text-xs font-semibold text-foreground/80">品类</TableHead>
                                <TableHead className="text-xs font-semibold text-foreground/80 text-right">预算(元)</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {importPreviewRows.map((row) => (
                                <TableRow
                                  key={row.rowIndex}
                                  className={cn(
                                    row.aiEnhanced && "bg-blue-50/35",
                                    (row.issues.length > 0 || isImportConfidenceLow(row.confidence)) && "bg-amber-50/45",
                                  )}
                                >
                                  <TableCell className="text-xs font-medium align-top">
                                    <div>{row.values[0] || "未填写公司名称"}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      {row.aiEnhanced && (
                                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-blue-200 text-blue-700">
                                          AI
                                        </Badge>
                                      )}
                                      {row.confidence != null && (
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "h-5 px-1.5 text-[10px]",
                                            isImportConfidenceLow(row.confidence)
                                              ? "border-amber-200 text-amber-700"
                                              : "border-emerald-200 text-emerald-700",
                                          )}
                                        >
                                          置信度 {formatImportConfidence(row.confidence)}
                                        </Badge>
                                      )}
                                    </div>
                                    {row.issues.length > 0 && (
                                      <div className="mt-1 text-[10px] leading-4 text-amber-700">
                                        {row.issues.slice(0, 2).join("；")}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-[11px] text-muted-foreground break-all max-w-[120px] align-top">
                                    {row.values[1] || "-"}
                                  </TableCell>
                                  <TableCell className="text-xs align-top">{row.values[2] || "-"}</TableCell>
                                  <TableCell className="text-xs font-mono align-top">{row.values[3] || "-"}</TableCell>
                                  <TableCell className="text-xs align-top">{row.values[4] || "-"}</TableCell>
                                  <TableCell className="text-xs align-top">{row.values[5] || "-"}</TableCell>
                                  <TableCell className="text-xs align-top">{row.values[7] || "历史数据未填写"}</TableCell>
                                  <TableCell className="text-xs text-right align-top">{row.values[6] || "-"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                    {importReviewRows && importReviewRows.length > 0 && (
                      <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-emerald-950">全量 AI 结果已生成，落库前兜底校准</p>
                            <p className="text-xs text-emerald-900/80">
                              AI 已经完成全量标准化；这里只需要处理异常、低置信度或你想手动修正的行。
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <Badge variant="secondary" className="bg-white/80 text-emerald-900 border border-emerald-200">
                              可导入 {importReviewSummary.selectedCount} 条
                            </Badge>
                            <Badge variant="secondary" className="bg-white/80 text-emerald-900 border border-emerald-200">
                              跳过 {importReviewSummary.skippedCount} 条
                            </Badge>
                            <Badge variant="secondary" className="bg-white/80 text-emerald-900 border border-emerald-200">
                              低置信度 {importReviewSummary.lowConfidenceCount} 条
                            </Badge>
                            <Badge variant="secondary" className="bg-white/80 text-emerald-900 border border-emerald-200">
                              有问题提示 {importReviewSummary.issueCount} 条
                            </Badge>
                            <Badge variant="secondary" className="bg-white/80 text-emerald-900 border border-emerald-200">
                              待校准 {importReviewSummary.focusCount} 条
                            </Badge>
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 rounded-md border border-emerald-200/80 bg-white/70 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <label className="flex items-center gap-2 text-xs text-emerald-950">
                              <Checkbox
                                checked={showOnlyReviewFocusRows}
                                onCheckedChange={(checked) => setShowOnlyReviewFocusRows(checked === true)}
                              />
                              只看待校准项
                            </label>
                            <p className="text-xs text-emerald-900/80">
                              当前显示 {visibleImportReviewRows.length} / {importReviewSummary.totalCount} 条，
                              默认优先展示不可导入、低置信度或有问题提示的行。
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={handleSkipFocusRows}>
                              跳过待校准项
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={handleRestoreFocusRows}>
                              恢复待校准项
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setShowOnlyReviewFocusRows((current) => !current)}
                            >
                              {showOnlyReviewFocusRows ? "展开全部" : "收起正常项"}
                            </Button>
                          </div>
                        </div>
                        <div className="border rounded-md bg-background max-h-[28rem] overflow-auto">
                          <Table>
                            <TableHeader className="bg-muted/40 sticky top-0 z-10">
                              <TableRow>
                                <TableHead className="text-xs">导入</TableHead>
                                <TableHead className="text-xs">公司名称</TableHead>
                                <TableHead className="text-xs">网址</TableHead>
                                <TableHead className="text-xs">联系人</TableHead>
                                <TableHead className="text-xs">电话</TableHead>
                                <TableHead className="text-xs">微信号</TableHead>
                                <TableHead className="text-xs">一级来源</TableHead>
                                <TableHead className="text-xs">二级来源</TableHead>
                                <TableHead className="text-xs">品类</TableHead>
                                <TableHead className="text-xs">预算</TableHead>
                                <TableHead className="text-xs">问题提示</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {visibleImportReviewRows.map((row) => (
                                <TableRow
                                  key={row.rowIndex}
                                  className={cn(
                                    !row.canImport && "bg-amber-50/60",
                                    isImportConfidenceLow(row.confidence) && "bg-blue-50/50",
                                  )}
                                >
                                  <TableCell className="align-top">
                                    <Checkbox
                                      checked={row.canImport}
                                      onCheckedChange={(checked) =>
                                        updateImportReviewRow(row.rowIndex, { canImport: checked === true })
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-[180px] align-top">
                                    <Input
                                      value={row.company}
                                      onChange={(event) => updateImportReviewRow(row.rowIndex, { company: event.target.value })}
                                      className="h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-[180px] align-top">
                                    <Input
                                      value={row.website}
                                      onChange={(event) => updateImportReviewRow(row.rowIndex, { website: event.target.value })}
                                      className="h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-[120px] align-top">
                                    <Input
                                      value={row.contact}
                                      onChange={(event) => updateImportReviewRow(row.rowIndex, { contact: event.target.value })}
                                      className="h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-[130px] align-top">
                                    <Input
                                      value={row.phone}
                                      onChange={(event) => updateImportReviewRow(row.rowIndex, { phone: event.target.value })}
                                      className="h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-[130px] align-top">
                                    <Input
                                      value={row.wechat}
                                      onChange={(event) => updateImportReviewRow(row.rowIndex, { wechat: event.target.value })}
                                      className="h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-[110px] align-top">
                                    <div className="h-8 px-2 border rounded-md bg-muted/40 text-xs flex items-center text-muted-foreground">
                                      公司分配资源
                                    </div>
                                  </TableCell>
                                  <TableCell className="min-w-[180px] align-top">
                                    <Select
                                      value={row.sourceKey || "__empty__"}
                                      onValueChange={(value) => {
                                        if (value === "__empty__") {
                                          updateImportReviewRow(row.rowIndex, { sourceKey: "", sourceLabel: "" })
                                          return
                                        }
                                        const option = importSourceOptions.find((item) => item.key === value)
                                        updateImportReviewRow(row.rowIndex, {
                                          sourceKey: option?.key ?? "",
                                          sourceLabel: option?.label ?? "",
                                        })
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="选择二级来源" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__empty__">不导入该来源</SelectItem>
                                        {importSourceOptions.map((option) => (
                                          <SelectItem key={option.key} value={option.key}>
                                            {option.groupLabel} / {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="min-w-[140px] align-top">
                                    <Select
                                      value={row.category.trim() ? row.category : "__empty__"}
                                      onValueChange={(value) =>
                                        updateImportReviewRow(row.rowIndex, { category: value === "__empty__" ? "" : value })
                                      }
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="选择品类（可留空兼容旧模板）" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__empty__">使用默认品类</SelectItem>
                                        {businessCategoryOptions.map((option) => (
                                          <SelectItem key={option.id} value={option.name}>
                                            {option.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="min-w-[100px] align-top">
                                    <Input
                                      value={row.budget}
                                      onChange={(event) => updateImportReviewRow(row.rowIndex, { budget: event.target.value })}
                                      className="h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-[220px] align-top whitespace-normal">
                                    <div className="space-y-1">
                                      <div className="flex flex-wrap gap-1">
                                        {row.aiEnhanced && (
                                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-blue-200 text-blue-700">
                                            AI
                                          </Badge>
                                        )}
                                        {row.confidence != null && (
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "h-5 px-1.5 text-[10px]",
                                              isImportConfidenceLow(row.confidence)
                                                ? "border-amber-200 text-amber-700"
                                                : "border-emerald-200 text-emerald-700",
                                            )}
                                          >
                                            置信度 {formatImportConfidence(row.confidence)}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="text-[11px] leading-4 text-muted-foreground whitespace-normal">
                                        {row.issues.length > 0 ? row.issues.join("；") : "无明显异常"}
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {visibleImportReviewRows.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">
                                    当前没有待校准项。你可以取消“只看待校准项”来查看全部 AI 结果。
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                )}


              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelImport}>
              取消
            </Button>
            <Button
              disabled={
                importStage !== "complete" ||
                isSubmittingImport ||
                isPreparingImportReview ||
                importAiStatus === "processing"
              }
              onClick={handleConfirmImport}
            >
              {isPreparingImportReview
                ? "AI 全量分析中..."
                : isSubmittingImport
                  ? importReviewRows
                    ? "正在确认导入..."
                    : "正在生成导入结果..."
                  : importAiStatus === "processing"
                    ? "等待 AI 分析完成..."
                    : importReviewRows
                      ? "确认校准结果并导入"
                      : importStage === "complete"
                        ? "生成全量 AI 结果"
                        : "开始导入"}

            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
