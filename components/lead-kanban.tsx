"use client"

import React, { useCallback, useState, useEffect, useMemo, useRef } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Plus,
  Calendar,
  AlertTriangle,
  Phone,
  MessageCircle,
  MapPin,
  ArrowRight,
  User,
  Building2,
  UserPlus,
  Search,
  Filter,
  Clock,
} from "lucide-react"

import { toast } from "sonner"
import { KanbanSkeleton } from "@/components/skeleton-loaders"
import { StatusBadge, StatusDot, getStageConfig } from "@/components/status-badge"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import type { UserProfile } from "@/lib/auth/profile"
import { mapRpcError, type RpcErrorFriendly } from "@/lib/rpc-error-mapper"
import { RpcErrorBanner } from "@/components/rpc-error-banner"
import { updateLead, closeLead, transferLead } from "@/lib/services/leads"
import { MePermissionsContext } from "@/components/app-root"

interface Lead {
  id: string | number
  company: string
  contact: string
  phone: string
  wechat: string
  source: string
  budget: string
  lastInteraction: number
  sourceLevel1?: string | null
  sourceLevel2?: string | null

  lastContactAt: string | null
  stage: string
  status: "open" | "closed" | "pool"
  nextContactAt: string | null
  ownerId?: string | null
  teamId?: number | null
  grade?: string | null
  tags?: string[] | null
  firstContactAt?: string | null
  lockedUntil?: string | null
  protectedUntil?: string | null
  createdAt?: string | null
  closeResult?: string | null
  closeReason?: string | null
  interactions: Interaction[]
}





interface Interaction {
  id: number
  type: "call" | "wechat" | "visit"
  content: string
  date: string
  user: string
  avatar?: string
  authorId?: string
}

interface SalesRep {
  id: string
  name: string
  activeLeads: number
  teamId?: number | null
  avatarUrl?: string | null
  isExcludedForAnalytics?: boolean
}


interface LeadViewFilters {
  searchQuery: string
  stageFilter: string
  sourceLevel1Filter: string
  sourceLevel2Filter: string
  ownerFilter: string
  timeFilter: string
  gradeFilter: string
  tagFilter: string
  sortOption: string
  // 兼容历史视图中保存的单一 sourceFilter 字段
  sourceFilter?: string
}


interface LeadViewPreset {
  id: string
  name: string
  filters: LeadViewFilters
  isDefault: boolean
}

interface GradeDefinition {
  key: string
  label: string
  description?: string
}

interface SourceTreeChild {
  key: string
  label: string
}

interface SourceChannel {
  key: string
  label: string
  children?: SourceTreeChild[] | null
}

interface SourceOption {
  key: string
  label: string
  level1Key?: string
}


// 线索初始列表由 Supabase 加载，这里保留一个空数组占位，防止误以为还有本地 mock 数据
const initialLeads: Lead[] = [


  {
    id: 1,
    company: "深圳市科技公司",
    contact: "李经理",
    phone: "13800138001",
    wechat: "limanager_sz",
    source: "抖音",
    budget: "¥500,000",
    lastInteraction: 1,
    stage: "L1",
    interactions: [
      {
        id: 1,
        type: "call",
        content: "首次电话沟通，客户对产品感兴趣，询问了价格和交付时间",
        date: "2025-06-02",
        user: "王芳",
        avatar: "",
      },
      { id: 2, type: "wechat", content: "发送了产品手册和报价单", date: "2025-06-03", user: "王芳", avatar: "" },
    ],
  },
  {
    id: 2,
    company: "广州智能设备",
    contact: "王总",
    phone: "13900139002",
    wechat: "wangceo_gz",
    source: "展会",
    budget: "¥800,000",
    lastInteraction: 2,
    stage: "L1",
    interactions: [
      {
        id: 1,
        type: "visit",
        content: "展会现场交流，收集了名片，客户表示下周安排详细沟通",
        date: "2025-06-01",
        user: "张伟",
        avatar: "",
      },
    ],
  },
  {
    id: 3,
    company: "北京云计算",
    contact: "张主管",
    phone: "13700137003",
    wechat: "zhangcloud_bj",
    source: "官网",
    budget: "¥350,000",
    lastInteraction: 0,
    stage: "L2",
    interactions: [
      {
        id: 1,
        type: "call",
        content: "客户通过官网咨询，详细介绍了解决方案",
        date: "2025-06-03",
        user: "李明",
        avatar: "",
      },
      {
        id: 2,
        type: "wechat",
        content: "客户确认意向，准备安排技术对接",
        date: "2025-06-04",
        user: "李明",
        avatar: "",
      },
    ],
  },
  {
    id: 4,
    company: "上海数据科技",
    contact: "陈经理",
    phone: "13600136004",
    wechat: "chendata_sh",
    source: "转介绍",
    budget: "¥1,200,000",
    lastInteraction: 4,
    stage: "L2",
    interactions: [
      { id: 1, type: "call", content: "老客户介绍，初步电话沟通了需求", date: "2025-05-30", user: "王芳", avatar: "" },
    ],
  },
  {
    id: 5,
    company: "杭州互联网",
    contact: "刘总",
    phone: "13500135005",
    wechat: "liutech_hz",
    source: "抖音",
    budget: "¥600,000",
    lastInteraction: 8,
    stage: "L3",
    interactions: [
      { id: 1, type: "visit", content: "客户来访参观，对产品演示很满意", date: "2025-05-25", user: "张伟", avatar: "" },
      {
        id: 2,
        type: "call",
        content: "跟进电话，客户说在比较其他供应商",
        date: "2025-05-27",
        user: "张伟",
        avatar: "",
      },
    ],
  },
  {
    id: 6,
    company: "成都软件园",
    contact: "赵经理",
    phone: "13400134006",
    wechat: "zhaosoft_cd",
    source: "展会",
    budget: "¥450,000",
    lastInteraction: 5,
    stage: "L3",
    interactions: [
      { id: 1, type: "wechat", content: "发送了定制方案，等待客户反馈", date: "2025-05-29", user: "李明", avatar: "" },
    ],
  },
  {
    id: 7,
    company: "武汉科创",
    contact: "周总",
    phone: "13300133007",
    wechat: "zhoutech_wh",
    source: "官网",
    budget: "¥750,000",
    lastInteraction: 1,
    stage: "L4",
    interactions: [
      { id: 1, type: "visit", content: "上门拜访，与技术团队深入交流", date: "2025-06-01", user: "王芳", avatar: "" },
      { id: 2, type: "call", content: "确认合同细节，客户需要内部审批", date: "2025-06-03", user: "王芳", avatar: "" },
    ],
  },
  {
    id: 8,
    company: "南京智造",
    contact: "吴经理",
    phone: "13200132008",
    wechat: "wumaker_nj",
    source: "转介绍",
    budget: "¥2,000,000",
    lastInteraction: 0,
    stage: "L4",
    interactions: [
      { id: 1, type: "call", content: "大客户项目，今日确认合同条款", date: "2025-06-04", user: "张伟", avatar: "" },
    ],
  },
  {
    id: 9,
    company: "天津工业",
    contact: "郑总",
    phone: "13100131009",
    wechat: "zhengindu_tj",
    source: "展会",
    budget: "¥980,000",
    lastInteraction: 0,
    stage: "Won",
    interactions: [
      { id: 1, type: "visit", content: "签约仪式，项目正式启动", date: "2025-06-04", user: "李明", avatar: "" },
    ],
  },
]

const stages = [
  { id: "L1", label: "L1 询盘" },
  { id: "L2", label: "L2 意向" },
  { id: "L3", label: "L3 关键意向" },
  { id: "L4", label: "L4 谈判" },
  { id: "Won", label: "成交" },
]

const FALLBACK_SOURCES = ["抖音", "展会", "官网", "转介绍", "电话", "其他"]

const FALLBACK_GRADES: GradeDefinition[] = [
  { key: "S", label: "S级（强成交 / 立即跟进）" },
  { key: "A", label: "A级（重点培育 / 近期可成交）" },
  { key: "B", label: "B级（普通意向 / 需持续教育）" },
  { key: "C", label: "C级（低优先级 / 长期培育）" },
]

const PAGE_SIZE = 20


function parseBudgetLabel(budget: string): number | null {
  const digits = budget.replace(/[^\d.-]/g, "")
  if (!digits) return null
  const value = Number(digits)
  return Number.isNaN(value) ? null : value
}

function LeadCard({ lead, onClick, riskConfig }: { lead: Lead; onClick: () => void; riskConfig: { warningHours: number; dangerHours: number } }) {
  const getStatusBadge = () => {
    if (lead.status === "closed") {
      if (lead.closeResult === "won" || lead.closeResult === "成交") {
        return (
          <Badge variant="outline" className="text-xs border-emerald-500/60 text-emerald-700">
            成交
          </Badge>
        )
      }
      return (
        <Badge variant="outline" className="text-xs border-slate-300 text-slate-600">
          丢单
        </Badge>
      )
    }
    return null
  }

  const getRiskBadge = (lead: Lead) => {
    // 已成交或已丢单的线索不再参与风险/需跟进提示
    if (lead.status === "closed" || lead.stage === "Won") return null

    const lastContactAt = lead.lastContactAt ? new Date(lead.lastContactAt) : lead.createdAt ? new Date(lead.createdAt) : null
    if (!lastContactAt) {
      return (
        <Badge variant="destructive" className="text-xs">
          风险
        </Badge>
      )
    }

    const diffHours = (Date.now() - lastContactAt.getTime()) / (1000 * 60 * 60)
    const { warningHours, dangerHours } = riskConfig

    if (diffHours >= dangerHours)
      return (
        <Badge variant="destructive" className="text-xs">
          风险
        </Badge>
      )
    if (diffHours >= warningHours)
      return <Badge className="bg-amber-100 text-amber-700 text-xs hover:bg-amber-100">需跟进</Badge>
    return null
  }



  const lastContactLabel = lead.lastInteraction === 0 ? "今天" : `${lead.lastInteraction}天前`
  const lastContactDateLabel = lead.lastContactAt
    ? new Date(lead.lastContactAt).toISOString().split("T")[0]
    : lead.createdAt
      ? new Date(lead.createdAt).toISOString().split("T")[0]
      : "未记录时间"

  const allTags = lead.tags ?? []
  const displayedTags = allTags.slice(0, 2)
  const remainingTagsCount = allTags.length - displayedTags.length

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium text-foreground">{lead.company}</p>
            <p className="text-sm text-muted-foreground">{lead.contact}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {getStatusBadge()}
            {getRiskBadge(lead)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-xs">
            {lead.source}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {lead.budget}
          </Badge>
          {lead.grade && (
            <Badge variant="outline" className="text-xs">
              客户级别 {lead.grade}
            </Badge>
          )}
        </div>
        {displayedTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {displayedTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[11px]">
                {tag}
              </Badge>
            ))}
            {remainingTagsCount > 0 && (
              <span className="text-[11px] text-muted-foreground">+{remainingTagsCount}</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="w-3 h-3" />
          <span>{lastContactLabel}</span>
          <span>·</span>
          <span>{lastContactDateLabel}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function InteractionItem({ interaction }: { interaction: Interaction }) {
  const getIcon = (type: string) => {
    switch (type) {
      case "call":
        return <Phone className="w-4 h-4" />
      case "wechat":
        return <MessageCircle className="w-4 h-4" />
      case "visit":
        return <MapPin className="w-4 h-4" />
      default:
        return <Phone className="w-4 h-4" />
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "call":
        return "电话"
      case "wechat":
        return "微信"
      case "visit":
        return "拜访"
      default:
        return "其他"
    }
  }

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <Avatar className="w-8 h-8">
          {interaction.avatar ? (
            <AvatarImage src={interaction.avatar} />
          ) : null}
          <AvatarFallback className="text-xs bg-primary/10 text-primary">
            {(interaction.user && interaction.user.length > 0 ? interaction.user : "?").slice(0, 1)}
          </AvatarFallback>
        </Avatar>
        <div className="w-px h-full bg-border mt-2" />
      </div>

      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="outline" className="text-xs gap-1">
            {getIcon(interaction.type)}
            {getTypeLabel(interaction.type)}
          </Badge>
          <span className="text-xs text-muted-foreground">{interaction.date}</span>
          <span className="text-xs text-muted-foreground">· {interaction.user}</span>
        </div>
        <p className="text-sm text-foreground">{interaction.content}</p>
      </div>
    </div>
  )
}

export function LeadKanban({ isPublicPool = false }: { isPublicPool?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newLead, setNewLead] = useState({
    company: "",
    contact: "",
    phone: "",
    sourceLevel1: "",
    sourceLevel2: "",
    budget: "",
    owner: "",
    grade: "",
    tags: "",
  })


  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const mePermissions = React.useContext(MePermissionsContext)
  const canAssignLeads = mePermissions?.canAssignLeads ?? false
  const canReturnToPool = mePermissions?.canReturnToPool ?? false
  const canDeleteLeads = mePermissions?.canDeleteLeads ?? false
  const leadScopeType = mePermissions?.leadScopeType ?? "self"
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null)

  const [followUp, setFollowUp] = useState({
    content: "",
    type: "",
    nextDate: "",
  })

  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState("")

  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [closeResult, setCloseResult] = useState<"won" | "lost" | "">("")
  const [closeReason, setCloseReason] = useState("")

  const [returnToPoolDialogOpen, setReturnToPoolDialogOpen] = useState(false)
  const [returnToPoolReason, setReturnToPoolReason] = useState("")

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState("")

  const [reassignDialogOpen, setReassignDialogOpen] = useState(false)
  const [reassignToRep, setReassignToRep] = useState("")
  const [reassignNote, setReassignNote] = useState("")
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])

  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const canTransferLeads = mePermissions?.canTransferLeads ?? false
  const [transferTargetTeamId, setTransferTargetTeamId] = useState<string>("")
  const [transferTargetOwnerId, setTransferTargetOwnerId] = useState<string>("")
  const [transferReason, setTransferReason] = useState("")
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([])

  const [isEditing, setIsEditing] = useState(false)
  const [editLead, setEditLead] = useState({
    company: "",
    contact: "",
    phone: "",
    wechat: "",
    source: "",
    budget: "",
    grade: "",
    tags: "",
  })

  const [searchQuery, setSearchQuery] = useState("")
  const [stageFilter, setStageFilter] = useState<string>("all")
  const [sourceLevel1Filter, setSourceLevel1Filter] = useState<string>("all")
  const [sourceLevel2Filter, setSourceLevel2Filter] = useState<string>("all")
  const [ownerFilter, setOwnerFilter] = useState<string>("all")
  const [timeFilter, setTimeFilter] = useState<string>("all")
  const [gradeFilter, setGradeFilter] = useState<string>("all")
  const [tagFilter, setTagFilter] = useState<string>("")
  const [sortOption, setSortOption] = useState<string>("recent")

  const [currentPage, setCurrentPage] = useState(1)

  const [viewPresets, setViewPresets] = useState<LeadViewPreset[]>([])
  const [activeViewId, setActiveViewId] = useState<string>("default")
  const [isSaveViewDialogOpen, setIsSaveViewDialogOpen] = useState(false)
  const [newViewName, setNewViewName] = useState("")
  const [isSavingView, setIsSavingView] = useState(false)
  const [isAdvancedFilterOpen, setIsAdvancedFilterOpen] = useState(false)

  const [gradeDefinitions, setGradeDefinitions] = useState<GradeDefinition[]>([])
  const [sourceChannels, setSourceChannels] = useState<SourceChannel[]>([])

  const gradeOptions: GradeDefinition[] = gradeDefinitions.length > 0 ? gradeDefinitions : FALLBACK_GRADES

  const level1Options: SourceChannel[] = useMemo(
    () =>
      sourceChannels.length > 0
        ? sourceChannels
        : FALLBACK_SOURCES.map((label) => ({ key: label, label, children: [] as SourceTreeChild[] })),
    [sourceChannels],
  )

  const sourceOptions: SourceOption[] = useMemo(() => {

    if (sourceChannels.length === 0) {
      return FALLBACK_SOURCES.map((label) => ({ key: label, label, level1Key: "legacy" }))
    }

    const flattened: SourceOption[] = []

    for (const channel of sourceChannels) {
      const children = channel.children ?? []
      if (children.length === 0) {
        flattened.push({ key: channel.key, label: channel.label, level1Key: channel.key })
      } else {
        for (const child of children) {
          flattened.push({
            key: child.key,
            label: `${channel.label} · ${child.label}`,
            level1Key: channel.key,
          })
        }
      }
    }

    return flattened
  }, [sourceChannels])

  const getChildrenForLevel1 = (level1Key: string): SourceTreeChild[] => {
    const channel = level1Options.find((c) => c.key === level1Key)
    return channel?.children ?? []
  }

  const resolveSourceLabel = (
    level1Key: string | null | undefined,
    level2Key: string | null | undefined,
  ): string => {
    if (level1Key && sourceChannels.length > 0) {
      const channel = sourceChannels.find((c) => c.key === level1Key)
      if (channel) {
        if (level2Key) {
          const child = (channel.children ?? []).find((ch) => ch.key === level2Key)
          if (child) {
            return child.label
          }
        }
        return channel.label
      }
    }

    if (sourceChannels.length === 0 && level1Key) {
      return level1Key
    }

    return "其他"
  }

  const [isLoading, setIsLoading] = useState(true)


  const hasLoadedOnceRef = useRef(false)


  const [loadError, setLoadError] = useState<RpcErrorFriendly | null>(null)

  const [reloadToken, setReloadToken] = useState(0)
  const retryLoad = useCallback(() => setReloadToken((t) => t + 1), [])

  const [isCreating, setIsCreating] = useState(false)
  const riskConfigRef = useRef({ warningHours: 72, dangerHours: 168 })

  const [isReassigning, setIsReassigning] = useState(false)
  const [isAdvancingStage, setIsAdvancingStage] = useState(false)
  const [isReturningToPool, setIsReturningToPool] = useState(false)
  const [isLoggingFollowUp, setIsLoggingFollowUp] = useState(false)
  const [, setIsSubmittingReturnToPool] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isClosingLead, setIsClosingLead] = useState(false)
  const [isDeletingLead, setIsDeletingLead] = useState(false)
  const [isLoadingInteractionsLeadId, setIsLoadingInteractionsLeadId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadLeads() {
      // 只有第一次加载时才显示骨架屏，后续通过 Realtime/刷新在后台悄悄拉数据
      if (!hasLoadedOnceRef.current) {
        setIsLoading(true)
      }
      setLoadError(null)

      try {
        const supabase = getBrowserSupabaseClient()
        const [
          { data, error },
          { data: businessRulesRpcResult, error: businessRulesError },
        ] = await Promise.all([
          supabase
            .from("leads_secure_view")
            .select(
              "id, team_id, name, source, stage, status, close_result, close_reason, customer_name, customer_phone, customer_email, budget, last_contact_at, next_contact_at, owner_id, customer_grade, source_level1, source_level2, tags, first_contact_at, locked_until, protected_until, created_at, created_by",
            )
            .in("status", ["open", "closed"]) 
            .order("updated_at", { ascending: false }),
          supabase.rpc("rpc_get_pipeline_business_rules"),
        ])

        if (businessRulesError) {
          console.error("Failed to load pipeline business rules via RPC for lead kanban", businessRulesError)
        }



        if (!isMounted) {
          return
        }

        if (error) {
          console.error("Failed to load leads", error)
          const friendly = mapRpcError(error, { title: "加载线索失败", description: "请稍后重试" })
          setLoadError(friendly)
          toast.error(friendly.title, {
            description: friendly.description,
            ...(friendly.canRetry ? { action: { label: "重试", onClick: retryLoad } } : {}),
          })
          setLeads([])
          return
        }

        const rows = (data ?? []) as any[]

        const businessRulesValue = (businessRulesRpcResult as any) ?? null
        if (businessRulesValue && typeof businessRulesValue === "object") {
          const rawWarning = (businessRulesValue as any).warning_hours
          const rawDanger = (businessRulesValue as any).danger_hours


          if (typeof rawWarning === "number" && Number.isFinite(rawWarning) && rawWarning > 0) {
            riskConfigRef.current.warningHours = rawWarning
          }
          if (typeof rawDanger === "number" && Number.isFinite(rawDanger) && rawDanger > 0) {
            riskConfigRef.current.dangerHours = rawDanger
          }
        }


        const mapped: Lead[] =
          rows.map((row: any) => {


              const lastContactAt = row.last_contact_at ? new Date(row.last_contact_at) : null
              const createdAt = row.created_at ? new Date(row.created_at) : null
              const baseDate = lastContactAt ?? createdAt
              const daysSinceBase =
                baseDate != null
                  ? Math.max(
                      0,
                      Math.floor(
                        (Date.now() - baseDate.getTime()) / (1000 * 60 * 60 * 24),
                      ),
                    )
                  : 0

              return {

                id: row.id,
                company: row.name ?? "未命名线索",
                contact: row.customer_name ?? "未填写联系人",
                phone: row.customer_phone ?? "",
                wechat: "",
                source: row.source ?? "其他",
                sourceLevel1: (row.source_level1 as string | null) ?? null,
                sourceLevel2: (row.source_level2 as string | null) ?? null,

                budget:
                  row.budget != null
                    ? `¥${Number(row.budget).toLocaleString("zh-CN")}`
                    : "待确认",
                lastInteraction: daysSinceBase,
                lastContactAt: (row.last_contact_at as string | null) ?? null,
                stage: row.stage ?? "L1",
                status: (row.status as string | null) === "closed" ? "closed" : "open",
                nextContactAt: row.next_contact_at ?? null,
                ownerId: (row.owner_id as string | null) ?? null,
                teamId: (row.team_id as number | null) ?? null,
                grade: (row.customer_grade as string | null) ?? null,
                tags: (row.tags as string[] | null) ?? null,
                firstContactAt: (row.first_contact_at as string | null) ?? null,
                lockedUntil: (row.locked_until as string | null) ?? null,
                protectedUntil: (row.protected_until as string | null) ?? null,
                createdAt: (row.created_at as string | null) ?? null,
                closeResult: (row.close_result as string | null) ?? null,
                closeReason: (row.close_reason as string | null) ?? null,
                interactions: [],


              }

            }) ?? []


        setLeads(mapped)
      } catch (err) {
        console.error("Failed to load leads", err)
        if (isMounted) {
          const friendly = mapRpcError(err as any, { title: "加载线索失败", description: "请稍后重试" })
          setLoadError(friendly)
          toast.error(friendly.title, {
            description: friendly.description,
            ...(friendly.canRetry ? { action: { label: "重试", onClick: retryLoad } } : {}),
          })
          setLeads([])
        }
      } finally {
        if (isMounted && !hasLoadedOnceRef.current) {
          setIsLoading(false)
          hasLoadedOnceRef.current = true
        }
      }
    }

    loadLeads()

    return () => {
      isMounted = false
    }
  }, [reloadToken, retryLoad])

  useEffect(() => {
    let isMounted = true

    async function loadLeadConfigs() {
      try {
        const supabase = getBrowserSupabaseClient()

        const [gradeResult, sourceResult] = await Promise.all([
          supabase
            .from("settings")
            .select("value")
            .eq("key", "leads.grade_definitions")
            .maybeSingle(),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "leads.source_tree")
            .maybeSingle(),
        ])

        if (!isMounted) {
          return
        }

        if (!gradeResult.error && gradeResult.data && (gradeResult.data as any).value) {
          const raw = (gradeResult.data as any).value as any
          if (Array.isArray(raw.grades)) {
            const normalized: GradeDefinition[] = raw.grades
              .filter((g: any) => typeof g?.key === "string" && typeof g?.label === "string")
              .map((g: any) => ({
                key: g.key as string,
                label: g.label as string,
                description: typeof g.description === "string" ? (g.description as string) : undefined,
              }))

            if (normalized.length > 0) {
              setGradeDefinitions(normalized)
            }
          }
        }

        if (!sourceResult.error && sourceResult.data && (sourceResult.data as any).value) {
          const raw = (sourceResult.data as any).value as any
          if (Array.isArray(raw.channels)) {
            const normalized: SourceChannel[] = raw.channels
              .filter((c: any) => typeof c?.key === "string" && typeof c?.label === "string")
              .map((c: any) => ({
                key: c.key as string,
                label: c.label as string,
                children: Array.isArray(c.children)
                  ? (c.children as any[])
                      .filter((child) => typeof child?.key === "string" && typeof child?.label === "string")
                      .map((child) => ({ key: child.key as string, label: child.label as string }))
                  : [],
              }))

            if (normalized.length > 0) {
              setSourceChannels(normalized)
            }
          }
        }
      } catch (error) {
        console.error("Failed to load lead configs", error)
      }
    }

    loadLeadConfigs()

    return () => {
      isMounted = false
    }
  }, [])

  // 订阅 Supabase Realtime，监听线索表变更，实现多人实时同步
  useEffect(() => {

    const supabase = getBrowserSupabaseClient()

    const channel = supabase
      .channel("leads-kanban-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        () => {
          // 任意线索变更后，触发一次重载，保证当前视图与服务器一致
          retryLoad()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [retryLoad])

  // 兜底：即使部分浏览器环境下 Realtime 被插件/网络拦截，也每 10 秒在后台静默刷新一次
  useEffect(() => {
    const id = window.setInterval(() => {
      retryLoad()
    }, 10000)

    return () => {
      window.clearInterval(id)
    }
  }, [retryLoad])

  // 当列表数据发生变化时，如果当前有打开的线索详情，自动用最新数据同步详情（保留已加载的跟进记录）
  useEffect(() => {
    setSelectedLead((prev) => {
      if (!prev) return prev

      const fresh = leads.find((l) => l.id === prev.id)
      if (!fresh) return prev

      return {
        ...prev,
        ...fresh,
        interactions: prev.interactions,
      }
    })
  }, [leads])


  useEffect(() => {




    let isMounted = true

    async function loadSalesReps() {
      try {
        const supabase = getBrowserSupabaseClient()

        const [profilesResult, teamsResult, profile, excludedProfilesResult, excludedTeamsResult] =
          await Promise.all([
            supabase
              .from("profiles_public")
              .select("id, full_name, avatar_url, team_id, status")
              .eq("status", "active"),

            supabase.from("teams").select("id, name").order("id", { ascending: true }),
            fetchCurrentUserProfile(supabase),
            supabase
              .from("settings")
              .select("value")
              .eq("key", "analytics.excluded_profiles")
              .maybeSingle(),
            supabase
              .from("settings")
              .select("value")
              .eq("key", "analytics.excluded_teams")
              .maybeSingle(),
          ])

        const { data, error } = profilesResult

        if (!isMounted) {
          return
        }

        if (error || teamsResult.error) {
          console.error("Failed to load sales reps or teams", error, teamsResult.error)
          return
        }

        const excludedProfileIds = new Set<string>(
          excludedProfilesResult.data && (excludedProfilesResult.data as any).value &&
          Array.isArray(((excludedProfilesResult.data as any).value as any).profile_ids)
            ? (((excludedProfilesResult.data as any).value as any).profile_ids as any[]).filter(
                (v: any) => typeof v === "string",
              )
            : [],
        )

        const excludedTeamIds = new Set<number>(
          excludedTeamsResult.data && (excludedTeamsResult.data as any).value &&
          Array.isArray(((excludedTeamsResult.data as any).value as any).team_ids)
            ? (((excludedTeamsResult.data as any).value as any).team_ids as any[]).filter(
                (v: any) => typeof v === "number",
              )
            : [],
        )

        const normalized: SalesRep[] =
          (data ?? []).map((row: any) => ({
            id: row.id as string,
            name: (row.full_name as string) ?? "未命名成员",
            activeLeads: 0,
            teamId: (row.team_id as number | null) ?? null,
            avatarUrl: (row.avatar_url as string | null) ?? null,
            isExcludedForAnalytics: excludedProfileIds.has(row.id as string),
          }))


        setSalesReps(normalized)
        setTeams(
          (teamsResult.data ?? [])
            .filter((t: any) => !excludedTeamIds.has(t.id as number))
            .map((t: any) => ({
              id: t.id as number,
              name: (t.name as string) ?? "未命名团队",
            })),
        )
        setCurrentProfile(profile)
      } catch (err) {
        console.error("Failed to load sales reps", err)
      }
    }

    loadSalesReps()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [
    searchQuery,
    stageFilter,
    sourceLevel1Filter,
    sourceLevel2Filter,
    ownerFilter,
    timeFilter,
    gradeFilter,
    tagFilter,
    sortOption,
  ])



  const activeLeadsByOwnerId = useMemo(() => {
    const counts = new Map<string, number>()

    for (const lead of leads) {
      if (!lead.ownerId) continue
      if (lead.status !== "open") continue
      const current = counts.get(lead.ownerId) ?? 0
      counts.set(lead.ownerId, current + 1)
    }

    return counts
  }, [leads])

  const currentUserId = currentProfile?.id ?? null
  const currentTeamId = currentProfile?.teamId ?? null

  const isSelectedLeadProtectedForOthers =
    selectedLead != null &&
    selectedLead.status === "open" &&
    selectedLead.protectedUntil != null &&
    new Date(selectedLead.protectedUntil) > new Date() &&
    selectedLead.ownerId != null &&
    currentUserId != null &&
    selectedLead.ownerId !== currentUserId

  const applyFiltersFromPreset = (preset: LeadViewPreset) => {
    const f = preset.filters

    setSearchQuery(f.searchQuery ?? "")
    setStageFilter(f.stageFilter ?? "all")
    setOwnerFilter(f.ownerFilter ?? "all")
    setTimeFilter(f.timeFilter ?? "all")
    setGradeFilter(f.gradeFilter ?? "all")
    setTagFilter(f.tagFilter ?? "")
    setSortOption(f.sortOption ?? "recent")

    // 视图中的渠道筛选拆分为一级/二级，兼容历史仅保存 sourceFilter 的视图
    const legacySourceFilter = (f as any).sourceFilter as string | undefined
    const level1FromPreset = (f as any).sourceLevel1Filter as string | undefined
    const level2FromPreset = (f as any).sourceLevel2Filter as string | undefined

    let nextLevel1 = level1FromPreset ?? "all"
    let nextLevel2 = level2FromPreset ?? "all"

    if (!level1FromPreset && !level2FromPreset && legacySourceFilter && legacySourceFilter !== "all") {
      nextLevel2 = legacySourceFilter
      const found = sourceOptions.find((option) => option.key === legacySourceFilter)
      if (found?.level1Key) {
        nextLevel1 = found.level1Key
      }
    }

    setSourceLevel1Filter(nextLevel1)
    setSourceLevel2Filter(nextLevel2)
  }


  const handleViewSelect = (value: string) => {
    if (value === "default") {
      setActiveViewId("default")
      setSearchQuery("")
      setStageFilter("all")
      setSourceLevel1Filter("all")
      setSourceLevel2Filter("all")
      setTimeFilter("all")
      setGradeFilter("all")
      setTagFilter("")
      setSortOption("recent")

      if (leadScopeType === "self" && currentUserId) {
        setOwnerFilter(currentUserId)
      } else {
        setOwnerFilter("all")
      }
      return
    }

    const preset = viewPresets.find((p) => p.id === value)
    if (!preset) return

    setActiveViewId(preset.id)
    applyFiltersFromPreset(preset)
  }


  const ownerOptions = useMemo(() => {
    if (leadScopeType === "self") {
      if (!currentUserId) {
        return []
      }

      const meRep = salesReps.find((rep) => rep.id === currentUserId)
      return meRep ? [meRep] : []
    }

    const selectableReps = salesReps.filter((rep) => !rep.isExcludedForAnalytics)

    if (leadScopeType === "team") {
      if (currentTeamId == null) {
        return selectableReps
      }

      return selectableReps.filter((rep) => rep.teamId != null && rep.teamId === currentTeamId)
    }

    return selectableReps
  }, [leadScopeType, currentUserId, currentTeamId, salesReps])


  const showAllOwnerOption =
    leadScopeType === "team" || leadScopeType === "org" || leadScopeType === "custom"

  useEffect(() => {
    if (leadScopeType === "self" && currentUserId && ownerFilter !== currentUserId) {
      setOwnerFilter(currentUserId)
    }
  }, [leadScopeType, currentUserId, ownerFilter])

  useEffect(() => {
    if (!currentProfile?.id) {
      return
    }

    let isMounted = true

    async function loadViewPresets() {
      try {
        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase
          .from("lead_view_presets")
          .select("id, name, filters, is_default")
          .eq("profile_id", currentProfile.id)
          .order("created_at", { ascending: true })

        if (!isMounted) {
          return
        }

        if (error) {
          console.error("Failed to load lead view presets", error)
          return
        }


        const normalized: LeadViewPreset[] =
          data?.map((row: any) => {
            const filters = (row.filters as any) || {}
            return {
              id: row.id as string,
              name: (row.name as string) ?? "未命名视图",
              filters: {
                searchQuery: (filters.searchQuery as string) ?? "",
                stageFilter: (filters.stageFilter as string) ?? "all",
                sourceLevel1Filter: (filters.sourceLevel1Filter as string) ?? "all",
                sourceLevel2Filter: (filters.sourceLevel2Filter as string) ?? "all",
                ownerFilter: (filters.ownerFilter as string) ?? "all",
                timeFilter: (filters.timeFilter as string) ?? "all",
                gradeFilter: (filters.gradeFilter as string) ?? "all",
                tagFilter: (filters.tagFilter as string) ?? "",
                sortOption: (filters.sortOption as string) ?? "recent",
                // 兼容旧数据中的单一 sourceFilter 字段
                sourceFilter: (filters.sourceFilter as string) ?? undefined,
              },
              isDefault: (row.is_default as boolean) ?? false,
            }
          }) ?? []


        setViewPresets(normalized)

        const defaultPreset = normalized.find((p) => p.isDefault)
        if (defaultPreset) {
          setActiveViewId(defaultPreset.id)
          applyFiltersFromPreset(defaultPreset)
        }
      } catch (err) {
        console.error("Failed to load lead view presets", err)
      }
    }

    loadViewPresets()

    return () => {
      isMounted = false
    }
  }, [currentProfile?.id])


  const handleAddLead = async () => {

    if (!newLead.company || !newLead.phone) {
      toast.error("请填写必填字段", {
        description: "公司名称和联系电话为必填项",
      })
      return
    }

    if (!newLead.sourceLevel1) {
      toast.error("请选择一级渠道", {
        description: "线索来源的一级渠道为必选项",
      })
      return
    }

    const trimmedBudget = newLead.budget.trim()

    let budgetValue: number | null = null

    if (trimmedBudget) {
      const parsed = Number(trimmedBudget.replace(/,/g, ""))
      if (Number.isNaN(parsed)) {
        toast.error("预算格式不正确", {
          description: "请填写数字预算金额，例如 500000",
        })
        return
      }
      budgetValue = parsed
    }

    try {
      setIsCreating(true)

      const supabase = getBrowserSupabaseClient()
      const profile = await fetchCurrentUserProfile(supabase)

      if (!profile || profile.teamId == null) {
        toast.error("无法确定当前用户团队", {
          description: "请联系管理员检查账号配置",
        })
        return
      }

      const canAssignLeads = mePermissions?.canAssignLeads ?? false
      const ownerId = canAssignLeads && newLead.owner ? newLead.owner : profile.id

      const sourceLabel = resolveSourceLabel(newLead.sourceLevel1, newLead.sourceLevel2 || null)

      const payload: Record<string, unknown> = {
        team_id: profile.teamId,
        owner_id: ownerId,
        name: newLead.company,
        source: sourceLabel,
        stage: "L1",
        status: "open",
        customer_name: newLead.contact || "新联系人",
        customer_phone: newLead.phone,
        customer_email: null,
        budget: budgetValue,
        last_contact_at: new Date().toISOString(),
        customer_grade: newLead.grade || null,
        source_level1: newLead.sourceLevel1,
        source_level2: newLead.sourceLevel2 || null,
        tags:


          newLead.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0),
      }

      const { data, error } = await supabase.rpc("rpc_lead_create", {
        payload,
      })

      if (error) {
        const friendly = mapRpcError(error, {
          title: "线索添加失败",
          description: "创建线索失败，请稍后重试",
        })
        toast.error(friendly.title, { description: friendly.description })
        return
      }

      const createdId = (data as string | null) ?? `temp-${Date.now()}`
      const budgetLabel =
        budgetValue != null ? `¥${budgetValue.toLocaleString("zh-CN")}` : "待确认"

      const sourceLabelForLocal = resolveSourceLabel(newLead.sourceLevel1, newLead.sourceLevel2 || null)

      setLeads([
        ...leads,
        {
          id: createdId,
          company: newLead.company,
          contact: newLead.contact || "新联系人",
          phone: newLead.phone,
          wechat: "",
          source: sourceLabelForLocal,
          sourceLevel1: newLead.sourceLevel1 || null,
          sourceLevel2: newLead.sourceLevel2 || null,
          budget: budgetLabel,
          lastInteraction: 0,
          lastContactAt: new Date().toISOString(),
          stage: "L1",
          status: "open",
          nextContactAt: null,
          ownerId,
          teamId: profile.teamId,
          grade: newLead.grade || null,
          tags:

            newLead.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0),
          interactions: [],
        },
      ])
      setNewLead({
        company: "",
        contact: "",
        phone: "",
        sourceLevel1: "",
        sourceLevel2: "",
        budget: "",
        owner: "",
        grade: "",
        tags: "",
      })

      setDialogOpen(false)
      toast.success("线索添加成功", {
        description: `${newLead.company} 已添加到 L1 询盘阶段`,
      })
    } catch (err) {
      console.error("Failed to create lead", err)
      toast.error("线索添加失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setIsCreating(false)
    }
  }

  const loadLeadInteractions = async (leadId: string | number) => {
    if (typeof leadId !== "string") {
      return
    }

    try {
      setIsLoadingInteractionsLeadId(leadId)

      const supabase = getBrowserSupabaseClient()
      const { data, error } = await supabase
        .from("lead_notes")
        .select("id, content, note_type, created_at, author_id")
        .eq("lead_id", leadId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })

      if (error) {
        console.error("Failed to load lead notes", error)
        toast.error("加载跟进记录失败", {
          description: "请稍后重试",
        })
        return
      }

      const interactionsFromDb: Interaction[] =
        data?.map((row: any, index: number) => {
          const authorId = (row.author_id as string | null) ?? null
          const authorRep = authorId ? salesReps.find((rep) => rep.id === authorId) : undefined
          const authorName = authorRep?.name || "未知成员"
          const avatarUrl = authorRep?.avatarUrl ?? undefined

          return {
            id: index + 1,
            type:
              row.note_type === "call" || row.note_type === "wechat" || row.note_type === "visit"
                ? (row.note_type as "call" | "wechat" | "visit")
                : "call",
            content: row.content ?? "",
            date: row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : "",
            user: authorName,
            avatar: avatarUrl,
            authorId: authorId ?? undefined,
          }
        }) ?? []


      setLeads((prevLeads) =>
        prevLeads.map((lead) =>
          lead.id === leadId ? { ...lead, interactions: interactionsFromDb } : lead,
        ),
      )

      setSelectedLead((prevSelected) =>
        prevSelected && prevSelected.id === leadId
          ? { ...prevSelected, interactions: interactionsFromDb }
          : prevSelected,
      )
    } catch (err) {
      console.error("Failed to load lead interactions", err)
      toast.error("加载跟进记录失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setIsLoadingInteractionsLeadId(null)
    }
  }

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead({ ...lead, interactions: [] })

    const budgetDigits = lead.budget.replace(/[^\d.-]/g, "")

    setEditLead({
      company: lead.company,
      contact: lead.contact,
      phone: lead.phone,
      wechat: lead.wechat,
      source: lead.source,
      budget: budgetDigits || "",
    })
    setIsEditing(false)

    setSheetOpen(true)
    void loadLeadInteractions(lead.id)
  }

  const handleReturnToPool = async () => {
    if (!selectedLead) {
      return
    }

    if (isSelectedLeadProtectedForOthers) {
      toast.error("当前线索处于保护期", {
        description: "在保护期内，仅负责人可以退回公海，请联系该线索负责人或等待保护期结束。",
      })
      return
    }

    if (!returnToPoolReason.trim()) {
      toast.error("请填写退回公海的原因")
      return
    }


    try {
      setIsReturningToPool(true)
      setIsSubmittingReturnToPool(true)

      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.rpc("rpc_lead_update", {
        p_lead_id: selectedLead.id,
        patch: {
          status: "pool",
        },
        p_reason: returnToPoolReason.trim(),
      })

      if (error) {
        const friendly = mapRpcError(error, {
          title: "退回公海失败",
          description: "退回公海失败，请稍后重试",
        })
        toast.error(friendly.title, { description: friendly.description })
        return
      }

      setLeads(leads.filter((l) => l.id !== selectedLead.id))
      setSheetOpen(false)
      setReturnToPoolDialogOpen(false)
      toast.info("线索已退回公海池", {
        description: `${selectedLead.company} 已移至公海池`,
      })
      setSelectedLead(null)
      setReturnToPoolReason("")
    } catch (err) {
      console.error("Failed to return lead to pool", err)
      toast.error("退回公海失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setIsReturningToPool(false)
      setIsSubmittingReturnToPool(false)
    }
  }

  const handleReassign = async () => {
    if (!selectedLead || !reassignToRep) {
      return
    }

    try {
      setIsReassigning(true)

      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.rpc("rpc_lead_assign", {
        p_lead_id: selectedLead.id,
        p_new_owner: reassignToRep,
        p_reason: reassignNote || null,
      })

      if (error) {
        const friendly = mapRpcError(error, {
          title: "重新分配失败",
          description: "重新分配线索失败，请稍后重试",
        })
        toast.error(friendly.title, { description: friendly.description })
        return
      }

      const repName = salesReps.find((r) => r.id === reassignToRep)?.name ?? "选中成员"

      toast.success("重新分配成功", {
        description: `${selectedLead.company} 已分配给 ${repName}`,
      })

      setReassignDialogOpen(false)
      setSheetOpen(false)
      setReassignToRep("")
      setReassignNote("")
      setSelectedLead(null)
    } catch (err) {
      console.error("Failed to reassign lead", err)
      toast.error("重新分配失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setIsReassigning(false)
    }
  }

  const handleLogFollowUp = async () => {
    if (!selectedLead || !followUp.content || !followUp.type) {
      return
    }

    try {
      setIsLoggingFollowUp(true)

      const supabase = getBrowserSupabaseClient()
      const profile = await fetchCurrentUserProfile(supabase)

      if (!profile) {
        toast.error("无法获取当前用户信息", {
          description: "请重新登录后再试",
        })
        return
      }

      const authorRep = salesReps.find((rep) => rep.id === profile.id)
      const authorName = authorRep?.name ?? "当前用户"
      const avatarUrl = authorRep?.avatarUrl ?? undefined


      const { error } = await supabase.from("lead_notes").insert({
        lead_id: selectedLead.id,
        author_id: profile.id,
        content: followUp.content,
        note_type: followUp.type,
      })

      if (error) {
        const message = error.message ?? "保存跟进记录失败"
        let friendly = "保存跟进记录失败，请稍后重试"

        if (message.includes("lead_notes.create")) {
          friendly = "没有创建跟进记录的权限，请联系管理员调整权限"
        }

        toast.error("保存跟进记录失败", {
          description: friendly,
        })
        return
      }

      // 更新线索的最后跟进时间与下次跟进日期（如有权限）
      const followUpPatch: Record<string, unknown> = {
        last_contact_at: new Date().toISOString(),
      }
      if (followUp.nextDate) {
        followUpPatch.next_contact_at = followUp.nextDate
      }

      try {
        const { error: updateError } = await supabase.rpc("rpc_lead_update", {
          p_lead_id: selectedLead.id,
          patch: followUpPatch,
        })

        if (updateError) {
          const friendly = mapRpcError(updateError, {
            title: "更新线索状态失败",
            description: "已记录跟进，但无法更新最后跟进时间，请稍后重试",
          })
          toast.error(friendly.title, {
            description: friendly.description,
          })
        }
      } catch (updateErr) {
        console.error("Failed to update lead after follow-up", updateErr)
        toast.error("更新线索状态失败", {
          description: "已记录跟进，但无法更新最后跟进时间，请联系管理员",
        })
      }

      const newInteraction: Interaction = {
        id: selectedLead.interactions.length + 1,
        type: followUp.type as "call" | "wechat" | "visit",
        content: followUp.content,
        date: new Date().toISOString().split("T")[0],
        user: authorName,
        avatar: avatarUrl,
        authorId: profile.id,
      }


      setLeads(
        leads.map((l) =>
          l.id === selectedLead.id
            ? {
                ...l,
                interactions: [newInteraction, ...l.interactions],
                lastInteraction: 0,
                lastContactAt: new Date().toISOString(),
                nextContactAt: followUp.nextDate || l.nextContactAt,
              }
            : l,
        ),
      )
      setSelectedLead({
        ...selectedLead,
        interactions: [newInteraction, ...selectedLead.interactions],
        lastInteraction: 0,
        lastContactAt: new Date().toISOString(),
        nextContactAt: followUp.nextDate || selectedLead.nextContactAt,
      })
      setFollowUp({ content: "", type: "", nextDate: "" })
      toast.success("跟进记录已保存", {
        description: followUp.nextDate ? `下次跟进日期：${followUp.nextDate}` : undefined,
      })
    } catch (err) {
      console.error("Failed to log follow up", err)
      toast.error("保存跟进记录失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setIsLoggingFollowUp(false)
    }
  }

  const handleStartEdit = () => {
    if (!selectedLead) return

    const budgetDigits = selectedLead.budget.replace(/[^\d.-]/g, "")

    setEditLead({
      company: selectedLead.company,
      contact: selectedLead.contact,
      phone: selectedLead.phone,
      wechat: selectedLead.wechat,
      source: selectedLead.source,
      budget: budgetDigits || "",
      grade: selectedLead.grade || "",
      tags: (selectedLead.tags ?? []).join(","),
    })
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    if (!selectedLead) return

    const budgetDigits = selectedLead.budget.replace(/[^\d.-]/g, "")

    setEditLead({
      company: selectedLead.company,
      contact: selectedLead.contact,
      phone: selectedLead.phone,
      wechat: selectedLead.wechat,
      source: selectedLead.source,
      budget: budgetDigits || "",
      grade: selectedLead.grade || "",
      tags: (selectedLead.tags ?? []).join(","),
    })
    setIsEditing(false)
  }

  const handleSaveLeadDetails = async () => {
    if (!selectedLead) return

    if (typeof selectedLead.id !== "string") {
      toast.error("当前线索数据异常", {
        description: "请刷新页面后重试",
      })
      return
    }

    if (!editLead.company.trim() || !editLead.phone.trim()) {
      toast.error("请填写必填字段", {
        description: "公司名称和联系电话为必填项",
      })
      return
    }

    const trimmedBudget = editLead.budget.trim()
    let budgetValue: number | null = null
    if (trimmedBudget) {
      const parsed = Number(trimmedBudget.replace(/,/g, ""))
      if (Number.isNaN(parsed)) {
        toast.error("预算格式不正确", {
          description: "请填写数字预算金额，例如 500000",
        })
        return
      }
      budgetValue = parsed
    }

    // 只提交实际发生变化的字段，避免无意义触发敏感字段权限校验
    const patch: Record<string, unknown> = {}

    const companyTrimmed = editLead.company.trim()
    if (companyTrimmed !== selectedLead.company) {
      patch.name = companyTrimmed
    }

    const contactTrimmed = editLead.contact.trim()
    if (contactTrimmed !== selectedLead.contact) {
      patch.customer_name = contactTrimmed || null
    }

    const phoneTrimmed = editLead.phone.trim()
    if (phoneTrimmed !== selectedLead.phone) {
      patch.customer_phone = phoneTrimmed
    }

    const wechatTrimmed = editLead.wechat.trim()
    if (wechatTrimmed !== selectedLead.wechat) {
      patch.wechat = wechatTrimmed || null
    }

    const sourceValue = editLead.source
    if (sourceValue && sourceValue !== selectedLead.sourceLevel2) {
      const selectedOption = sourceOptions.find((option) => option.key === sourceValue)
      if (selectedOption) {
        patch.source = selectedOption.label
        patch.source_level1 = selectedOption.level1Key
        patch.source_level2 = selectedOption.key
      }
    }


    const gradeValue = editLead.grade.trim()
    if (gradeValue && gradeValue !== (selectedLead.grade ?? "")) {
      patch.customer_grade = gradeValue
    }

    const tagsInput = editLead.tags.trim()
    if (tagsInput !== (selectedLead.tags ?? []).join(",")) {
      const parsedTags = tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)

      patch.tags = parsedTags
    }

    if (budgetValue != null) {
      const originalBudgetDigits = selectedLead.budget.replace(/[^\d.-]/g, "")
      const originalBudget = originalBudgetDigits ? Number(originalBudgetDigits.replace(/,/g, "")) : null
      const hasBudgetChanged = originalBudget == null || originalBudget !== budgetValue

      if (hasBudgetChanged) {
        patch.budget = budgetValue
      }
    }

    if (Object.keys(patch).length === 0) {
      setIsEditing(false)
      toast.success("线索信息已更新", {
        description: "没有检测到字段变更，已退出编辑模式",
      })
      return
    }

    try {
      setIsSavingEdit(true)
      await updateLead(selectedLead.id, patch, "编辑线索基础信息")

      const budgetLabel =
        budgetValue != null ? `¥${budgetValue.toLocaleString("zh-CN")}` : selectedLead.budget

      const updatedSourceLabel =
        editLead.source
          ? sourceOptions.find((option) => option.key === editLead.source)?.label || selectedLead.source
          : selectedLead.source

      setLeads((prev) =>
        prev.map((l) =>
          l.id === selectedLead.id
            ? {
                ...l,
                company: editLead.company.trim(),
                contact: editLead.contact.trim() || l.contact,
                phone: editLead.phone.trim(),
                wechat: editLead.wechat.trim() || l.wechat,
                source: updatedSourceLabel,
                budget: budgetLabel,
              }
            : l,
        ),
      )

      setSelectedLead((prev) =>
        prev
          ? {
              ...prev,
              company: editLead.company.trim(),
              contact: editLead.contact.trim() || prev.contact,
              phone: editLead.phone.trim(),
              wechat: editLead.wechat.trim() || prev.wechat,
              source: updatedSourceLabel,
              budget: budgetLabel,
            }
          : prev,
      )


      // 为了保证列表与详情和看板完全同步，这里在本地更新后触发一次数据重载
      retryLoad()

      setIsEditing(false)
      toast.success("线索信息已更新", {
        description: "基础信息已成功保存",
      })

    } catch (err) {
      console.error("Failed to update lead details", err)
      const friendly = mapRpcError(err as any, {
        title: "更新线索信息失败",
        description: "请稍后重试或联系管理员",
      })
      toast.error(friendly.title, {
        description: friendly.description,
      })
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleAdvanceStage = async () => {
    if (!selectedLead || !upgradeReason) {
      return
    }

    const nextStage = getNextStage()
    if (!nextStage) {
      toast.info("无法推进阶段", {
        description: "当前已是最后阶段",
      })
      setAdvanceDialogOpen(false)
      setUpgradeReason("")
      return
    }

    try {
      setIsAdvancingStage(true)

      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.rpc("rpc_lead_update", {
        p_lead_id: selectedLead.id,
        patch: {
          stage: nextStage.id,
        },
        p_reason: upgradeReason,
      })

      if (error) {
        const friendly = mapRpcError(error, {
          title: "阶段推进失败",
          description: "阶段推进失败，请稍后重试",
        })
        toast.error(friendly.title, { description: friendly.description })
        return
      }

      setLeads(leads.map((l) => (l.id === selectedLead.id ? { ...l, stage: nextStage.id } : l)))
      setSelectedLead({ ...selectedLead, stage: nextStage.id })
      toast.success("阶段推进成功", {
        description: `${selectedLead.company} 已推进至 ${nextStage.label}`,
      })
    } catch (err) {
      console.error("Failed to advance lead stage", err)
      toast.error("阶段推进失败", {
        description: "请稍后重试或联系管理员",
      })
    } finally {
      setIsAdvancingStage(false)
      setAdvanceDialogOpen(false)
      setUpgradeReason("")
    }
  }

  const getNextStage = () => {
    const currentIndex = stages.findIndex((s) => s.id === selectedLead?.stage)
    if (currentIndex < stages.length - 1) {
      return stages[currentIndex + 1]
    }
    return null
  }

  const normalizedTagKeywords = tagFilter
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)

  const filteredLeads = leads.filter((lead) => {
    const query = searchQuery.trim().toLowerCase()

    if (query) {
      const matchesText =
        lead.company.toLowerCase().includes(query) ||
        lead.contact.toLowerCase().includes(query) ||
        lead.phone.includes(searchQuery.trim())
      if (!matchesText) {
        return false
      }
    }

    if (stageFilter !== "all" && lead.stage !== stageFilter) {
      return false
    }

    // 渠道筛选：一级与二级分别可选，语义与“新增线索”保持一致
    if (sourceLevel1Filter !== "all") {
      if (!lead.sourceLevel1 || lead.sourceLevel1 !== sourceLevel1Filter) {
        return false
      }
    }

    if (sourceLevel2Filter !== "all") {
      if (!lead.sourceLevel2 || lead.sourceLevel2 !== sourceLevel2Filter) {
        return false
      }
    }

    if (ownerFilter !== "all" && lead.ownerId && lead.ownerId !== ownerFilter) {
      return false
    }


    if (gradeFilter !== "all") {
      if (!lead.grade || lead.grade !== gradeFilter) {
        return false
      }
    }

    if (normalizedTagKeywords.length > 0) {
      const tags = lead.tags ?? []
      const hasAnyTag = normalizedTagKeywords.some((keyword) =>
        tags.some((tag) => tag.toLowerCase().includes(keyword.toLowerCase())),
      )
      if (!hasAnyTag) {
        return false
      }
    }

    if (timeFilter !== "all") {
      const days = lead.lastInteraction
      if (timeFilter === "3d" && days > 3) {
        return false
      }
      if (timeFilter === "7d" && days > 7) {
        return false
      }
      if (timeFilter === "30d" && days > 30) {
        return false
      }
    }

    return true
  })


  const sortedLeads = [...filteredLeads].sort((a, b) => {
    if (sortOption === "recent") {
      return a.lastInteraction - b.lastInteraction
    }

    if (sortOption === "risk") {
      return b.lastInteraction - a.lastInteraction
    }

    if (sortOption === "budget_desc" || sortOption === "budget_asc") {
      const aBudget = parseBudgetLabel(a.budget) ?? 0
      const bBudget = parseBudgetLabel(b.budget) ?? 0
      if (sortOption === "budget_desc") {
        return bBudget - aBudget
      }
      return aBudget - bBudget
    }

    return 0
  })

  const totalLeads = sortedLeads.length
  const totalPages = Math.max(1, Math.ceil(totalLeads / PAGE_SIZE))
  const currentPageSafe = Math.min(currentPage, totalPages)
  const startIndex = (currentPageSafe - 1) * PAGE_SIZE
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalLeads)
  const pagedLeads = sortedLeads.slice(startIndex, endIndex)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{isPublicPool ? "公海池" : "我的线索"}</h1>
            <p className="text-muted-foreground">{isPublicPool ? "可领取的公共线索池" : "管理您的销售线索"}</p>
          </div>
        </div>
        <KanbanSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{isPublicPool ? "公海池" : "我的线索"}</h1>
          <p className="text-muted-foreground">{isPublicPool ? "可领取的公共线索池" : "管理您的销售线索"}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              新增线索
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新增线索</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="company">公司名称 *</Label>
                <Input
                  id="company"
                  value={newLead.company}
                  onChange={(e) => setNewLead({ ...newLead, company: e.target.value })}
                  placeholder="输入公司名称"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact">联系人</Label>
                <Input
                  id="contact"
                  value={newLead.contact}
                  onChange={(e) => setNewLead({ ...newLead, contact: e.target.value })}
                  placeholder="例如：采购经理张磊"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">
                  联系电话 * <span className="text-xs text-muted-foreground">(唯一)</span>
                </Label>
                <Input
                  id="phone"
                  value={newLead.phone}
                  onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
                  placeholder="输入联系电话"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">预算（元）</Label>
                <Input
                  id="budget"
                  value={newLead.budget}
                  onChange={(e) => setNewLead({ ...newLead, budget: e.target.value })}
                  placeholder="例如：500000"
                />
              </div>
            <div className="space-y-2">
              <Label htmlFor="source-level1">一级渠道 *</Label>
              <Select
                value={newLead.sourceLevel1}
                onValueChange={(value) => setNewLead((prev) => ({ ...prev, sourceLevel1: value, sourceLevel2: "" }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择一级渠道" />
                </SelectTrigger>
                <SelectContent>
                  {level1Options.map((channel) => (
                    <SelectItem key={channel.key} value={channel.key}>
                      {channel.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-level2">二级渠道（可选）</Label>
              <Select
                value={newLead.sourceLevel2}
                onValueChange={(value) => setNewLead((prev) => ({ ...prev, sourceLevel2: value }))}
                disabled={getChildrenForLevel1(newLead.sourceLevel1).length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    getChildrenForLevel1(newLead.sourceLevel1).length === 0
                      ? "当前一级渠道下暂无二级渠道"
                      : "选择二级渠道（可选）"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {getChildrenForLevel1(newLead.sourceLevel1).map((child) => (
                    <SelectItem key={child.key} value={child.key}>
                      {child.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="grade">客户级别</Label>
              <Select value={newLead.grade} onValueChange={(value) => setNewLead({ ...newLead, grade: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="可选：S/A/B/C" />
                </SelectTrigger>
                <SelectContent>
                  {gradeOptions.map((grade) => (
                    <SelectItem key={grade.key} value={grade.key}>
                      {grade.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">标签</Label>
              <Input
                id="tags"
                value={newLead.tags}
                onChange={(e) => setNewLead({ ...newLead, tags: e.target.value })}
                placeholder="例如：自有工厂, 品牌构想, 决策人清晰"
              />
            </div>
            <div className="space-y-2">

                <Label htmlFor="owner">负责人</Label>
                <Select
                  value={newLead.owner}
                  onValueChange={(value) => setNewLead({ ...newLead, owner: value })}
                  disabled={!canAssignLeads}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={canAssignLeads ? "选择负责人（默认为当前登录人）" : "默认使用当前登录人"} />
                  </SelectTrigger>
                  <SelectContent>
                    {salesReps.map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleAddLead} disabled={isCreating}>
                确认添加
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadError && (
        <RpcErrorBanner
          error={loadError}
          onRetry={loadError.canRetry ? retryLoad : undefined}
          onDismiss={() => setLoadError(null)}
          retryLabel="重试加载"
        />
      )}

      <Dialog open={isSaveViewDialogOpen} onOpenChange={setIsSaveViewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存当前筛选为视图</DialogTitle>
            <DialogDescription>
              将当前的筛选条件保存为命名视图，方便下次一键切换。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="view-name">视图名称</Label>
            <Input
              id="view-name"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="例如：我的 S 级高预算线索"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveViewDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!currentProfile?.id) {
                  toast.error("无法保存视图", { description: "未获取到当前用户信息" })
                  return
                }

                if (!newViewName.trim()) {
                  toast.error("请填写视图名称")
                  return
                }

                try {
                  setIsSavingView(true)

                  const supabase = getBrowserSupabaseClient()
                  const filters: LeadViewFilters = {
                    searchQuery,
                    stageFilter,
                    sourceLevel1Filter,
                    sourceLevel2Filter,
                    ownerFilter,
                    timeFilter,
                    gradeFilter,
                    tagFilter,
                    sortOption,
                  }


                  const { data, error } = await supabase
                    .from("lead_view_presets")
                    .insert({
                      profile_id: currentProfile.id,
                      name: newViewName.trim(),
                      filters,
                      is_default: false,
                    })
                    .select("id, name, filters, is_default")
                    .single()

                  if (error) {
                    console.error("Failed to save lead view preset", error)
                    toast.error("保存视图失败", { description: "请稍后重试或联系管理员" })
                    return
                  }

                  const created: LeadViewPreset = {
                    id: (data as any).id as string,
                    name: ((data as any).name as string) ?? newViewName.trim(),
                    filters: (data as any).filters as LeadViewFilters,
                    isDefault: ((data as any).is_default as boolean) ?? false,
                  }

                  setViewPresets((prev) => [...prev, created])
                  setActiveViewId(created.id)
                  setIsSaveViewDialogOpen(false)
                  setNewViewName("")

                  toast.success("视图已保存", {
                    description: "下次可以在视图下拉中一键切换到该筛选组合",
                  })
                } catch (err) {
                  console.error("Failed to save lead view preset", err)
                  toast.error("保存视图失败", { description: "请稍后重试或联系管理员" })
                } finally {
                  setIsSavingView(false)
                }
              }}
              disabled={isSavingView}
            >
              {isSavingView ? "保存中..." : "确认保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={isAdvancedFilterOpen} onOpenChange={setIsAdvancedFilterOpen}>
        <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[540px] overflow-y-auto p-0">
          <div className="p-6 space-y-4">
            <SheetHeader className="px-0">
              <SheetTitle>高级筛选</SheetTitle>
            </SheetHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">一级渠道</p>
                <Select
                  value={sourceLevel1Filter}
                  onValueChange={(value) => {
                    setSourceLevel1Filter(value)
                    setSourceLevel2Filter("all")
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="全部一级渠道" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部一级渠道</SelectItem>
                    {level1Options.map((channel) => (
                      <SelectItem key={channel.key} value={channel.key}>
                        {channel.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">二级渠道</p>
                <Select
                  value={sourceLevel2Filter}
                  onValueChange={setSourceLevel2Filter}
                  disabled={
                    sourceLevel1Filter === "all" ||
                    getChildrenForLevel1(sourceLevel1Filter).length === 0
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        sourceLevel1Filter === "all" ||
                        getChildrenForLevel1(sourceLevel1Filter).length === 0
                          ? "请选择一级渠道后筛选二级渠道"
                          : "全部二级渠道"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {getChildrenForLevel1(sourceLevel1Filter).length === 0
                        ? "当前一级渠道下暂无二级渠道"
                        : "全部二级渠道"}
                    </SelectItem>
                    {getChildrenForLevel1(sourceLevel1Filter).map((child) => (
                      <SelectItem key={child.key} value={child.key}>
                        {child.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">

                <p className="text-xs text-muted-foreground">客户级别</p>
                <Select value={gradeFilter} onValueChange={setGradeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="全部级别" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部级别</SelectItem>
                    {gradeOptions.map((grade) => (
                      <SelectItem key={grade.key} value={grade.key}>
                        {grade.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>


              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">标签关键词</p>
                <Input
                  placeholder="按标签关键词筛选，多个用逗号分隔"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">排序方式</p>
                <Select value={sortOption} onValueChange={setSortOption}>
                  <SelectTrigger>
                    <SelectValue placeholder="排序方式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">按最近跟进</SelectItem>
                    <SelectItem value="risk">按风险高优先</SelectItem>
                    <SelectItem value="budget_desc">预算从高到低</SelectItem>
                    <SelectItem value="budget_asc">预算从低到高</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">视图</p>
                <Select value={activeViewId} onValueChange={handleViewSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择视图" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">基础视图（全部）</SelectItem>
                    {viewPresets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSourceLevel1Filter("all")
                    setSourceLevel2Filter("all")
                    setGradeFilter("all")
                    setTagFilter("")
                    setSortOption("recent")
                  }}

                >
                  重置高级筛选
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-1"
                  onClick={() => {
                    setNewViewName("")
                    setIsSaveViewDialogOpen(true)
                  }}
                >
                  <Filter className="w-3 h-3" />
                  保存当前视图
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Filters Row */}


      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">

        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索公司名称、联系人、电话..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="负责人筛选" />
            </SelectTrigger>
            <SelectContent>
              {showAllOwnerOption && <SelectItem value="all">全部负责人</SelectItem>}
              {ownerOptions.map((rep) => (
                <SelectItem key={rep.id} value={rep.id}>
                  {rep.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="阶段筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部阶段</SelectItem>
              {stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="时间筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部时间</SelectItem>
              <SelectItem value="3d">最近 3 天</SelectItem>
              <SelectItem value="7d">最近 7 天</SelectItem>
              <SelectItem value="30d">最近 30 天</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-1"
            onClick={() => setIsAdvancedFilterOpen(true)}
          >
            <Filter className="w-3 h-3" />
            高级筛选
          </Button>
        </div>

      </div>

      {/* Risk Alert（仅统计未成交线索） */}

      {(() => {
        const activeLeadsForRisk = filteredLeads.filter((lead) => lead.status === "open" && lead.stage !== "Won")
        const { warningHours, dangerHours } = riskConfigRef.current



        const nowMs = Date.now()

        const urgentCount = activeLeadsForRisk.filter((lead) => {
          const lastContactAt = lead.lastContactAt ? new Date(lead.lastContactAt) : lead.createdAt ? new Date(lead.createdAt) : null
          if (!lastContactAt) return true
          const diffHours = (nowMs - lastContactAt.getTime()) / (1000 * 60 * 60)
          return diffHours >= dangerHours
        }).length

        const warningCount = activeLeadsForRisk.filter((lead) => {
          const lastContactAt = lead.lastContactAt ? new Date(lead.lastContactAt) : lead.createdAt ? new Date(lead.createdAt) : null
          if (!lastContactAt) return false
          const diffHours = (nowMs - lastContactAt.getTime()) / (1000 * 60 * 60)
          return diffHours >= warningHours && diffHours < dangerHours
        }).length


        if (urgentCount === 0 && warningCount === 0) {
          return (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <AlertTriangle className="w-5 h-5 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-emerald-800">当前暂无需要跟进的未成交线索</p>
                <p className="text-xs text-emerald-700">请继续保持跟进节奏，避免在谈线索进入风险区间</p>
              </div>
            </div>
          )
        }

        return (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <div>
              <p className="text-sm font-medium text-red-800">
                {urgentCount} 条未成交线索需要紧急跟进
              </p>
              <p className="text-xs text-red-600">
                超过配置的红色风险阈值未互动的在谈线索将被视为高风险，建议优先联系；超过黄色预警阈值但尚未达到红色风险阈值的在谈线索共有 {warningCount} 条。
              </p>

            </div>
          </div>
        )
      })()}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {stages.map((stage) => {
          const stageLeads = pagedLeads.filter((lead) => lead.stage === stage.id)
          const stageConfig = getStageConfig(stage.id)
          return (
            <div key={stage.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot stage={stage.id} />
                  <h3 className="font-medium text-sm text-foreground">{stage.label}</h3>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {stageLeads.length}
                </Badge>
              </div>
              <div className="space-y-3 min-h-[200px] md:min-h-[400px] p-2 rounded-lg">
                {stageLeads.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onClick={() => handleLeadClick(lead)} riskConfig={riskConfigRef.current} />
                ))}

              </div>
            </div>
          )
        })}
      </div>

      {totalLeads > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            显示第 {startIndex + 1}–{endIndex} 条，共 {totalLeads} 条线索
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPageSafe === 1}
            >
              上一页
            </Button>
            <span>
              第 {currentPageSafe} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => (page < totalPages ? page + 1 : page))}
              disabled={currentPageSafe === totalPages}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:w-[480px] sm:max-w-[540px] overflow-y-auto p-0">
          {selectedLead && (
            <div className="flex flex-col h-full">
              <SheetHeader className="space-y-4 p-6 pt-12 border-b">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    {isEditing ? (
                      <Input
                        value={editLead.company}
                        onChange={(e) => setEditLead({ ...editLead, company: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="公司名称"
                      />
                    ) : (
                      <SheetTitle className="text-left truncate">{selectedLead.company}</SheetTitle>
                    )}
                    <StatusBadge stage={selectedLead.stage} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:flex-wrap sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isSelectedLeadProtectedForOthers) {
                        toast.error("当前线索处于保护期", {
                          description:
                            "在保护期内，仅负责人可以重新分配或退回公海，请联系该线索负责人或等待保护期结束。",
                        })
                        return
                      }
                      setReassignDialogOpen(true)
                    }}
                    disabled={!canAssignLeads}
                  >

                    <UserPlus className="w-4 h-4 mr-1" />
                    重新分配
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTransferTargetTeamId("")
                      setTransferTargetOwnerId("")
                      setTransferReason("")
                      setTransferDialogOpen(true)
                    }}
                    disabled={!selectedLead || !canTransferLeads}
                  >
                    跨团队转移
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (isSelectedLeadProtectedForOthers) {
                        toast.error("当前线索处于保护期", {
                          description:
                            "在保护期内，仅负责人可以重新分配、跨团队转移或退回公海，请联系该线索负责人或等待保护期结束。",
                        })
                        return
                      }
                      setReturnToPoolReason("")
                      setReturnToPoolDialogOpen(true)
                    }}
                    disabled={!canReturnToPool}
                  >

                    退回公海
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteReason("")
                      setDeleteDialogOpen(true)
                    }}
                    disabled={!canDeleteLeads}
                  >
                    删除线索
                  </Button>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* 生命周期阶段视图 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">生命周期阶段</p>
                    {selectedLead.status === "closed" && (
                      <span className="text-[11px] text-muted-foreground">
                        {selectedLead.closeResult === "won" || selectedLead.stage === "Won"
                          ? "已成交"
                          : "已关闭（未成交）"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {stages.map((stage, index) => {
                      const currentIndex = stages.findIndex((s) => s.id === selectedLead.stage)
                      const isActive = stage.id === selectedLead.stage
                      const isPassed = currentIndex !== -1 && index < currentIndex

                      return (
                        <div key={stage.id} className="flex items-center gap-2">
                          <div
                            className={
                              isActive
                                ? "w-6 h-6 rounded-full flex items-center justify-center text-[11px] bg-primary text-primary-foreground"
                                : isPassed
                                  ? "w-6 h-6 rounded-full flex items-center justify-center text-[11px] bg-primary/10 text-primary"
                                  : "w-6 h-6 rounded-full flex items-center justify-center text-[11px] bg-muted text-muted-foreground"
                            }
                          >
                            {index + 1}
                          </div>
                          <span
                            className={
                              isActive
                                ? "text-[11px] text-foreground font-medium"
                                : "text-[11px] text-muted-foreground"
                            }
                          >
                            {getStageConfig(stage.id).label}
                          </span>
                          {index < stages.length - 1 && (
                            <div
                              className={
                                currentIndex > index
                                  ? "h-px w-6 bg-primary/70"
                                  : "h-px w-6 bg-muted"
                              }
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {selectedLead.status === "closed" && (
                  <div className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground flex flex-col gap-1">
                    <span>
                      关闭结果：
                      <span className="font-medium text-foreground">
                        {selectedLead.closeResult === "won" ? "成交" : "丢单"}
                      </span>
                    </span>
                    {selectedLead.closeReason && (
                      <span>
                        关闭原因：
                        <span className="font-medium text-foreground">{selectedLead.closeReason}</span>
                      </span>
                    )}
                  </div>
                )}

                {/* 锁单与保护期状态 */}

                {selectedLead && selectedLead.firstContactAt && (

                  <div className="flex flex-wrap items-center gap-3 rounded-md bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      首次有效联系：
                      <span className="font-medium text-foreground">
                        {new Date(selectedLead.firstContactAt).toLocaleString("zh-CN", { hour12: false })}
                      </span>
                    </span>
                    {selectedLead.lockedUntil && (
                      <span>
                        锁单至：
                        <span className="font-medium text-foreground">
                          {new Date(selectedLead.lockedUntil).toLocaleString("zh-CN", { hour12: false })}
                        </span>
                      </span>
                    )}
                    {selectedLead.protectedUntil && (
                      <span>
                        保护期至：
                        <span className="font-medium text-foreground">
                          {new Date(selectedLead.protectedUntil).toLocaleDateString("zh-CN")}
                        </span>
                      </span>
                    )}
                    {isSelectedLeadProtectedForOthers && (
                      <span className="text-amber-700">
                        当前线索处于保护期，仅负责人可在保护期内重新分配、跨团队转移或退回公海。
                      </span>
                    )}
                  </div>
                )}

                {/* 下一步行动模块：仅在在谈线索时展示，成交/丢单不再提示下一步行动 */}
                {selectedLead && selectedLead.status === "open" && (
                  <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-3 text-xs text-muted-foreground">

                    <div className="flex items-center justify-between gap-2">
                      <p className="inline-flex items-center gap-1 font-medium text-primary">
                        <Clock className="w-3 h-3" />
                        下一步行动
                      </p>
                      {selectedLead.nextContactAt && (
                        <span className="rounded-full bg-emerald-500/10 text-emerald-700 px-2 py-0.5 text-[11px]">
                          下次跟进已安排
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {selectedLead.nextContactAt ? (
                        <p className="text-xs">
                          下次跟进日期：
                          <span className="font-medium text-foreground">
                            {new Date(selectedLead.nextContactAt).toLocaleDateString("zh-CN")}
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs">
                          当前尚未设置下一步行动，
                          <span className="font-medium text-foreground">建议补充一个下次跟进日期</span>
                          ，避免线索长时间无人触达。
                        </p>
                      )}
                      {selectedLead.lastContactAt && (
                        <p className="text-[11px] text-muted-foreground">
                          最近一次跟进：
                          {new Date(selectedLead.lastContactAt).toLocaleString("zh-CN", { hour12: false })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                      {!selectedLead.nextContactAt && (
                        <p className="text-[11px] text-muted-foreground">
                          在下方「记录跟进」时选择下次跟进日期，即可自动生成下一步行动。
                        </p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => {
                          const el = document.getElementById("lead-followup-section")
                          if (el) {
                            el.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                        }}
                      >
                        立即记录一次跟进
                      </Button>
                    </div>
                  </div>
                )}

                {/* Key Info Grid */}

                <div className="grid grid-cols-2 gap-4">

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3" /> 联系人
                    </p>
                    {isEditing ? (
                      <Input
                        value={editLead.contact}
                        onChange={(e) => setEditLead({ ...editLead, contact: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="联系人姓名"
                      />
                    ) : (
                      <p className="text-sm font-medium">{selectedLead.contact}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> 电话
                    </p>
                    {isEditing ? (
                      <Input
                        value={editLead.phone}
                        onChange={(e) => setEditLead({ ...editLead, phone: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="联系电话"
                      />
                    ) : (
                      <p className="text-sm font-medium">{selectedLead.phone}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" /> 微信
                    </p>
                    {isEditing ? (
                      <Input
                        value={editLead.wechat}
                        onChange={(e) => setEditLead({ ...editLead, wechat: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="微信号"
                      />
                    ) : (
                      <p className="text-sm font-medium">{selectedLead.wechat || "-"}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">来源</p>
                    {isEditing ? (
                      <Select
                        value={editLead.source}
                        onValueChange={(value) => setEditLead({ ...editLead, source: value })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="选择来源" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceOptions.map((option) => (
                            <SelectItem key={option.key} value={option.key}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                    ) : (
                      <Badge variant="secondary">{selectedLead.source}</Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">预算</p>
                    {isEditing ? (
                      <Input
                        value={editLead.budget}
                        onChange={(e) => setEditLead({ ...editLead, budget: e.target.value })}
                        className="h-8 text-sm max-w-xs"
                        placeholder="预算金额（元）"
                      />
                    ) : (
                      <p className="text-sm font-medium text-primary">{selectedLead.budget}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">客户级别</p>
                    {isEditing ? (
                      <Select
                        value={editLead.grade}
                        onValueChange={(value) => setEditLead({ ...editLead, grade: value })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="选择客户级别" />
                        </SelectTrigger>
                        <SelectContent>
                          {gradeOptions.map((grade) => (
                            <SelectItem key={grade.key} value={grade.key}>
                              {grade.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : selectedLead.grade ? (
                      <Badge variant="outline">{selectedLead.grade}</Badge>
                    ) : (
                      <p className="text-sm text-muted-foreground">未设置</p>
                    )}
                  </div>

                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground">标签</p>
                    {isEditing ? (
                      <Input
                        value={editLead.tags}
                        onChange={(e) => setEditLead({ ...editLead, tags: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="例如：自有工厂, 品牌构想, 决策人清晰"
                      />
                    ) : selectedLead.tags && selectedLead.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {selectedLead.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">未添加标签</p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  {isEditing ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={isSavingEdit}
                      >
                        取消
                      </Button>
                      <Button size="sm" onClick={handleSaveLeadDetails} disabled={isSavingEdit}>
                        保存基础信息
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={handleStartEdit}>
                      编辑基础信息
                    </Button>
                  )}
                </div>

                {/* Log Follow-up Section：仅在在谈线索时允许新增跟进，成交/丢单仅保留历史记录 */}
                {selectedLead?.status === "open" && (
                  <div id="lead-followup-section" className="space-y-3">

                  <h4 className="text-sm font-semibold text-foreground">记录跟进</h4>

                  <Textarea
                    placeholder="输入跟进内容..."
                    value={followUp.content}
                    onChange={(e) => setFollowUp({ ...followUp, content: e.target.value })}
                    className="min-h-[80px]"
                  />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Select
                        value={followUp.type}
                        onValueChange={(value) => setFollowUp({ ...followUp, type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="互动类型" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="call">电话</SelectItem>
                          <SelectItem value="wechat">微信</SelectItem>
                          <SelectItem value="visit">拜访</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Input
                        type="date"
                        placeholder="下次跟进日期"
                        value={followUp.nextDate}
                        onChange={(e) => setFollowUp({ ...followUp, nextDate: e.target.value })}
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleLogFollowUp}
                    disabled={!followUp.content || !followUp.type || isLoggingFollowUp}
                    className="w-full"
                  >
                    保存跟进记录
                  </Button>
                </div>
                )}

                {/* Interaction Timeline */}

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">互动记录</h4>
                  <div className="space-y-0">
                    {isLoadingInteractionsLeadId === selectedLead.id && (
                      <p className="text-sm text-muted-foreground text-center py-4">正在加载跟进记录...</p>
                    )}
                    {isLoadingInteractionsLeadId !== selectedLead.id &&
                      selectedLead.interactions.map((interaction) => (
                        <InteractionItem key={interaction.id} interaction={interaction} />
                      ))}
                    {isLoadingInteractionsLeadId !== selectedLead.id &&
                      selectedLead.interactions.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">暂无互动记录</p>
                      )}
                  </div>
                </div>
              </div>

              <div className="border-t p-6 mt-auto flex flex-col gap-2">
                <Button
                  className="w-full"
                  onClick={() => setAdvanceDialogOpen(true)}
                  disabled={!selectedLead || selectedLead.status === "closed" || isAdvancingStage}
                >
                  推进阶段
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                {selectedLead?.status === "closed" && (
                  <p className="text-xs text-muted-foreground text-center">
                    已关闭线索无法继续推进阶段，如需调整请联系管理员。
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setCloseResult("")
                    setCloseReason("")
                    setCloseDialogOpen(true)
                  }}
                  disabled={!selectedLead}
                >
                  标记成交 / 丢单
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>跨团队转移线索</DialogTitle>
            <DialogDescription>
              将 {selectedLead?.company} 转移到其他团队，并指定新的负责人。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-team">目标团队 *</Label>
              <Select
                value={transferTargetTeamId}
                onValueChange={(value) => {
                  setTransferTargetTeamId(value)
                  setTransferTargetOwnerId("")
                }}
              >
                <SelectTrigger id="transfer-team">
                  <SelectValue placeholder="选择目标团队" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={String(team.id)}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-owner">新的负责人 *</Label>
              <Select
                value={transferTargetOwnerId}
                onValueChange={setTransferTargetOwnerId}
                disabled={!transferTargetTeamId}
              >
                <SelectTrigger id="transfer-owner">
                  <SelectValue placeholder={transferTargetTeamId ? "选择新负责人" : "请先选择目标团队"} />
                </SelectTrigger>
                <SelectContent>
                  {salesReps
                    .filter((rep) => rep.teamId != null && String(rep.teamId) === transferTargetTeamId)
                    .map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-reason">转移原因 (可选)</Label>
              <Textarea
                id="transfer-reason"
                placeholder="例如：客户所在区域调整，由新团队负责跟进..."
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!selectedLead || !transferTargetTeamId || !transferTargetOwnerId) {
                  toast.error("请先选择目标团队和新负责人")
                  return
                }

                if (typeof selectedLead.id !== "string") {
                  toast.error("当前线索数据异常", {
                    description: "请刷新页面后重试",
                  })
                  return
                }

                const targetTeamIdNumber = Number.parseInt(transferTargetTeamId, 10)
                if (Number.isNaN(targetTeamIdNumber)) {
                  toast.error("目标团队选择无效")
                  return
                }

                if (selectedLead.teamId != null && selectedLead.teamId === targetTeamIdNumber) {
                  toast.error("请选择不同的目标团队")
                  return
                }

                try {
                  setIsReassigning(true)
                  await transferLead(selectedLead.id, targetTeamIdNumber, transferTargetOwnerId)

                  const teamName = teams.find((t) => t.id === targetTeamIdNumber)?.name ?? "目标团队"
                  const ownerName =
                    salesReps.find((rep) => rep.id === transferTargetOwnerId)?.name ?? "新负责人"

                  toast.success("线索已跨团队转移", {
                    description: `${selectedLead.company} 已转移至 ${teamName}，由 ${ownerName} 负责`,
                  })

                  setTransferDialogOpen(false)
                  setSheetOpen(false)
                  setSelectedLead(null)
                  setTransferTargetTeamId("")
                  setTransferTargetOwnerId("")
                  setTransferReason("")
                  retryLoad()
                } catch (err) {
                  console.error("Failed to transfer lead", err)
                  const friendly = mapRpcError(err as any, {
                    title: "跨团队转移失败",
                    description: "请稍后重试或联系管理员",
                  })
                  toast.error(friendly.title, {
                    description: friendly.description,
                  })
                } finally {
                  setIsReassigning(false)
                }
              }}
              disabled={!transferTargetTeamId || !transferTargetOwnerId || isReassigning}
            >
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>推进线索阶段</DialogTitle>
            <DialogDescription>
              将 {selectedLead?.company} 从 {stages.find((s) => s.id === selectedLead?.stage)?.label} 推进至{" "}
              {getNextStage()?.label}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">推进原因 *</Label>
              <Textarea
                id="reason"
                placeholder="请输入推进原因（必填）..."
                value={upgradeReason}
                onChange={(e) => setUpgradeReason(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAdvanceStage} disabled={!upgradeReason || isAdvancingStage}>
              确认推进
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关闭线索</DialogTitle>
            <DialogDescription>
              为 {selectedLead?.company} 标记成交或丢单结果
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="close-result">关闭结果 *</Label>
              <Select
                value={closeResult}
                onValueChange={(value) => setCloseResult(value as "won" | "lost")}
              >
                <SelectTrigger id="close-result">
                  <SelectValue placeholder="选择关闭结果" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="won">成交</SelectItem>
                  <SelectItem value="lost">丢单</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="close-reason">关闭原因 *</Label>
              <Textarea
                id="close-reason"
                placeholder="请输入成交或丢单的原因，便于后续复盘..."
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!selectedLead || !closeResult || !closeReason.trim()) {
                  toast.error("请完善关闭结果与原因")
                  return
                }

                if (typeof selectedLead.id !== "string") {
                  toast.error("当前线索数据异常", {
                    description: "请刷新页面后重试",
                  })
                  return
                }

                try {
                  setIsClosingLead(true)
                  await closeLead(selectedLead.id, closeResult, closeReason.trim())

                  toast.success("线索已关闭", {
                    description: closeResult === "won" ? "已标记为成交" : "已标记为丢单",
                  })

                  setCloseDialogOpen(false)
                  setSheetOpen(false)
                  setSelectedLead(null)
                  setCloseResult("")
                  setCloseReason("")
                  retryLoad()
                } catch (err) {
                  console.error("Failed to close lead", err)
                  const friendly = mapRpcError(err as any, {
                    title: "关闭线索失败",
                    description: "请稍后重试或联系管理员",
                  })
                  toast.error(friendly.title, {
                    description: friendly.description,
                  })
                } finally {
                  setIsClosingLead(false)
                }
              }}
              disabled={!closeResult || !closeReason.trim() || isClosingLead}
            >
              确认关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reassignDialogOpen} onOpenChange={setReassignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重新分配线索</DialogTitle>
            <DialogDescription>
              将 <strong>{selectedLead?.company}</strong> 分配给其他销售人员
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reassign-rep">分配给 *</Label>
              <Select value={reassignToRep} onValueChange={setReassignToRep}>
                <SelectTrigger>
                  <SelectValue placeholder="选择销售人员" />
                </SelectTrigger>
                <SelectContent>
                  {ownerOptions.map((rep) => (
                    <SelectItem key={rep.id} value={rep.id}>
                      <div className="flex items-center gap-2">
                        <span>{rep.name}</span>
                        <span className="text-xs text-muted-foreground">({activeLeadsByOwnerId.get(rep.id) ?? 0} 条在跟进)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reassign-note">分配备注 (可选)</Label>
              <Textarea
                id="reassign-note"
                placeholder="例如：高优先级客户，需重点跟进..."
                value={reassignNote}
                onChange={(e) => setReassignNote(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleReassign} disabled={!reassignToRep || isReassigning}>
              确认分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnToPoolDialogOpen} onOpenChange={setReturnToPoolDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退回公海</DialogTitle>
            <DialogDescription>
              将 {selectedLead?.company} 退回公海池，其他有权限的同事可以从公海中重新认领。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="return-to-pool-reason">退回原因 *</Label>
              <Textarea
                id="return-to-pool-reason"
                placeholder="请输入退回原因，如长期未接通、客户暂缓等..."
                value={returnToPoolReason}
                onChange={(e) => setReturnToPoolReason(e.target.value)}
                className="min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground">
                退回原因会记录在审计日志中，公海池列表也会显示给有权限的成员。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReturnToPoolDialogOpen(false)
                setReturnToPoolReason("")
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleReturnToPool}
              disabled={!returnToPoolReason.trim() || isReturningToPool || !canReturnToPool}
            >
              确认退回公海
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除线索</DialogTitle>
            <DialogDescription>
              删除后该线索会从当前列表中移除，相关操作会记录在审计日志中。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="delete-reason">删除原因 *</Label>
              <Textarea
                id="delete-reason"
                placeholder="请输入删除原因，便于后续审计和追踪..."
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground">删除权限由系统设置 → 角色权限中的“删除线索”开关控制。</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteReason("")
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!selectedLead) {
                  return
                }

                if (typeof selectedLead.id !== "string") {
                  toast.error("当前线索数据异常", {
                    description: "请刷新页面后重试",
                  })
                  return
                }

                if (!deleteReason.trim()) {
                  toast.error("请填写删除原因")
                  return
                }

                try {
                  setIsDeletingLead(true)

                  const supabase = getBrowserSupabaseClient()
                  const { error } = await supabase.rpc("rpc_lead_delete", {
                    p_lead_id: selectedLead.id,
                    p_reason: deleteReason.trim(),
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
                    description: `${selectedLead.company} 已从当前列表中移除，相关操作已记录`,
                  })

                  setLeads((prev) => prev.filter((l) => l.id !== selectedLead.id))
                  setDeleteDialogOpen(false)
                  setSheetOpen(false)
                  setSelectedLead(null)
                  setDeleteReason("")
                } catch (err) {
                  console.error("Failed to delete lead", err)
                  toast.error("删除线索失败", {
                    description: "请稍后重试或联系管理员",
                  })
                } finally {
                  setIsDeletingLead(false)
                }
              }}
              disabled={!deleteReason.trim() || isDeletingLead || !canDeleteLeads}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
