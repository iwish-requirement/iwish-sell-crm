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
import { Checkbox } from "@/components/ui/checkbox"

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
import { LeadKanbanImportDialog } from "@/components/lead-kanban-import-dialog"

interface Lead {
  id: string | number
  company: string
  website?: string
  contact: string
  phone: string
  wechat: string
  source: string
  budget: string
  lastInteraction: number
  sourceLevel1?: string | null
  sourceLevel2?: string | null
  businessCategories?: { id: number; name: string }[]
  businessTypes?: { id: number; name: string; categoryId: number }[]
  // 责任归因与来源细分字段（来自 leads_secure_view）
  responsibilityType?: string | null
  devMethodKey?: string | null
  referralCustomerName?: string | null
  referralTypeKey?: string | null
  activityName?: string | null
  sourceDepartmentKey?: string | null

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
  type: "call" | "wechat" | "visit" | "system"
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

interface ResponsibilityTypeOption {
  key: string
  label: string
}

interface DevMethodOption {
  key: string
  label: string
}

interface ReferralTypeOption {
  key: string
  label: string
}

interface SourceDepartmentOption {
  key: string
  label: string
}

const FALLBACK_RESPONSIBILITY_TYPES: ResponsibilityTypeOption[] = [
  { key: "company_resource", label: "公司分配资源" },
  { key: "sales_self", label: "销售自主开发" },
  { key: "customer_referral", label: "客户转介绍" },
]

const FALLBACK_DEV_METHODS: DevMethodOption[] = [
  { key: "email_outreach", label: "邮件开发" },
  { key: "private_domain", label: "私域运营/朋友圈" },
  { key: "old_customer_mining", label: "老客挖掘" },
  { key: "short_video", label: "短视频/内容引流" },
  { key: "other", label: "其他" },
]

const FALLBACK_REFERRAL_TYPES: ReferralTypeOption[] = [
  { key: "existing_customer", label: "老客户介绍" },
  { key: "partner", label: "渠道伙伴介绍" },
  { key: "friend", label: "朋友/人脉介绍" },
]

const FALLBACK_SOURCE_DEPARTMENTS: SourceDepartmentOption[] = [
  { key: "sz_sales", label: "深圳销售团队" },
  { key: "sz_cs", label: "深圳客服团队" },
  { key: "hz_sales", label: "杭州销售团队" },
]

// 公司分配资源场景下的二级来源分组（与设置页默认值保持一致）
const FALLBACK_COMPANY_RESOURCE_GROUPS: SourceChannel[] = [
  {
    key: "social_media",
    label: "社媒渠道",
    children: [
      { key: "wechat_company", label: "视频号（公司号）" },
      { key: "wechat_ip_1", label: "视频号（IP号）" },
      { key: "wechat_ip_2", label: "视频号（IP号2）" },
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
      { key: "website_form", label: "官网表单" },
      { key: "website_wechat", label: "官网加微信" },
    ],
  },
  {
    key: "offline_events",
    label: "线下活动",
    children: [
      { key: "strategy_course", label: "一号位战略课" },
      { key: "traffic_course", label: "流量系列课" },
      { key: "brand_course", label: "品牌系列课" },
      { key: "seo_course", label: "SEO系列课" },
      { key: "expo", label: "展会" },
      { key: "public_workshop", label: "公开课分享会" },
      { key: "other_event", label: "其他活动" },
    ],
  },
  {
    key: "livestream",
    label: "直播类",
    children: [{ key: "livestream_lead", label: "直播间线索" }],
  },
]

const responsibilityTypeOptions: ResponsibilityTypeOption[] = FALLBACK_RESPONSIBILITY_TYPES
const devMethodOptions: DevMethodOption[] = FALLBACK_DEV_METHODS
const referralTypeOptions: ReferralTypeOption[] = FALLBACK_REFERRAL_TYPES
const companyResourceGroupOptions: SourceChannel[] = FALLBACK_COMPANY_RESOURCE_GROUPS


// 线索列表由 Supabase 实时加载，这里不再保留历史 mock 数据，以免造成误解




const stages = [
  { id: "L1", label: "L1 询盘" },
  { id: "L2", label: "L2 意向" },
  { id: "L3", label: "L3 关键意向" },
  { id: "L4", label: "L4 谈判" },
  { id: "Won", label: "成交" },
]

const FALLBACK_SOURCE_CHANNELS: SourceChannel[] = [
  {
    key: "ads",
    label: "广告投放",
    children: [
      { key: "ads_douyin", label: "抖音广告" },
      { key: "ads_wechat_video", label: "视频号广告" },
      { key: "ads_feed", label: "信息流广告" },
      { key: "ads_search", label: "搜索广告" },
    ],
  },
  {
    key: "content_privacy",
    label: "内容与私域",
    children: [
      { key: "content_douyin_live", label: "抖音直播间" },
      { key: "content_wechat_live", label: "视频号直播" },
      { key: "content_wechat_article", label: "公众号/内容文章" },
      { key: "content_other", label: "其他内容平台" },
    ],
  },
  {
    key: "offline",
    label: "线下活动",
    children: [
      { key: "offline_expo", label: "展会" },
      { key: "offline_salon", label: "沙龙/培训" },
      { key: "offline_promotion", label: "地推活动" },
    ],
  },
  {
    key: "website_forms",
    label: "官网与表单",
    children: [
      { key: "website_form", label: "官网表单" },
      { key: "landing_page", label: "着陆页" },
      { key: "miniapp_form", label: "小程序表单" },
    ],
  },
  {
    key: "partners",
    label: "渠道合作/代理商",
    children: [
      { key: "partner_referral", label: "渠道商推荐" },
      { key: "partner_joint_campaign", label: "联合活动/联合运营" },
    ],
  },
  {
    key: "referrals",
    label: "老客与转介绍",
    children: [
      { key: "existing_customer", label: "老客续费/增购引导" },
      { key: "customer_referral", label: "客户转介绍" },
    ],
  },
  {
    key: "internal",
    label: "内部线索",
    children: [
      { key: "internal_manual", label: "手工录入" },
      { key: "internal_transfer", label: "内部转移/共享" },
    ],
  },
]

const FALLBACK_GRADES: GradeDefinition[] = [
  { key: "S", label: "S级（强成交 / 立即跟进）" },
  { key: "A", label: "A级（重点培育 / 近期可成交）" },
  { key: "B", label: "B级（普通意向 / 需持续教育）" },
  { key: "C", label: "C级（低优先级 / 长期培育）" },
]

const PAGE_SIZE = 10
const LEAD_QUERY_PAGE_SIZE = 1000
const LEAD_SELECT_COLUMNS =
  "id, team_id, owner_id, created_by, name, website, source, stage, status, close_result, close_reason, last_contact_at, created_at, updated_at, customer_name, customer_phone, customer_email, address, budget, internal_score, blacklist_reason, next_contact_at, wechat, customer_grade, source_level1, source_level2, tags, first_contact_at, locked_by, locked_until, protected_until, business_categories, business_types, responsibility_type, dev_method_key, referral_customer_name, referral_type_key, activity_name, source_department_key, source_locked_at"



function parseBudgetLabel(budget: string): number | null {
  const digits = budget.replace(/[^\d.-]/g, "")
  if (!digits) return null
  const value = Number(digits)
  return Number.isNaN(value) ? null : value
}

function LeadCard({
  lead,
  onClick,
  riskConfig,
  sourceLevel1Label,
  sourceLevel2Label,
  ownerLabel,
}: {
  lead: Lead
  onClick: () => void
  riskConfig: { warningHours: number; dangerHours: number }
  sourceLevel1Label: string | null
  sourceLevel2Label: string | null
  ownerLabel: string | null
}) {

  const getStatusBadge = () => {
    if (lead.status === "closed") {
      if (lead.closeResult === "won" || lead.closeResult === "成交") {
        return (
          <Badge variant="outline" className="text-sm border-emerald-500/60 text-emerald-700">
            成交
          </Badge>
        )
      }
      return (
        <Badge variant="outline" className="text-sm border-slate-300 text-slate-600">
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
      return <Badge className="bg-amber-100 text-amber-700 text-xs hover:bg-amber-100 font-medium">需跟进</Badge>
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

  const companyLabel = (lead.company ?? "").trim()
  const websiteLabel = (lead.website ?? "").trim()
  const hasCompany = companyLabel.length > 0
  const hasWebsite = websiteLabel.length > 0
  const title = hasCompany ? companyLabel : hasWebsite ? websiteLabel : "未命名线索"
  const isWebsiteOnlyTitle = hasWebsite && (!hasCompany || companyLabel === websiteLabel)
  const titleClassName = isWebsiteOnlyTitle
    ? "text-lg font-bold text-foreground leading-tight break-all"
    : "text-lg font-bold text-foreground leading-tight"


  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow border-muted-foreground/10 overflow-hidden" onClick={onClick}>
      <CardContent className="p-4 space-y-3 break-words">

        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={titleClassName}>{title}</p>
            {hasCompany && hasWebsite && (
              <p className="text-xs text-muted-foreground mt-0.5 break-all">{websiteLabel}</p>
            )}
            {lead.contact && (
              <p className="text-sm text-muted-foreground font-medium mt-0.5">{lead.contact}</p>
            )}

          </div>



          <div className="flex flex-col items-end gap-1.5">
            {getStatusBadge()}
            {getRiskBadge(lead)}
          </div>
        </div>


        <div className="flex flex-wrap gap-2">
          {sourceLevel1Label || sourceLevel2Label ? (
            <>
              {sourceLevel1Label ? (
                <Badge variant="secondary" className="text-sm font-normal">
                  {sourceLevel1Label}
                </Badge>
              ) : null}
              {sourceLevel2Label ? (
                <Badge variant="outline" className="text-sm font-normal border-muted-foreground/20">
                  {sourceLevel2Label}
                </Badge>
              ) : null}
            </>
          ) : (
            <Badge variant="secondary" className="text-sm font-normal">
              {lead.source}
            </Badge>
          )}
          <Badge variant="outline" className="text-sm font-normal">
            {lead.budget}
          </Badge>
          {lead.businessCategories?.map((cat) => (
            <Badge key={`cat-${cat.id}`} variant="outline" className="text-xs font-medium border-primary/30 text-primary">
              {cat.name}
            </Badge>
          ))}
          {lead.businessTypes?.map((bt) => (
            <Badge key={`type-${bt.id}`} variant="secondary" className="text-xs font-medium">
              {bt.name}
            </Badge>
          ))}

          {lead.grade && (
            <Badge variant="outline" className="text-sm font-medium border-primary/30 text-primary">
              级别 {lead.grade}
            </Badge>
          )}
        </div>
        {displayedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {displayedTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[11px] px-2 py-1 bg-muted/50 text-muted-foreground max-w-full whitespace-normal break-words w-full text-left">


                {tag}
              </Badge>
            ))}
            {remainingTagsCount > 0 && (
              <span className="text-[11px] text-muted-foreground">+{remainingTagsCount}</span>
            )}

          </div>
        )}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground pt-1 border-t border-muted/30">
          <Calendar className="w-3.5 h-3.5" />
          <span className="font-medium text-foreground/70">{lastContactLabel}</span>
          <span className="text-muted-foreground/30">|</span>
          <span>{lastContactDateLabel}</span>
        </div>
        {ownerLabel && (
          <div className="pt-1 text-sm font-semibold text-foreground">
            负责人：{ownerLabel}
          </div>
        )}





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
      case "system":
        return <ArrowRight className="w-4 h-4" />
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
        <Avatar className="w-9 h-9 border border-background">
          {interaction.avatar ? (
            <AvatarImage src={interaction.avatar} />
          ) : null}
          <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">
            {(interaction.user && interaction.user.length > 0 ? interaction.user : "?").slice(0, 1)}
          </AvatarFallback>
        </Avatar>
        <div className="w-px h-full bg-border mt-2" />
      </div>

      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <Badge variant="outline" className="text-sm gap-1 font-semibold border-primary/20 bg-primary/5">
            {getIcon(interaction.type)}
            {getTypeLabel(interaction.type)}
          </Badge>
          <span className="text-sm text-muted-foreground">{interaction.date}</span>
          <span className="text-sm font-semibold text-foreground/80">· {interaction.user}</span>
        </div>
        <p className="text-sm text-foreground leading-relaxed bg-muted/30 p-2.5 rounded-md border border-muted/50">{interaction.content}</p>
      </div>
    </div>
  )
}


export function LeadKanban({ isPublicPool = false }: { isPublicPool?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newLead, setNewLead] = useState({
    company: "",
    website: "",
    contact: "",
    phone: "",
    wechat: "",
    sourceLevel1: "",
    sourceLevel2: "",
    budget: "",
    owner: "",
    grade: "",
    tags: "",
    businessCategoryIds: [] as string[],
    businessTypeIds: [] as string[],
    responsibilityType: "",
    devMethodKey: "",
    referralCustomerName: "",
    referralTypeKey: "",
    activityName: "",
    sourceDepartmentKey: "",
  })





  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const mePermissions = React.useContext(MePermissionsContext)
  const canAssignLeads = mePermissions?.canAssignLeads ?? false
  const canReturnToPool = mePermissions?.canReturnToPool ?? false
  const canDeleteLeads = mePermissions?.canDeleteLeads ?? false
  const canImportLeads = mePermissions?.canImportLeads ?? false
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
    website: "",
    contact: "",
    phone: "",
    wechat: "",
    sourceLevel1: "",
    sourceLevel2: "",
    budget: "",
    grade: "",
    tags: "",
    businessTypeIds: [] as string[],
    responsibilityType: "",
    devMethodKey: "",
    referralCustomerName: "",
    referralTypeKey: "",
    activityName: "",
    sourceDepartmentKey: "",
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
  const [businessCategories, setBusinessCategories] = useState<{ id: number; name: string; sort_order?: number }[]>([])
  const [businessTypes, setBusinessTypes] = useState<{ id: number; name: string; category_id: number; sort_order?: number }[]>([])

  const [sourceChannels, setSourceChannels] = useState<SourceChannel[]>([])
  const [sourceDepartments, setSourceDepartments] = useState<SourceDepartmentOption[]>(FALLBACK_SOURCE_DEPARTMENTS)


  const gradeOptions: GradeDefinition[] = gradeDefinitions.length > 0 ? gradeDefinitions : FALLBACK_GRADES

  const level1Options: SourceChannel[] = useMemo(
    () => (sourceChannels.length > 0 ? sourceChannels : FALLBACK_SOURCE_CHANNELS),
    [sourceChannels],
  )

  const sourceOptions: SourceOption[] = useMemo(() => {
    const channelsToUse = sourceChannels.length > 0 ? sourceChannels : FALLBACK_SOURCE_CHANNELS

    const flattened: SourceOption[] = []

    for (const channel of channelsToUse) { 
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

  const businessTypeGroups = useMemo(
    () =>
      businessCategories.map((cat) => ({
        ...cat,
        types: businessTypes.filter((t) => t.category_id === cat.id),
      })),
    [businessCategories, businessTypes],
  )

  const businessTypeMap = useMemo(() => {
    const map = new Map<number, { id: number; name: string; category_id: number; sort_order?: number }>()
    for (const t of businessTypes) {
      map.set(t.id, t)
    }
    return map
  }, [businessTypes])

  const legacySourceLevel1Keys = useMemo<string[]>(() => {
    const keys = new Set<string>()
    const responsibilityKeys = new Set(responsibilityTypeOptions.map((item) => item.key))
    for (const lead of leads) {
      const key = lead.sourceLevel1
      if (key && !responsibilityKeys.has(key)) {
        keys.add(key)
      }
    }
    return Array.from(keys).sort()
  }, [leads])

  const getChildrenForLevel1 = (level1Key: string): SourceTreeChild[] => {
    const channel = level1Options.find((c) => c.key === level1Key)
    return channel?.children ?? []
  }

  const getSecondarySourceOptionsForFilter = (level1Key: string): SourceTreeChild[] => {
    if (!level1Key || level1Key === "all") {
      return []
    }

    // 新来源模型：公司分配资源场景下，二级来源来自公司分配资源分组配置
    if (level1Key === "company_resource") {
      const children: SourceTreeChild[] = []
      for (const group of companyResourceGroupOptions) {
        for (const child of group.children ?? []) {
          children.push(child)
        }
      }
      return children
    }

    // 历史渠道树：用于兼容旧线索的一级/二级来源
    return getChildrenForLevel1(level1Key)
  }



  const resolveSourceLabel = (
    level1Key: string | null | undefined,
    level2Key: string | null | undefined,
  ): string => {
    // 新来源模型下，source_level1 即责任归因，source_level2 在公司分配资源场景下表示二级来源
    if (level1Key && FALLBACK_RESPONSIBILITY_TYPES.some((item) => item.key === level1Key)) {
      const resp = FALLBACK_RESPONSIBILITY_TYPES.find((item) => item.key === level1Key)
      if (level1Key === "company_resource" && level2Key) {
        for (const group of companyResourceGroupOptions) {
          const child = (group.children ?? []).find((ch) => ch.key === level2Key)
          if (child) {
            return child.label
          }
        }
      }
      return resp?.label ?? level1Key
    }

    const channelsToUse = sourceChannels.length > 0 ? sourceChannels : FALLBACK_SOURCE_CHANNELS

    if (level1Key) {
      const channel = channelsToUse.find((c) => c.key === level1Key)
      if (channel) {
        if (level2Key) {
          const child = (channel.children ?? []).find((ch) => ch.key === level2Key)
          if (child) {
            return child.label
          }
        }
        return channel.label
      }

      // 如果找不到配置，兜底返回 key（至少保证有值）
      return level1Key
    }

    return "其他"
  }

  const resolveSourceLevel1Label = (level1Key: string | null | undefined): string | null => {
    if (!level1Key) return null

    const resp = FALLBACK_RESPONSIBILITY_TYPES.find((item) => item.key === level1Key)
    if (resp) {
      return resp.label
    }

    const channelsToUse = sourceChannels.length > 0 ? sourceChannels : FALLBACK_SOURCE_CHANNELS
    const channel = channelsToUse.find((c) => c.key === level1Key)

    return channel?.label ?? level1Key
  }

  const resolveSourceLevel2Label = (
    level1Key: string | null | undefined,
    level2Key: string | null | undefined,
  ): string | null => {
    if (!level2Key) return null

    if (level1Key === "company_resource") {
      for (const group of companyResourceGroupOptions) {
        const child = (group.children ?? []).find((ch) => ch.key === level2Key)
        if (child) {
          return child.label
        }
      }
      return level2Key
    }

    const channelsToUse = sourceChannels.length > 0 ? sourceChannels : FALLBACK_SOURCE_CHANNELS

    if (level1Key) {
      const channel = channelsToUse.find((c) => c.key === level1Key)
      const child = (channel?.children ?? []).find((ch) => ch.key === level2Key)
      return child?.label ?? level2Key
    }

    return level2Key
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
    const loadedPermissions = mePermissions

    if (loadedPermissions === null) {
      if (!hasLoadedOnceRef.current) {
        setIsLoading(true)
      }
      return () => {
        isMounted = false
      }
    }

    async function loadLeads() {
      // 只有第一次加载时才显示骨架屏，后续通过 Realtime/刷新在后台悄悄拉数据
      if (!hasLoadedOnceRef.current) {
        setIsLoading(true)
      }
      setLoadError(null)

      try {
        const supabase = getBrowserSupabaseClient()
        const profile = await fetchCurrentUserProfile(supabase)

        if (!isMounted) {
          return
        }

        setCurrentProfile(profile)

        const scopeType = loadedPermissions?.leadScopeType ?? "self"
        const buildLeadsQuery = () => {
          let query = supabase
            .from("leads_secure_view")
            .select(LEAD_SELECT_COLUMNS)
            .in("status", ["open", "closed"])

          if (scopeType === "self" && profile?.id) {
            query = query.eq("owner_id", profile.id)
          } else if (scopeType === "team" && profile?.teamId != null) {
            query = query.eq("team_id", profile.teamId)
          }

          return query.order("updated_at", { ascending: false })
        }

        if ((scopeType === "self" && !profile?.id) || (scopeType === "team" && profile?.teamId == null)) {
          setLeads([])
          return
        }

        const loadLeadRows = async () => {
          const rows: any[] = []

          for (let offset = 0; ; offset += LEAD_QUERY_PAGE_SIZE) {
            const { data, error } = await buildLeadsQuery().range(offset, offset + LEAD_QUERY_PAGE_SIZE - 1)

            if (error) {
              return { data: null, error }
            }

            const page = data ?? []
            rows.push(...page)

            if (page.length < LEAD_QUERY_PAGE_SIZE) {
              break
            }
          }

          return { data: rows, error: null }
        }

        const [
          { data, error },
          { data: businessRulesRpcResult, error: businessRulesError },
        ] = await Promise.all([
          loadLeadRows(),
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
                website: (row as any).website ?? "",
                contact: row.customer_name ?? "未填写联系人",
                phone: row.customer_phone ?? "",
                wechat: (row.wechat as string | null) ?? "",
                source: row.source ?? "其他",

                sourceLevel1: (row.source_level1 as string | null) ?? null,
                sourceLevel2: (row.source_level2 as string | null) ?? null,
                businessCategories: Array.isArray(row.business_categories)
                  ? (row.business_categories as any[]).map((bc) => ({ id: Number(bc.id), name: String(bc.name) }))
                  : [],
                businessTypes: Array.isArray(row.business_types)
                  ? (row.business_types as any[]).map((bt) => ({ id: Number(bt.id), name: String(bt.name), categoryId: Number(bt.category_id) }))
                  : [],

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
                responsibilityType: (row.responsibility_type as string | null) ?? null,
                devMethodKey: (row.dev_method_key as string | null) ?? null,
                referralCustomerName: (row.referral_customer_name as string | null) ?? null,
                referralTypeKey: (row.referral_type_key as string | null) ?? null,
                activityName: (row.activity_name as string | null) ?? null,
                sourceDepartmentKey: (row.source_department_key as string | null) ?? null,
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
  }, [mePermissions, reloadToken, retryLoad])

  useEffect(() => {
    let isMounted = true

    async function loadLeadConfigs() {
      try {
        const supabase = getBrowserSupabaseClient()

        const [gradeResult, sourceResult, categoryResult, typeResult, sourceDeptResult] = await Promise.all([

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
          supabase
            .from("business_categories")
            .select("id, name, sort_order, is_active")
            .eq("is_active", true)
            .order("sort_order", { ascending: true }),
          supabase
            .from("business_types")
            .select("id, name, category_id, sort_order, is_active")
            .eq("is_active", true)
            .order("sort_order", { ascending: true }),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "leads.source_departments")
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

        if (!categoryResult.error && Array.isArray(categoryResult.data)) {
          setBusinessCategories(
            (categoryResult.data as any[]).map((row) => ({
              id: Number(row.id),
              name: String(row.name),
              sort_order: Number(row.sort_order ?? 100),
            })),
          )
        }

        if (!typeResult.error && Array.isArray(typeResult.data)) {
          setBusinessTypes(
            (typeResult.data as any[]).map((row) => ({
              id: Number(row.id),
              name: String(row.name),
              category_id: Number(row.category_id),
              sort_order: Number(row.sort_order ?? 100),
            })),
          )
        }

        if (!sourceDeptResult.error && sourceDeptResult.data && (sourceDeptResult.data as any).value) {
          const raw = (sourceDeptResult.data as any).value as any
          if (Array.isArray(raw.departments)) {
            const normalized: SourceDepartmentOption[] = raw.departments
              .filter((d: any) => typeof d?.key === "string" && typeof d?.label === "string")
              .map((d: any) => ({
                key: d.key as string,
                label: d.label as string,
              }))

            if (normalized.length > 0) {
              setSourceDepartments(normalized)
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
          (data ?? []).map((row: any) => {
            const teamId = (row.team_id as number | null) ?? null
            const isExcluded = excludedProfileIds.has(row.id as string) || (teamId != null && excludedTeamIds.has(teamId))

            return {
              id: row.id as string,
              name: (row.full_name as string) ?? "未命名成员",
              activeLeads: 0,
              teamId,
              avatarUrl: (row.avatar_url as string | null) ?? null,
              isExcludedForAnalytics: isExcluded,
            }
          })



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
    const profileId = currentProfile?.id
    if (!profileId) {
      return
    }

    let isMounted = true

    async function loadViewPresets() {
      try {
        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase
          .from("lead_view_presets")
          .select("id, name, filters, is_default")
          .eq("profile_id", profileId)
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
    const trimmedCompany = newLead.company.trim()
    const trimmedWebsite = newLead.website.trim()

    if ((!trimmedCompany && !trimmedWebsite) || (!newLead.phone.trim() && !(newLead.wechat ?? "").trim())) {
      toast.error("请填写必填字段", {
        description: "公司名称或网址至少填写一个，且联系电话 / 微信至少填写一个",
      })
      return
    }



    if (!newLead.responsibilityType) {
      toast.error("请选择责任归因", {
        description: "一级来源（责任归因）为必填项",
      })
      return
    }

    if (newLead.responsibilityType === "company_resource" && !newLead.sourceLevel2) {
      toast.error("请选择二级来源", {
        description: "当责任归因为公司分配资源时，必须选择二级来源",
      })
      return
    }

    if (newLead.responsibilityType === "sales_self" && !newLead.devMethodKey) {
      toast.error("请选择开发方式", {
        description: "当责任归因为销售自主开发时，必须选择开发方式",
      })
      return
    }

    if (newLead.responsibilityType === "customer_referral") {
      if (!newLead.referralCustomerName || !newLead.referralTypeKey) {
        toast.error("请补全转介绍信息", {
          description: "当责任归因为客户转介绍时，必须填写来源客户和转介绍类型",
        })
        return
      }
    }

    if (!newLead.businessTypeIds || newLead.businessTypeIds.length === 0) {

      toast.error("请选择业务类型", {
        description: "至少选择一个具体业务子类型",
      })
      return
    }

    if (!newLead.businessCategoryIds || newLead.businessCategoryIds.length === 0) {
      toast.error("请选择品类", { description: "品类为必填项，请至少选择一个品类" })
      return
    }

    const trimmedPhone = newLead.phone.trim()
    const trimmedWechat = (newLead.wechat ?? "").trim()
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
      const isOwnerSelectable = canAssignLeads && newLead.owner && ownerOptions.some((rep) => rep.id === newLead.owner)
      const ownerId = isOwnerSelectable ? newLead.owner : profile.id


      const sourceLabel = resolveSourceLabel(newLead.responsibilityType, newLead.sourceLevel2 || null)

      const selectedTypeIds = newLead.businessTypeIds.map((id) => Number(id)).filter((v) => Number.isFinite(v))
      const resolvedCategoryIds = Array.from(
        new Set(
          selectedTypeIds
            .map((id) => businessTypeMap.get(id)?.category_id)
            .filter((id): id is number => id != null),
        ),
      )
      const selectedCategoryIds = newLead.businessCategoryIds.map((id) => Number(id)).filter((v) => Number.isFinite(v))
      const categoryIds = Array.from(new Set([...selectedCategoryIds, ...resolvedCategoryIds]))

      const payload: Record<string, unknown> = {
        team_id: profile.teamId,
        owner_id: ownerId,
        name: trimmedCompany || trimmedWebsite,
        website: trimmedWebsite || null,
        source: sourceLabel,
        stage: "L1",
        status: "open",
        customer_name: newLead.contact || "新联系人",
        customer_phone: trimmedPhone || null,
        customer_email: null,
        budget: budgetValue,

        last_contact_at: new Date().toISOString(),
        customer_grade: newLead.grade || null,
        source_level1: newLead.responsibilityType,
        source_level2: newLead.sourceLevel2 || null,
        responsibility_type: newLead.responsibilityType,
        dev_method_key: newLead.devMethodKey || null,
        referral_customer_name:
          newLead.responsibilityType === "customer_referral" ? newLead.referralCustomerName || null : null,
        referral_type_key:
          newLead.responsibilityType === "customer_referral" ? newLead.referralTypeKey || null : null,
        activity_name: newLead.activityName || null,
        source_department_key: newLead.sourceDepartmentKey || null,
        business_type_ids: selectedTypeIds,
        business_category_ids: categoryIds,
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

      if (trimmedWechat && typeof createdId === "string" && !createdId.startsWith("temp-")) {
        try {
          await updateLead(createdId, { wechat: trimmedWechat }, "补充微信联系方式")
        } catch (updateErr) {
          console.error("Failed to update wechat for new lead", updateErr)
        }
      }

      const sourceLabelForLocal = resolveSourceLabel(newLead.responsibilityType, newLead.sourceLevel2 || null)



      setLeads([
        ...leads,
        {
          id: createdId,
          company: newLead.company,
          website: newLead.website.trim(),
          contact: newLead.contact || "新联系人",
          phone: trimmedPhone,
          wechat: trimmedWechat,

          source: sourceLabelForLocal,
          sourceLevel1: newLead.responsibilityType || null,
          sourceLevel2: newLead.sourceLevel2 || null,

          businessTypes: selectedTypeIds.map((id) => {
            const found = businessTypeMap.get(id)
            return found ? { id: found.id, name: found.name, categoryId: found.category_id } : { id, name: `类型 #${id}`, categoryId: -1 }
          }),
          businessCategories: categoryIds.map((cid) => {
            const found = businessCategories.find((c) => c.id === cid)
            return { id: cid, name: found?.name ?? `分类 #${cid}` }
          }),
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
        website: "",
        contact: "",
        phone: "",
        wechat: "",
        sourceLevel1: "",
        sourceLevel2: "",
        budget: "",
        owner: "",
        grade: "",
        tags: "",
        businessCategoryIds: [],
        businessTypeIds: [],
        responsibilityType: "",
        devMethodKey: "",
        referralCustomerName: "",
        referralTypeKey: "",
        activityName: "",
        sourceDepartmentKey: "",
      })




      setDialogOpen(false)
      const leadTitleForToast = newLead.company || newLead.website
      toast.success("线索添加成功", {
        description: `${leadTitleForToast || "新线索"} 已添加到 L1 询盘阶段`,
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

      const noteInteractions: Interaction[] =
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


      let transferInteractions: Interaction[] = []
      try {
        const { data: activityRows, error: activityError } = await supabase.rpc("rpc_recent_activities", { p_limit: 100 })
        if (activityError) {
          console.error("Failed to load lead activities", activityError)
        } else if (Array.isArray(activityRows)) {
          transferInteractions = activityRows
            .filter((row: any) => row?.target_type === "lead" && row?.target_id === leadId && row?.action === "transfer_lead")
            .map((row: any, index: number) => {
              const fromOwnerId = String(row?.before?.owner_id ?? "").trim()
              const toOwnerId = String(row?.after?.owner_id ?? "").trim()
              const fromOwner = salesReps.find((rep) => rep.id === fromOwnerId)?.name
              const toOwner = salesReps.find((rep) => rep.id === toOwnerId)?.name
              const content = [
                toOwner ? `已转移给 ${toOwner}` : "线索已完成跨团队转移",
                fromOwner ? `原负责人 ${fromOwner}` : "",
                row?.reason ? `原因：${row.reason}` : "",
              ]
                .filter(Boolean)
                .join("，")

              return {
                id: 100000 + index,
                type: "visit",
                content,
                date: row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : "",
                user: String(row.actor_name ?? "系统"),
                authorId: (row.actor_id as string | null) ?? undefined,
              }
            })
        }
      } catch (activityErr) {
        console.error("Failed to load lead transfer activities", activityErr)
      }

      const interactionsFromDb: Interaction[] = [...noteInteractions, ...transferInteractions]

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
      website: lead.website ?? "",
      contact: lead.contact,
      phone: lead.phone,
      wechat: lead.wechat,
      sourceLevel1: lead.sourceLevel1 ?? "",
      sourceLevel2: lead.sourceLevel2 ?? "",
      budget: budgetDigits || "",
      grade: lead.grade || "",
      tags: (lead.tags ?? []).join(","),
      businessTypeIds: (lead.businessTypes ?? []).map((t) => String(t.id)),
      responsibilityType: lead.responsibilityType ?? "",
      devMethodKey: lead.devMethodKey ?? "",
      referralCustomerName: lead.referralCustomerName ?? "",
      referralTypeKey: lead.referralTypeKey ?? "",
      activityName: lead.activityName ?? "",
      sourceDepartmentKey: lead.sourceDepartmentKey ?? "",
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
      website: selectedLead.website ?? "",
      contact: selectedLead.contact,
      phone: selectedLead.phone,
      wechat: selectedLead.wechat,
      sourceLevel1: selectedLead.sourceLevel1 ?? "",
      sourceLevel2: selectedLead.sourceLevel2 ?? "",
      budget: budgetDigits || "",
      grade: selectedLead.grade || "",
      tags: (selectedLead.tags ?? []).join(","),
      businessTypeIds: (selectedLead.businessTypes ?? []).map((t) => String(t.id)),
      responsibilityType: selectedLead.responsibilityType ?? "",
      devMethodKey: selectedLead.devMethodKey ?? "",
      referralCustomerName: selectedLead.referralCustomerName ?? "",
      referralTypeKey: selectedLead.referralTypeKey ?? "",
      activityName: selectedLead.activityName ?? "",
      sourceDepartmentKey: selectedLead.sourceDepartmentKey ?? "",
    })
    setIsEditing(true)
  }



  const handleCancelEdit = () => {
    if (!selectedLead) return

    const budgetDigits = selectedLead.budget.replace(/[^\d.-]/g, "")

    setEditLead({
      company: selectedLead.company,
      website: selectedLead.website ?? "",
      contact: selectedLead.contact,
      phone: selectedLead.phone,
      wechat: selectedLead.wechat,
      sourceLevel1: selectedLead.sourceLevel1 ?? "",
      sourceLevel2: selectedLead.sourceLevel2 ?? "",
      budget: budgetDigits || "",
      grade: selectedLead.grade || "",
      tags: (selectedLead.tags ?? []).join(","),
      businessTypeIds: (selectedLead.businessTypes ?? []).map((t) => String(t.id)),
      responsibilityType: selectedLead.responsibilityType ?? "",
      devMethodKey: selectedLead.devMethodKey ?? "",
      referralCustomerName: selectedLead.referralCustomerName ?? "",
      referralTypeKey: selectedLead.referralTypeKey ?? "",
      activityName: selectedLead.activityName ?? "",
      sourceDepartmentKey: selectedLead.sourceDepartmentKey ?? "",
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

    const hasCompanyOrWebsite = editLead.company.trim() || editLead.website.trim()
    const hasPhone = editLead.phone.trim()

    if (!hasCompanyOrWebsite || !hasPhone) {
      toast.error("请填写必填字段", {
        description: "公司名称与公司网址至少填写一个，且联系电话为必填项",
      })
      return
    }


    if (!editLead.sourceLevel1) {
      toast.error("请选择一级来源", {
        description: "线索来源的一级来源为必选项",
      })
      return
    }


    const effectiveResponsibility = (
      editLead.responsibilityType || selectedLead.responsibilityType || ""
    ).trim()

    if (effectiveResponsibility === "company_resource") {
      const secondary = (editLead.sourceLevel2 || "").trim()
      if (!secondary) {
        toast.error("请选择二级来源", {
          description: "公司分配资源场景下需要选择具体二级来源",
        })
        return
      }
    }

    if (effectiveResponsibility === "sales_self") {
      const devMethod = (editLead.devMethodKey || "").trim()
      if (!devMethod) {
        toast.error("请选择开发方式", {
          description: "销售自主开发场景下需要选择开发方式",
        })
        return
      }
    }

    if (effectiveResponsibility === "customer_referral") {
      const referralName = (editLead.referralCustomerName || "").trim()
      const referralType = (editLead.referralTypeKey || "").trim()
      if (!referralName || !referralType) {
        toast.error("请补全转介绍信息", {
          description: "转介绍客户名称和转介绍类型为必填项",
        })
        return
      }
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
    let resolvedCategoryIdsForEdit: number[] = []

    const companyTrimmed = editLead.company.trim()

    if (companyTrimmed !== selectedLead.company) {
      patch.name = companyTrimmed
    }

    const websiteTrimmed = editLead.website.trim()
    if ((selectedLead.website ?? "") !== websiteTrimmed) {
      ;(patch as any).website = websiteTrimmed || null
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

    const nextSourceLevel1 = editLead.sourceLevel1
    const nextSourceLevel2 = editLead.sourceLevel2 || ""
    const prevSourceLevel1 = selectedLead.sourceLevel1 ?? ""
    const prevSourceLevel2 = selectedLead.sourceLevel2 ?? ""

    if (nextSourceLevel1 !== prevSourceLevel1 || nextSourceLevel2 !== prevSourceLevel2) {
      patch.source = resolveSourceLabel(nextSourceLevel1, nextSourceLevel2 || null)
      patch.source_level1 = nextSourceLevel1
      patch.source_level2 = nextSourceLevel2 ? nextSourceLevel2 : null
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

    const nextTypeIds = editLead.businessTypeIds.map((id) => Number(id)).filter((v) => Number.isFinite(v))
    const currentTypeIds = (selectedLead.businessTypes ?? []).map((bt) => bt.id)
    const hasBusinessTypeChanged = nextTypeIds.join(",") !== currentTypeIds.join(",")
    if (hasBusinessTypeChanged) {
      if (nextTypeIds.length === 0) {
        toast.error("业务类型不能为空", { description: "请至少选择一个业务子类型" })
        setIsSavingEdit(false)
        return
      }
      resolvedCategoryIdsForEdit = Array.from(
        new Set(
          nextTypeIds
            .map((id) => businessTypeMap.get(id)?.category_id)
            .filter((id): id is number => id != null),
        ),
      )
      patch.business_type_ids = nextTypeIds
      patch.business_category_ids = resolvedCategoryIdsForEdit
    }

    const nextResponsibility = editLead.responsibilityType.trim()
    const prevResponsibility = selectedLead.responsibilityType ?? ""

    if (nextResponsibility && nextResponsibility !== prevResponsibility) {
      patch.responsibility_type = nextResponsibility
    }

    const nextDevMethod = editLead.devMethodKey.trim()
    const prevDevMethod = selectedLead.devMethodKey ?? ""
    if (nextDevMethod !== prevDevMethod) {
      patch.dev_method_key = nextDevMethod || null
    }

    const nextReferralCustomer = editLead.referralCustomerName.trim()
    const prevReferralCustomer = selectedLead.referralCustomerName ?? ""
    if (nextReferralCustomer !== prevReferralCustomer) {
      patch.referral_customer_name = nextReferralCustomer || null
    }

    const nextReferralType = editLead.referralTypeKey.trim()
    const prevReferralType = selectedLead.referralTypeKey ?? ""
    if (nextReferralType !== prevReferralType) {
      patch.referral_type_key = nextReferralType || null
    }

    const nextActivityName = editLead.activityName.trim()
    const prevActivityName = selectedLead.activityName ?? ""
    if (nextActivityName !== prevActivityName) {
      patch.activity_name = nextActivityName || null
    }

    const nextSourceDepartment = editLead.sourceDepartmentKey.trim()
    const prevSourceDepartment = selectedLead.sourceDepartmentKey ?? ""
    if (nextSourceDepartment !== prevSourceDepartment) {
      patch.source_department_key = nextSourceDepartment || null
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

      const updatedSourceLabel = typeof patch.source === "string" ? (patch.source as string) : selectedLead.source
      const updatedSourceLevel1 =
        typeof patch.source_level1 === "string" ? (patch.source_level1 as string) : selectedLead.sourceLevel1
      const updatedSourceLevel2 =
        patch.source_level2 === null
          ? null
          : typeof patch.source_level2 === "string"
            ? (patch.source_level2 as string)
            : selectedLead.sourceLevel2

      const updatedBusinessTypes = hasBusinessTypeChanged
        ? nextTypeIds.map((id) => {
            const found = businessTypeMap.get(id)
            return found ? { id: found.id, name: found.name, categoryId: found.category_id } : { id, name: `类型 #${id}`, categoryId: -1 }
          })
        : selectedLead.businessTypes ?? []

      const updatedBusinessCategories = hasBusinessTypeChanged
        ? (resolvedCategoryIdsForEdit ?? []).map((cid) => {
            const found = businessCategories.find((c) => c.id === cid)
            return { id: cid, name: found?.name ?? `分类 #${cid}` }
          })
        : selectedLead.businessCategories ?? []

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
                sourceLevel1: updatedSourceLevel1 ?? null,
                sourceLevel2: updatedSourceLevel2 ?? null,
                budget: budgetLabel,
                businessTypes: updatedBusinessTypes,
                businessCategories: updatedBusinessCategories,
              }
            : l,
        ),
      )


      setSelectedLead((prev) =>
        prev
          ? {
              ...prev,
              company: editLead.company.trim(),
              website: editLead.website.trim() || prev.website,
              contact: editLead.contact.trim() || prev.contact,
              phone: editLead.phone.trim(),
              wechat: editLead.wechat.trim() || prev.wechat,
              source: updatedSourceLabel,
              sourceLevel1: updatedSourceLevel1 ?? null,
              sourceLevel2: updatedSourceLevel2 ?? null,
              budget: budgetLabel,
              businessTypes: updatedBusinessTypes,
              businessCategories: updatedBusinessCategories,
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

    // 团队范围兜底：即便后端 RLS 放宽，这里也只展示当前团队的线索
    if (leadScopeType === "team" && currentTeamId != null && lead.teamId != null && lead.teamId !== currentTeamId) {
      return false
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

  const stageCountsById: Record<string, number> = {}
  for (const lead of sortedLeads) {
    stageCountsById[lead.stage] = (stageCountsById[lead.stage] ?? 0) + 1
  }
  const maxStageCount = Object.values(stageCountsById).reduce((max, count) => Math.max(max, count), 0)

  const totalPages = Math.max(1, Math.ceil(maxStageCount / PAGE_SIZE))
  const currentPageSafe = Math.min(currentPage, totalPages)


  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">{isPublicPool ? "公海池" : "我的线索"}</h1>
            <p className="text-sm text-muted-foreground font-medium mt-1">{isPublicPool ? "可领取的公共线索池" : "高效管理您的销售线索与客户关系"}</p>
          </div>
        </div>
        <KanbanSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">{isPublicPool ? "公海池" : "我的线索"}</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">{isPublicPool ? "可领取的公共线索池" : "高效管理您的销售线索与客户关系"}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isPublicPool && (
            <LeadKanbanImportDialog
              canImportLeads={canImportLeads}
              salesReps={salesReps.map((rep) => ({ id: rep.id, name: rep.name, teamId: rep.teamId }))}
              currentTeamId={currentProfile?.teamId ?? null}
              onImported={retryLoad}
            />
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="h-11 px-6 font-bold shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]">
              <Plus className="w-5 h-5 mr-2 stroke-[2.5px]" />
              新增线索
            </Button>
          </DialogTrigger>

          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>新增线索</DialogTitle>

            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="company">公司名称（与公司网址二选一）</Label>
                <Input
                  id="company"
                  value={newLead.company}
                  onChange={(e) => setNewLead({ ...newLead, company: e.target.value })}
                  placeholder="输入公司名称"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">公司网址（与公司名称二选一）</Label>
                <Input
                  id="website"
                  value={newLead.website}
                  onChange={(e) => setNewLead({ ...newLead, website: e.target.value })}
                  placeholder="例如：https://example.com"
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
                <Label className="flex items-center justify-between">
                  <span>联系方式（电话 / 微信） *</span>
                  <span className="text-xs text-muted-foreground">至少填写一个，电话建议唯一</span>
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    id="phone"
                    value={newLead.phone}
                    onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
                    placeholder="联系电话（可选）"
                  />
                  <Input
                    id="wechat"
                    value={newLead.wechat}
                    onChange={(e) => setNewLead({ ...newLead, wechat: e.target.value })}
                    placeholder="微信号（可选）"
                  />
                </div>
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
              <Label htmlFor="responsibility-type">一级来源（责任归因） *</Label>

              <Select
                value={newLead.responsibilityType}
                onValueChange={(value) =>
                  setNewLead((prev) => ({
                    ...prev,
                    responsibilityType: value,
                    // 保持 sourceLevel1 与责任归因同步，兼容历史视图/筛选
                    sourceLevel1: value,
                    // 切换责任归因时重置下游条件字段
                    sourceLevel2: "",
                    devMethodKey: "",
                    referralCustomerName: "",
                    referralTypeKey: "",
                    activityName: "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择一级来源" />
                </SelectTrigger>

                <SelectContent>
                  {responsibilityTypeOptions.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newLead.responsibilityType === "company_resource" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="source-level2">二级来源 *</Label>
                  <Select
                    value={newLead.sourceLevel2}
                    onValueChange={(value) => setNewLead((prev) => ({ ...prev, sourceLevel2: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择具体来源渠道" />
                    </SelectTrigger>
                    <SelectContent>
                      {companyResourceGroupOptions.map((group) => (
                        <React.Fragment key={group.key}>
                          <SelectItem value={group.key} disabled>
                            <span className="text-xs font-semibold text-muted-foreground">{group.label}</span>
                          </SelectItem>
                          {(group.children ?? []).map((child) => (
                            <SelectItem key={child.key} value={child.key}>
                              {child.label}
                            </SelectItem>
                          ))}
                        </React.Fragment>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="source-department">来源责任部门（可选）</Label>
                  <Select
                    value={newLead.sourceDepartmentKey}
                    onValueChange={(value) =>
                      setNewLead((prev) => ({ ...prev, sourceDepartmentKey: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="可选：用于内部复盘来源责任部门" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceDepartments.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>

                  </Select>
                </div>
              </>
            )}

            {newLead.responsibilityType === "sales_self" && (
              <div className="space-y-2">
                <Label htmlFor="dev-method">开发方式 *</Label>
                <Select
                  value={newLead.devMethodKey}
                  onValueChange={(value) => setNewLead((prev) => ({ ...prev, devMethodKey: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择开发方式，例如邮件开发/私域运营等" />
                  </SelectTrigger>
                  <SelectContent>
                    {devMethodOptions.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {newLead.responsibilityType === "customer_referral" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="referral-customer">转介绍客户名称 *</Label>
                  <Input
                    id="referral-customer"
                    value={newLead.referralCustomerName}
                    onChange={(e) =>
                      setNewLead((prev) => ({ ...prev, referralCustomerName: e.target.value }))
                    }
                    placeholder="例如：XX 科技（老客户）"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="referral-type">转介绍类型 *</Label>
                  <Select
                    value={newLead.referralTypeKey}
                    onValueChange={(value) => setNewLead((prev) => ({ ...prev, referralTypeKey: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择转介绍类型" />
                    </SelectTrigger>
                    <SelectContent>
                      {referralTypeOptions.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="activity-name">活动名称（可选）</Label>
              <Input
                id="activity-name"
                value={newLead.activityName}
                onChange={(e) => setNewLead((prev) => ({ ...prev, activityName: e.target.value }))}
                placeholder="例如：一号位战略课 / 某场路演等"
              />
            </div>


            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>品类 *</Label>
                <p className="text-xs text-muted-foreground">至少选择一个品类</p>
              </div>
              <div className="flex flex-wrap gap-2 rounded-md border border-muted-foreground/20 p-3">
                {businessCategories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无品类，请先在设置中配置</p>
                ) : businessCategories.map((category) => {
                  const checked = newLead.businessCategoryIds.includes(String(category.id))
                  return <label key={category.id} className="flex items-center gap-2 rounded-md border border-muted-foreground/20 px-3 py-2 hover:border-primary/40">
                    <Checkbox checked={checked} onCheckedChange={(value) => setNewLead((prev) => {
                      const next = new Set(prev.businessCategoryIds)
                      if (value) next.add(String(category.id)); else next.delete(String(category.id))
                      return { ...prev, businessCategoryIds: Array.from(next) }
                    })} />
                    <span className="text-sm">{category.name}</span>
                  </label>
                })}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>业务类型 *</Label>
                <p className="text-xs text-muted-foreground">至少选择一个子类型</p>
              </div>
              <div className="space-y-3 rounded-md border border-muted-foreground/20 p-3 max-h-72 overflow-y-auto">
                {businessTypeGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无业务类型，请先在设置中配置</p>
                ) : (
                  businessTypeGroups.map((group) => (
                    <div key={group.id} className="space-y-2">
                      <div className="text-sm font-semibold text-foreground/80">{group.name}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {group.types.length === 0 ? (
                          <p className="text-xs text-muted-foreground">该分类下暂无子类型</p>
                        ) : (
                          group.types.map((type) => {
                            const checked = newLead.businessTypeIds.includes(String(type.id))
                            return (
                              <label
                                key={type.id}
                                className="flex items-center gap-2 rounded-md border border-muted-foreground/20 px-3 py-2 hover:border-primary/40"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(value) => {
                                    setNewLead((prev) => {
                                      const next = new Set(prev.businessTypeIds)
                                      const nextCategories = new Set(prev.businessCategoryIds)
                                      if (value) {
                                        next.add(String(type.id))
                                        nextCategories.add(String(type.category_id))
                                      } else {
                                        next.delete(String(type.id))
                                      }
                                      return { ...prev, businessTypeIds: Array.from(next), businessCategoryIds: Array.from(nextCategories) }
                                    })
                                  }}
                                />
                                <span className="text-sm">{type.name}</span>
                              </label>
                            )
                          })
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
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
                    {ownerOptions.map((rep) => (
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
                <p className="text-sm font-semibold text-foreground/80">一级来源（责任归因）</p>

                <Select
                  value={sourceLevel1Filter}
                  onValueChange={(value) => {
                    setSourceLevel1Filter(value)
                    setSourceLevel2Filter("all")
                  }}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="全部一级来源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部一级来源</SelectItem>

                    {responsibilityTypeOptions.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                    {legacySourceLevel1Keys.length > 0 && (
                      <>
                        <SelectItem value="__legacy_header" disabled>
                          <span className="text-xs text-muted-foreground">历史来源（兼容旧线索）</span>
                        </SelectItem>
                        {legacySourceLevel1Keys.map((key) => (
                          <SelectItem key={key} value={key}>
                            {resolveSourceLevel1Label(key)}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground/80">二级来源</p>
                <Select
                  value={sourceLevel2Filter}
                  onValueChange={setSourceLevel2Filter}
                  disabled={
                    sourceLevel1Filter === "all" ||
                    getSecondarySourceOptionsForFilter(sourceLevel1Filter).length === 0
                  }
                >
                  <SelectTrigger className="h-10">
                    <SelectValue
                      placeholder={
                        sourceLevel1Filter === "all" ||
                        getSecondarySourceOptionsForFilter(sourceLevel1Filter).length === 0
                          ? "请选择一级来源后筛选二级来源"
                          : "全部二级来源"

                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {getSecondarySourceOptionsForFilter(sourceLevel1Filter).length === 0
                        ? "当前一级来源下暂无二级来源"
                        : "全部二级来源"}
                    </SelectItem>

                    {getSecondarySourceOptionsForFilter(sourceLevel1Filter).map((child) => (
                      <SelectItem key={child.key} value={child.key}>
                        {child.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>


              <div className="space-y-2">

                <p className="text-sm font-semibold text-foreground/80">客户级别</p>
                <Select value={gradeFilter} onValueChange={setGradeFilter}>
                  <SelectTrigger className="h-10">
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
                <p className="text-sm font-semibold text-foreground/80">标签关键词</p>
                <Input
                  placeholder="按标签关键词筛选，多个用逗号分隔"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground/80">排序方式</p>
                <Select value={sortOption} onValueChange={setSortOption}>
                  <SelectTrigger className="h-10">
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
                <p className="text-sm font-semibold text-foreground/80">视图</p>
                <Select value={activeViewId} onValueChange={handleViewSelect}>
                  <SelectTrigger className="h-10">
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
              {showAllOwnerOption && (
                <SelectItem value="all">
                  {leadScopeType === "team" ? "全部团队成员" : "全部负责人"}
                </SelectItem>
              )}
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
            <div className="flex items-center gap-4 p-5 rounded-xl bg-emerald-50/50 border border-emerald-100 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-base font-bold text-emerald-900">当前暂无需要跟进的风险线索</p>
                <p className="text-sm text-emerald-700/80 mt-0.5">请继续保持积极跟进，确保业务稳步推进</p>
              </div>
            </div>
          )
        }

        return (
          <div className="flex items-center gap-4 p-5 rounded-xl bg-red-50/50 border border-red-100 shadow-sm animate-pulse-subtle">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-base font-bold text-red-900">
                {urgentCount} 条线索急需跟进
              </p>
              <p className="text-sm text-red-700/80 mt-0.5 leading-relaxed">
                超过红色风险阈值的在谈线索已达 <span className="font-bold underline">{urgentCount}</span> 条，建议立即处理；另有 <span className="font-semibold">{warningCount}</span> 条线索处于预警区间。
              </p>
            </div>
          </div>
        )
      })()}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {stages.map((stage) => {
          const allStageLeads = sortedLeads.filter((lead) => lead.stage === stage.id)
          const startIndex = (currentPageSafe - 1) * PAGE_SIZE
          const endIndex = Math.min(startIndex + PAGE_SIZE, allStageLeads.length)
          const stageLeads = allStageLeads.slice(startIndex, endIndex)
          const stageTotalCount = allStageLeads.length
          const stageConfig = getStageConfig(stage.id)
          return (
            <div key={stage.id} className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <StatusDot stage={stage.id} />
                  <h3 className="font-bold text-sm text-foreground uppercase tracking-wider">{stage.label}</h3>
                </div>
                <Badge variant="secondary" className="text-xs font-bold rounded-full px-2 h-5 min-w-[20px] flex items-center justify-center">
                  {stageTotalCount}
                </Badge>
              </div>
              <div className="space-y-4 min-h-[200px] md:min-h-[400px] p-2 rounded-xl border border-muted/20">
                {stageLeads.map((lead) => {
                  const ownerRep = lead.ownerId ? salesReps.find((rep) => rep.id === lead.ownerId) : undefined
                  const ownerLabel = ownerRep ? ownerRep.name : null

                  return (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onClick={() => handleLeadClick(lead)}
                      riskConfig={riskConfigRef.current}
                      sourceLevel1Label={resolveSourceLevel1Label(lead.sourceLevel1)}
                      sourceLevel2Label={resolveSourceLevel2Label(lead.sourceLevel1, lead.sourceLevel2)}
                      ownerLabel={ownerLabel}
                    />
                  )
                })}


              </div>
            </div>
          )
        })}
      </div>


      {totalLeads > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground p-3 rounded-lg border border-muted/20">
          <div className="font-medium">
            每个意向阶段每页最多显示 <span className="text-foreground">{PAGE_SIZE}</span> 条线索；当前第 <span className="text-foreground">{currentPageSafe}</span> 页，共 <span className="text-foreground font-bold">{totalLeads}</span> 条线索
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPageSafe === 1}
              className="h-8 px-3"
            >
              上一页
            </Button>
            <span className="font-semibold text-foreground bg-background px-2 py-0.5 rounded border">
              {currentPageSafe} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => (page < totalPages ? page + 1 : page))}
              disabled={currentPageSafe === totalPages}
              className="h-8 px-3"
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
              <SheetHeader className="space-y-4 p-6 pt-12 border-b bg-muted/10">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/20 shadow-sm">
                    <Building2 className="w-6 h-6 text-primary" />
                  </div>
                  <div className="min-w-0 space-y-1.5 flex-1">
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <Input
                          value={editLead.company}
                          onChange={(e) => setEditLead({ ...editLead, company: e.target.value })}
                          className="h-10 text-base font-bold"
                          placeholder="公司名称（与公司网址二选一）"
                        />
                        <Input
                          value={editLead.website}
                          onChange={(e) => setEditLead({ ...editLead, website: e.target.value })}
                          className="h-9 text-xs"
                          placeholder="公司网址（与公司名称二选一，例如：https://example.com）"
                        />
                      </div>

                    ) : (
                      <SheetTitle className="text-left text-2xl font-bold truncate tracking-tight">
                        {selectedLead.company || selectedLead.website || "未命名线索"}
                      </SheetTitle>
                    )}

                    <div className="flex items-center gap-2">
                      <StatusBadge stage={selectedLead.stage} />
                      {selectedLead.grade && (
                        <Badge variant="outline" className="text-xs font-bold border-primary/30 text-primary">
                          级别 {selectedLead.grade}
                        </Badge>
                      )}
                    </div>
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
                  <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-3 text-sm text-muted-foreground">


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
                        <p className="text-sm">
                          下次跟进日期：

                          <span className="font-medium text-foreground">
                            {new Date(selectedLead.nextContactAt).toLocaleDateString("zh-CN")}
                          </span>
                        </p>
                      ) : (
                        <p className="text-sm">
                          当前尚未设置下一步行动，

                          <span className="font-medium text-foreground">建议补充一个下次跟进日期</span>
                          ，避免线索长时间无人触达。
                        </p>
                      )}
                      {selectedLead.lastContactAt && (
                        <p className="text-xs text-muted-foreground">

                          最近一次跟进：
                          {new Date(selectedLead.lastContactAt).toLocaleString("zh-CN", { hour12: false })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                      {!selectedLead.nextContactAt && (
                        <p className="text-xs text-muted-foreground">

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

                <div className="grid grid-cols-2 gap-x-6 gap-y-5 py-4 border-y border-muted/30">

                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" /> 联系人
                    </p>
                    {isEditing ? (
                      <Input
                        value={editLead.contact}
                        onChange={(e) => setEditLead({ ...editLead, contact: e.target.value })}
                        className="h-9 text-sm"
                        placeholder="联系人姓名"
                      />
                    ) : (
                      <p className="text-base font-bold text-foreground">{selectedLead.contact}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5" /> 电话
                    </p>
                    {isEditing ? (
                      <Input
                        value={editLead.phone}
                        onChange={(e) => setEditLead({ ...editLead, phone: e.target.value })}
                        className="h-9 text-sm"
                        placeholder="联系电话"
                      />
                    ) : (
                      <p className="text-base font-bold text-foreground">{selectedLead.phone}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5" /> 微信
                    </p>
                    {isEditing ? (
                      <Input
                        value={editLead.wechat}
                        onChange={(e) => setEditLead({ ...editLead, wechat: e.target.value })}
                        className="h-9 text-sm"
                        placeholder="微信号"
                      />
                    ) : (
                      <p className="text-base font-bold text-foreground">{selectedLead.wechat || "-"}</p>
                    )}
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <p className="text-sm font-semibold text-muted-foreground">一级来源（责任归因）</p>


                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                          <div className="min-w-0 space-y-1">
                            <Label className="text-xs text-muted-foreground">一级来源（责任归因） *</Label>

                            <Select
                              value={editLead.responsibilityType}
                              onValueChange={(value) =>
                                setEditLead((prev) => ({
                                  ...prev,
                                  responsibilityType: value,
                                  sourceLevel1: value,
                                  sourceLevel2: "",
                                  devMethodKey: "",
                                  referralCustomerName: "",
                                  referralTypeKey: "",
                                  activityName: "",
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 text-sm w-full min-w-0">
                                <SelectValue placeholder="选择责任归因" />
                              </SelectTrigger>
                              <SelectContent>
                                {responsibilityTypeOptions.map((item) => (
                                  <SelectItem key={item.key} value={item.key}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {editLead.responsibilityType === "company_resource" && (
                            <div className="min-w-0 space-y-1">
                              <Label className="text-xs text-muted-foreground">二级来源 *</Label>
                              <Select
                                value={editLead.sourceLevel2 || ""}
                                onValueChange={(value) =>
                                  setEditLead((prev) => ({
                                    ...prev,
                                    sourceLevel2: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 text-sm w-full min-w-0">
                                  <SelectValue placeholder="选择具体来源渠道" />
                                </SelectTrigger>
                                <SelectContent>
                                  {companyResourceGroupOptions.map((group) => (
                                    <React.Fragment key={group.key}>
                                      <SelectItem value={group.key} disabled>
                                        <span className="text-xs font-semibold text-muted-foreground">
                                          {group.label}
                                        </span>
                                      </SelectItem>
                                      {(group.children ?? []).map((child) => (
                                        <SelectItem key={child.key} value={child.key}>
                                          {child.label}
                                        </SelectItem>
                                      ))}
                                    </React.Fragment>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>

                        {editLead.responsibilityType === "company_resource" && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">来源责任部门（可选）</Label>
                              <Select
                                value={editLead.sourceDepartmentKey || ""}
                                onValueChange={(value) =>
                                  setEditLead((prev) => ({
                                    ...prev,
                                    sourceDepartmentKey: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 text-sm w-full min-w-0">
                                  <SelectValue placeholder="可选：用于内部复盘来源责任部门" />
                                </SelectTrigger>
                                <SelectContent>
                                  {sourceDepartments.map((item) => (
                                    <SelectItem key={item.key} value={item.key}>
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>

                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">活动名称（可选）</Label>
                              <Input
                                value={editLead.activityName}
                                onChange={(e) =>
                                  setEditLead((prev) => ({
                                    ...prev,
                                    activityName: e.target.value,
                                  }))
                                }
                                className="h-9 text-sm"
                                placeholder="例如：一号位战略课 / 某场路演等"
                              />
                            </div>
                          </div>
                        )}

                        {editLead.responsibilityType === "sales_self" && (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">开发方式 *</Label>
                            <Select
                              value={editLead.devMethodKey}
                              onValueChange={(value) =>
                                setEditLead((prev) => ({
                                  ...prev,
                                  devMethodKey: value,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 text-sm w-full min-w-0">
                                <SelectValue placeholder="选择开发方式，例如邮件开发/私域运营等" />
                              </SelectTrigger>
                              <SelectContent>
                                {devMethodOptions.map((item) => (
                                  <SelectItem key={item.key} value={item.key}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {editLead.responsibilityType === "customer_referral" && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">转介绍客户名称 *</Label>
                              <Input
                                value={editLead.referralCustomerName}
                                onChange={(e) =>
                                  setEditLead((prev) => ({
                                    ...prev,
                                    referralCustomerName: e.target.value,
                                  }))
                                }
                                className="h-9 text-sm"
                                placeholder="例如：XX 科技（老客户）"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">转介绍类型 *</Label>
                              <Select
                                value={editLead.referralTypeKey}
                                onValueChange={(value) =>
                                  setEditLead((prev) => ({
                                    ...prev,
                                    referralTypeKey: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 text-sm w-full min-w-0">
                                  <SelectValue placeholder="选择转介绍类型" />
                                </SelectTrigger>
                                <SelectContent>
                                  {referralTypeOptions.map((item) => (
                                    <SelectItem key={item.key} value={item.key}>
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {resolveSourceLevel1Label(selectedLead.sourceLevel1) ? (
                          <Badge variant="secondary" className="text-sm font-medium h-7">
                            {resolveSourceLevel1Label(selectedLead.sourceLevel1)}
                          </Badge>
                        ) : null}
                        {resolveSourceLevel2Label(selectedLead.sourceLevel1, selectedLead.sourceLevel2) ? (
                          <Badge variant="outline" className="text-sm font-medium h-7 border-muted-foreground/20">
                            {resolveSourceLevel2Label(selectedLead.sourceLevel1, selectedLead.sourceLevel2)}
                          </Badge>
                        ) : null}
                        {!resolveSourceLevel1Label(selectedLead.sourceLevel1) &&
                        !resolveSourceLevel2Label(selectedLead.sourceLevel1, selectedLead.sourceLevel2) ? (
                          <Badge variant="secondary" className="text-sm font-medium h-7">
                            {selectedLead.source}
                          </Badge>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-muted-foreground">预算金额</p>
                    {isEditing ? (
                      <Input
                        value={editLead.budget}
                        onChange={(e) => setEditLead({ ...editLead, budget: e.target.value })}
                        className="h-9 text-sm max-w-xs"
                        placeholder="预算金额（元）"
                      />
                    ) : (
                      <p className="text-lg font-bold text-primary tracking-tight">{selectedLead.budget}</p>
                    )}
                  </div>

                  <div className="space-y-1.5 col-span-2">
                    <p className="text-sm font-semibold text-muted-foreground">业务类型</p>
                    {isEditing ? (
                      <div className="space-y-2 rounded-md border border-muted-foreground/20 p-3 max-h-64 overflow-y-auto">
                        {businessTypeGroups.length === 0 ? (
                          <p className="text-xs text-muted-foreground">暂无业务类型，请先在设置中配置</p>
                        ) : (
                          businessTypeGroups.map((group) => (
                            <div key={group.id} className="space-y-1">
                              <div className="text-xs font-semibold text-foreground/80">{group.name}</div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {group.types.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">该分类下暂无子类型</p>
                                ) : (
                                  group.types.map((type) => {
                                    const checked = editLead.businessTypeIds.includes(String(type.id))
                                    return (
                                      <label
                                        key={type.id}
                                        className="flex items-center gap-2 rounded-md border border-muted-foreground/20 px-3 py-2 hover:border-primary/40"
                                      >
                                        <Checkbox
                                          checked={checked}
                                          onCheckedChange={(value) => {
                                            setEditLead((prev) => {
                                              const next = new Set(prev.businessTypeIds)
                                              if (value) {
                                                next.add(String(type.id))
                                              } else {
                                                next.delete(String(type.id))
                                              }
                                              return { ...prev, businessTypeIds: Array.from(next) }
                                            })
                                          }}
                                        />
                                        <span className="text-sm">{type.name}</span>
                                      </label>
                                    )
                                  })
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    ) : selectedLead.businessTypes && selectedLead.businessTypes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedLead.businessTypes.map((bt) => (
                          <Badge key={bt.id} variant="secondary" className="text-xs font-medium h-6">
                            {bt.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground font-medium">未设置业务类型</p>
                    )}
                  </div>
                  <div className="space-y-1.5">

                    <p className="text-sm font-semibold text-muted-foreground">客户分级</p>
                    {isEditing ? (
                      <Select
                        value={editLead.grade}
                        onValueChange={(value) => setEditLead({ ...editLead, grade: value })}
                      >
                        <SelectTrigger className="h-9 text-sm">
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
                      <Badge variant="outline" className="text-sm font-bold border-primary/30 text-primary h-7">{selectedLead.grade}</Badge>
                    ) : (
                      <p className="text-sm text-muted-foreground font-medium">未设置</p>
                    )}
                  </div>


                  <div className="space-y-1.5 col-span-2">
                    <p className="text-sm font-semibold text-muted-foreground">标签属性</p>
                    {isEditing ? (
                      <Input
                        value={editLead.tags}
                        onChange={(e) => setEditLead({ ...editLead, tags: e.target.value })}
                        className="h-9 text-sm"
                        placeholder="例如：自有工厂, 品牌构想, 决策人清晰"
                      />
                    ) : selectedLead.tags && selectedLead.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedLead.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs font-normal bg-muted/50 text-muted-foreground max-w-full whitespace-normal break-words w-full text-left px-2 py-1">


                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground font-medium">未添加标签</p>
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
                    .filter(
                      (rep) =>
                        !rep.isExcludedForAnalytics && rep.teamId != null && String(rep.teamId) === transferTargetTeamId,
                    )
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
                  await transferLead(
                    selectedLead.id,
                    targetTeamIdNumber,
                    transferTargetOwnerId,
                    transferReason.trim() || null,
                  )

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
