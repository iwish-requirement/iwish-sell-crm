"use client"

import { useState, useEffect, useMemo, useContext } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Plus,
  Settings2,
  Shield,
  Save,
  Building2,
  Users,
  Pencil,
  Trash2,
  ArrowRightLeft,
  UserPlus,
  MoreHorizontal,
  Eye,
  UserCog,
  Globe,
  Lock,
  Database,
  Check,
  X,
  Clock,
  UserCheck,
  Search,
  AlertTriangle,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import { cn } from "@/lib/utils"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { rpcGetRolePermissions, rpcRolePermissionsSetMatrix, type RolePermissionMatrixItem } from "@/lib/services/role-permissions"
import { mapRpcError, type RpcErrorFriendly } from "@/lib/rpc-error-mapper"
import { toast } from "sonner"
import { LeadGradesAndSourcesSettingsCard } from "./lead-grades-and-sources-settings-card"
import { BusinessTypesSettingsCard } from "./business-types-settings-card"
import { MePermissionsContext } from "@/components/app-root"





// Types
interface TeamMember {
  id: number
  profileId?: string
  roleId?: string
  name: string
  avatar: string
  role: string
  phone: string
  status: "active" | "disabled"
  disabledAt?: string
  disableReason?: string
}

interface Team {
  id: number
  name: string
  members: TeamMember[]
}

type DataScope = "all" | "team" | "own"

type ScopeType = "self" | "team" | "org" | "custom"

interface RolePermissionFlags {
  createLeads: boolean
  updateLeads: boolean
  closeLeads: boolean
  viewUnmaskedPhone: boolean
  exportData: boolean
  importLeads: boolean
  assignLeads: boolean
  deleteLeads: boolean
  returnToPool: boolean
  manageLeadNotes: boolean
  manageTeams: boolean
  editSettings: boolean
  editSensitiveFields: boolean
  viewInternalFields: boolean
  editInternalFields: boolean
  viewReports: boolean
  viewAudit: boolean
  viewContracts: boolean
  manageContracts: boolean
}


interface Role {
  id: string
  name: string
  dataScope: DataScope
  usersCount: number
  isSystem: boolean
  roleType: "sales_rep" | "sales_manager" | "marketing" | "biz_owner" | "tech_maintainer" | "other"
  permissions: RolePermissionFlags
}

interface PendingUser {
  id: string
  name: string
  email: string
  phone: string
  applyTime: string
}

// 历史 mock 团队数据已废弃，真实团队列表来自 Supabase `teams` 表
const initialTeams: Team[] = [
  {
    id: 1,
    name: "销售一组",
    members: [
      {
        id: 1,
        name: "王建国",
        avatar: "/chinese-sales-man-portrait.jpg",
        role: "manager",
        phone: "138****1234",
        status: "active",
      },
      {
        id: 2,
        name: "李美玲",
        avatar: "/chinese-business-woman-portrait.jpg",
        role: "sales",
        phone: "139****5678",
        status: "active",
      },
      {
        id: 3,
        name: "张伟",
        avatar: "/young-chinese-man-portrait.jpg",
        role: "sales",
        phone: "137****9012",
        status: "active",
      },
    ],
  },
  {
    id: 2,
    name: "销售二组",
    members: [
      {
        id: 4,
        name: "陈晓燕",
        avatar: "/chinese-professional-woman-portrait.jpg",
        role: "manager",
        phone: "136****3456",
        status: "active",
      },
      {
        id: 5,
        name: "刘强",
        avatar: "/chinese-male-sales-rep-portrait.jpg",
        role: "sales",
        phone: "135****7890",
        status: "active",
      },
    ],
  },
  {
    id: 3,
    name: "市场部",
    members: [
      {
        id: 6,
        name: "赵敏",
        avatar: "/chinese-female-professional-portrait.jpg",
        role: "manager",
        phone: "134****2345",
        status: "active",
      },
    ],
  },
]

// 历史 mock 角色数据已废弃，真实角色来自 Supabase `roles` 表
const initialRoles: Role[] = [
  {
    id: "fallback-admin",
    name: "管理员",
    dataScope: "all",
    usersCount: 2,
    isSystem: true,
    permissions: {
      createLeads: true,
      updateLeads: true,
      closeLeads: true,
      viewUnmaskedPhone: true,
      exportData: true,
      importLeads: true,
      assignLeads: true,
      deleteLeads: true,
      returnToPool: true,
      manageLeadNotes: true,
      manageTeams: true,
      editSettings: true,
      editSensitiveFields: true,
      viewInternalFields: true,
      editInternalFields: true,
      viewReports: true,
      viewAudit: true,
    },
  },
  {
    id: "fallback-manager",
    name: "销售主管",
    dataScope: "team",
    usersCount: 3,
    isSystem: true,
    permissions: {
      createLeads: true,
      updateLeads: true,
      closeLeads: true,
      viewUnmaskedPhone: true,
      exportData: true,
      importLeads: false,
      assignLeads: true,
      deleteLeads: false,
      returnToPool: true,
      manageLeadNotes: true,
      manageTeams: false,
      editSettings: false,
      editSensitiveFields: false,
      viewInternalFields: false,
      editInternalFields: false,
      viewReports: true,
      viewAudit: false,
    },
  },
  {
    id: "fallback-sales",
    name: "销售代表",
    dataScope: "own",
    usersCount: 8,
    isSystem: true,
    permissions: {
      createLeads: true,
      updateLeads: true,
      closeLeads: true,
      viewUnmaskedPhone: false,
      exportData: false,
      importLeads: false,
      assignLeads: false,
      deleteLeads: false,
      returnToPool: true,
      manageLeadNotes: true,
      manageTeams: false,
      editSettings: false,
      editSensitiveFields: false,
      viewInternalFields: false,
      editInternalFields: false,
      viewReports: false,
      viewAudit: false,
    },
  },
  {
    id: "fallback-intern",
    name: "实习生",
    dataScope: "own",
    usersCount: 2,
    isSystem: false,
    permissions: {
      createLeads: false,
      updateLeads: false,
      closeLeads: false,
      viewUnmaskedPhone: false,
      exportData: false,
      importLeads: false,
      assignLeads: false,
      deleteLeads: false,
      returnToPool: false,
      manageLeadNotes: false,
      manageTeams: false,
      editSettings: false,
      editSensitiveFields: false,
      viewInternalFields: false,
      editInternalFields: false,
      viewReports: false,
      viewAudit: false,
    },
  },
]

// 组织架构 Tab 使用 profiles_public 作为成员候选来源，不再使用本地 allUsers mock


const roleLabels: Record<string, string> = {
  manager: "主管",
  sales: "销售",
  admin: "管理员",
}

const dataScopeLabels: Record<string, string> = {
  all: "全部数据",
  team: "团队数据",
  own: "仅本人",
}

const ROLE_TYPE_LABELS: Record<Role["roleType"], string> = {
  sales_rep: "销售顾问 / 一线销售",
  sales_manager: "销售经理 / 主管",
  marketing: "市场角色",
  biz_owner: "业务负责人 / 总经理",
  tech_maintainer: "技术维护 / 系统维护",
  other: "其他（自定义组合）",
}

const RECOMMENDED_ROLE_TEMPLATES: Record<
  Role["roleType"],
  { dataScope: DataScope; permissions: Partial<RolePermissionFlags> }
> = {
  sales_rep: {
    dataScope: "own",
    permissions: {
      createLeads: true,
      updateLeads: true,
      closeLeads: true,
      viewUnmaskedPhone: true,
      exportData: false,
      importLeads: false,
      assignLeads: false,
      deleteLeads: false,
      returnToPool: true,
      manageLeadNotes: true,
      manageTeams: false,
      editSettings: false,
      editSensitiveFields: false,
      viewInternalFields: false,
      editInternalFields: false,
      viewReports: false,
      viewAudit: false,
      viewContracts: true,
      manageContracts: true,
    },
  },
  sales_manager: {
    dataScope: "team",
    permissions: {
      createLeads: true,
      updateLeads: true,
      closeLeads: true,
      viewUnmaskedPhone: true,
      exportData: true,
      importLeads: false,
      assignLeads: true,
      deleteLeads: false,
      returnToPool: true,
      manageLeadNotes: true,
      manageTeams: false,
      editSettings: false,
      editSensitiveFields: false,
      viewInternalFields: true,
      editInternalFields: false,
      viewReports: true,
      viewAudit: false,
      viewContracts: true,
      manageContracts: true,
    },
  },
  marketing: {
    dataScope: "all",
    permissions: {
      createLeads: true,
      updateLeads: true,
      closeLeads: false,
      viewUnmaskedPhone: false,
      exportData: false,
      importLeads: true,
      assignLeads: false,
      deleteLeads: false,
      returnToPool: false,
      manageLeadNotes: false,
      manageTeams: false,
      editSettings: false,
      editSensitiveFields: false,
      viewInternalFields: false,
      editInternalFields: false,
      viewReports: true,
      viewAudit: false,
      viewContracts: false,
      manageContracts: false,
    },
  },
  biz_owner: {
    dataScope: "all",
    permissions: {
      createLeads: true,
      updateLeads: true,
      closeLeads: true,
      viewUnmaskedPhone: true,
      exportData: true,
      importLeads: true,
      assignLeads: true,
      deleteLeads: true,
      returnToPool: true,
      manageLeadNotes: true,
      manageTeams: true,
      editSettings: true,
      editSensitiveFields: true,
      viewInternalFields: true,
      editInternalFields: true,
      viewReports: true,
      viewAudit: true,
      viewContracts: true,
      manageContracts: true,
    },
  },
  tech_maintainer: {
    dataScope: "all",
    permissions: {
      createLeads: false,
      updateLeads: false,
      closeLeads: false,
      viewUnmaskedPhone: false,
      exportData: false,
      importLeads: false,
      assignLeads: false,
      deleteLeads: false,
      returnToPool: false,
      manageLeadNotes: false,
      manageTeams: true,
      editSettings: true,
      editSensitiveFields: false,
      viewInternalFields: false,
      editInternalFields: false,
      viewReports: true,
      viewAudit: true,
    },
  },
  other: {
    dataScope: "own",
    permissions: {},
  },
}

const DATA_SCOPE_TO_SCOPE_TYPE: Record<DataScope, ScopeType> = {
  all: "org",
  team: "team",
  own: "self",
}

const PERMISSION_KEY_MAP = {
  createLeads: ["leads.create"] as const,
  updateLeads: ["leads.update"] as const,
  closeLeads: ["leads.close"] as const,
  viewUnmaskedPhone: ["leads.fields.read_sensitive"] as const,
  exportData: ["leads.export", "reports.export"] as const,
  importLeads: ["leads.import"] as const,
  assignLeads: ["leads.assign"] as const,
  deleteLeads: ["leads.delete"] as const,
  returnToPool: ["leads.pool.return"] as const,
  manageLeadNotes: [
    "lead_notes.read",
    "lead_notes.create",
    "lead_notes.update",
    "lead_notes.delete",
  ] as const,
  manageTeams: ["teams.manage", "profiles.manage"] as const,
  editSettings: [
    "settings.security.manage",
    "settings.pipeline.manage",
    "settings.ui.manage",
    "settings.integrations.manage",
  ] as const,
  editSensitiveFields: ["leads.fields.write_sensitive"] as const,
  viewInternalFields: ["leads.fields.read_internal"] as const,
  editInternalFields: ["leads.fields.write_internal"] as const,
  viewReports: ["reports.read"] as const,
  viewAudit: ["audit.read"] as const,
  viewContracts: ["contracts.read"] as const,
  manageContracts: ["contracts.manage"] as const,
} as const


type PermissionToggleKey = keyof typeof PERMISSION_KEY_MAP

const PERMISSION_MATRIX_GROUPS = [
  {
    id: "operation" as const,
    title: "业务操作",
    description: "线索生命周期相关的日常操作，例如分配、删除和退回公海。",
  },
  {
    id: "management" as const,
    title: "管理权限",
    description: "团队与系统配置相关的管理操作，例如管理团队和编辑系统设置。",
  },
] as const

type PermissionMatrixGroupId = (typeof PERMISSION_MATRIX_GROUPS)[number]["id"]

type PermissionMatrixRowConfig = {
  key: PermissionToggleKey
  groupId: PermissionMatrixGroupId
  label: string
  description: string
}

const PERMISSION_MATRIX_ROWS: PermissionMatrixRowConfig[] = [
  {
    key: "createLeads",
    groupId: "operation",
    label: "创建线索",
    description: "允许手动创建新的销售线索。",
  },
  {
    key: "updateLeads",
    groupId: "operation",
    label: "编辑线索",
    description: "允许修改线索的基本信息和非敏感字段。",
  },
  {
    key: "closeLeads",
    groupId: "operation",
    label: "关闭线索（成交/战败）",
    description: "允许将线索标记为成交或战败。",
  },
  {
    key: "viewUnmaskedPhone",
    groupId: "operation",
    label: "查看未脱敏联系方式",
    description: "允许查看线索的真实手机号和邮箱信息，需要严格控制授予范围。",
  },
  {
    key: "exportData",
    groupId: "operation",
    label: "导出数据",
    description: "允许导出线索或报表数据，所有导出操作将写入审计日志。",
  },
  {
    key: "assignLeads",
    groupId: "operation",
    label: "分配线索",
    description: "允许将线索分配给其他销售，通常适用于主管及以上角色。",
  },
  {
    key: "importLeads",
    groupId: "operation",
    label: "导入线索",
    description: "允许通过模板批量导入线索数据，通常仅对管理员开放。",
  },
  {
    key: "deleteLeads",
    groupId: "operation",
    label: "删除线索",
    description: "允许永久删除线索记录，建议仅对管理员开放。",
  },
  {
    key: "returnToPool",
    groupId: "operation",
    label: "退回公海",
    description: "允许将线索退回公海池，用于重新分配或回收无效线索。",
  },
  {
    key: "manageLeadNotes",
    groupId: "operation",
    label: "管理跟进记录",
    description: "允许查看、添加、编辑和删除线索的跟进记录。",
  },
  {
    key: "manageTeams",
    groupId: "management",
    label: "管理团队",
    description: "允许创建、编辑团队和成员，并调整成员所属团队。",
  },
  {
    key: "editSettings",
    groupId: "management",
    label: "编辑系统设置",
    description: "允许修改业务规则、安全策略和集成配置，影响全局行为。",
  },
  {
    key: "editSensitiveFields",
    groupId: "management",
    label: "编辑敏感字段",
    description: "允许修改线索的电话、邮箱、预算等敏感信息。",
  },
  {
    key: "viewInternalFields",
    groupId: "management",
    label: "查看内部字段",
    description: "允许查看内部评分、黑名单原因等内部使用字段。",
  },
  {
    key: "editInternalFields",
    groupId: "management",
    label: "编辑内部字段",
    description: "允许修改内部评分、黑名单原因等内部使用字段。",
  },
  {
    key: "viewReports",
    groupId: "management",
    label: "查看报表",
    description: "允许访问分析报表页面。",
  },
  {
    key: "viewAudit",
    groupId: "management",
    label: "查看审计日志",
    description: "允许访问审计日志页面。",
  },
  {
    key: "viewContracts",
    groupId: "operation",
    label: "查看合同信息",
    description: "允许在成交详情等界面查看合同金额、周期等信息。",
  },
  {
    key: "manageContracts",
    groupId: "operation",
    label: "管理合同信息",
    description: "允许在成交详情等界面创建和编辑合同信息。",
  },
]

export function SystemSettings() {
  const [settingsTab, setSettingsTab] = useState("rules")
  const mePermissions = useContext(MePermissionsContext)
  const canViewSettings = mePermissions?.canViewSettings ?? false
  const isPermissionsLoading = mePermissions === null

  if (isPermissionsLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">系统设置</h1>
          <p className="text-muted-foreground">正在加载当前账号权限，请稍候...</p>
        </div>
      </div>
    )
  }

  if (!canViewSettings) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">系统设置</h1>
          <p className="text-muted-foreground">
            当前账号无权访问系统设置，如需调整相关权限，请联系系统管理员。
          </p>
        </div>
      </div>
    )
  }

  return (

    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">系统设置</h1>
        <p className="text-muted-foreground">配置业务规则、组织架构和权限管理</p>
      </div>

      <Tabs value={settingsTab} onValueChange={setSettingsTab} className="space-y-6">

        <TabsList>
          <TabsTrigger value="rules" className="gap-2">
            <Settings2 className="w-4 h-4" />
            业务规则
          </TabsTrigger>
          <TabsTrigger value="organization" className="gap-2">
            <Building2 className="w-4 h-4" />
            组织架构
          </TabsTrigger>
          <TabsTrigger value="permissions" className="gap-2">
            <Shield className="w-4 h-4" />
            角色权限
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <BusinessRulesTab />
        </TabsContent>
        <TabsContent value="organization">
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Business Rules Tab
function BusinessRulesTab() {
  const [publicPoolDays, setPublicPoolDays] = useState("30")
  const [warningHours, setWarningHours] = useState("72")
  const [dangerHours, setDangerHours] = useState("168")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [roleSaveError, setRoleSaveError] = useState<RpcErrorFriendly | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [businessSubTab, setBusinessSubTab] = useState("leads")

  const [renewalNotifyEnabled, setRenewalNotifyEnabled] = useState(true)
  const [renewalNotifyDaysBefore, setRenewalNotifyDaysBefore] = useState("30")


  useEffect(() => {
    let isMounted = true

    async function loadBusinessRules() {
      try {
        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase
          .from("settings")
          .select("key, value")
          .in("key", ["pipeline.business_rules", "wecom.notifications"])


        if (!isMounted) {
          return
        }

        if (error) {
          console.error("Failed to load business rules settings", error)
          const message = error.message ?? ""
          if (message.includes("ERR_NO_PERMISSION:settings.read")) {
            setLoadError("当前账号无权查看业务规则配置")
          } else {
            setLoadError("业务规则配置加载失败，请稍后重试")
          }
          setIsLoading(false)
          return
        }

        const rows = (data ?? []) as any[]

        const pipelineRow = rows.find((row) => row.key === "pipeline.business_rules") as any
        const wecomRow = rows.find((row) => row.key === "wecom.notifications") as any

        const pipelineValue = (pipelineRow?.value as any) ?? null

        if (pipelineValue) {
          if (pipelineValue.public_pool_days != null) {
            setPublicPoolDays(String(pipelineValue.public_pool_days))
          }
          if (pipelineValue.warning_hours != null) {
            setWarningHours(String(pipelineValue.warning_hours))
          }
          if (pipelineValue.danger_hours != null) {
            setDangerHours(String(pipelineValue.danger_hours))
          }
        }

        const wecomValue = (wecomRow?.value as any) ?? null
        if (wecomValue && typeof wecomValue === "object") {
          const renewalCfg = (wecomValue as any).renewal_upcoming as any
          if (renewalCfg && typeof renewalCfg === "object") {
            if (typeof renewalCfg.enabled === "boolean") {
              setRenewalNotifyEnabled(renewalCfg.enabled)
            }
            if (renewalCfg.days_before != null) {
              setRenewalNotifyDaysBefore(String(renewalCfg.days_before))
            }
          }
        }


        setLoadError(null)
        setIsLoading(false)
      } catch (error) {
        console.error("Unexpected error while loading business rules settings", error)
        if (isMounted) {
          setLoadError("业务规则配置加载失败，请稍后重试")
          setIsLoading(false)
        }
      }
    }

    loadBusinessRules()

    return () => {
      isMounted = false
    }
  }, [])

  const handleSave = async () => {
    const poolDays = Number.parseInt(publicPoolDays, 10)
    const warnHours = Number.parseInt(warningHours, 10)
    const dangerHoursValue = Number.parseInt(dangerHours, 10)
    const renewalDays = Number.parseInt(renewalNotifyDaysBefore, 10)

    if (
      Number.isNaN(poolDays) ||
      Number.isNaN(warnHours) ||
      Number.isNaN(dangerHoursValue) ||
      poolDays <= 0 ||
      warnHours <= 0 ||
      dangerHoursValue <= 0 ||
      (renewalNotifyEnabled && (Number.isNaN(renewalDays) || renewalDays <= 0))
    ) {
      toast.error("保存失败", { description: "请填写大于 0 的有效数字" })
      return
    }

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase
        .from("settings")
        .upsert(
          [
            {
              key: "pipeline.business_rules",
              value: {
                public_pool_days: poolDays,
                warning_hours: warnHours,
                danger_hours: dangerHoursValue,
              },
            },
            {
              key: "wecom.notifications",
              value: {
                renewal_upcoming: {
                  enabled: renewalNotifyEnabled,
                  days_before: renewalDays > 0 ? renewalDays : 30,
                },
              },
            },
          ],
          { onConflict: "key" },
        )


      if (error) {
        console.error("Failed to save business rules settings", error)
        const message = error.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:settings.pipeline.manage")) {
          toast.error("保存失败", {
            description: "当前账号无权修改业务规则，请联系系统管理员开通 settings.pipeline.manage 权限",
          })
        } else {
          toast.error("保存失败", { description: "保存业务规则配置时出错，请稍后重试" })
        }
        return
      }

      toast.success("业务规则已保存")
    } catch (error) {
      console.error("Unexpected error while saving business rules settings", error)
      toast.error("保存失败", { description: "保存业务规则配置时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Tabs value={businessSubTab} onValueChange={setBusinessSubTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="leads" className="gap-1">
            <Globe className="w-4 h-4" />
            线索 &amp; 公海
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1">
            <Eye className="w-4 h-4" />
            仪表盘 &amp; 文案
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1">
            <Database className="w-4 h-4" />
            数据统计
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leads">
          <div className="space-y-6">
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>业务规则配置</CardTitle>
                <CardDescription>配置线索管理和跟进规则</CardDescription>
                {loadError && <p className="mt-2 text-xs text-destructive/80">{loadError}</p>}
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="poolDays">公海池掉落天数</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="poolDays"
                        type="number"
                        value={publicPoolDays}
                        onChange={(e) => setPublicPoolDays(e.target.value)}
                        className="w-24"
                        disabled={isLoading || isSaving}
                      />
                      <span className="text-sm text-muted-foreground">天</span>
                    </div>
                    <p className="text-xs text-muted-foreground">超过此天数未跟进的线索将自动进入公海池</p>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label htmlFor="warningHours">预警阈值（黄色）</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="warningHours"
                        type="number"
                        value={warningHours}
                        onChange={(e) => setWarningHours(e.target.value)}
                        className="w-24"
                        disabled={isLoading || isSaving}
                      />
                      <span className="text-sm text-muted-foreground">小时</span>
                    </div>
                    <p className="text-xs text-muted-foreground">超过此时间未跟进将显示黄色预警标识</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dangerHours">风险阈值（红色）</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="dangerHours"
                        type="number"
                        value={dangerHours}
                        onChange={(e) => setDangerHours(e.target.value)}
                        className="w-24"
                        disabled={isLoading || isSaving}
                      />
                      <span className="text-sm text-muted-foreground">小时</span>
                    </div>
                    <p className="text-xs text-muted-foreground">超过此时间未跟进将显示红色风险标识</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-medium">续费预警企微通知</Label>
                      <p className="text-xs text-muted-foreground">
                        开启后，系统会在合同到期前指定天数，自动通过企微给负责人发送续费提醒。
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={renewalNotifyEnabled}
                        onCheckedChange={(v) => setRenewalNotifyEnabled(Boolean(v))}
                        disabled={isLoading || isSaving}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pl-0 sm:pl-6">
                    <Label htmlFor="renewalNotifyDays">提前天数</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="renewalNotifyDays"
                        type="number"
                        value={renewalNotifyDaysBefore}
                        onChange={(e) => setRenewalNotifyDaysBefore(e.target.value)}
                        className="w-24"
                        disabled={isLoading || isSaving || !renewalNotifyEnabled}
                      />
                      <span className="text-sm text-muted-foreground">天（例如 30 表示到期前 30 天提醒）</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      仅对有绑定企微的负责人生效，系统会按负责人聚合同一天到期的合同一次性提醒。
                    </p>
                  </div>
                </div>

                <Button onClick={handleSave} disabled={isSaving || isLoading}>
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? "保存中..." : "保存规则"}
                </Button>

              </CardContent>
            </Card>

            <LeadLockAndProtectionSettingsCard />
            <LeadGradesAndSourcesSettingsCard />
            <BusinessTypesSettingsCard />

          </div>
        </TabsContent>


        <TabsContent value="dashboard">
          <DashboardTextSettingsCard />
        </TabsContent>

        <TabsContent value="analytics">
          <div className="space-y-6">
            <AnalyticsExclusionSettingsCard />
            <AnalyticsExcludedTeamsSettingsCard />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DashboardTextSettingsCard() {
  type DashboardStageKey = "L1" | "L2" | "L3" | "L4" | "Won"

  const DASHBOARD_STAGE_KEYS: DashboardStageKey[] = ["L1", "L2", "L3", "L4", "Won"]

  const DEFAULT_STAGE_CONFIG: Record<DashboardStageKey, { label: string; fullName: string }> = {
    L1: { label: "L1 询盘", fullName: "L1 询盘" },
    L2: { label: "L2 意向", fullName: "L2 意向" },
    L3: { label: "L3 关键意向", fullName: "L3 关键意向" },
    L4: { label: "L4 谈判", fullName: "L4 谈判" },
    Won: { label: "成交", fullName: "成交客户" },
  }

  const [stageConfig, setStageConfig] = useState<Record<DashboardStageKey, { label: string; fullName: string }>>(
    DEFAULT_STAGE_CONFIG,
  )
  const [welcomeTemplate, setWelcomeTemplate] = useState("欢迎回来，{fullName}。以下是您的销售概览。")
  const [fallbackName, setFallbackName] = useState("伙伴")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadDashboardSettings() {
      try {
        setIsLoading(true)
        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase
          .from("settings")
          .select("key, value")
          .in("key", ["dashboard.pipeline_stages", "dashboard.welcome_template"])

        if (!isMounted) return

        if (error) {
          console.error("Failed to load dashboard settings", error)
          const message = error.message ?? ""
          if (message.includes("ERR_NO_PERMISSION:settings.read")) {
            setLoadError("当前账号无权查看仪表盘配置")
          } else {
            setLoadError("仪表盘配置加载失败，请稍后重试")
          }
          setIsLoading(false)
          return
        }

        const rows = (data ?? []) as any[]

        const pipelineRow = rows.find((row) => row.key === "dashboard.pipeline_stages") as any
        const welcomeRow = rows.find((row) => row.key === "dashboard.welcome_template") as any

        let nextStageConfig: Record<DashboardStageKey, { label: string; fullName: string }> = {
          ...DEFAULT_STAGE_CONFIG,
        }

        if (pipelineRow && pipelineRow.value) {
          const raw = pipelineRow.value as any
          if (raw && typeof raw === "object") {
            for (const stage of DASHBOARD_STAGE_KEYS) {
              const cfg = raw[stage]
              if (cfg && typeof cfg === "object") {
                nextStageConfig[stage] = {
                  label: (cfg.label as string) || DEFAULT_STAGE_CONFIG[stage].label,
                  fullName: (cfg.fullName as string) || DEFAULT_STAGE_CONFIG[stage].fullName,
                }
              }
            }
          }
        }

        setStageConfig(nextStageConfig)

        if (welcomeRow && welcomeRow.value) {
          const raw = welcomeRow.value as any
          if (raw && typeof raw === "object") {
            if (typeof raw.template === "string" && raw.template.trim()) {
              setWelcomeTemplate(raw.template as string)
            }
            if (typeof raw.fallback_name === "string" && raw.fallback_name.trim()) {
              setFallbackName(raw.fallback_name as string)
            }
          }
        }

        setLoadError(null)
        setIsLoading(false)
      } catch (error) {
        console.error("Unexpected error while loading dashboard settings", error)
        if (isMounted) {
          setLoadError("仪表盘配置加载失败，请稍后重试")
          setIsLoading(false)
        }
      }
    }

    void loadDashboardSettings()

    return () => {
      isMounted = false
    }
  }, [])

  const handleSave = async () => {
    const trimmedTemplate = welcomeTemplate.trim() || "欢迎回来，{fullName}。以下是您的销售概览。"
    const trimmedFallback = fallbackName.trim() || "伙伴"

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()

      const { error } = await supabase
        .from("settings")
        .upsert(
          [
            {
              key: "dashboard.pipeline_stages",
              value: DASHBOARD_STAGE_KEYS.reduce((acc, key) => {
                acc[key] = {
                  label: stageConfig[key].label || DEFAULT_STAGE_CONFIG[key].label,
                  fullName: stageConfig[key].fullName || DEFAULT_STAGE_CONFIG[key].fullName,
                }
                return acc
              }, {} as Record<DashboardStageKey, { label: string; fullName: string }>),
            },
            {
              key: "dashboard.welcome_template",
              value: {
                template: trimmedTemplate,
                fallback_name: trimmedFallback,
              },
            },
          ],
          { onConflict: "key" },
        )

      if (error) {
        console.error("Failed to save dashboard settings", error)
        const message = error.message ?? ""
        if (
          message.includes("ERR_NO_PERMISSION:settings.ui.manage") ||
          message.includes("ERR_NO_PERMISSION:settings.pipeline.manage")
        ) {
          toast.error("保存失败", {
            description: "当前账号无权修改仪表盘配置，请联系系统管理员开通相应设置权限",
          })
        } else {
          toast.error("保存失败", { description: "保存仪表盘配置时出错，请稍后重试" })
        }
        return
      }

      toast.success("仪表盘配置已保存")
    } catch (error) {
      console.error("Unexpected error while saving dashboard settings", error)
      toast.error("保存失败", { description: "保存仪表盘配置时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>仪表盘文案配置</CardTitle>
        <CardDescription>配置仪表盘欢迎语和各阶段文案，支持按需自定义。</CardDescription>
        {loadError && <p className="mt-2 text-xs text-destructive/80">{loadError}</p>}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dashboardWelcomeTemplate">仪表盘欢迎语模板</Label>
            <Textarea
              id="dashboardWelcomeTemplate"
              value={welcomeTemplate}
              onChange={(e) => setWelcomeTemplate(e.target.value)}
              disabled={isLoading || isSaving}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              支持占位符 {"{fullName}"}，系统会自动替换为当前用户姓名或邮箱。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dashboardFallbackName">未登录或无姓名时的称呼</Label>
            <Input
              id="dashboardFallbackName"
              value={fallbackName}
              onChange={(e) => setFallbackName(e.target.value)}
              disabled={isLoading || isSaving}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">用于欢迎语中替代 {"{fullName}"} 的称呼，例如“伙伴”。</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">漏斗阶段文案</h3>
              <p className="text-xs text-muted-foreground">
                调整各阶段在仪表盘/看板中显示的简称和全称，建议与业务阶段保持一致。
              </p>
            </div>
          </div>
          <div className="grid gap-4">
            {DASHBOARD_STAGE_KEYS.map((stageKey) => (
              <div key={stageKey} className="grid grid-cols-1 sm:grid-cols-[80px,1fr,1fr] gap-3 items-start">
                <div className="text-sm font-medium text-muted-foreground">{stageKey}</div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`stage-label-${stageKey}`}>
                    阶段简称
                  </Label>
                  <Input
                    id={`stage-label-${stageKey}`}
                    value={stageConfig[stageKey].label}
                    onChange={(e) =>
                      setStageConfig((prev) => ({
                        ...prev,
                        [stageKey]: {
                          ...prev[stageKey],
                          label: e.target.value,
                        },
                      }))
                    }
                    disabled={isLoading || isSaving}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`stage-full-${stageKey}`}>
                    阶段全称
                  </Label>
                  <Input
                    id={`stage-full-${stageKey}`}
                    value={stageConfig[stageKey].fullName}
                    onChange={(e) =>
                      setStageConfig((prev) => ({
                        ...prev,
                        [stageKey]: {
                          ...prev[stageKey],
                          fullName: e.target.value,
                        },
                      }))
                    }
                    disabled={isLoading || isSaving}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving || isLoading}>
          <Save className="w-4 h-4 mr-2" />
          {isSaving ? "保存中..." : "保存仪表盘配置"}
        </Button>
      </CardContent>
    </Card>
  )
}

function AnalyticsExclusionSettingsCard() {
  const [profiles, setProfiles] = useState<{ id: string; name: string; avatarUrl: string | null }[]>([])
  const [search, setSearch] = useState("")
  const [excludedProfileIds, setExcludedProfileIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadExclusions() {
      try {
        const supabase = getBrowserSupabaseClient()

        const [profilesResult, settingsResult] = await Promise.all([
          supabase
            .from("profiles_public")
            .select("id, full_name, avatar_url, status")
            .eq("status", "active")
            .order("full_name", { ascending: true }),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "analytics.excluded_profiles")
            .maybeSingle(),
        ])

        if (!isMounted) return

        if (profilesResult.error) {
          console.error("Failed to load profiles for analytics exclusion settings", profilesResult.error)
          setLoadError("加载成员列表失败，请稍后重试")
          setIsLoading(false)
          return
        }

        const profilesData = (profilesResult.data ?? []) as any[]
        setProfiles(
          profilesData.map((row) => ({
            id: row.id as string,
            name: ((row.full_name as string | null) ?? "未命名成员") as string,
            avatarUrl: (row.avatar_url as string | null) ?? null,
          })),
        )

        if (settingsResult.error && settingsResult.error.code !== "PGRST116") {
          console.error("Failed to load analytics exclusion settings", settingsResult.error)
        }

        const raw = (settingsResult.data?.value as any) ?? null
        if (raw && Array.isArray(raw.profile_ids)) {
          const ids = raw.profile_ids.filter((v: any) => typeof v === "string") as string[]
          setExcludedProfileIds(ids)
        }

        setLoadError(null)
        setIsLoading(false)
      } catch (error) {
        console.error("Unexpected error while loading analytics exclusion settings", error)
        if (isMounted) {
          setLoadError("排除账号配置加载失败，请稍后重试")
          setIsLoading(false)
        }
      }
    }

    void loadExclusions()

    return () => {
      isMounted = false
    }
  }, [])

  const handleToggleProfile = (id: string) => {
    setExcludedProfileIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase
        .from("settings")
        .upsert(
          {
            key: "analytics.excluded_profiles",
            value: {
              profile_ids: excludedProfileIds,
            },
          },
          { onConflict: "key" },
        )

      if (error) {
        console.error("Failed to save analytics exclusion settings", error)
        const message = error.message ?? ""
        if (
          message.includes("ERR_NO_PERMISSION:settings.ui.manage") ||
          message.includes("ERR_NO_PERMISSION:settings.pipeline.manage")
        ) {
          toast.error("保存失败", {
            description: "当前账号无权修改统计排除配置，请联系系统管理员开通相应设置权限",
          })
        } else {
          toast.error("保存失败", { description: "保存统计排除配置时出错，请稍后重试" })
        }
        return
      }

      toast.success("排除账号配置已保存")
    } catch (error) {
      console.error("Unexpected error while saving analytics exclusion settings", error)
      toast.error("保存失败", { description: "保存统计排除配置时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return profiles
    return profiles.filter((p) => {
      const name = p.name?.toLowerCase() ?? ""
      return name.includes(query) || p.id.toLowerCase().includes(query)
    })
  }, [profiles, search])

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>统计排除账号</CardTitle>
        <CardDescription>
          配置哪些账号不参与团队业绩排行榜等核心业务统计，适用于“技术维护”“系统管理”等运维类账号。
        </CardDescription>
        {loadError && <p className="mt-2 text-xs text-destructive/80">{loadError}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 max-w-sm">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索成员姓名或 ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead className="w-[160px] text-right">排除统计</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-xs text-muted-foreground">
                    正在加载成员列表...
                  </TableCell>
                </TableRow>
              ) : filteredProfiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-xs text-muted-foreground">
                    暂无匹配的成员
                  </TableCell>
                </TableRow>
              ) : (
                filteredProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.name} />}
                          <AvatarFallback>{profile.name?.trim()?.[0] ?? "?"}</AvatarFallback>
                        </Avatar>
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium">{profile.name}</div>
                          <div className="text-xs text-muted-foreground">{profile.id}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">不计入统计</span>
                        <Switch
                          checked={excludedProfileIds.includes(profile.id)}
                          onCheckedChange={() => handleToggleProfile(profile.id)}
                          disabled={isLoading || isSaving}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "保存中..." : "保存排除配置"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LeadLockAndProtectionSettingsCard() {
  const [lockHours, setLockHours] = useState("24")
  const [stageDays, setStageDays] = useState({
    L1: "1",
    L2: "3",
    L3: "7",
    L4: "14",
    Won: "30",
  })
  const [gradeDays, setGradeDays] = useState({
    S: "7",
    A: "14",
    B: "21",
    C: "30",
  })

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadLockSettings() {
      try {
        setIsLoading(true)
        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase
          .from("settings")
          .select("value")
          .eq("key", "leads.lock_and_protection")
          .maybeSingle()

        if (!isMounted) return

        if (error && error.code !== "PGRST116") {
          console.error("Failed to load lead lock and protection settings", error)
          const message = error.message ?? ""
          if (message.includes("ERR_NO_PERMISSION:settings.read")) {
            setLoadError("当前账号无权查看锁单与保护期配置")
          } else {
            setLoadError("锁单与保护期配置加载失败，请稍后重试")
          }
          setIsLoading(false)
          return
        }

        const value = (data?.value as any) ?? null

        if (value) {
          if (value.first_contact_lock_hours != null) {
            setLockHours(String(value.first_contact_lock_hours))
          }

          const stageCfg = (value.stage_protection_days as any) ?? {}
          setStageDays((prev) => ({
            L1: stageCfg.L1 != null ? String(stageCfg.L1) : prev.L1,
            L2: stageCfg.L2 != null ? String(stageCfg.L2) : prev.L2,
            L3: stageCfg.L3 != null ? String(stageCfg.L3) : prev.L3,
            L4: stageCfg.L4 != null ? String(stageCfg.L4) : prev.L4,
            Won: stageCfg.Won != null ? String(stageCfg.Won) : prev.Won,
          }))

          const gradeCfg = (value.grade_protection_days as any) ?? {}
          setGradeDays((prev) => ({
            S: gradeCfg.S != null ? String(gradeCfg.S) : prev.S,
            A: gradeCfg.A != null ? String(gradeCfg.A) : prev.A,
            B: gradeCfg.B != null ? String(gradeCfg.B) : prev.B,
            C: gradeCfg.C != null ? String(gradeCfg.C) : prev.C,
          }))
        }

        setLoadError(null)
        setIsLoading(false)
      } catch (error) {
        console.error("Unexpected error while loading lead lock and protection settings", error)
        if (isMounted) {
          setLoadError("锁单与保护期配置加载失败，请稍后重试")
          setIsLoading(false)
        }
      }
    }

    void loadLockSettings()

    return () => {
      isMounted = false
    }
  }, [])

  const handleSave = async () => {
    const parsedLock = Number.parseInt(lockHours, 10)
    const parsedStage = {
      L1: Number.parseInt(stageDays.L1, 10),
      L2: Number.parseInt(stageDays.L2, 10),
      L3: Number.parseInt(stageDays.L3, 10),
      L4: Number.parseInt(stageDays.L4, 10),
      Won: Number.parseInt(stageDays.Won, 10),
    }
    const parsedGrade = {
      S: Number.parseInt(gradeDays.S, 10),
      A: Number.parseInt(gradeDays.A, 10),
      B: Number.parseInt(gradeDays.B, 10),
      C: Number.parseInt(gradeDays.C, 10),
    }

    const anyNaN =
      Number.isNaN(parsedLock) ||
      Object.values(parsedStage).some((v) => Number.isNaN(v)) ||
      Object.values(parsedGrade).some((v) => Number.isNaN(v))

    if (anyNaN || parsedLock <= 0 || Object.values(parsedStage).some((v) => v < 0) || Object.values(parsedGrade).some((v) => v < 0)) {
      toast.error("保存失败", {
        description: "请填写有效数字（锁单时长需大于 0，保护期天数可为 0 或更大）",
      })
      return
    }

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase
        .from("settings")
        .upsert(
          {
            key: "leads.lock_and_protection",
            value: {
              first_contact_lock_hours: parsedLock,
              stage_protection_days: parsedStage,
              grade_protection_days: parsedGrade,
            },
          },
          { onConflict: "key" },
        )

      if (error) {
        console.error("Failed to save lead lock and protection settings", error)
        const message = error.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:settings.pipeline.manage")) {
          toast.error("保存失败", {
            description: "当前账号无权修改锁单与保护期规则，请联系系统管理员开通 settings.pipeline.manage 权限",
          })
        } else {
          toast.error("保存失败", { description: "保存锁单与保护期配置时出错，请稍后重试" })
        }
        return
      }

      toast.success("锁单与保护期规则已保存")
    } catch (error) {
      console.error("Unexpected error while saving lead lock and protection settings", error)
      toast.error("保存失败", { description: "保存锁单与保护期配置时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>锁单与保护期</CardTitle>
        <CardDescription>
          配置首次有效联系后的锁单时长，以及按阶段和客户级别计算的保护期天数。已有保护期不会被缩短，只会在配置变大时向后延长。
        </CardDescription>
        {loadError && <p className="mt-2 text-xs text-destructive/80">{loadError}</p>}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lockHours">首次有效联系锁单时长</Label>
            <div className="flex items-center gap-2">
              <Input
                id="lockHours"
                type="number"
                value={lockHours}
                onChange={(e) => setLockHours(e.target.value)}
                className="w-24"
                disabled={isLoading || isSaving}
              />
              <span className="text-sm text-muted-foreground">小时</span>
            </div>
            <p className="text-xs text-muted-foreground">
              首次有效联系后的这段时间内，系统会优先保护当前负责人，避免线索被频繁抢占或退回。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">按阶段保护期</h3>
                <p className="text-xs text-muted-foreground">不同阶段的线索可设置不同的最短保护期天数。</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["L1", "L1 询盘"],
                ["L2", "L2 意向"],
                ["L3", "L3 关键意向"],
                ["L4", "L4 谈判"],
                ["Won", "成交客户"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs" htmlFor={`stage-${key}`}>
                    {label}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`stage-${key}`}
                      type="number"
                      value={stageDays[key as keyof typeof stageDays]}
                      onChange={(e) =>
                        setStageDays((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="w-24"
                      disabled={isLoading || isSaving}
                    />
                    <span className="text-xs text-muted-foreground">天</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">按客户级别保护期</h3>
                <p className="text-xs text-muted-foreground">
                  S/A/B/C 等不同客户级别可以叠加额外的保护期，系统会取阶段与级别中更长的一侧。
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["S", "S 级客户"],
                ["A", "A 级客户"],
                ["B", "B 级客户"],
                ["C", "C 级客户"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs" htmlFor={`grade-${key}`}>
                    {label}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`grade-${key}`}
                      type="number"
                      value={gradeDays[key as keyof typeof gradeDays]}
                      onChange={(e) =>
                        setGradeDays((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="w-24"
                      disabled={isLoading || isSaving}
                    />
                    <span className="text-xs text-muted-foreground">天</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving || isLoading}>
          <Save className="w-4 h-4 mr-2" />
          {isSaving ? "保存中..." : "保存锁单与保护期规则"}
        </Button>
      </CardContent>
    </Card>
  )
}

function AnalyticsExcludedTeamsSettingsCard() {
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([])
  const [search, setSearch] = useState("")
  const [excludedTeamIds, setExcludedTeamIds] = useState<number[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadExcludedTeams() {
      try {
        const supabase = getBrowserSupabaseClient()

        const [teamsResult, settingsResult] = await Promise.all([
          supabase.from("teams").select("id, name").order("name", { ascending: true }),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "analytics.excluded_teams")
            .maybeSingle(),
        ])

        if (!isMounted) return

        if (teamsResult.error) {
          console.error("Failed to load teams for analytics excluded teams settings", teamsResult.error)
          setLoadError("加载团队列表失败，请稍后重试")
          setIsLoading(false)
          return
        }

        const teamsData = (teamsResult.data ?? []) as any[]
        setTeams(
          teamsData.map((row) => ({
            id: row.id as number,
            name: ((row.name as string | null) ?? `团队 #${row.id}`) as string,
          })),
        )

        if (settingsResult.error && settingsResult.error.code !== "PGRST116") {
          console.error("Failed to load analytics excluded teams settings", settingsResult.error)
        }

        const raw = (settingsResult.data?.value as any) ?? null
        if (raw && Array.isArray(raw.team_ids)) {
          const ids = raw.team_ids.filter((v: any) => typeof v === "number") as number[]
          setExcludedTeamIds(ids)
        }

        setLoadError(null)
        setIsLoading(false)
      } catch (error) {
        console.error("Unexpected error while loading analytics excluded teams settings", error)
        if (isMounted) {
          setLoadError("排除团队配置加载失败，请稍后重试")
          setIsLoading(false)
        }
      }
    }

    void loadExcludedTeams()

    return () => {
      isMounted = false
    }
  }, [])

  const handleToggleTeam = (id: number) => {
    setExcludedTeamIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase
        .from("settings")
        .upsert(
          {
            key: "analytics.excluded_teams",
            value: {
              team_ids: excludedTeamIds,
            },
          },
          { onConflict: "key" },
        )

      if (error) {
        console.error("Failed to save analytics excluded teams settings", error)
        const message = error.message ?? ""
        if (
          message.includes("ERR_NO_PERMISSION:settings.ui.manage") ||
          message.includes("ERR_NO_PERMISSION:settings.pipeline.manage")
        ) {
          toast.error("保存失败", {
            description: "当前账号无权修改统计排除配置，请联系系统管理员开通相应设置权限",
          })
        } else {
          toast.error("保存失败", { description: "保存统计排除配置时出错，请稍后重试" })
        }
        return
      }

      toast.success("排除团队配置已保存")
    } catch (error) {
      console.error("Unexpected error while saving analytics excluded teams settings", error)
      toast.error("保存失败", { description: "保存统计排除配置时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  const filteredTeams = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return teams
    return teams.filter((team) => {
      const name = team.name.toLowerCase()
      return name.includes(query) || String(team.id).includes(query)
    })
  }, [teams, search])

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-foreground">统计排除团队</CardTitle>
        <CardDescription className="text-sm">
          配置哪些团队不参与数据分析中的团队筛选和业绩统计，适用于“系统管理”“技术维护”等运维团队。
        </CardDescription>
        {loadError && <p className="mt-2 text-sm text-destructive/80">{loadError}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 max-w-sm">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索团队名称或 ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={isLoading}
            className="h-9 text-sm"
          />
        </div>

        <div className="border rounded-md overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-xs font-semibold">团队</TableHead>
                <TableHead className="w-[160px] text-right text-xs font-semibold">排除统计</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-sm text-muted-foreground text-center py-8">
                    正在加载团队列表...
                  </TableCell>
                </TableRow>
              ) : filteredTeams.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-sm text-muted-foreground text-center py-8">
                    暂无匹配的团队
                  </TableCell>
                </TableRow>
              ) : (
                filteredTeams.map((team) => (
                  <TableRow key={team.id} className="text-sm">
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="font-semibold text-foreground">{team.name}</div>
                        <div className="text-[11px] text-muted-foreground">ID: {team.id}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">不计入统计</span>
                        <Switch
                          checked={excludedTeamIds.includes(team.id)}
                          onCheckedChange={() => handleToggleTeam(team.id)}
                          disabled={isLoading || isSaving}
                          className="scale-90"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>


        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "保存中..." : "保存排除配置"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// Organization Tab
function OrganizationTab() {
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [editTeamDialogOpen, setEditTeamDialogOpen] = useState(false)
  const [addTeamDialogOpen, setAddTeamDialogOpen] = useState(false)
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [newTeamName, setNewTeamName] = useState("")
  const [editedTeamName, setEditedTeamName] = useState("")
  const [targetTeamId, setTargetTeamId] = useState<string>("")
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([])
  const [allMembers, setAllMembers] = useState<TeamMember[]>([])

  const [orgTab, setOrgTab] = useState<"active" | "pending">("active")
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([])
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false)
  const [selectedPendingUser, setSelectedPendingUser] = useState<PendingUser | null>(null)
  const [approvalTeam, setApprovalTeam] = useState("")
  const [approvalRole, setApprovalRole] = useState("")
  const [dbTeams, setDbTeams] = useState<{ id: number; name: string }[]>([])
  const [dbRoles, setDbRoles] = useState<{ id: string; name: string }[]>([])
  const [isOrgMetaLoading, setIsOrgMetaLoading] = useState(true)
  const [isApprovingUser, setIsApprovingUser] = useState(false)
  const [isRejectingUser, setIsRejectingUser] = useState(false)
  const [editRoleDialogOpen, setEditRoleDialogOpen] = useState(false)
  const [roleEditTarget, setRoleEditTarget] = useState<TeamMember | null>(null)
  const [roleEditRoleId, setRoleEditRoleId] = useState<string>("")
  const [isUpdatingOrg, setIsUpdatingOrg] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [deleteTeamDialogOpen, setDeleteTeamDialogOpen] = useState(false)

  const [rejectReason, setRejectReason] = useState("")
  const [statusDialogTarget, setStatusDialogTarget] = useState<TeamMember | null>(null)
  const [disableDialogOpen, setDisableDialogOpen] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [disableReason, setDisableReason] = useState("")
  const [isDisablingUser, setIsDisablingUser] = useState(false)
  const [isRestoringUser, setIsRestoringUser] = useState(false)

  const selectedTeam = teams.find((t) => t.id === selectedTeamId)

  useEffect(() => {
    let isMounted = true

    async function loadOrgMeta() {
      try {
        const supabase = getBrowserSupabaseClient()

        const [teamsResult, rolesResult, pendingResult, profilesPublicResult] = await Promise.all([
          supabase.from("teams").select("id, name").order("id", { ascending: true }),
          supabase.from("roles").select("id, name").order("name", { ascending: true }),
          supabase
            .from("profiles")
            .select("id, full_name, email, phone, created_at")
            .eq("status", "pending")
            .order("created_at", { ascending: true }),
          supabase
            .from("profiles_public")
            .select("id, full_name, avatar_url, team_id, role_id, status"),
        ])

        if (!isMounted) {
          return
        }

        if (teamsResult.error || rolesResult.error || pendingResult.error || profilesPublicResult.error) {
          console.error(
            "Failed to load organization metadata",
            teamsResult.error,
            rolesResult.error,
            pendingResult.error,
            profilesPublicResult.error,
          )
          toast.error("加载组织信息失败", {
            description: "请稍后重试或联系管理员",
          })
          return
        }

        const teamsData = (teamsResult.data ?? []) as any[]
        const rolesData = (rolesResult.data ?? []) as any[]
        const profilesPublicData = (profilesPublicResult.data ?? []) as any[]

        const allMembersFromProfiles: TeamMember[] = []

        setDbTeams(
          teamsData.map((team: any) => ({
            id: team.id as number,
            name: (team.name as string) ?? "未命名团队",
          })),
        )

        setDbRoles(
          rolesData.map((role: any) => ({
            id: role.id as string,
            name: (role.name as string) ?? "未命名角色",
          })),
        )

        setPendingUsers(
          (pendingResult.data ?? []).map((p: any) => ({
            id: p.id as string,
            name: (p.full_name as string) ?? "未填写姓名",
            email: (p.email as string) ?? "",
            phone: (p.phone as string) ?? "",
            applyTime: p.created_at
              ? new Date(p.created_at as string).toLocaleString("zh-CN")
              : "",
          })),
        )

        const roleIdToName = new Map<string, string>()
        for (const role of rolesData) {
          const roleId = role.id as string | null
          if (!roleId) continue
          roleIdToName.set(roleId, (role.name as string) ?? "未命名角色")
        }

        const teamsMap = new Map<number, Team>()
        for (const team of teamsData) {
          const teamId = team.id as number
          teamsMap.set(teamId, {
            id: teamId,
            name: (team.name as string) ?? "未命名团队",
            members: [],
          })
        }

        let nextMemberId = 1
        for (const profile of profilesPublicData) {
          const profileId = profile.id as string
          const status = (profile.status as string) ?? "pending"

          const roleId = profile.role_id as string | null
          const roleName = (roleId && roleIdToName.get(roleId)) ?? "未分配角色"

          const memberBase: TeamMember = {
            id: profileId,
            profileId,
            roleId: roleId ?? undefined,
            name: (profile.full_name as string) ?? "未填写姓名",
            avatar: (profile.avatar_url as string) ?? "",
            role: roleName,
            phone: "—",
            status: status === "disabled" ? "disabled" : status === "active" ? "active" : "pending",
          }

          allMembersFromProfiles.push(memberBase)
          if (status !== "active" && status !== "disabled") {
            continue
          }

          const teamId = profile.team_id as number | null
          if (!teamId) {
            continue
          }

          const team = teamsMap.get(teamId)
          if (!team) {
            continue
          }

          const member: TeamMember = {
            ...memberBase,
            id: nextMemberId++,
            status: status === "disabled" ? "disabled" : "active",
          }

          team.members.push(member)
        }

        const builtTeams = Array.from(teamsMap.values())
        setTeams(builtTeams)
        setAllMembers(allMembersFromProfiles)

        if (builtTeams.length > 0) {
          setSelectedTeamId((prevSelected) => {
            const exists = builtTeams.some((team) => team.id === prevSelected)
            return exists ? prevSelected : builtTeams[0].id
          })
        }
      } catch (error) {
        console.error("Failed to load organization metadata", error)
        if (isMounted) {
          toast.error("加载组织信息失败", {
            description: "请稍后重试或联系管理员",
          })
        }
      } finally {
        if (isMounted) {
          setIsOrgMetaLoading(false)
        }
      }
    }

    loadOrgMeta()

    return () => {
      isMounted = false
    }
  }, [])

  const handleDeleteTeam = async () => {
    const currentTeam = selectedTeam

    if (!currentTeam) return

    if (currentTeam.members.length > 0) {
      toast.error("无法删除团队", {
        description: "该团队下仍有成员，请先转移或移除所有成员后再删除。",
      })
      return
    }

    try {
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase
        .from("teams")
        .delete()
        .eq("id", currentTeam.id)

      if (error) {
        console.error("Failed to delete team", error)
        const message = error.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:teams.manage")) {
          toast.error("删除失败", {
            description: "当前账号无权删除团队。如需开通 teams.manage 权限，请联系系统管理员。",
          })
        } else if (message.includes("violates foreign key constraint") || message.includes("foreign key")) {
          toast.error("删除失败", {
            description: "该团队仍被成员或业务数据引用，无法删除。请先清理相关引用。",
          })
        } else {
          toast.error("删除失败", { description: "删除团队时出错，请稍后重试或联系管理员" })
        }
        return
      }

      setTeams((prev) => prev.filter((team) => team.id !== currentTeam.id))
      setDbTeams((prev) => prev.filter((team) => team.id !== currentTeam.id))

      setSelectedTeamId((prevSelected) => {
        if (prevSelected !== currentTeam.id) return prevSelected
        const remaining = teams.filter((team) => team.id !== currentTeam.id)
        return remaining.length > 0 ? remaining[0].id : null
      })

      setDeleteTeamDialogOpen(false)
      toast.success(`团队 "${currentTeam.name}" 已删除`)
    } catch (error) {
      console.error("Failed to delete team", error)
      toast.error("删除失败", { description: "删除团队时发生异常，请稍后重试或联系管理员" })
    }
  }

  const handleAddTeam = async () => {

    const name = newTeamName.trim()
    if (!name) {
      return
    }

    try {
      const supabase = getBrowserSupabaseClient()
      const { data, error } = await supabase
        .from("teams")
        .insert({ name })
        .select("id, name")
        .single()

      if (error || !data) {
        console.error("Failed to create team", error)
        const message = error?.message ?? ""
          if (message.includes("ERR_NO_PERMISSION:teams.manage")) {
          toast.error("创建失败", {
            description: "当前账号无权创建团队。如需开通 teams.manage 权限，请联系系统管理员。",
          })

        } else {
          toast.error("创建失败", { description: "创建团队时出错，请稍后重试" })
        }
        return
      }

      const createdId = data.id as number
      const createdName = (data.name as string) ?? name

      setTeams((prevTeams) => [
        ...prevTeams,
        {
          id: createdId,
          name: createdName,
          members: [],
        },
      ])

      setDbTeams((prevDbTeams) => [
        ...prevDbTeams,
        {
          id: createdId,
          name: createdName,
        },
      ])

      setNewTeamName("")
      setAddTeamDialogOpen(false)
      toast.success(`团队 "${createdName}" 已创建`)
    } catch (error) {
      console.error("Failed to create team", error)
      toast.error("创建失败", { description: "创建团队时发生异常，请稍后重试或联系管理员" })
    }
  }

  const handleEditTeamName = async () => {
    const name = editedTeamName.trim()
    const currentTeam = selectedTeam

    if (!name || !currentTeam) {
      return
    }

    try {
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase
        .from("teams")
        .update({ name })
        .eq("id", currentTeam.id)

      if (error) {
        console.error("Failed to update team name", error)
        const message = error.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:teams.manage")) {
          toast.error("保存失败", {
            description: "当前账号无权修改团队配置。如需开通 teams.manage 权限，请联系系统管理员。",
          })

        } else {
          toast.error("保存失败", { description: "更新团队名称时出错，请稍后重试" })
        }
        return
      }

      setTeams((prevTeams) =>
        prevTeams.map((team) => (team.id === currentTeam.id ? { ...team, name } : team)),
      )

      setDbTeams((prevDbTeams) =>
        prevDbTeams.map((team) => (team.id === currentTeam.id ? { ...team, name } : team)),
      )

      setEditTeamDialogOpen(false)
      toast.success("团队名称已更新")
    } catch (error) {
      console.error("Failed to update team name", error)
      toast.error("保存失败", { description: "更新团队名称时发生异常，请稍后重试或联系管理员" })
    }
  }

  const handleAddMembers = async () => {
    if (selectedNewMembers.length === 0 || !selectedTeam) {
      return
    }

    try {
      setIsUpdatingOrg(true)
      const supabase = getBrowserSupabaseClient()

      const membersToAdd = allMembers.filter((m) => selectedNewMembers.includes(m.profileId ?? ""))

      for (const member of membersToAdd) {
        if (!member.profileId) {
          continue
        }

        const { error } = await supabase.rpc("rpc_profile_update_org", {
          p_user_id: member.profileId,
          p_team_id: selectedTeam.id,
          p_role_id: member.roleId ?? null,
        })

        if (error) {
          console.error("Failed to add member to team", error)
          const message = error.message ?? "添加成员失败"
          let friendly = "添加成员失败，请稍后重试"

          if (message.includes("ERR_NO_PERMISSION:profiles.manage")) {
            friendly = "没有调整组织架构的权限，请联系系统管理员开通 profiles.manage 权限"
          }

          toast.error("添加成员失败", { description: friendly })
          setIsUpdatingOrg(false)
          return
        }
      }

      // 成功后刷新一次组织数据，确保前端与数据库一致
      setSelectedNewMembers([])
      setAddMemberDialogOpen(false)
      toast.success(`已添加 ${membersToAdd.length} 名成员到 ${selectedTeam.name}`)

      // 重新加载组织信息
      window.location.reload()
    } catch (error) {
      console.error("Unexpected error while adding members", error)
      toast.error("添加成员失败", { description: "添加成员时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsUpdatingOrg(false)
    }
  }

  const handleTransferMember = async () => {
    if (!selectedMember || !targetTeamId) {
      return
    }

    if (!selectedMember.profileId) {
      toast.error("操作失败", {
        description: "该成员尚未关联账号，无法转移团队",
      })
      return
    }

    const targetId = Number.parseInt(targetTeamId, 10)
    if (Number.isNaN(targetId)) {
      return
    }

    try {
      setIsUpdatingOrg(true)
      const supabase = getBrowserSupabaseClient()

      const { error } = await supabase.rpc("rpc_profile_update_org", {
        p_user_id: selectedMember.profileId,
        p_team_id: targetId,
        p_role_id: selectedMember.roleId ?? null,
      })

      if (error) {
        console.error("Failed to transfer member", error)
        const message = error.message ?? "转移失败"
        let friendly = "转移失败，请稍后重试"

        if (message.includes("ERR_NO_PERMISSION:profiles.manage")) {
          friendly = "没有调整组织架构的权限，请联系系统管理员开通 profiles.manage 权限"
        } else if (message.includes("ERR_INVALID_STATUS:only_active_can_change_org")) {
          friendly = "只有在职成员可以转移团队，请刷新列表后重试"
        } else if (message.includes("ERR_NOT_FOUND:profile")) {
          friendly = "未找到该成员的账号，请刷新后重试"
        }

        toast.error("转移失败", { description: friendly })
        return
      }

      setTeams((prevTeams) =>
        prevTeams.map((team) => {
          if (team.id === selectedTeamId) {
            return { ...team, members: team.members.filter((m) => m.id !== selectedMember.id) }
          }
          if (team.id === targetId) {
            return { ...team, members: [...team.members, { ...selectedMember }] }
          }
          return team
        }),
      )

      setTransferDialogOpen(false)
      setSelectedMember(null)
      setTargetTeamId("")
      toast.success(`${selectedMember.name} 已转移至新团队`)
    } catch (error) {
      console.error("Failed to transfer member", error)
      toast.error("转移失败", { description: "转移成员时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsUpdatingOrg(false)
    }
  }

  const handleRemoveMember = async (memberId: number) => {
    const team = teams.find((t) => t.id === selectedTeamId)
    const member = team?.members.find((m) => m.id === memberId)

    if (!team || !member) {
      return
    }

    if (!member.profileId) {
      toast.error("操作失败", {
        description: "该成员尚未关联账号，无法从团队中移除",
      })
      return
    }

    if (member.status === "active") {
      toast.error("无法移除在职成员", {
        description: "在职成员必须至少属于一个团队，请先通过“转移团队”或“禁用账号”处理。",
      })
      return
    }

    try {
      setIsUpdatingOrg(true)
      const supabase = getBrowserSupabaseClient()

      const { error } = await supabase.rpc("rpc_profile_update_org", {
        p_user_id: member.profileId,
        p_team_id: null,
        p_role_id: member.roleId ?? null,
      })

      if (error) {
        console.error("Failed to remove member from team", error)
        const message = error.message ?? "移除失败"
        let friendly = "移除失败，请稍后重试"

        if (message.includes("ERR_NO_PERMISSION:profiles.manage")) {
          friendly = "没有调整组织架构的权限，请联系系统管理员开通 profiles.manage 权限"
        } else if (message.includes("ERR_INVALID_STATUS:only_active_can_change_org")) {
          friendly = "只有在允许状态下才能调整组织归属，请刷新列表后重试"
        } else if (message.includes("ERR_NOT_FOUND:profile")) {
          friendly = "未找到该成员的账号，请刷新后重试"
        }

        toast.error("移除失败", { description: friendly })
        return
      }

      setTeams((prevTeams) =>
        prevTeams.map((t) =>
          t.id === team.id ? { ...t, members: t.members.filter((m) => m.id !== memberId) } : t,
        ),
      )

      toast.success("成员已从团队中移除")
    } catch (error) {
      console.error("Failed to remove member from team", error)
      toast.error("移除失败", { description: "移除成员时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsUpdatingOrg(false)
    }
  }

  const handleApproveUser = async () => {
    if (!selectedPendingUser || !approvalTeam || !approvalRole) {
      return
    }

    try {
      setIsApprovingUser(true)

      const supabase = getBrowserSupabaseClient()
      const teamId = Number.parseInt(approvalTeam, 10)
      const roleId = approvalRole

      const { error } = await supabase.rpc("rpc_auth_approve", {
        p_user_id: selectedPendingUser.id,
        p_team_id: teamId,
        p_role_id: roleId,
      })

      if (error) {
        const message = error.message ?? "审批失败"
        let friendly = "审批失败，请稍后重试"

        if (message.includes("ERR_NO_PERMISSION:auth.approve")) {
          friendly = "没有审批用户的权限，请联系系统管理员"
        } else if (message.includes("ERR_INVALID_STATUS:only_pending_can_approve")) {
          friendly = "只有待审核状态的用户可以被审批，请刷新后重试"
        }

        toast.error("审批失败", { description: friendly })
        return
      }

      const roleName = dbRoles.find((role) => role.id === roleId)?.name ?? "未命名角色"

      const newMember: TeamMember = {
        id: Date.now(),
        profileId: selectedPendingUser.id,
        roleId: roleId,
        name: selectedPendingUser.name,
        avatar: "",
        role: roleName,
        phone: "—",
        status: "active",
      }

      setTeams((prevTeams) => prevTeams.map((t) => (t.id === teamId ? { ...t, members: [...t.members, newMember] } : t)))
      setPendingUsers((prevPending) => prevPending.filter((u) => u.id !== selectedPendingUser.id))
      setApprovalDialogOpen(false)
      setSelectedPendingUser(null)
      setApprovalTeam("")
      setApprovalRole("")

      toast.success(`${selectedPendingUser.name} 已激活并加入团队`)
    } catch (error) {
      console.error("Failed to approve user", error)
      toast.error("审批失败", { description: "请稍后重试或联系管理员" })
    } finally {
      setIsApprovingUser(false)
    }
  }

  const handleRejectUser = (user: PendingUser) => {
    setSelectedPendingUser(user)
    setRejectReason("")
    setRejectDialogOpen(true)
  }

  const handleDisableAccount = async () => {
    if (!statusDialogTarget) {
      return
    }

    if (!statusDialogTarget.profileId) {
      toast.error("操作失败", {
        description: "该成员尚未关联账号，无法禁用",
      })
      return
    }

    if (!disableReason.trim()) {
      toast.error("禁用失败", {
        description: "请填写禁用原因",
      })
      return
    }

    try {
      setIsDisablingUser(true)

      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.rpc("rpc_auth_disable", {
        p_user_id: statusDialogTarget.profileId,
        p_reason: disableReason,
      })

      if (error) {
        const message = error.message ?? "禁用失败"
        let friendly = "禁用失败，请稍后重试"

        if (message.includes("ERR_NO_PERMISSION:auth.disable")) {
          friendly = "没有禁用用户的权限，请联系系统管理员"
        } else if (message.includes("ERR_INVALID_STATUS:only_active_can_disable")) {
          friendly = "只有在职状态的用户可以被禁用，请刷新后重试"
        }

        toast.error("禁用失败", { description: friendly })
        return
      }

      const disabledAt = new Date().toLocaleString("zh-CN")

      setTeams((prevTeams) =>
        prevTeams.map((team) => ({
          ...team,
          members: team.members.map((member) =>
            member.id === statusDialogTarget.id
              ? {
                  ...member,
                  status: "disabled" as const,
                  disableReason,
                  disabledAt,
                }
              : member,
          ),
        })),
      )

      toast.success("账号已禁用", {
        description: `${statusDialogTarget.name} 已被禁用，后续将无法登录系统`,
      })

      setDisableDialogOpen(false)
      setStatusDialogTarget(null)
      setDisableReason("")
    } catch (error) {
      console.error("Failed to disable user", error)
      toast.error("禁用失败", { description: "请稍后重试或联系管理员" })
    } finally {
      setIsDisablingUser(false)
    }
  }

  const handleRestoreAccount = async () => {
    if (!statusDialogTarget) {
      return
    }

    if (!statusDialogTarget.profileId) {
      toast.error("操作失败", {
        description: "该成员尚未关联账号，无法恢复",
      })
      return
    }

    try {
      setIsRestoringUser(true)

      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.rpc("rpc_auth_restore", {
        p_user_id: statusDialogTarget.profileId,
        p_team_id: null,
        p_role_id: null,
      })

      if (error) {
        const message = error.message ?? "恢复失败"
        let friendly = "恢复失败，请稍后重试"

        if (message.includes("ERR_NO_PERMISSION:auth.restore")) {
          friendly = "没有恢复用户的权限，请联系系统管理员"
        } else if (message.includes("ERR_INVALID_STATUS:only_disabled_can_restore")) {
          friendly = "只有禁用状态的用户可以被恢复，请刷新后重试"
        }

        toast.error("恢复失败", { description: friendly })
        return
      }

      setTeams((prevTeams) =>
        prevTeams.map((team) => ({
          ...team,
          members: team.members.map((member) =>
            member.id === statusDialogTarget.id
              ? {
                  ...member,
                  status: "active" as const,
                  disableReason: undefined,
                  disabledAt: undefined,
                }
              : member,
          ),
        })),
      )

      toast.success("账号已恢复", {
        description: `${statusDialogTarget.name} 可以重新登录系统`,
      })

      setRestoreDialogOpen(false)
      setStatusDialogTarget(null)
    } catch (error) {
      console.error("Failed to restore user", error)
      toast.error("恢复失败", { description: "请稍后重试或联系管理员" })
    } finally {
      setIsRestoringUser(false)
    }
  }

  return (
    <div className="space-y-6">
      <Tabs value={orgTab} onValueChange={(v) => setOrgTab(v as "active" | "pending")}>
        <TabsList>
          <TabsTrigger value="active" className="gap-2">
            <Users className="w-4 h-4" />
            在职成员
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="w-4 h-4" />
            待审核
            {pendingUsers.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                {pendingUsers.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-6">
          {/* Existing team management UI */}
          <div className="flex gap-6 h-[calc(100vh-340px)] min-h-[500px]">
            {/* Left: Teams List */}
            <Card className="w-64 flex-shrink-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold text-foreground">团队列表</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px]">
                  <div className="px-3 space-y-1">
                    {teams.map((team) => (
                      <button
                        key={team.id}
                        onClick={() => setSelectedTeamId(team.id)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-left",
                          selectedTeamId === team.id
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "hover:bg-accent text-foreground font-medium",
                        )}
                      >
                        <span className="truncate">{team.name}</span>
                        <Badge
                          variant={selectedTeamId === team.id ? "secondary" : "outline"}
                          className={cn(
                            "ml-2 text-[11px]",
                            selectedTeamId === team.id && "bg-primary-foreground/20 text-primary-foreground",
                          )}
                        >
                          {team.members.length}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </ScrollArea>

                <div className="p-3 border-t">
                  <Dialog open={addTeamDialogOpen} onOpenChange={setAddTeamDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-full bg-transparent">
                        <Plus className="w-4 h-4 mr-2" />
                        添加团队
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>创建新团队</DialogTitle>
                      </DialogHeader>
                      <div className="py-4">
                        <Label htmlFor="teamName">团队名称</Label>
                        <Input
                          id="teamName"
                          value={newTeamName}
                          onChange={(e) => setNewTeamName(e.target.value)}
                          placeholder="输入团队名称"
                          className="mt-2"
                        />
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAddTeamDialogOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={handleAddTeam}>创建</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>

            {/* Right: Team Members */}
            <Card className="flex-1">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg font-bold text-foreground">{selectedTeam?.name}</CardTitle>

                  <Dialog
                    open={editTeamDialogOpen}
                    onOpenChange={(open) => {
                      setEditTeamDialogOpen(open)
                      if (open && selectedTeam) setEditedTeamName(selectedTeam.name)
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>编辑团队名称</DialogTitle>
                      </DialogHeader>
                      <div className="py-4">
                        <Label htmlFor="editTeamName">团队名称</Label>
                        <Input
                          id="editTeamName"
                          value={editedTeamName}
                          onChange={(e) => setEditedTeamName(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setEditTeamDialogOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={handleEditTeamName}>保存</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="flex gap-2">
                  <AlertDialog open={deleteTeamDialogOpen} onOpenChange={setDeleteTeamDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive text-destructive hover:bg-destructive/5"
                        disabled={!selectedTeam}
                      >
                        <Trash2 className="w-4 h-4 mr-1" /> 删除团队
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除团队</AlertDialogTitle>
                        <AlertDialogDescription>
                          确认删除团队「{selectedTeam?.name}」吗？该操作不可撤销，且仅当团队下没有任何成员且未被业务数据引用时才会成功。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          onClick={(e) => {
                            e.preventDefault()
                            void handleDeleteTeam()
                          }}
                        >
                          确认删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Dialog open={addMemberDialogOpen} onOpenChange={setAddMemberDialogOpen}>

                    <DialogTrigger asChild>
                      <Button size="sm">
                        <UserPlus className="w-4 h-4 mr-2" />
                        添加成员
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>添加成员</DialogTitle>
                        <DialogDescription>选择要添加到 {selectedTeam?.name} 的成员</DialogDescription>
                      </DialogHeader>
                      <div className="py-4 space-y-3">
                        {allMembers.map((user) => (
                          <div key={user.profileId ?? user.id} className="flex items-center gap-3 p-2 rounded-lg border">
                            <input
                              type="checkbox"
                              checked={selectedNewMembers.includes(user.profileId ?? "")}
                              onChange={(e) => {
                                const key = user.profileId ?? ""
                                if (!key) return
                                if (e.target.checked) {
                                  setSelectedNewMembers([...selectedNewMembers, key])
                                } else {
                                  setSelectedNewMembers(selectedNewMembers.filter((id) => id !== key))
                                }
                              }}
                              className="rounded"
                            />
                            <Avatar className="h-8 w-8">
                              <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{user.name}</p>
                              <p className="text-xs text-muted-foreground">{user.phone}</p>
                            </div>
                            <Badge variant={user.status === "active" ? "default" : "secondary"}>
                              {user.status === "active" ? "在职" : "禁用"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAddMemberDialogOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={handleAddMembers} disabled={selectedNewMembers.length === 0}>
                          添加 {selectedNewMembers.length > 0 && `(${selectedNewMembers.length})`}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-semibold">成员</TableHead>
                      <TableHead className="text-xs font-semibold">角色</TableHead>
                      <TableHead className="text-xs font-semibold">电话</TableHead>
                      <TableHead className="text-xs font-semibold">状态</TableHead>
                      <TableHead className="w-[80px] text-xs font-semibold">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTeam?.members.map((member) => (
                      <TableRow key={member.id} className="text-sm">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              {member.avatar ? <AvatarImage src={member.avatar} /> : null}
                              <AvatarFallback>{member.name?.trim()?.[0] ?? "?"}</AvatarFallback>
                            </Avatar>

                            <span className="font-semibold">{member.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={member.role === "manager" ? "default" : "secondary"} className="text-[11px]">
                            {roleLabels[member.role] || member.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono">{member.phone}</TableCell>
                        <TableCell>
                          <Badge
                            variant={member.status === "active" ? "outline" : "secondary"}
                            className={cn(
                              "text-[11px]",
                              member.status === "active"
                                ? "text-green-600 border-green-600"
                                : "bg-slate-100 text-slate-500 border-slate-200"
                            )}

                            title={
                              member.status === "disabled"
                                ? [
                                    member.disableReason ? `禁用原因：${member.disableReason}` : null,
                                    member.disabledAt ? `禁用时间：${member.disabledAt}` : null,
                                  ]
                                    .filter(Boolean)
                                    .join("\n") || undefined
                                : undefined
                            }
                          >
                            {member.status === "active" ? "在职" : "已禁用"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedMember(member)
                                  setTransferDialogOpen(true)
                                }}
                              >
                                <ArrowRightLeft className="w-4 h-4 mr-2" />
                                转移团队
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setRoleEditTarget(member)
                                  const currentRoleId =
                                    member.roleId ?? dbRoles.find((role) => role.name === member.role)?.id ?? ""
                                  setRoleEditRoleId(currentRoleId)
                                  setEditRoleDialogOpen(true)
                                }}
                              >
                                <Pencil className="w-4 h-4 mr-2" />
                                编辑角色
                              </DropdownMenuItem>
                              {member.status === "active" ? (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => {
                                    setStatusDialogTarget(member)
                                    setDisableReason("")
                                    setDisableDialogOpen(true)
                                  }}
                                >
                                  <Lock className="w-4 h-4 mr-2" />
                                  禁用账号
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setStatusDialogTarget(member)
                                    setRestoreDialogOpen(true)
                                  }}
                                >
                                  <UserCheck className="w-4 h-4 mr-2" />
                                  恢复账号
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleRemoveMember(member.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                移除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                    {selectedTeam?.members.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          暂无成员
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Transfer Dialog */}
            <Dialog
              open={transferDialogOpen}
              onOpenChange={(open) => {
                setTransferDialogOpen(open)
                if (!open) {
                  setTargetTeamId("")
                  if (!isUpdatingOrg) {
                    setSelectedMember(null)
                  }
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>转移成员</DialogTitle>
                  <DialogDescription>将 {selectedMember?.name} 转移到其他团队</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Label>目标团队</Label>
                  <Select value={targetTeamId} onValueChange={setTargetTeamId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="选择目标团队" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams
                        .filter((t) => t.id !== selectedTeamId)
                        .map((team) => (
                          <SelectItem key={team.id} value={team.id.toString()}>
                            {team.name} ({team.members.length} 人)
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTransferDialogOpen(false)
                      setTargetTeamId("")
                      if (!isUpdatingOrg) {
                        setSelectedMember(null)
                      }
                    }}
                  >
                    取消
                  </Button>
                  <Button onClick={handleTransferMember} disabled={!targetTeamId || isUpdatingOrg}>
                    {isUpdatingOrg ? "正在转移..." : "确认转移"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Edit Role Dialog */}
            <Dialog
              open={editRoleDialogOpen}
              onOpenChange={(open) => {
                setEditRoleDialogOpen(open)
                if (!open && !isUpdatingOrg) {
                  setRoleEditTarget(null)
                  setRoleEditRoleId("")
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>编辑角色</DialogTitle>
                  <DialogDescription>调整 {roleEditTarget?.name} 的系统角色</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-2">
                  <Label>角色</Label>
                  <Select value={roleEditRoleId} onValueChange={setRoleEditRoleId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="选择角色" />
                    </SelectTrigger>
                    <SelectContent>
                      {dbRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditRoleDialogOpen(false)
                      if (!isUpdatingOrg) {
                        setRoleEditTarget(null)
                        setRoleEditRoleId("")
                      }
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!roleEditTarget || !roleEditTarget.profileId || !roleEditRoleId || !selectedTeamId) {
                        return
                      }

                      try {
                        setIsUpdatingOrg(true)
                        const supabase = getBrowserSupabaseClient()
                        const { error } = await supabase.rpc("rpc_profile_update_org", {
                          p_user_id: roleEditTarget.profileId,
                          p_team_id: selectedTeamId,
                          p_role_id: roleEditRoleId,
                        })

                        if (error) {
                          console.error("Failed to update member role", error)
                          const message = error.message ?? "保存失败"
                          let friendly = "保存失败，请稍后重试"

                          if (message.includes("ERR_NO_PERMISSION:profiles.manage")) {
                            friendly = "没有调整组织架构的权限，请联系系统管理员开通 profiles.manage 权限"
                          } else if (message.includes("ERR_INVALID_STATUS:only_active_can_change_org")) {
                            friendly = "只有在职成员可以调整角色，请刷新列表后重试"
                          } else if (message.includes("ERR_NOT_FOUND:profile")) {
                            friendly = "未找到该成员的账号，请刷新后重试"
                          }

                          toast.error("保存失败", { description: friendly })
                          return
                        }

                        const roleName = dbRoles.find((role) => role.id === roleEditRoleId)?.name ?? "未命名角色"

                        setTeams((prevTeams) =>
                          prevTeams.map((team) => ({
                            ...team,
                            members: team.members.map((member) =>
                              roleEditTarget && member.id === roleEditTarget.id
                                ? { ...member, roleId: roleEditRoleId, role: roleName }
                                : member,
                            ),
                          })),
                        )

                        toast.success("角色已更新")
                        setEditRoleDialogOpen(false)
                        setRoleEditTarget(null)
                        setRoleEditRoleId("")
                      } catch (error) {
                        console.error("Failed to update member role", error)
                        toast.error("保存失败", { description: "调整角色时发生异常，请稍后重试或联系管理员" })
                      } finally {
                        setIsUpdatingOrg(false)
                      }
                    }}
                    disabled={!roleEditRoleId || !roleEditTarget || isUpdatingOrg}
                  >
                    {isUpdatingOrg ? "保存中..." : "保存"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>

        <TabsContent value="pending" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground">待审核申请</CardTitle>
              <CardDescription className="text-sm">以下用户正在等待账户激活</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">姓名</TableHead>
                    <TableHead className="text-xs font-semibold">邮箱</TableHead>
                    <TableHead className="text-xs font-semibold">申请时间</TableHead>
                    <TableHead className="w-[180px] text-right text-xs font-semibold">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingUsers.map((user) => (
                    <TableRow key={user.id} className="text-sm">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-amber-100 text-amber-700 font-semibold">
                              {user.name.slice(0, 1)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-semibold">{user.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell className="text-muted-foreground">{user.applyTime}</TableCell>

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive border-destructive/50 hover:bg-destructive/10 bg-transparent"
                            onClick={() => handleRejectUser(user)}
                          >
                            <X className="w-4 h-4 mr-1" />
                            拒绝
                          </Button>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => {
                              setSelectedPendingUser(user)
                              setApprovalDialogOpen(true)
                            }}
                            disabled={isApprovingUser}
                          >
                            <Check className="w-4 h-4 mr-1" />
                            批准
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {pendingUsers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                        <UserCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                        暂无待审核申请
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Dialog open={approvalDialogOpen} onOpenChange={setApprovalDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">激活用户: {selectedPendingUser?.name}</DialogTitle>
                <DialogDescription className="text-sm">请为该用户分配团队和角色以完成激活</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">分配团队</Label>
                  <Select value={approvalTeam} onValueChange={setApprovalTeam}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="选择团队" />
                    </SelectTrigger>
                    <SelectContent>
                      {dbTeams.map((team) => (
                        <SelectItem key={team.id} value={team.id.toString()}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">分配角色</Label>
                  <Select value={approvalRole} onValueChange={setApprovalRole}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="选择角色" />
                    </SelectTrigger>
                    <SelectContent>
                      {dbRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setApprovalDialogOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={handleApproveUser}
                  disabled={!approvalTeam || !approvalRole || isApprovingUser}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isApprovingUser ? "正在激活..." : "确认激活"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">驳回申请: {selectedPendingUser?.name}</DialogTitle>
                <DialogDescription className="text-sm">请填写驳回原因，该原因将记录在审计日志中</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="rejectReason" className="text-sm font-medium">驳回原因</Label>
                  <Textarea
                    id="rejectReason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="请输入具体原因，例如信息不完整或不符合准入条件"
                    className="text-sm"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (!selectedPendingUser) return

                    if (!rejectReason.trim()) {
                      toast.error("驳回失败", { description: "请填写驳回原因" })
                      return
                    }

                    try {
                      setIsRejectingUser(true)
                      const response = await fetch("/api/auth/reject", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          userId: selectedPendingUser.id,
                          reason: rejectReason,
                        }),
                      })

                      const result = (await response.json().catch(() => ({}))) as {
                        ok?: boolean
                        error?: string
                        detail?: string
                      }

                      if (!response.ok || !result.ok) {
                        const message = result.error ?? result.detail ?? "驳回失败"
                        let friendly = "驳回失败，请稍后重试"

                        if (message.includes("ERR_NO_PERMISSION:auth.reject")) {
                          friendly = "没有驳回用户的权限，请联系系统管理员"
                        } else if (message.includes("ERR_VALIDATION:rejection_reason_required")) {
                          friendly = "驳回原因必填，请检查后重新提交"
                        } else if (message.includes("ERR_INVALID_STATUS:only_pending_can_reject")) {
                          friendly = "只有待审核状态的用户可以被驳回，请刷新后重试"
                        } else if (message.includes("ERR_SERVER_MISCONFIGURED")) {
                          friendly = "服务端未配置 Supabase service role key，无法删除认证账号"
                        } else if (message.includes("ERR_AUTH_DELETE_FAILED")) {
                          friendly = "已驳回业务申请，但未能删除 Supabase Auth 用户，请联系管理员手动处理"
                        }

                        toast.error("驳回失败", { description: friendly })
                        return
                      }

                      setPendingUsers(pendingUsers.filter((u) => u.id !== selectedPendingUser.id))
                      setRejectDialogOpen(false)
                      setSelectedPendingUser(null)
                      setRejectReason("")

                      toast.success("已驳回申请")
                    } catch (error) {
                      console.error("Failed to reject user", error)
                      toast.error("驳回失败", { description: "请稍后重试或联系管理员" })
                    } finally {
                      setIsRejectingUser(false)
                    }
                  }}
                  disabled={isRejectingUser}
                >
                  {isRejectingUser ? "正在驳回..." : "确认驳回"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={disableDialogOpen}
            onOpenChange={(open) => {
              setDisableDialogOpen(open)
              if (!open) {
                setDisableReason("")
                setStatusDialogTarget(null)
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">禁用账号: {statusDialogTarget?.name}</DialogTitle>
                <DialogDescription className="text-sm">禁用后该成员将无法登录系统，操作会记录在审计日志中。</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="disableReason" className="text-sm font-medium">禁用原因</Label>
                  <Textarea
                    id="disableReason"
                    value={disableReason}
                    onChange={(e) => setDisableReason(e.target.value)}
                    placeholder="请输入禁用原因，例如长期未在岗、违反销售规范等"
                    className="text-sm"
                  />
                  <p className="text-xs text-muted-foreground">原因会写入审计日志，方便后续追溯。</p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDisableDialogOpen(false)
                    setDisableReason("")
                    setStatusDialogTarget(null)
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDisableAccount}
                  disabled={isDisablingUser || !disableReason.trim() || !statusDialogTarget}
                >
                  {isDisablingUser ? "正在禁用..." : "确认禁用"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={restoreDialogOpen}
            onOpenChange={(open) => {
              setRestoreDialogOpen(open)
              if (!open) {
                setStatusDialogTarget(null)
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>恢复账号: {statusDialogTarget?.name}</DialogTitle>
                <DialogDescription>恢复后该成员将重新变为在职状态，并可以登录系统。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRestoreDialogOpen(false)
                    setStatusDialogTarget(null)
                  }}
                >
                  取消
                </Button>
                <Button
                  onClick={handleRestoreAccount}
                  disabled={isRestoringUser || !statusDialogTarget}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isRestoringUser ? "正在恢复..." : "确认恢复"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Permissions Tab
function PermissionsTab() {
  const [roles, setRoles] = useState<Role[]>([])
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [recommendedDiffCount, setRecommendedDiffCount] = useState<number>(0)
  const [editingRoleOriginal, setEditingRoleOriginal] = useState<Role | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [roleSaveError, setRoleSaveError] = useState<RpcErrorFriendly | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [permissionSearch, setPermissionSearch] = useState("")

  const hasUnsavedChanges = useMemo(() => {
    if (!sheetOpen || !editingRole || !editingRoleOriginal) return false

    const a = {
      name: editingRole.name,
      dataScope: editingRole.dataScope,
      permissions: editingRole.permissions,
    }

    const b = {
      name: editingRoleOriginal.name,
      dataScope: editingRoleOriginal.dataScope,
      permissions: editingRoleOriginal.permissions,
    }

    return JSON.stringify(a) !== JSON.stringify(b)
  }, [editingRole, editingRoleOriginal, sheetOpen])

  useEffect(() => {
    if (!sheetOpen || !hasUnsavedChanges) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
      return ""
    }

    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [sheetOpen, hasUnsavedChanges])

  type PermissionPreviewItem = {
    key: string
    allowed: boolean
    scope: { scope_type: string; scope_rule: any } | null
  }

  type UserOverrideRow = {
    permissionKey: string
    effect: "inherit" | "allow" | "deny"
    expiresAt: string | null
    reason: string
  }

  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [selectedUserName, setSelectedUserName] = useState<string>("")
  const [userSearchKeyword, setUserSearchKeyword] = useState("")
  const [userOptions, setUserOptions] = useState<{ id: string; name: string }[]>([])
  const [userPermissions, setUserPermissions] = useState<PermissionPreviewItem[]>([])
  const [userOverrides, setUserOverrides] = useState<UserOverrideRow[]>([])
  const [isLoadingUserPerms, setIsLoadingUserPerms] = useState(false)
  const [isSavingUserOverrides, setIsSavingUserOverrides] = useState(false)

  type FieldPolicyRow = {
    resource: string
    field: string
    readPermissionKey: string | null
    writePermissionKey: string | null
    maskStrategy: string
  }

  const [fieldPolicies, setFieldPolicies] = useState<FieldPolicyRow[]>([])
  const [isSavingFieldPolicies, setIsSavingFieldPolicies] = useState(false)

  type ScopeSetRow = {
    id: string
    name: string
    resource: string
    definition: any
  }

  const [scopeSets, setScopeSets] = useState<ScopeSetRow[]>([])
  const [newScopeSetName, setNewScopeSetName] = useState("")
  const [newScopeSetDefinition, setNewScopeSetDefinition] = useState("{\n  \"team_ids\": [],\n  \"rules\": {}\n}")
  const [isSavingScopeSets, setIsSavingScopeSets] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadRolesAndPermissions() {
      try {
        setIsLoading(true)
        const supabase = getBrowserSupabaseClient()

        const [rolesResult, profilesResult, fieldPoliciesResult, scopeSetsResult, profilesPublicResult] =
          await Promise.all([
            supabase
              .from("roles")
              .select("id, name, is_system, is_active, role_type")
              .eq("is_active", true)
              .order("name", { ascending: true }),
            supabase
              .from("profiles")
              .select("id, role_id, status")
              .eq("status", "active"),
            supabase
              .from("field_policies")
              .select("resource, field, read_permission_key, write_permission_key, mask_strategy"),
            supabase.from("custom_scope_sets").select("id, name, resource, definition"),
            supabase.from("profiles_public_view").select("id, full_name").order("full_name", { ascending: true }),
          ])

        if (!isMounted) return

        if (rolesResult.error) {
          console.error("Failed to load roles", rolesResult.error)
          setLoadError("加载角色列表失败，请稍后重试或联系管理员")
          setRoles(initialRoles)
        } else {
          const rawRoles = (rolesResult.data ?? []) as any[]
          const rawProfiles = (profilesResult.data ?? []) as any[]

          const userCountByRole = new Map<string, number>()
          for (const profile of rawProfiles) {
            const roleId = profile.role_id as string | null
            if (!roleId) continue
            userCountByRole.set(roleId, (userCountByRole.get(roleId) ?? 0) + 1)
          }

          const permsByRole = new Map<
            string,
            { permission_key: string; effect: string; scope_type: ScopeType; scope_rule: any }[]
          >()

          const permissionResults = await Promise.all(
            rawRoles.map(async (role) => {
              const roleId = role.id as string
              const { data, error } = await rpcGetRolePermissions(roleId)
              return { roleId, data, error }
            }),
          )

          for (const result of permissionResults) {
            if (result.error || !result.data) {
              console.error("Failed to load role permissions via RPC", result.error, "for role", result.roleId)
              continue
            }

            const permissions = ((result.data as any).permissions ?? []) as any[]
            const list = permsByRole.get(result.roleId) ?? []

            for (const item of permissions) {
              list.push({
                permission_key: item.permission_key as string,
                effect: item.effect as string,
                scope_type: ((item.scope_type as string) as ScopeType) ?? "self",
                scope_rule: item.scope_rule,
              })
            }

            permsByRole.set(result.roleId, list)
          }

          function deriveDataScope(roleId: string): DataScope {
            const perms = permsByRole.get(roleId) ?? []
            const targetKeys = ["leads.read", "leads.update", "leads.assign", "leads.transfer", "leads.close"]
            const match = perms.find((p) => p.effect === "allow" && targetKeys.includes(p.permission_key))
            const scope = match?.scope_type ?? "self"
            if (scope === "org") return "all"
            if (scope === "team") return "team"
            return "own"
          }

          function deriveFlag(roleId: string, toggleKey: PermissionToggleKey): boolean {
            const perms = permsByRole.get(roleId) ?? []
            const mappedKeys = PERMISSION_KEY_MAP[toggleKey]
            return perms.some((p) => p.effect === "allow" && mappedKeys.includes(p.permission_key as any))
          }

          const nextRoles: Role[] = rawRoles.map((role) => {
            const roleId = role.id as string
            const dataScope = deriveDataScope(roleId)
            const roleType = ((role.role_type as string) ?? "other") as Role["roleType"]

          const permissions: RolePermissionFlags = {
            createLeads: deriveFlag(roleId, "createLeads"),
            updateLeads: deriveFlag(roleId, "updateLeads"),
            closeLeads: deriveFlag(roleId, "closeLeads"),
            viewUnmaskedPhone: deriveFlag(roleId, "viewUnmaskedPhone"),
            exportData: deriveFlag(roleId, "exportData"),
            importLeads: deriveFlag(roleId, "importLeads"),
            assignLeads: deriveFlag(roleId, "assignLeads"),
            deleteLeads: deriveFlag(roleId, "deleteLeads"),
            returnToPool: deriveFlag(roleId, "returnToPool"),
            manageLeadNotes: deriveFlag(roleId, "manageLeadNotes"),
            manageTeams: deriveFlag(roleId, "manageTeams"),
            editSettings: deriveFlag(roleId, "editSettings"),
            editSensitiveFields: deriveFlag(roleId, "editSensitiveFields"),
            viewInternalFields: deriveFlag(roleId, "viewInternalFields"),
            editInternalFields: deriveFlag(roleId, "editInternalFields"),
            viewReports: deriveFlag(roleId, "viewReports"),
            viewAudit: deriveFlag(roleId, "viewAudit"),
            viewContracts: deriveFlag(roleId, "viewContracts"),
            manageContracts: deriveFlag(roleId, "manageContracts"),
          }



            return {
              id: roleId,
              name: (role.name as string) ?? "未命名角色",
              dataScope,
              usersCount: userCountByRole.get(roleId) ?? 0,
              isSystem: (role.is_system as boolean) ?? false,
              roleType,
              permissions,
            }
          })

          setRoles(nextRoles.length > 0 ? nextRoles : initialRoles)
          setLoadError(null)
        }

        if (fieldPoliciesResult.error) {
          console.error("Failed to load field_policies", fieldPoliciesResult.error)
        } else {
          const rows = (fieldPoliciesResult.data ?? []) as any[]
          setFieldPolicies(
            rows.map((row) => ({
              resource: (row.resource as string) ?? "",
              field: (row.field as string) ?? "",
              readPermissionKey: (row.read_permission_key as string | null) ?? null,
              writePermissionKey: (row.write_permission_key as string | null) ?? null,
              maskStrategy: (row.mask_strategy as string) ?? "null",
            })),
          )
        }

        if (scopeSetsResult.error) {
          console.error("Failed to load custom_scope_sets", scopeSetsResult.error)
        } else {
          const rows = (scopeSetsResult.data ?? []) as any[]
          setScopeSets(
            rows.map((row) => ({
              id: row.id as string,
              name: (row.name as string) ?? "未命名范围集",
              resource: (row.resource as string) ?? "",
              definition: row.definition,
            })),
          )
        }

        if (profilesPublicResult.error) {
          console.error("Failed to load profiles_public_view for user override options", profilesPublicResult.error)
        } else {
          const rows = (profilesPublicResult.data ?? []) as any[]
          setUserOptions(
            rows.map((row) => ({
              id: row.id as string,
              name: (row.full_name as string) ?? "未填写姓名",
            })),
          )
        }
      } catch (error) {
        console.error("Failed to load permissions-related metadata", error)
        if (isMounted) {
          setLoadError("加载权限相关配置失败，请稍后重试或联系管理员")
          setRoles(initialRoles)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadRolesAndPermissions()

    return () => {
      isMounted = false
    }
  }, [])

  const handleEditRole = (role: Role) => {
    setRoleSaveError(null)
    const snapshot: Role = {
      ...role,
      permissions: { ...role.permissions },
    }

    // 计算与推荐模板的差异数量，用于在 UI 中展示
    const template = RECOMMENDED_ROLE_TEMPLATES[snapshot.roleType]
    if (template) {
      let diff = 0
      if (template.dataScope && template.dataScope !== snapshot.dataScope) {
        diff++
      }
      for (const key of Object.keys(snapshot.permissions) as (keyof RolePermissionFlags)[]) {
        const expected = template.permissions[key]
        if (typeof expected === "boolean" && expected !== snapshot.permissions[key]) {
          diff++
        }
      }
      setRecommendedDiffCount(diff)
    } else {
      setRecommendedDiffCount(0)
    }

    setEditingRole(snapshot)
    setEditingRoleOriginal(snapshot)
    setSheetOpen(true)
  }

  const requestCloseSheet = () => {
    if (isSaving) return
    if (hasUnsavedChanges && !window.confirm("你有未保存的修改，确定要关闭吗？")) return

    setSheetOpen(false)
    setEditingRole(null)
    setEditingRoleOriginal(null)
    setRoleSaveError(null)
  }

  const handleSheetOpenChange = (open: boolean) => {
    if (open) {
      setSheetOpen(true)
      return
    }

    requestCloseSheet()
  }

  const handleSaveRole = async () => {
    if (!editingRole) return
    if (isSaving) return

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()

      const existing = roles.find((r) => r.id === editingRole.id)
      if (existing && (existing.name !== editingRole.name || existing.roleType !== editingRole.roleType)) {
        const { error: updateRoleError } = await supabase
          .from("roles")
          .update({ name: editingRole.name, role_type: editingRole.roleType })
          .eq("id", editingRole.id)

        if (updateRoleError) {
          console.error("Failed to update role name", updateRoleError)
          const friendly = mapRpcError(updateRoleError, {
            title: "保存失败",
            description: "更新角色名称时出错，请稍后重试",
          })
          setRoleSaveError(friendly)
          toast.error(friendly.title, { description: friendly.description })
          return
        }
      }

      const scopeType = DATA_SCOPE_TO_SCOPE_TYPE[editingRole.dataScope]

      const items: RolePermissionMatrixItem[] = []

      const coreLeadKeys = ["leads.read", "leads.update", "leads.assign", "leads.transfer", "leads.close"]
      for (const key of coreLeadKeys) {
        items.push({
          permission_key: key,
          effect: "allow",
          scope_type: scopeType,
        })
      }

      const pushToggle = (toggleKey: PermissionToggleKey, enabled: boolean, overrideScopeType?: ScopeType) => {
        const permissionKeys = PERMISSION_KEY_MAP[toggleKey]
        for (const permissionKey of permissionKeys) {
          items.push({
            permission_key: permissionKey,
            effect: enabled ? "allow" : null,
            scope_type: overrideScopeType ?? scopeType,
          })
        }
      }

      pushToggle("createLeads", editingRole.permissions.createLeads)
      pushToggle("updateLeads", editingRole.permissions.updateLeads)
      pushToggle("closeLeads", editingRole.permissions.closeLeads)
      pushToggle("viewUnmaskedPhone", editingRole.permissions.viewUnmaskedPhone)
      pushToggle("exportData", editingRole.permissions.exportData, "org")
      pushToggle("importLeads", editingRole.permissions.importLeads, "org")
      pushToggle("assignLeads", editingRole.permissions.assignLeads)
      pushToggle("deleteLeads", editingRole.permissions.deleteLeads, "org")
      pushToggle("returnToPool", editingRole.permissions.returnToPool)
      pushToggle("manageLeadNotes", editingRole.permissions.manageLeadNotes)
      pushToggle("manageTeams", editingRole.permissions.manageTeams, "org")
      pushToggle("editSettings", editingRole.permissions.editSettings, "org")
      pushToggle("editSensitiveFields", editingRole.permissions.editSensitiveFields)
      pushToggle("viewInternalFields", editingRole.permissions.viewInternalFields)
      pushToggle("editInternalFields", editingRole.permissions.editInternalFields)
      pushToggle("viewReports", editingRole.permissions.viewReports)
      pushToggle("viewAudit", editingRole.permissions.viewAudit)
      pushToggle("viewContracts", editingRole.permissions.viewContracts)
      pushToggle("manageContracts", editingRole.permissions.manageContracts)


      const { error: rpcError } = await rpcRolePermissionsSetMatrix(editingRole.id, items)


      if (rpcError) {
        console.error("Failed to save role permission matrix", rpcError)
        const friendly = mapRpcError(rpcError, {
          title: "保存失败",
          description: "更新角色权限矩阵时出错，请稍后重试",
        })
        setRoleSaveError(friendly)
        toast.error(friendly.title, { description: friendly.description })
        return
      }

      setRoleSaveError(null)

      let nextRole: Role = editingRole
      const { data: refreshed, error: refreshError } = await rpcGetRolePermissions(editingRole.id)
      if (refreshError || !refreshed?.permissions) {
        console.error("Failed to refresh role permissions via RPC", refreshError)
      } else {
        const perms = refreshed.permissions
        const targetKeys = ["leads.read", "leads.update", "leads.assign", "leads.transfer", "leads.close"]
        const match = perms.find((p) => p.effect === "allow" && targetKeys.includes(p.permission_key))
        const scope = (match?.scope_type ?? "self") as ScopeType

        const nextDataScope: DataScope = scope === "org" ? "all" : scope === "team" ? "team" : "own"

        const deriveFlagFromPerms = (toggleKey: PermissionToggleKey) => {
          const mappedKeys = PERMISSION_KEY_MAP[toggleKey]
          return perms.some((p) => p.effect === "allow" && mappedKeys.includes(p.permission_key as any))
        }

        nextRole = {
          ...editingRole,
          dataScope: nextDataScope,
          permissions: {
            createLeads: deriveFlagFromPerms("createLeads"),
            updateLeads: deriveFlagFromPerms("updateLeads"),
            closeLeads: deriveFlagFromPerms("closeLeads"),
            viewUnmaskedPhone: deriveFlagFromPerms("viewUnmaskedPhone"),
            exportData: deriveFlagFromPerms("exportData"),
            importLeads: deriveFlagFromPerms("importLeads"),
            assignLeads: deriveFlagFromPerms("assignLeads"),
            deleteLeads: deriveFlagFromPerms("deleteLeads"),
            returnToPool: deriveFlagFromPerms("returnToPool"),
            manageLeadNotes: deriveFlagFromPerms("manageLeadNotes"),
            manageTeams: deriveFlagFromPerms("manageTeams"),
            editSettings: deriveFlagFromPerms("editSettings"),
            editSensitiveFields: deriveFlagFromPerms("editSensitiveFields"),
            viewInternalFields: deriveFlagFromPerms("viewInternalFields"),
            editInternalFields: deriveFlagFromPerms("editInternalFields"),
            viewReports: deriveFlagFromPerms("viewReports"),
            viewAudit: deriveFlagFromPerms("viewAudit"),
            viewContracts: deriveFlagFromPerms("viewContracts"),
            manageContracts: deriveFlagFromPerms("manageContracts"),
          },

        }
      }

      setRoles((prev) => prev.map((r) => (r.id === editingRole.id ? nextRole : r)))
      setSheetOpen(false)
      setEditingRole(null)
      setEditingRoleOriginal(null)
      toast.success("权限设置已保存")
    } catch (error) {
      console.error("Unexpected error while saving role", error)
      toast.error("保存失败", { description: "保存角色权限时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()
      const { data, error } = await supabase
        .from("roles")
        .insert({ name: newRoleName.trim(), is_system: false, is_active: true, role_type: "sales_rep" })
        .select("id, name, is_system, is_active, role_type")
        .single()

      if (error || !data) {
        console.error("Failed to create role", error)
        const message = error?.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:roles.manage")) {
          toast.error("创建失败", { description: "没有创建角色的权限，请联系系统管理员" })
        } else {
          toast.error("创建失败", { description: "创建角色时出错，请稍后重试" })
        }
        return
      }

      const newRole: Role = {
        id: data.id as string,
        name: (data.name as string) ?? newRoleName.trim(),
        dataScope: "own",
        usersCount: 0,
        isSystem: (data.is_system as boolean) ?? false,
        roleType: ((data.role_type as string) ?? "sales_rep") as Role["roleType"],
        permissions: {
          createLeads: false,
          updateLeads: false,
          closeLeads: false,
          viewUnmaskedPhone: false,
          exportData: false,
          assignLeads: false,
          deleteLeads: false,
          returnToPool: false,
          manageLeadNotes: false,
          manageTeams: false,
          editSettings: false,
          editSensitiveFields: false,
          viewInternalFields: false,
          editInternalFields: false,
          viewReports: false,
          viewAudit: false,
        },
      }

      const nextRoles = [...roles, newRole]
      setRoles(nextRoles)
      setNewRoleName("")
      setCreateDialogOpen(false)
      toast.success(`角色 "${newRole.name}" 已创建`)
      setEditingRole(newRole)
      setSheetOpen(true)
    } catch (error) {
      console.error("Unexpected error while creating role", error)
      toast.error("创建失败", { description: "创建角色时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteRole = async (roleId: string) => {
    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase
        .from("roles")
        .update({ is_active: false })
        .eq("id", roleId)

      if (error) {
        console.error("Failed to delete role", error)
        const message = error.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:roles.manage")) {
          toast.error("删除失败", { description: "没有删除角色的权限，请联系系统管理员" })
        } else {
          toast.error("删除失败", { description: "删除角色时出错，请稍后重试" })
        }
        return
      }

      setRoles(roles.filter((r) => r.id !== roleId))
      toast.success("角色已删除")
    } catch (error) {
      console.error("Unexpected error while deleting role", error)
      toast.error("删除失败", { description: "删除角色时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  const updatePermission = (key: keyof RolePermissionFlags, value: boolean) => {
    if (editingRole) {
      setEditingRole({
        ...editingRole,
        permissions: { ...editingRole.permissions, [key]: value },
      })
    }
  }

  const handleGroupToggle = (groupId: PermissionMatrixGroupId, value: boolean) => {
    PERMISSION_MATRIX_ROWS.filter((row) => row.groupId === groupId).forEach((row) => {
      updatePermission(row.key, value)
    })
  }

  const filteredUserOptions = userOptions.filter((u) =>
    userSearchKeyword ? u.name.toLowerCase().includes(userSearchKeyword.toLowerCase()) : true,
  )

  const handleLoadUserPermissions = async (userId: string, userName: string) => {
    try {
      setIsLoadingUserPerms(true)
      const supabase = getBrowserSupabaseClient()

      const { data, error } = await supabase.rpc("rpc_permissions_preview", {
        p_user_id: userId,
      })

      if (error || !data) {
        console.error("Failed to load permissions preview", error)
        const message = error?.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:profiles.manage")) {
          toast.error("加载失败", { description: "当前账号无权查看用户权限，请联系系统管理员开通 profiles.manage" })
        } else {
          toast.error("加载失败", { description: "加载用户权限预览失败，请稍后重试" })
        }
        return
      }

      const permissions = ((data as any).permissions ?? []) as any[]
      const previewItems: PermissionPreviewItem[] = permissions.map((item) => ({
        key: item.key as string,
        allowed: Boolean(item.allowed),
        scope: item.scope ?? null,
      }))

      const overrides: UserOverrideRow[] = previewItems.map((item) => ({
        permissionKey: item.key,
        effect: "inherit",
        expiresAt: null,
        reason: "",
      }))

      setSelectedUserId(userId)
      setSelectedUserName(userName)
      setUserPermissions(previewItems)
      setUserOverrides(overrides)
    } catch (error) {
      console.error("Unexpected error while loading permissions preview", error)
      toast.error("加载失败", { description: "加载用户权限预览时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsLoadingUserPerms(false)
    }
  }

  const handleSaveUserOverrides = async () => {
    if (!selectedUserId) return

    try {
      setIsSavingUserOverrides(true)
      const supabase = getBrowserSupabaseClient()

      const items = userOverrides
        .filter((row) => row.effect !== "inherit")
        .map((row) => ({
          permission_key: row.permissionKey,
          effect: row.effect === "inherit" ? "unset" : row.effect,
          expires_at: row.expiresAt,
          reason: row.reason || null,
        }))

      const { error } = await supabase.rpc("rpc_user_permissions_set", {
        p_user_id: selectedUserId,
        p_items: items,
      })

      if (error) {
        console.error("Failed to save user permission overrides", error)
        const message = error.message ?? ""
        if (message.includes("ERR_NO_PERMISSION:user_permissions.manage")) {
          toast.error("保存失败", { description: "没有管理用户覆盖权限的权限，请联系系统管理员开通 user_permissions.manage" })
        } else {
          toast.error("保存失败", { description: "更新用户覆盖权限时出错，请稍后重试" })
        }
        return
      }

      toast.success("用户覆盖权限已保存")
    } catch (error) {
      console.error("Unexpected error while saving user overrides", error)
      toast.error("保存失败", { description: "保存用户覆盖权限时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSavingUserOverrides(false)
    }
  }

  const handleSaveFieldPolicies = async () => {
    try {
      setIsSavingFieldPolicies(true)
      const supabase = getBrowserSupabaseClient()

      const groupedByResource = new Map<string, FieldPolicyRow[]>()
      for (const row of fieldPolicies) {
        const list = groupedByResource.get(row.resource) ?? []
        list.push(row)
        groupedByResource.set(row.resource, list)
      }

      for (const [resource, rows] of groupedByResource.entries()) {
        const items = rows.map((row) => ({
          field: row.field,
          read_permission_key: row.readPermissionKey,
          write_permission_key: row.writePermissionKey,
          mask_strategy: row.maskStrategy,
          enabled: true,
        }))

        const { error } = await supabase.rpc("rpc_field_policies_set", {
          p_resource: resource,
          p_items: items,
        })

        if (error) {
          console.error("Failed to save field policies", error)
          const message = error.message ?? ""
          if (message.includes("ERR_NO_PERMISSION:field_policies.manage")) {
            toast.error("保存失败", { description: "没有管理字段策略的权限，请联系系统管理员开通 field_policies.manage" })
          } else {
            toast.error("保存失败", { description: "更新字段策略时出错，请稍后重试" })
          }
          return
        }
      }

      toast.success("字段策略已保存")
    } catch (error) {
      console.error("Unexpected error while saving field policies", error)
      toast.error("保存失败", { description: "保存字段策略时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSavingFieldPolicies(false)
    }
  }

  const handleSaveScopeSets = async () => {
    try {
      setIsSavingScopeSets(true)
      const supabase = getBrowserSupabaseClient()

      const groupedByResource = new Map<string, ScopeSetRow[]>()
      for (const row of scopeSets) {
        const list = groupedByResource.get(row.resource) ?? []
        list.push(row)
        groupedByResource.set(row.resource, list)
      }

      for (const [resource, rows] of groupedByResource.entries()) {
        const items = rows.map((row) => ({
          id: row.id,
          name: row.name,
          definition: row.definition,
          deleted: false,
        }))

        const { error } = await supabase.rpc("rpc_scope_sets_set", {
          p_resource: resource,
          p_items: items,
        })

        if (error) {
          console.error("Failed to save scope sets", error)
          const message = error.message ?? ""
          if (message.includes("ERR_NO_PERMISSION:scopes.manage")) {
            toast.error("保存失败", { description: "没有管理范围集的权限，请联系系统管理员开通 scopes.manage" })
          } else {
            toast.error("保存失败", { description: "更新自定义范围集时出错，请稍后重试" })
          }
          return
        }
      }

      toast.success("自定义范围已保存")
    } catch (error) {
      console.error("Unexpected error while saving scope sets", error)
      toast.error("保存失败", { description: "保存自定义范围时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSavingScopeSets(false)
    }
  }

  const handleAddScopeSet = () => {
    const name = newScopeSetName.trim()
    if (!name) {
      toast.error("创建失败", { description: "请填写范围集名称" })
      return
    }

    let definition: any
    try {
      definition = JSON.parse(newScopeSetDefinition)
    } catch (error) {
      toast.error("创建失败", { description: "自定义范围 JSON 解析失败，请检查格式" })
      return
    }

    setScopeSets((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name,
        resource: "leads",
        definition,
      },
    ])
    setNewScopeSetName("")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">角色管理</h3>
          <p className="text-sm text-muted-foreground">权限配置已收敛到「角色权限矩阵」；用户覆盖权限 / 字段策略 / 自定义范围集暂不提供 UI 入口</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              创建角色
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建新角色</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="newRoleName">角色名称</Label>
              <Input
                id="newRoleName"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="输入角色名称"
                className="mt-2"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreateRole}>创建</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold">角色名称</TableHead>
              <TableHead className="text-xs font-semibold">数据范围</TableHead>
              <TableHead className="text-center text-xs font-semibold">用户数</TableHead>
              <TableHead className="w-[100px] text-xs font-semibold">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id} className="text-sm">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{role.name}</span>
                    {role.isSystem && (
                      <Badge variant="secondary" className="text-[11px]">
                        系统
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[11px]">{dataScopeLabels[role.dataScope]}</Badge>
                </TableCell>
                <TableCell className="text-center font-medium">{role.usersCount}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditRole(role)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    {!role.isSystem && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteRole(role.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>


      <Card className="border-dashed bg-muted/20">
        <CardHeader>
          <CardTitle className="text-base font-bold">权限入口收敛说明</CardTitle>
          <CardDescription className="text-sm">
            本版本仅开放「角色权限矩阵」作为权限配置入口；用户覆盖权限 / 字段策略 / 自定义范围集暂不对普通用户开放。
          </CardDescription>
        </CardHeader>
      </Card>


      {/* Permission Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="text-xl font-bold">编辑角色权限</SheetTitle>
          </SheetHeader>

          {editingRole && (
            <ScrollArea className="h-[calc(100vh-180px)] pr-4">
              <div className="space-y-6 py-6 px-6">

                {roleSaveError && (
                  <Alert variant="destructive">
                    <AlertTriangle />
                    <AlertTitle>{roleSaveError.title}</AlertTitle>
                    <AlertDescription>
                      <p>{roleSaveError.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={handleSaveRole} disabled={isSaving}>
                          {isSaving ? "保存中..." : "重试保存"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRoleSaveError(null)}
                          disabled={isSaving}
                        >
                          关闭
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-col gap-6">
                  <div className="space-y-6">
                    {/* Basic Info */}
                    <div className="space-y-4">
                      <h4 className="text-base font-bold flex items-center gap-2">
                        <UserCog className="w-4.5 h-4.5" />
                        基本信息
                      </h4>
                      <div className="space-y-3 pl-6">
                        <div className="space-y-2">
                          <Label htmlFor="roleName" className="text-sm font-medium">角色名称</Label>
                          <Input
                            id="roleName"
                            value={editingRole.name}
                            onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">角色类型</Label>
                          <Select
                            value={editingRole.roleType}
                            onValueChange={(value: Role["roleType"]) =>
                              setEditingRole({ ...editingRole, roleType: value })
                            }
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sales_rep">销售顾问 / 一线销售</SelectItem>
                              <SelectItem value="sales_manager">销售经理 / 主管</SelectItem>
                              <SelectItem value="marketing">市场角色</SelectItem>
                              <SelectItem value="biz_owner">业务负责人 / 总经理</SelectItem>
                              <SelectItem value="tech_maintainer">技术维护 / 系统维护</SelectItem>
                              <SelectItem value="other">其他（自定义组合）</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">数据范围</Label>
                          <Select
                            value={editingRole.dataScope}
                            onValueChange={(value: "all" | "team" | "own") =>
                              setEditingRole({ ...editingRole, dataScope: value })
                            }
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">
                                <div className="flex items-center gap-2">
                                  <Globe className="w-4 h-4" />
                                  全部数据
                                </div>
                              </SelectItem>
                              <SelectItem value="team">
                                <div className="flex items-center gap-2">
                                  <Users className="w-4 h-4" />
                                  团队数据
                                </div>
                              </SelectItem>
                              <SelectItem value="own">
                                <div className="flex items-center gap-2">
                                  <Lock className="w-4 h-4" />
                                  仅本人
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-6">
                    {/* Data Security Permissions */}
                    <div className="space-y-4">
                      <h4 className="text-base font-bold flex items-center gap-2">
                        <Database className="w-4.5 h-4.5" />
                        数据安全
                      </h4>
                      <div className="space-y-3 pl-6">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-sm font-medium">查看完整手机号</Label>
                            <p className="text-xs text-muted-foreground">允许查看未脱敏的客户电话</p>
                          </div>
                          <Switch
                            checked={editingRole.permissions.viewUnmaskedPhone}
                            onCheckedChange={(checked) => updatePermission("viewUnmaskedPhone", checked)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-sm font-medium">导出数据</Label>
                            <p className="text-xs text-muted-foreground">允许导出线索和客户数据</p>
                          </div>
                          <Switch
                            checked={editingRole.permissions.exportData}
                            onCheckedChange={(checked) => updatePermission("exportData", checked)}
                          />
                        </div>
                      </div>
                    </div>


                    <Separator />

                    {/* Operation & Management Permission Matrix */}
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <h4 className="text-base font-bold flex items-center gap-2">
                            <Eye className="w-4.5 h-4.5" />
                            业务 & 管理操作权限
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            推荐先根据角色类型应用一份基础模板，再按需要微调个别开关。
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <Badge variant={recommendedDiffCount === 0 ? "default" : "outline"} className="text-[11px]">
                              {recommendedDiffCount === 0
                                ? "当前配置与推荐模板一致"
                                : `与推荐模板有 ${recommendedDiffCount} 项差异`}
                            </Badge>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                              disabled={!editingRole}
                              onClick={() => {

                                if (!editingRole) return
                                const template = RECOMMENDED_ROLE_TEMPLATES[editingRole.roleType]
                                if (!template) return

                                const mergedPermissions: RolePermissionFlags = {
                                  ...editingRole.permissions,
                                  ...template.permissions,
                                }

                                const nextRole: Role = {
                                  ...editingRole,
                                  dataScope: template.dataScope ?? editingRole.dataScope,
                                  permissions: mergedPermissions,
                                }

                                // 应用模板后重新计算与推荐配置差异
                                let diff = 0
                                if (template.dataScope && template.dataScope !== nextRole.dataScope) {
                                  diff++
                                }
                                for (const key of Object.keys(nextRole.permissions) as (keyof RolePermissionFlags)[]) {
                                  const expected = template.permissions[key]
                                  if (typeof expected === "boolean" && expected !== nextRole.permissions[key]) {
                                    diff++
                                  }
                                }
                                setRecommendedDiffCount(diff)

                                setEditingRole(nextRole)
                              }}
                            >
                              应用推荐配置
                            </Button>
                          </div>
                        </div>
                        <div className="relative w-40">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            placeholder="搜索权限..."
                            className="pl-7 h-8 text-xs bg-background"
                            value={permissionSearch}
                            onChange={(event) => setPermissionSearch(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-4 rounded-md border bg-muted/30 p-3">
                        {PERMISSION_MATRIX_GROUPS.map((group) => {
                          const groupRows = PERMISSION_MATRIX_ROWS.filter((row) => row.groupId === group.id).filter(
                            (row) => {
                              if (!permissionSearch.trim()) return true
                              const keyword = permissionSearch.trim()
                              return row.label.includes(keyword) || row.description.includes(keyword)
                            },
                          )

                          if (groupRows.length === 0) {
                            return null
                          }

                          const allChecked = groupRows.every((row) => editingRole?.permissions[row.key] === true)
                          const someChecked = groupRows.some((row) => editingRole?.permissions[row.key] === true)

                          return (
                            <div key={group.id} className="space-y-2">
                              <div className="flex items-center justify-between px-1">
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-2">
                                    {group.id === "operation" ? (
                                      <Eye className="w-4 h-4 text-primary" />
                                    ) : (
                                      <Shield className="w-4 h-4 text-primary" />
                                    )}
                                    <span className="text-sm font-semibold text-foreground">{group.title}</span>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">{group.description}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px] hover:bg-background"
                                    onClick={() => handleGroupToggle(group.id, !allChecked)}
                                  >
                                    {allChecked ? "清空本组" : "全选本组"}
                                  </Button>
                                </div>
                              </div>
                              <div className="rounded-md border bg-background/60 shadow-sm overflow-hidden">
                                <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_auto] gap-2 px-3 py-2.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/20">
                                  <span>权限点</span>
                                  <span>核心说明</span>
                                  <span className="text-center">启用</span>
                                </div>
                                <Separator />
                                <div className="divide-y divide-border/40">
                                  {groupRows.map((row) => (
                                    <div
                                      key={row.key}
                                      className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_auto] items-center gap-2 px-3 py-2.5 hover:bg-muted/10 transition-colors"
                                    >
                                      <div className="text-sm font-medium text-foreground">{row.label}</div>
                                      <div className="text-xs text-muted-foreground">{row.description}</div>
                                      <div className="flex justify-center">
                                        <Switch
                                          checked={!!editingRole?.permissions[row.key]}
                                          onCheckedChange={(checked) => updatePermission(row.key, checked)}
                                          className="scale-90"
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )
                        })}

                        {permissionSearch.trim() &&
                          !PERMISSION_MATRIX_GROUPS.some((group) => {
                            const groupRows = PERMISSION_MATRIX_ROWS.filter((row) => row.groupId === group.id).filter(
                              (row) => {
                                const keyword = permissionSearch.trim()
                                return row.label.includes(keyword) || row.description.includes(keyword)
                              },
                            )
                            return groupRows.length > 0
                          }) && (
                            <p className="text-xs text-muted-foreground text-center py-4">
                              未找到匹配的权限，请尝试更换关键词
                            </p>
                          )}
                      </div>
                    </div>

                    <Separator />

                    {/* Field Permissions */}
                    <div className="space-y-3">
                      <h4 className="text-base font-bold flex items-center gap-2">
                        <Database className="w-4.5 h-4.5" />
                        字段权限
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        字段权限决定不同角色是否可以查看或编辑敏感/内部字段，实际控制仍由后端安全视图、字段策略与 RLS 统一约束，这里的开关仅用于配置角色是否具备对应字段级权限 Key。
                      </p>
                      <div className="mt-2 rounded-md border bg-muted/30 shadow-sm overflow-hidden">
                        <div className="grid grid-cols-[minmax(0,1.6fr)_auto_auto] gap-2 px-4 py-2.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/20">
                          <span>字段分组</span>
                          <span className="text-center">可见</span>
                          <span className="text-center">可编辑</span>
                        </div>
                        <Separator />
                        <div className="divide-y divide-border/40">
                          <div className="grid grid-cols-[minmax(0,1.6fr)_auto_auto] items-center gap-2 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                            <div className="text-sm font-medium text-foreground">
                              敏感字段（手机号 / 邮箱 / 预算 / 详细地址）
                            </div>
                            <div className="flex justify-center">
                              <Switch
                                checked={!!editingRole?.permissions.viewUnmaskedPhone}
                                onCheckedChange={(checked) => updatePermission("viewUnmaskedPhone", checked)}
                                aria-label="敏感字段可见性由 leads.fields.read_sensitive 控制"
                                className="scale-90"
                              />
                            </div>
                            <div className="flex justify-center">
                              <Switch
                                checked={!!editingRole?.permissions.editSensitiveFields}
                                onCheckedChange={(checked) => updatePermission("editSensitiveFields", checked)}
                                aria-label="敏感字段可编辑性由 leads.fields.write_sensitive 控制"
                                className="scale-90"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1.6fr)_auto_auto] items-center gap-2 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                            <div className="text-sm font-medium text-foreground">内部字段（内部评分 / 黑名单原因）</div>
                            <div className="flex justify-center">
                              <Switch
                                checked={!!editingRole?.permissions.viewInternalFields}
                                onCheckedChange={(checked) => updatePermission("viewInternalFields", checked)}
                                aria-label="内部字段可见性由 leads.fields.read_internal 控制"
                                className="scale-90"
                              />
                            </div>
                            <div className="flex justify-center">
                              <Switch
                                checked={!!editingRole?.permissions.editInternalFields}
                                onCheckedChange={(checked) => updatePermission("editInternalFields", checked)}
                                aria-label="内部字段可编辑性由 leads.fields.write_internal 控制"
                                className="scale-90"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </ScrollArea>
          )}

          <SheetFooter className="absolute bottom-0 left-0 right-0 p-6 bg-background border-t">
            <Button variant="outline" onClick={requestCloseSheet} disabled={isSaving}>
              取消
            </Button>
            <Button onClick={handleSaveRole} disabled={isSaving}>
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "保存中..." : "保存权限"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
