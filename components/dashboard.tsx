"use client"

import { useContext, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageCircle,
  PhoneCall,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { MePermissionsContext } from "@/components/app-root"
import { SalesFunnel } from "@/components/sales-funnel"
import { ChartSkeleton, KPICardSkeleton, TableSkeleton } from "@/components/skeleton-loaders"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fetchCurrentUserProfile, fetchCurrentUserPublicProfile } from "@/lib/auth/profile"
import {
  fetchDashboardSummary,
  fetchRoleDashboardActivity,
  type DailyActivityUserRow,
  type DashboardCustomerDetailRow,
  type DashboardAlert,
  type DashboardSummary,
  type RoleDashboardActivity,
} from "@/lib/services/dashboard"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type RoleDashboardMode = "sales" | "manager" | "director"
type TimeRangePreset = "today" | "yesterday" | "week" | "month" | "custom"

interface KpiDefinition {
  key: keyof RoleDashboardActivity["totals"]
  title: string
  description: string
  icon: typeof Users
  tone: string
}

interface DashboardDateRange {
  start: Date
  end: Date
}

const MANAGER_KPIS: KpiDefinition[] = [
  { key: "newLeads", title: "今日新增线索", description: "当天录入并进入跟进范围", icon: UserPlus, tone: "text-blue-600 bg-blue-50" },
  { key: "contactActions", title: "建联行动", description: "电话和微信沟通记录", icon: PhoneCall, tone: "text-cyan-600 bg-cyan-50" },
  { key: "visits", title: "拜访客户", description: "线下拜访或深度拜访记录", icon: Users, tone: "text-violet-600 bg-violet-50" },
  { key: "qualifiedLeads", title: "有效线索", description: "L2+ 或 S/A/B 级线索", icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50" },
  { key: "wonLeads", title: "成交线索", description: "已进入成交结果", icon: TrendingUp, tone: "text-amber-600 bg-amber-50" },
  { key: "overdueLeads", title: "逾期未跟进", description: "超过下次跟进或风险阈值", icon: AlertTriangle, tone: "text-red-600 bg-red-50" },
]

const SALES_KPIS: KpiDefinition[] = [
  { key: "pendingToday", title: "今日待跟进", description: "下次跟进时间在今天", icon: CalendarClock, tone: "text-blue-600 bg-blue-50" },
  { key: "overdueLeads", title: "逾期未跟进", description: "需要优先补动作", icon: AlertTriangle, tone: "text-red-600 bg-red-50" },
  { key: "newlyAssigned", title: "新分配/更新", description: "今日有新变化的线索", icon: UserPlus, tone: "text-violet-600 bg-violet-50" },
  { key: "contactActions", title: "今日建联", description: "电话和微信动作", icon: PhoneCall, tone: "text-cyan-600 bg-cyan-50" },
  { key: "visits", title: "今日拜访", description: "拜访类客户动作", icon: Users, tone: "text-emerald-600 bg-emerald-50" },
  { key: "followUps", title: "今日跟进", description: "全部有效跟进记录", icon: MessageCircle, tone: "text-amber-600 bg-amber-50" },
]

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "0"
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "¥0"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value)
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return formatDateInput(date)
}

function getPresetRange(preset: TimeRangePreset): DashboardDateRange {
  const now = new Date()
  const today = startOfLocalDay(now)
  if (preset === "yesterday") {
    const start = addDays(today, -1)
    return { start, end: today }
  }
  if (preset === "week") {
    const day = today.getDay() || 7
    const start = addDays(today, 1 - day)
    return { start, end: addDays(today, 1) }
  }
  if (preset === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    return { start, end: addDays(today, 1) }
  }
  return { start: today, end: addDays(today, 1) }
}

function getRangeLabel(range: DashboardDateRange): string {
  const start = formatDateInput(range.start)
  const endInclusive = formatDateInput(addDays(range.end, -1))
  return start === endInclusive ? start : `${start} 至 ${endInclusive}`
}

function getModeLabel(mode: RoleDashboardMode): string {
  if (mode === "sales") return "个人工作台"
  if (mode === "manager") return "团队管理工作台"
  return "业务总经理工作台"
}

function getAlertClassName(alert: DashboardAlert): string {
  if (alert.type === "danger") return "border-red-200 bg-red-50 text-red-900"
  if (alert.type === "warning") return "border-amber-200 bg-amber-50 text-amber-900"
  return "border-blue-200 bg-blue-50 text-blue-900"
}

function KpiGrid({
  activity,
  mode,
}: {
  activity: RoleDashboardActivity | null
  mode: RoleDashboardMode
}) {
  const kpis = mode === "sales" ? SALES_KPIS : MANAGER_KPIS

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
      {kpis.map((item) => {
        const Icon = item.icon
        const value = activity?.totals[item.key] ?? 0
        return (
          <Card key={item.key} className="border-muted-foreground/10 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold tracking-tight">{formatNumber(value)}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                </div>
                <div className={`rounded-lg p-2 ${item.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function TimeRangeControls({
  preset,
  range,
  onPresetChange,
  onCustomRangeChange,
}: {
  preset: TimeRangePreset
  range: DashboardDateRange
  onPresetChange: (preset: TimeRangePreset) => void
  onCustomRangeChange: (range: DashboardDateRange) => void
}) {
  const presets: { key: TimeRangePreset; label: string }[] = [
    { key: "today", label: "今日" },
    { key: "yesterday", label: "昨日" },
    { key: "week", label: "本周" },
    { key: "month", label: "本月" },
    { key: "custom", label: "自定义" },
  ]

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">时间维度</p>
          <p className="text-xs text-muted-foreground">统计范围：{getRangeLabel(range)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onPresetChange(item.key)}
              className={`h-9 rounded-md border px-3 text-sm font-medium transition-colors ${
                preset === item.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={formatDateInput(range.start)}
                onChange={(event) => {
                  const nextStart = new Date(event.target.value)
                  if (!Number.isNaN(nextStart.getTime())) {
                    onCustomRangeChange({ start: nextStart, end: range.end <= nextStart ? addDays(nextStart, 1) : range.end })
                  }
                }}
                className="h-9 w-[150px]"
              />
              <span className="text-xs text-muted-foreground">至</span>
              <Input
                type="date"
                value={formatDateInput(addDays(range.end, -1))}
                onChange={(event) => {
                  const selected = new Date(event.target.value)
                  if (!Number.isNaN(selected.getTime())) {
                    const nextEnd = addDays(selected, 1)
                    onCustomRangeChange({ start: nextEnd <= range.start ? addDays(nextEnd, -1) : range.start, end: nextEnd })
                  }
                }}
                className="h-9 w-[150px]"
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ActivityTable({ users, mode }: { users: DailyActivityUserRow[]; mode: RoleDashboardMode }) {
  const rows = mode === "sales" ? users.slice(0, 1) : users

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="text-lg">{mode === "sales" ? "我的今日动作" : "业务人员每日动作表"}</CardTitle>
        <CardDescription>
          按人员聚合今日线索录入、建联、拜访、跟进和逾期情况。
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-[460px] overflow-auto p-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="min-w-[160px]">业务人员</TableHead>
              <TableHead className="text-right">新增线索</TableHead>
              <TableHead className="text-right">建联</TableHead>
              <TableHead className="text-right">拜访</TableHead>
              <TableHead className="text-right">跟进</TableHead>
              <TableHead className="text-right">有效线索</TableHead>
              <TableHead className="text-right">成交</TableHead>
              <TableHead className="text-right">逾期</TableHead>
              <TableHead className="text-right">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  暂无可统计的业务人员数据
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const actionTotal = row.newLeads + row.contactActions + row.visits + row.followUps
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt={row.name} /> : null}
                          <AvatarFallback className="text-xs font-semibold">
                            {row.name.trim().slice(0, 1) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-semibold">{row.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{row.newLeads}</TableCell>
                    <TableCell className="text-right font-medium">{row.contactActions}</TableCell>
                    <TableCell className="text-right font-medium">{row.visits}</TableCell>
                    <TableCell className="text-right font-medium">{row.followUps}</TableCell>
                    <TableCell className="text-right font-medium">{row.qualifiedLeads}</TableCell>
                    <TableCell className="text-right font-medium">{row.wonLeads}</TableCell>
                    <TableCell className="text-right font-medium text-red-600">{row.overdueLeads}</TableCell>
                    <TableCell className="text-right">
                      {row.overdueLeads > 0 ? (
                        <Badge variant="destructive">需关注</Badge>
                      ) : actionTotal > 0 ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">正常</Badge>
                      ) : (
                        <Badge variant="secondary">暂无动作</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function CustomerDetailsTable({ rows }: { rows: DashboardCustomerDetailRow[] }) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">客户明细</CardTitle>
            <CardDescription>按当前时间范围汇总的客户与跟进明细。</CardDescription>
          </div>
          <Badge variant="outline">最多展示 50 条</Badge>
        </div>
      </CardHeader>
      <CardContent className="max-h-[560px] overflow-auto p-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="min-w-[220px]">客户/企业</TableHead>
              <TableHead>联系人</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead>阶段</TableHead>
              <TableHead>级别</TableHead>
              <TableHead className="text-right">建联</TableHead>
              <TableHead className="text-right">拜访</TableHead>
              <TableHead className="text-right">跟进</TableHead>
              <TableHead>最近跟进</TableHead>
              <TableHead>下次跟进</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                  当前时间范围内暂无可展示的客户明细
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="max-w-[260px]">
                      <p className="truncate font-semibold text-foreground">{row.companyName}</p>
                      <p className="text-xs text-muted-foreground">创建：{formatDateLabel(row.createdAt)}</p>
                    </div>
                  </TableCell>
                  <TableCell>{row.contactName || "-"}</TableCell>
                  <TableCell>{row.ownerName}</TableCell>
                  <TableCell>{row.stage}</TableCell>
                  <TableCell>{row.grade ? <Badge variant="outline">{row.grade}</Badge> : "-"}</TableCell>
                  <TableCell className="text-right font-medium">{row.contactActions}</TableCell>
                  <TableCell className="text-right font-medium">{row.visits}</TableCell>
                  <TableCell className="text-right font-medium">{row.followUps}</TableCell>
                  <TableCell>{formatDateLabel(row.lastContactAt)}</TableCell>
                  <TableCell>{formatDateLabel(row.nextContactAt)}</TableCell>
                  <TableCell>
                    {row.isOverdue ? (
                      <Badge variant="destructive">逾期</Badge>
                    ) : row.isWon ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">成交</Badge>
                    ) : row.isQualified ? (
                      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">有效</Badge>
                    ) : (
                      <Badge variant="secondary">跟进中</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <a
                      href={`/leads/${row.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      查看
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AlertsPanel({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <Card className="h-full border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          需要关注
        </CardTitle>
        <CardDescription>按当前统计范围识别的重点事项。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {alerts.length === 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            当前暂无明显异常，继续保持跟进节奏。
          </div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className={`rounded-md border p-3 ${getAlertClassName(alert)}`}>
              <p className="text-sm font-semibold">{alert.title}</p>
              <p className="mt-1 text-xs leading-relaxed opacity-80">{alert.description}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function TrendChart({ activity }: { activity: RoleDashboardActivity | null }) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="h-4 w-4 text-blue-600" />
          最近 7 天过程趋势
        </CardTitle>
        <CardDescription>对比线索录入、建联行动和客户拜访走势。</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="h-[260px]">
          {!activity || activity.trends.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无趋势数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activity.trends} margin={{ top: 8, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                    boxShadow: "0 8px 18px rgb(15 23 42 / 0.12)",
                  }}
                />
                <Bar dataKey="newLeads" name="新增线索" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="contactActions" name="建联行动" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="visits" name="拜访客户" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ProcessFunnel({ activity }: { activity: RoleDashboardActivity | null }) {
  const items = [
    { label: "今日新增", value: activity?.funnel.newLeads ?? 0 },
    { label: "已建联", value: activity?.funnel.contacted ?? 0 },
    { label: "已拜访", value: activity?.funnel.visited ?? 0 },
    { label: "跟进中", value: activity?.funnel.inProgress ?? 0 },
    { label: "成交", value: activity?.funnel.won ?? 0 },
  ]
  const max = Math.max(...items.map((item) => item.value), 1)

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="text-lg">过程漏斗</CardTitle>
        <CardDescription>线索录入、建联、拜访、跟进与成交分布。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {items.map((item) => (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{item.label}</span>
              <span className="font-semibold">{item.value}</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 8 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function LegacySummaryCard({ summary }: { summary: DashboardSummary | null }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardContent className="p-4">
          <p className="text-2xl font-bold">{formatNumber(summary?.totalLeads ?? 0)}</p>
          <p className="mt-1 text-sm font-semibold">当前线索总数</p>
        </CardContent>
      </Card>
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardContent className="p-4">
          <p className="text-2xl font-bold">{(summary?.winRate ?? 0).toFixed(1)}%</p>
          <p className="mt-1 text-sm font-semibold">成交转化率</p>
        </CardContent>
      </Card>
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardContent className="p-4">
          <p className="text-2xl font-bold">{formatCurrency(summary?.monthlyRevenue ?? 0)}</p>
          <p className="mt-1 text-sm font-semibold">本月回款</p>
        </CardContent>
      </Card>
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardContent className="p-4">
          <p className="text-2xl font-bold text-red-600">{formatNumber(summary?.riskLeadCount ?? 0)}</p>
          <p className="mt-1 text-sm font-semibold">风险线索</p>
        </CardContent>
      </Card>
    </div>
  )
}

export function Dashboard() {
  const [isLoading, setIsLoading] = useState(true)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [activity, setActivity] = useState<RoleDashboardActivity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [welcomeText, setWelcomeText] = useState<string | null>(null)
  const [timePreset, setTimePreset] = useState<TimeRangePreset>("today")
  const [dateRange, setDateRange] = useState<DashboardDateRange>(() => getPresetRange("today"))
  const mePermissions = useContext(MePermissionsContext)

  const mode: RoleDashboardMode = useMemo(() => {
    const scopeType = mePermissions?.leadScopeType ?? "self"
    if ((scopeType === "org" || scopeType === "custom") && mePermissions?.canViewReports) return "director"
    if (scopeType === "team") return "manager"
    return "sales"
  }, [mePermissions])

  useEffect(() => {
    let isMounted = true

    async function loadDashboard() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const supabase = getBrowserSupabaseClient()
        const profile = await fetchCurrentUserProfile(supabase)
        const scopeType = mePermissions?.leadScopeType ?? "self"
        const params: { teamId?: number; ownerId?: string } = {}

        if (scopeType === "self" && profile?.id) {
          params.ownerId = profile.id
        } else if (scopeType === "team" && profile?.teamId != null) {
          params.teamId = profile.teamId
        }

        const [nextSummary, nextActivity] = await Promise.all([
          fetchDashboardSummary(params),
          fetchRoleDashboardActivity({
            ...params,
            startDate: dateRange.start.toISOString(),
            endDate: dateRange.end.toISOString(),
          }),
        ])

        if (!isMounted) return
        setSummary(nextSummary)
        setActivity(nextActivity)
      } catch (error) {
        console.error("Failed to load role dashboard", error)
        if (!isMounted) return
        setLoadError("仪表盘数据加载失败，请稍后重试。")
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    void loadDashboard()

    return () => {
      isMounted = false
    }
  }, [mePermissions, dateRange])

  useEffect(() => {
    let isMounted = true

    async function loadWelcomeText() {
      try {
        const supabase = getBrowserSupabaseClient()
        const publicProfile = await fetchCurrentUserPublicProfile(supabase)
        const displayName = publicProfile?.fullName || publicProfile?.email || "伙伴"
        if (isMounted) {
          setWelcomeText(`${displayName} · ${getModeLabel(mode)}`)
        }
      } catch (err) {
        console.error("Unexpected error while building dashboard welcome text", err)
        if (isMounted) setWelcomeText(getModeLabel(mode))
      }
    }

    void loadWelcomeText()

    return () => {
      isMounted = false
    }
  }, [mode])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">正在同步今日过程数据...</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <KPICardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <TableSkeleton rows={5} />
          <ChartSkeleton />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {activity?.dateLabel ?? "今日"}
            </Badge>
            <Badge>{getModeLabel(mode)}</Badge>
          </div>
          <p className="mt-1 text-base font-medium text-foreground/70">
            {welcomeText ?? getModeLabel(mode)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">新增：创建时间</Badge>
          <Badge variant="outline">建联：电话/微信</Badge>
          <Badge variant="outline">逾期：下次跟进优先</Badge>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}

      <TimeRangeControls
        preset={timePreset}
        range={dateRange}
        onPresetChange={(preset) => {
          setTimePreset(preset)
          if (preset !== "custom") {
            setDateRange(getPresetRange(preset))
          }
        }}
        onCustomRangeChange={(range) => {
          setTimePreset("custom")
          setDateRange(range)
        }}
      />

      <KpiGrid activity={activity} mode={mode} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <ActivityTable users={activity?.users ?? []} mode={mode} />
        <AlertsPanel alerts={activity?.alerts ?? []} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <TrendChart activity={activity} />
        <ProcessFunnel activity={activity} />
      </div>

      <CustomerDetailsTable rows={activity?.customerDetails ?? []} />

      <LegacySummaryCard summary={summary} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="border-b border-muted/30">
            <CardTitle className="text-lg">销售漏斗概览</CardTitle>
            <CardDescription>当前线索阶段分布。</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <SalesFunnel />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
