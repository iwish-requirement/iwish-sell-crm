"use client"

import React, { useState, useCallback, useEffect, useMemo } from "react"
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

interface PoolLead {
  id: string
  company: string
  contact: string
  phone: string
  source: string
  budget: string
  lastStage: string
  returnReason: string
  daysInPool: number
  returnedAt: string
  returnedById: string | null
  importedById: string | null
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

// 公海池初始列表由 Supabase 加载，这里保留一个空数组占位，防止误以为还有本地 mock 数据
const mockPoolLeads: PoolLead[] = [
  {
    id: "PL001",
    company: "北京云智科技有限公司",
    contact: "刘总",
    phone: "138****5521",
    source: "抖音",
    budget: "15-20万",
    lastStage: "L2 意向",
    returnReason: "超过7天未跟进",
    daysInPool: 12,
    returnedAt: "2025-01-22",
  },
  {
    id: "PL002",
    company: "深圳创新智能科技",
    contact: "陈经理",
    phone: "139****8832",
    source: "线下展会",
    budget: "8-12万",
    lastStage: "L1 初步接触",
    returnReason: "销售离职",
    daysInPool: 5,
    returnedAt: "2025-01-29",
  },
  {
    id: "PL003",
    company: "杭州数据服务公司",
    contact: "王女士",
    phone: "137****2210",
    source: "官网表单",
    budget: "20-30万",
    lastStage: "L3 商务",
    returnReason: "主动释放",
    daysInPool: 3,
    returnedAt: "2025-01-31",
  },
  {
    id: "PL004",
    company: "广州智慧物流有限公司",
    contact: "张总监",
    phone: "136****9901",
    source: "转介绍",
    budget: "5-8万",
    lastStage: "L1 初步接触",
    returnReason: "超过7天未跟进",
    daysInPool: 18,
    returnedAt: "2025-01-16",
  },
  {
    id: "PL005",
    company: "成都软件开发集团",
    contact: "李主管",
    phone: "135****4478",
    source: "抖音",
    budget: "10-15万",
    lastStage: "L2 意向",
    returnReason: "客户暂无预算",
    daysInPool: 8,
    returnedAt: "2025-01-26",
  },
  {
    id: "PL006",
    company: "武汉工业自动化",
    contact: "赵工",
    phone: "158****3345",
    source: "线下展会",
    budget: "25-35万",
    lastStage: "L2 意向",
    returnReason: "超过7天未跟进",
    daysInPool: 21,
    returnedAt: "2025-01-13",
  },
]

type ImportStage = "idle" | "uploading" | "checking" | "complete"

export function PublicPool() {
  const [leads, setLeads] = useState<PoolLead[]>([])
  const mePermissions = React.useContext(MePermissionsContext)
  const canAssignLeads = mePermissions?.canAssignLeads ?? false
  const canDeleteLeads = mePermissions?.canDeleteLeads ?? false
  const [searchQuery, setSearchQuery] = useState("")
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [claimingLeadId, setClaimingLeadId] = useState<string | null>(null)
  const [selectedLeads, setSelectedLeads] = useState<string[]>([])
  const [assignToRep, setAssignToRep] = useState("")
  const [assignmentNote, setAssignmentNote] = useState("")

  const [salesReps, setSalesReps] = useState<SalesRep[]>(EMPTY_SALES_REPS)
  const [isAssigning, setIsAssigning] = useState(false)
  const [loadSalesRepsError, setLoadSalesRepsError] = useState<string | null>(null)

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
  const [parsedImportRows, setParsedImportRows] = useState<string[][] | null>(null)
  const [isSubmittingImport, setIsSubmittingImport] = useState(false)

  const [importJobs, setImportJobs] = useState<LeadImportJob[]>([])
  const [exportJobs, setExportJobs] = useState<LeadExportJob[]>([])
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<RpcErrorFriendly | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTargetLead, setDeleteTargetLead] = useState<PoolLead | null>(null)
  const retryLoad = useCallback(() => setReloadToken((t) => t + 1), [])

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
            "id, name, stage, status, source, customer_name, customer_phone, budget, updated_at, created_by",
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

        const ids =
          data?.map((row: any) => row.id as string).filter((id: string | null) => !!id) ?? []
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
          data?.map((row: any) => {
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
              contact: (row.customer_name as string) ?? "未填写联系人",
              phone: (row.customer_phone as string) ?? "",
              source: (row.source as string) ?? "其他",
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
        const [{ data, error }, exclusionResult] = await Promise.all([
          supabase
            .from("profiles_public")
            .select("id, full_name")
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

        setLoadSalesRepsError(null)

        const excludedProfileIds = new Set<string>(
          exclusionResult.data && (exclusionResult.data as any).value &&
          Array.isArray(((exclusionResult.data as any).value as any).profile_ids)
            ? (((exclusionResult.data as any).value as any).profile_ids as any[]).filter(
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
      toast.error("没有分配线索的权限", {
        description: "请联系管理员在系统设置 → 角色权限中开启“线索分配/认领”相关权限。",
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
    setImportProgress(0)
    setDuplicatesFound(0)
    setParsedImportRows(null)

    try {
      const ext = file.name.toLowerCase().split(".").pop()
      if (ext !== "csv") {
        toast.error("导入失败", {
          description: "当前版本仅支持 CSV 模板导入，请使用下载的 CSV 模板",
        })
        setImportStage("idle")
        setImportProgress(0)
        return
      }

      const text = await file.text()
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (lines.length <= 1) {
        toast.error("导入失败", {
          description: "导入文件为空或只有表头，请检查模板内容",
        })
        setImportStage("idle")
        setImportProgress(0)
        return
      }

      const rows = lines.slice(1)
      const parsed: string[][] = []
      const seenPhones = new Set<string>()
      let duplicateCount = 0

      rows.forEach((line) => {
        const cols = line.split(",").map((c) => c.trim())
        if (cols.length < 6) return
        const phone = cols[2] ?? ""
        const normalizedPhone = phone.replace(/[^0-9+]/g, "")
        if (normalizedPhone && seenPhones.has(normalizedPhone)) {
          duplicateCount += 1
          return
        }
        if (normalizedPhone) {
          seenPhones.add(normalizedPhone)
        }
        parsed.push(cols)
      })

      setParsedImportRows(parsed)
      setDuplicatesFound(duplicateCount)

      // 简单的进度动画：快速拉到 100%
      let progress = 0
      const interval = setInterval(() => {
        progress += 20
        if (progress >= 100) {
          progress = 100
          clearInterval(interval)
          setImportStage("complete")
        }
        setImportProgress(progress)
      }, 120)
    } catch (err) {
      console.error("Failed to parse import file", err)
      toast.error("导入失败", { description: "解析导入文件时出错，请稍后重试" })
      setImportStage("idle")
      setImportProgress(0)
    }
  }

  const resetImport = () => {
    setUploadedFile(null)
    setImportStage("idle")
    setImportProgress(0)
    setDuplicatesFound(0)
    setParsedImportRows(null)
  }

  const handleCancelImport = () => {
    setImportDialogOpen(false)
    setTimeout(resetImport, 300)
  }

  const handleConfirmImport = async () => {
    const supabase = getBrowserSupabaseClient()

    if (importStage === "complete" && uploadedFile && !isSubmittingImport && parsedImportRows) {
      try {
        setIsSubmittingImport(true)

        // 1) 先创建导入任务，保证审计与作业记录
        const { data: jobId, error } = await supabase.rpc("rpc_leads_import_request", {
          p_source: "public_pool",
          p_file_name: uploadedFile.name,
          p_file_size: uploadedFile.size,
          p_options: {},
        })

        if (error || !jobId) {
          const friendly = mapRpcError(error, {
            title: "导入任务创建失败",
            description: "创建导入任务失败，请稍后重试",
          })
          toast.error(friendly.title, { description: friendly.description })
        } else {
          // 2) 解析 CSV 模板并通过 RPC 将线索真正落库到公海池
          try {
            const ext = uploadedFile.name.toLowerCase().split(".").pop()
            if (ext !== "csv") {
              toast.error("导入失败", {
                description: "当前版本仅支持 CSV 模板导入，请使用下载的 CSV 模板",
              })
            } else {
              const text = await uploadedFile.text()
              const lines = text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0)

              if (lines.length <= 1) {
                toast.error("导入失败", {
                  description: "导入文件为空或只有表头，请检查模板内容",
                })
              } else {
                // 如果已经提前解析过，就直接使用缓存的 parsedImportRows；否则兜底重新解析一遍
                const rowsToUse = parsedImportRows ?? lines.slice(1).map((line) => line.split(",").map((c) => c.trim()))

                const {
                  data: userData,
                  error: userError,
                } = await supabase.auth.getUser()
                const userId = userData?.user?.id ?? null
                if (userError || !userId) {
                  throw new Error("无法获取当前登录用户信息")
                }

                const { data: profile, error: profileError } = await supabase
                  .from("profiles")
                  .select("id, team_id")
                  .eq("id", userId)
                  .maybeSingle()

                if (profileError || !profile?.team_id) {
                  throw new Error("无法获取当前用户的团队信息")
                }

                let importedCount = 0
                let failedCount = 0
                let dbDuplicateCount = 0

                const existingPhoneCache = new Map<string, boolean>()

                for (const cols of rowsToUse) {
                  if (cols.length < 6) continue

                  const [company, contact, phone, wechat, source, budgetStr] = cols.map((c) => c.trim())
                  const budget = budgetStr ? Number(budgetStr) : null

                  // 数据库级去重：若该手机号已存在可见线索，则跳过本行
                  const phoneKey = phone.trim()
                  if (phoneKey) {
                    let exists = existingPhoneCache.get(phoneKey)
                    if (exists === undefined) {
                      const { data: existing, error: existingError } = await supabase
                        .from("leads_secure_view")
                        .select("id, customer_phone")
                        .eq("customer_phone", phoneKey)
                        .limit(1)
                        .maybeSingle()

                      exists = !existingError && !!existing
                      existingPhoneCache.set(phoneKey, exists)
                    }

                    if (exists) {
                      dbDuplicateCount += 1
                      continue
                    }
                  }

                  const payload: any = {
                    team_id: profile.team_id,
                    owner_id: profile.id,
                    name: company,
                    source,
                    stage: "new",
                    status: "pool",
                    customer_name: contact,
                    customer_phone: phone,
                  }

                  if (budget !== null && !Number.isNaN(budget)) {
                    payload.budget = budget
                  }

                  const { error: createError } = await supabase.rpc("rpc_lead_create", {
                    payload,
                  })

                  if (createError) {
                    console.error("Failed to create lead from import", createError)
                    failedCount += 1
                  } else {
                    importedCount += 1
                  }
                }

                const totalDuplicates = duplicatesFound + dbDuplicateCount
                const totalCount = importedCount + failedCount + totalDuplicates

                // 导入完成后，回写导入任务统计
                if (jobId) {
                  try {
                    await supabase.rpc("rpc_leads_import_mark_complete", {
                      p_job_id: jobId,
                      p_status: "completed",
                      p_total_count: totalCount,
                      p_success_count: importedCount,
                      p_duplicate_count: totalDuplicates,
                      p_error_message: null,
                    })
                  } catch (markErr) {
                    console.error("Failed to mark import job complete", markErr)
                  }
                }

                toast.success("导入任务已创建", {
                  description: `已成功导入 ${importedCount} 条线索，${failedCount} 条导入失败，${totalDuplicates} 条重复已跳过`,
                })

                // 刷新公海列表和任务列表
                retryLoad()
              }
            }
          } catch (importErr) {
            console.error("Failed to import leads into pool", importErr)
            toast.error("导入失败", {
              description: "解析文件或写入线索时出错，请稍后重试",
            })
          }
        }
      } catch (err) {
        console.error("Failed to request leads import job", err)
        toast.error("导入任务创建失败", {
          description: "请稍后重试或联系管理员",
        })
      } finally {
        setIsSubmittingImport(false)
      }
    }

    setImportDialogOpen(false)
    setTimeout(resetImport, 300)
  }

  const getDaysInPoolBadge = (days: number) => {
    if (days >= 14) {
      return <Badge variant="destructive">{days} 天</Badge>
    } else if (days >= 7) {
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
          {days} 天
        </Badge>
      )
    }
    return <Badge variant="outline">{days} 天</Badge>
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">公海池</h1>
            <p className="text-sm text-muted-foreground mt-1">加载中...</p>
          </div>
        </div>
        <TableSkeleton rows={6} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">公海池</h1>
          <p className="text-sm text-muted-foreground mt-1">共 {leads.length} 条待分配线索</p>
        </div>
        <div className="flex items-center gap-3">
          {canAssignLeads && (
            <Button
              variant="default"
              disabled={selectedLeads.length === 0}
              onClick={() => {
                if (selectedLeads.length === 0) return
                handleAssign()
              }}
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
          >
            <UserPlus className="w-4 h-4 mr-2" />
            认领到我的线索 {selectedLeads.length > 0 && `(${selectedLeads.length})`}
          </Button>
          <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            导入线索
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
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
                        .select("name, customer_name, customer_phone, source, budget, stage, status")
                        .eq("status", "pool")

                      if (leadsError) {
                        console.error("Failed to load leads for export (xlsx)", leadsError)
                        toast.error("导出失败", { description: "加载线索数据失败，请稍后重试" })
                      } else {
                        const rows = data ?? []
                        const header = ["公司名称", "联系人", "电话", "来源", "预算", "阶段", "状态"]
                        const csvLines = [
                          header.join(","),
                          ...rows.map((row: any) =>
                            [
                              row.name ?? "",
                              row.customer_name ?? "",
                              row.customer_phone ?? "",
                              row.source ?? "",
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
                        .select("name, customer_name, customer_phone, source, budget, stage, status")
                        .eq("status", "pool")

                      if (leadsError) {
                        console.error("Failed to load leads for export (csv)", leadsError)
                        toast.error("导出失败", { description: "加载线索数据失败，请稍后重试" })
                      } else {
                        const rows = data ?? []
                        const header = ["公司名称", "联系人", "电话", "来源", "预算", "阶段", "状态"]
                        const csvLines = [
                          header.join(","),
                          ...rows.map((row: any) =>
                            [
                              row.name ?? "",
                              row.customer_name ?? "",
                              row.customer_phone ?? "",
                              row.source ?? "",
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

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索公司名称、联系人、电话..."
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
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="全选"
                    className={isSomeSelected ? "data-[state=checked]:bg-primary/50" : ""}
                  />
                </TableHead>
                <TableHead className="w-[200px] min-w-[180px]">公司名称</TableHead>
                <TableHead className="min-w-[80px]">联系人</TableHead>
                <TableHead className="min-w-[120px]">电话</TableHead>
                <TableHead className="min-w-[80px]">来源</TableHead>
                <TableHead className="min-w-[80px]">预算</TableHead>
                <TableHead className="min-w-[100px]">最后阶段</TableHead>
                <TableHead className="min-w-[120px]">退回原因</TableHead>
                <TableHead className="min-w-[120px]">最近退回人</TableHead>
                <TableHead className="text-center min-w-[100px]">
                  <div className="flex items-center justify-center gap-1">
                    <Clock className="w-4 h-4" />
                    池内天数
                  </div>
                </TableHead>
                <TableHead className="text-right min-w-[100px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLeads.map((lead) => (
                <TableRow key={lead.id} className={selectedLeads.includes(lead.id) ? "bg-primary/5" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={selectedLeads.includes(lead.id)}
                      onCheckedChange={(checked) => handleSelectLead(lead.id, checked as boolean)}
                      aria-label={`选择 ${lead.company}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{lead.company}</TableCell>
                  <TableCell>{lead.contact}</TableCell>
                  <TableCell className="font-mono text-sm">{lead.phone}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{lead.source}</Badge>
                  </TableCell>
                  <TableCell>{lead.budget}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{lead.lastStage}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{lead.returnReason}</TableCell>
                  <TableCell>
                    {lead.returnedById ? (
                      <span className="text-sm">{repNameById[lead.returnedById] ?? "未知成员"}</span>
                    ) : lead.importedById ? (
                      <span className="text-xs text-muted-foreground">
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
                            if (!canDeleteLeads) {
                              toast.error("没有删除线索的权限", {
                                description: "请联系管理员在系统设置 → 角色权限中开启“删除线索”权限",
                              })
                              return
                            }

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
                  <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
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
            <DialogTitle>分配线索给销售</DialogTitle>
            <DialogDescription>
              正在分配 <strong>{selectedLeads.length}</strong> 条选中的线索
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Selected leads summary */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium mb-2">已选择线索：</p>
              <div className="flex flex-wrap gap-2">
                {selectedLeads.slice(0, 3).map((id) => {
                  const lead = leads.find((l) => l.id === id)
                  return lead ? (
                    <Badge key={id} variant="secondary" className="text-xs">
                      {lead.company}
                    </Badge>
                  ) : null
                })}
                {selectedLeads.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{selectedLeads.length - 3} 更多
                  </Badge>
                )}
              </div>
            </div>

            {/* Sales Rep Select */}
            <div className="space-y-2">
              <Label htmlFor="rep">分配给 *</Label>
              <Select value={assignToRep} onValueChange={setAssignToRep}>
                <SelectTrigger>
                  <SelectValue placeholder="选择销售人员" />
                </SelectTrigger>
                <SelectContent>
                  {salesReps.map((rep) => (
                    <SelectItem key={rep.id} value={rep.id}>
                      <div className="flex items-center gap-2">
                        <span>{rep.name}</span>
                        <span className="text-xs text-muted-foreground">({rep.activeLeads} 条在跟进)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Assignment Note */}
            <div className="space-y-2">
              <Label htmlFor="note">分配备注 (可选)</Label>
              <Textarea
                id="note"
                placeholder="例如：尽快跟进，客户预算充足..."
                value={assignmentNote}
                onChange={(e) => setAssignmentNote(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={confirmAssignment} disabled={!assignToRep || selectedLeads.length === 0 || isAssigning}>
              确认分配
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
            <DialogTitle>{detailLead?.company ?? "线索详情"}</DialogTitle>
            {detailLead && (
              <DialogDescription>
                {detailLead.contact && <span>{detailLead.contact}</span>}
                {detailLead.phone && <span className="ml-2 font-mono text-xs text-muted-foreground">{detailLead.phone}</span>}
              </DialogDescription>
            )}
          </DialogHeader>
          {detailLead && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">来源</span>
                  <div className="mt-1">
                    <Badge variant="outline">{detailLead.source}</Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">最后阶段</span>
                  <div className="mt-1">
                    <Badge variant="secondary">{detailLead.lastStage}</Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">预算</span>
                  <div className="mt-1">{detailLead.budget}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">退回原因</span>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {detailLead.returnReason || "退回原因未记录"}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">进入公海时间</span>
                  <div className="mt-1 text-xs text-muted-foreground">{detailLead.returnedAt || "--"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">池内天数</span>
                  <div className="mt-1">{detailLead.daysInPool} 天</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">跟进记录</span>
                </div>
                {isLoadingInteractions && (
                  <p className="text-xs text-muted-foreground">跟进记录加载中...</p>
                )}
                {interactionsError && !isLoadingInteractions && (
                  <p className="text-xs text-destructive">{interactionsError.description}</p>
                )}
                {!isLoadingInteractions && !interactionsError && interactions.length === 0 && (
                  <p className="text-xs text-muted-foreground">暂无跟进记录</p>
                )}
                {!isLoadingInteractions && interactions.length > 0 && (
                  <div className="space-y-3 max-h-64 overflow-y-auto border rounded-md p-3 bg-muted/30">
                    {interactions.map((item) => (
                      <div key={item.id} className="text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{item.author}</span>
                          <span className="text-muted-foreground">{item.date}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Badge variant="outline">
                            {item.type === "call" && "电话"}
                            {item.type === "wechat" && "微信"}
                            {item.type === "visit" && "拜访"}
                          </Badge>
                          <span>{item.content}</span>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>导入线索</DialogTitle>
            <DialogDescription>上传 Excel 或 CSV 文件批量导入线索数据</DialogDescription>
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
                  <p className="text-xs text-muted-foreground mb-4">支持 .xlsx, .xls, .csv 格式</p>
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
                    <span className="text-sm text-muted-foreground">下载导入模板</span>
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
                      {importStage === "uploading" && "正在上传..."}
                      {importStage === "checking" && "正在检查冲突..."}
                      {importStage === "complete" && "检查完成"}
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
                        已解析 {parsedImportRows?.length ?? 0} 条线索数据
                      </span>
                    </div>
                    {duplicatesFound > 0 && (
                      <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg">
                        <AlertTriangle className="w-5 h-5" />
                        <span className="text-sm font-medium">检测到 {duplicatesFound} 条重复手机号，已自动跳过</span>
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
              disabled={importStage !== "complete" || isSubmittingImport}
              onClick={handleConfirmImport}
            >
              {isSubmittingImport ? "导入中..." : importStage === "complete" ? "确认导入" : "开始导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
