"use client"

import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Clock,
  ExternalLink,
  MessageCircle,
  PhoneCall,
  UserPlus,
  Users,
} from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { MePermissionsContext } from "@/components/app-root"
import { CrmOperatingDashboard, CrmOperatingReportDialog } from "@/components/crm-operating-dashboard"
import { CrmProtectionNotices } from "@/components/crm-sales-settings"
import { FollowUpFunnel } from "@/components/follow-up-funnel"
import { ChartSkeleton } from "@/components/skeleton-loaders"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fetchCurrentUserPublicProfile } from "@/lib/auth/profile"
import { DASHBOARD_REQUEST_TIMEOUT_MS, loadDashboardSection } from "@/lib/services/dashboard-request"
import {
  fetchDashboardActivitySnapshot,
  fetchDashboardMonthlyRevenue,
  type DashboardReceiptTotal,
  FOLLOW_UP_STAGE_FLOW,
  type DailyActivityUserRow,
  type DashboardCustomerDetailRow,
  type DashboardAlert,
  type DashboardActivityFilterParams,
  type DashboardActivitySnapshot,
  type DashboardCursor,
  type DashboardMemberFilter,
  type DashboardPage,
  type RoleDashboardActivity,
  type TeamActivityRow,
} from "@/lib/services/dashboard"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type RoleDashboardMode = "sales" | "manager" | "director"
type TimeRangePreset = "all" | "today" | "yesterday" | "week" | "month" | "quarter" | "year" | "custom"

interface SalesKpiDefinition {
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

const SALES_KPIS: SalesKpiDefinition[] = [
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

function formatCurrency(value: number, currency = "CNY"): string {
  if (!Number.isFinite(value) || value <= 0) return "¥0"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
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
  if (preset === "all") {
    return { start: new Date(2000, 0, 1), end: addDays(today, 1) }
  }
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
  if (preset === "quarter") {
    const start = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)
    return { start, end: addDays(today, 1) }
  }
  if (preset === "year") return { start: new Date(today.getFullYear(), 0, 1), end: addDays(today, 1) }
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

function KpiGrid({ activity }: { activity: RoleDashboardActivity | null }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
      {SALES_KPIS.map((item) => {
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
    { key: "quarter", label: "本季" },
    { key: "year", label: "本年" },
    { key: "all", label: "全部" },
    { key: "custom", label: "自定义" },
  ]

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">时间维度</p>
          <p className="text-xs text-muted-foreground">
            统计范围：{preset === "all" ? "全部时间" : getRangeLabel(range)}
          </p>
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

function quotaCellClass(ratio: number): string {
  if (ratio >= 1) return "font-semibold text-red-600"
  if (ratio >= 0.8) return "font-semibold text-amber-600"
  return "font-medium"
}

function MemberRow({ row, quotaLimit }: { row: DailyActivityUserRow; quotaLimit: number }) {
  const actionTotal = row.newLeads + row.contactActions + row.visits + row.followUps
  const limit = row.quotaLimit ?? quotaLimit
  const quotaRatio = limit > 0 ? row.activeLeads / limit : 0
  return (
    <TableRow>
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
      <TableCell className={`text-right tabular-nums ${quotaCellClass(quotaRatio)}`}>
        {row.activeLeads}/{limit}
      </TableCell>
      <TableCell className="text-right font-medium">{row.newLeads}</TableCell>
      <TableCell className="text-right font-medium">{row.contactActions}</TableCell>
      <TableCell className="text-right font-medium">{row.visits}</TableCell>
      <TableCell className="text-right font-medium">{row.followUps}</TableCell>
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
}

const MEMBER_TABLE_HEADERS = (
  <TableHeader className="sticky top-0 z-10 bg-background">
    <TableRow>
      <TableHead className="min-w-[160px]">业务人员</TableHead>
      <TableHead className="text-right" title="在管有效线索 / 配额上限">
        在管/名额
      </TableHead>
      <TableHead className="text-right">新增线索</TableHead>
      <TableHead className="text-right">建联</TableHead>
      <TableHead className="text-right">拜访</TableHead>
      <TableHead className="text-right">跟进</TableHead>
      <TableHead className="text-right">成交</TableHead>
      <TableHead className="text-right">逾期</TableHead>
      <TableHead className="text-right">状态</TableHead>
    </TableRow>
  </TableHeader>
)

function ActivityTable({
  users,
  quotaLimit,
}: {
  users: DailyActivityUserRow[]
  quotaLimit: number
}) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="text-lg">团队成员动作对比</CardTitle>
        <CardDescription>按人员聚合在管名额、线索录入、建联、拜访、跟进和逾期情况。</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[460px] overflow-auto p-0">
        <Table>
          {MEMBER_TABLE_HEADERS}
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  暂无可统计的业务人员数据
                </TableCell>
              </TableRow>
            ) : (
              users.map((row) => <MemberRow key={row.id} row={row} quotaLimit={quotaLimit} />)
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function DepartmentMemberTable({
  users,
  teams,
  department,
  quotaLimit,
}: {
  users: DailyActivityUserRow[]
  teams: TeamActivityRow[]
  department: TeamActivityRow | undefined
  quotaLimit: number
}) {
  const teamNameById = new Map(teams.map((team) => [team.teamId, team.teamName]))
  const stageCellClass = (stageId: string) =>
    KEY_STAGE_IDS.has(stageId) ? "bg-amber-50/70 font-semibold text-amber-700" : "font-medium"

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="text-lg">部门成员明细</CardTitle>
        <CardDescription>
          按部门展示各成员的在管名额与线索阶段分布，口径与上方部门数据对比一致。附加团队成员仅作查看，其数据计入主团队。
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-[560px] overflow-auto p-0">
        <Table className="min-w-[1100px]">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="min-w-[120px]">业务人员</TableHead>
              <TableHead className="text-right" title="在管有效线索 / 配额上限">
                在管/名额
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">本时段新增</TableHead>
              {FOLLOW_UP_STAGE_FLOW.map((stage) => (
                <TableHead
                  key={stage.id}
                  className={`whitespace-nowrap text-right ${
                    KEY_STAGE_IDS.has(stage.id) ? "font-semibold text-amber-600" : ""
                  }`}
                >
                  {stage.label}
                </TableHead>
              ))}
              <TableHead className="text-right">逾期</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {department && (
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={13}>
                  <span className="font-semibold">{department.teamName}（总计）</span>
                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                    {department.memberCount} 人 · 在管 {department.activeLeads}
                    {department.memberCount > 0 && department.quotaUsage !== null &&
                      `/${department.quotaCapacity ?? quotaLimit * department.memberCount} · 名额占用 ${Math.round(department.quotaUsage * 100)}%`}
                    {" · 本时段新增 "}{department.newLeads}
                    {" · 有效拜访 "}{department.stageCounts.offline_visit ?? 0}
                    {" · 方案及报价 "}{department.stageCounts.proposal_quotation ?? 0}
                    {" · 成交 "}{department.stageCounts.won ?? 0}
                    {" · 逾期 "}{department.overdueLeads}
                  </span>
                </TableCell>
              </TableRow>
            )}
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">
                  暂无可统计的业务人员数据
                </TableCell>
              </TableRow>
            ) : users.map((member) => {
              const isAdditional = member.isAdditional
              const limit = member.quotaLimit ?? quotaLimit
              const quotaRatio = limit > 0 ? member.activeLeads / limit : 0
              const primaryTeamName = isAdditional
                ? teamNameById.get(member.teamId) ?? "主团队"
                : null
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {member.avatarUrl ? (
                            <AvatarImage src={member.avatarUrl} alt={member.name} />
                          ) : null}
                          <AvatarFallback className="text-xs font-semibold">
                            {member.name.trim().slice(0, 1) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className={isAdditional ? "font-medium" : "font-semibold"}>{member.name}</span>
                      </div>
                      {isAdditional && primaryTeamName ? (
                        <span className="text-[11px] text-muted-foreground">
                          附加成员 · 数据计入主团队「{primaryTeamName}」
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${quotaCellClass(quotaRatio)}`}>
                    {member.activeLeads}/{limit}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{member.newLeads}</TableCell>
                  {FOLLOW_UP_STAGE_FLOW.map((stage) => (
                    <TableCell
                      key={stage.id}
                      className={`text-right tabular-nums ${stageCellClass(stage.id)}`}
                    >
                      {member.stageCounts[stage.id] ?? 0}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium text-red-600">
                    {member.overdueLeads}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// 部门对比的关键阶段：线下拜访（见面沟通）与方案及报价（已给方案）
const KEY_STAGE_IDS = new Set<string>(["offline_visit", "proposal_quotation"])

function TeamTable({ teams }: { teams: TeamActivityRow[] }) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="text-lg">部门数据对比</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[460px] overflow-auto p-0">
        <Table className="min-w-[620px]">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="min-w-[92px]">部门</TableHead>
              <TableHead className="text-right">成员</TableHead>
              <TableHead className="text-right">本时段新增</TableHead>
              {FOLLOW_UP_STAGE_FLOW.map((stage) => (
                <TableHead
                  key={stage.id}
                  className={`whitespace-nowrap text-right ${
                    KEY_STAGE_IDS.has(stage.id) ? "font-semibold text-amber-600" : ""
                  }`}
                >
                  {stage.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                  暂无可统计的部门数据
                </TableCell>
              </TableRow>
            ) : (
              teams.map((team) => (
                <TableRow key={team.teamId ?? team.teamName}>
                  <TableCell className="font-semibold">{team.teamName}</TableCell>
                  <TableCell className="text-right font-medium">{team.memberCount}</TableCell>
                  <TableCell className="text-right font-medium">{team.newLeads}</TableCell>
                  {FOLLOW_UP_STAGE_FLOW.map((stage) => {
                    const isKey = KEY_STAGE_IDS.has(stage.id)
                    const count = team.stageCounts[stage.id] ?? 0
                    return (
                      <TableCell
                        key={stage.id}
                        className={`text-right tabular-nums ${
                          isKey ? "bg-amber-50/70 font-semibold text-amber-700" : "font-medium"
                        }`}
                      >
                        {count}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function CustomerDetailsTable({
  rows,
  title = "客户明细",
  description = "按当前时间范围汇总的客户与跟进明细。",
}: {
  rows: DashboardCustomerDetailRow[]
  title?: string
  description?: string
}) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
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
  const trendDays = activity?.trends.length ?? 7
  // 点位较少时直接在图上标注数值，总经理无需悬停即可读数
  const showLabels = trendDays <= 10
  const totalNew = activity?.trends.reduce((sum, point) => sum + point.newLeads, 0) ?? 0
  const totalVisits = activity?.trends.reduce((sum, point) => sum + point.visits, 0) ?? 0
  const totalWon = activity?.trends.reduce((sum, point) => sum + point.won, 0) ?? 0
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              最近 {trendDays} 天新增、拜访与成交趋势
            </CardTitle>
            <CardDescription>对比每日新增线索、拜访和成交数量走势。</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6]" />
              <span className="font-medium text-foreground">新增线索</span>
              <span className="text-base font-bold tabular-nums text-[#2563eb]">合计 {totalNew}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-[#8b5cf6]" />
              <span className="font-medium text-foreground">拜访</span>
              <span className="text-base font-bold tabular-nums text-[#7c3aed]">合计 {totalVisits}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
              <span className="font-medium text-foreground">成交</span>
              <span className="text-base font-bold tabular-nums text-[#16a34a]">合计 {totalWon}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="h-[260px]">
          {!activity || activity.trends.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无趋势数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity.trends} margin={{ top: 22, right: 24, left: -10, bottom: 0 }}>
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
                <Line
                  type="monotone"
                  dataKey="newLeads"
                  name="新增线索"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  label={showLabels ? { position: "top", fontSize: 14, fill: "#2563eb" } : undefined}
                />
                <Line
                  type="monotone"
                  dataKey="visits"
                  name="拜访"
                  stroke="#8b5cf6"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  label={showLabels ? { position: "top", fontSize: 14, fill: "#7c3aed" } : undefined}
                />
                <Line
                  type="monotone"
                  dataKey="won"
                  name="成交"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  label={showLabels ? { position: "bottom", fontSize: 14, fill: "#16a34a" } : undefined}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function FunnelCard({
  activity,
  monthlyRevenue,
  allTime = false,
  actions,
}: {
  activity: RoleDashboardActivity | null
  monthlyRevenue: DashboardReceiptTotal[] | null
  allTime?: boolean
  actions?: ReactNode
}) {
  const bands = activity?.stageFunnel ?? []
  const total = bands.reduce((sum, band) => sum + band.count, 0)
  const paymentCount = bands.find((band) => band.stageId === "payment_received")?.count ?? 0

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">{activity ? "销售漏斗" : "回款概览"}</CardTitle>
            {activity && (
              <CardDescription>
                {allTime
                  ? "全部线索按当前跟进阶段的分布（不含公海与无效线索）。"
                  : "所选时段新增线索当前的阶段分布（不含公海与无效线索）。"}
              </CardDescription>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activity && (
              <>
                <Badge variant="outline">本时段新增 {formatNumber(activity.totals.newLeads)}</Badge>
                <Badge variant="outline">本时段成交 {formatNumber(activity.totals.wonInRange)}</Badge>
                <Badge variant="outline">到款阶段 {formatNumber(paymentCount)}</Badge>
              </>
            )}
            {monthlyRevenue !== null && (
              <Badge variant="outline" className="whitespace-normal">本月回款 {monthlyRevenue.length
                ? monthlyRevenue.map(({ currency, amount }) => formatCurrency(amount, currency)).join(" / ")
                : formatCurrency(0)}</Badge>
            )}
            {actions}
          </div>
        </div>
      </CardHeader>
      {activity && (
        <CardContent className="pt-5">
          <FollowUpFunnel bands={bands} total={total} />
        </CardContent>
      )}
    </Card>
  )
}

type SectionResult<T> = { status: "ready"; data: T } | { status: "error" }

function useDashboardSection<T>(load: ((signal: AbortSignal) => Promise<T>) | null) {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{ load: typeof load; attempt: number; result: SectionResult<T> } | null>(null)

  useEffect(() => {
    if (!load) return
    const controller = new AbortController()
    void loadDashboardSection(load, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ load, attempt, result: { status: "ready", data } })
      },
      (error) => {
        if (controller.signal.aborted) return
        console.error("Failed to load dashboard section", error)
        setSettled({ load, attempt, result: { status: "error" } })
      },
    )
    return () => controller.abort()
  }, [load, attempt])

  const result = settled?.load === load && settled.attempt === attempt
    ? settled.result
    : { status: "loading" as const }

  return { result, retry: () => setAttempt((current) => current + 1) }
}

function DashboardLoadNotice({ label, status, retry }: {
  label: string
  status: "loading" | "ready" | "error"
  retry: () => void
}) {
  if (status === "ready") return null
  if (status === "loading") {
    return <p role="status" className="text-sm text-muted-foreground">正在加载{label}…</p>
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
      <p role="alert" className="text-sm text-destructive">{label}加载超时或失败。</p>
      <Button type="button" variant="outline" size="sm" onClick={retry}>重试{label}</Button>
    </div>
  )
}

function DashboardDetailPager<Row>({ label, loadPage, children }: {
  label: string
  loadPage: (after: DashboardCursor | null, signal: AbortSignal) => Promise<DashboardPage<Row>>
  children: (rows: Row[]) => ReactNode
}) {
  const [cursors, setCursors] = useState<(DashboardCursor | null)[]>([null])
  const cursor = cursors[cursors.length - 1]
  const load = useCallback((signal: AbortSignal) => loadPage(cursor, signal), [cursor, loadPage])
  const { result, retry } = useDashboardSection(load)
  const page = result.status === "ready" ? result.data : null
  const nextCursor = page?.nextCursor

  return (
    <div className="space-y-3">
      <DashboardLoadNotice label={label} status={result.status} retry={retry} />
      {page && children(page.rows)}
      {(cursors.length > 1 || nextCursor) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm tabular-nums text-muted-foreground">第 {cursors.length} 页</span>
          <Button type="button" size="sm" variant="outline" disabled={cursors.length === 1}
            onClick={() => setCursors((pages) => pages.slice(0, -1))}>上一页</Button>
          <Button type="button" size="sm" variant="outline" disabled={!nextCursor}
            onClick={() => nextCursor && setCursors((pages) => [...pages, nextCursor])}>下一页</Button>
        </div>
      )}
    </div>
  )
}

function DashboardCustomerDetails({ loadCustomers, todoOnly = false }: {
  loadCustomers: DashboardActivitySnapshot["loadCustomers"]
  todoOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const label = todoOnly ? "待跟进与逾期" : "客户明细"
  const loadPage = useCallback((after: DashboardCursor | null, signal: AbortSignal) =>
    loadCustomers(todoOnly, after, signal), [loadCustomers, todoOnly])

  return (
    <section className="space-y-3">
      <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}>
        {open ? "收起" : "查看"}{label}
      </Button>
      {open && (
        <DashboardDetailPager label={label} loadPage={loadPage}>
          {(rows) => (
            <CustomerDetailsTable rows={rows} title={label}
              description={todoOnly ? "下次跟进时间已到或已逾期的线索，优先处理。" : undefined} />
          )}
        </DashboardDetailPager>
      )}
    </section>
  )
}

function DashboardMemberDetails({ snapshot, byDepartment = false }: {
  snapshot: DashboardActivitySnapshot
  byDepartment?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { activity, loadMembers } = snapshot
  const [department, setDepartment] = useState(() =>
    String((activity.teams.find((team) => team.memberCount > 0) ?? activity.teams[0])?.teamId ?? "unassigned"),
  )
  const selectedTeam = activity.teams.find((team) => String(team.teamId) === department)
  const label = byDepartment ? "部门成员明细" : "团队成员明细"
  const loadPage = useCallback((after: DashboardCursor | null, signal: AbortSignal) => {
    const filter: DashboardMemberFilter = {}
    if (byDepartment) {
      if (department === "unassigned") filter.unassigned = true
      else filter.departmentId = Number(department)
    }
    return loadMembers(filter, after, signal)
  }, [byDepartment, department, loadMembers])

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}>
          {open ? "收起" : "查看"}{label}
        </Button>
        {open && byDepartment && (
          <select aria-label="筛选成员部门" className="h-9 rounded-md border bg-background px-3 text-sm"
            value={department} onChange={(event) => setDepartment(event.target.value)}>
            {activity.teams.map((team) => <option key={team.teamId} value={String(team.teamId)}>{team.teamName}</option>)}
            <option value="unassigned">未分配团队</option>
          </select>
        )}
      </div>
      {open && (
        <DashboardDetailPager key={department} label={label} loadPage={loadPage}>
          {(users) => byDepartment ? (
            <DepartmentMemberTable
              users={users}
              teams={activity.teams}
              department={selectedTeam}
              quotaLimit={activity.quotaLimit}
            />
          ) : (
            <ActivityTable users={users} quotaLimit={activity.quotaLimit} />
          )}
        </DashboardDetailPager>
      )}
    </section>
  )
}

export function Dashboard() {
  const [welcomeText, setWelcomeText] = useState<string | null>(null)
  const [timePreset, setTimePreset] = useState<TimeRangePreset>("today")
  const [dateRange, setDateRange] = useState<DashboardDateRange>(() => getPresetRange("today"))
  const [permissionWaitExpired, setPermissionWaitExpired] = useState(false)
  const mePermissions = useContext(MePermissionsContext)
  const scopeType = mePermissions?.leadScopeType ?? "self"
  const permissionsReady = mePermissions !== null

  useEffect(() => {
    if (permissionsReady) return
    // Avoid a speculative self-scope request while the application loads permissions.
    const timeout = setTimeout(() => setPermissionWaitExpired(true), DASHBOARD_REQUEST_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [permissionsReady])

  const mode: RoleDashboardMode = useMemo(() => {
    const scopeType = mePermissions?.leadScopeType ?? "self"
    if ((scopeType === "org" || scopeType === "custom") && mePermissions?.canViewReports) return "director"
    if (scopeType === "team") return "manager"
    return "sales"
  }, [mePermissions])

  const loadActivity = useCallback(async (signal: AbortSignal) => {
    const params: DashboardActivityFilterParams = {
      scope: scopeType,
      allTime: timePreset === "all",
      startDate: dateRange.start.toISOString(),
      endDate: dateRange.end.toISOString(),
    }
    return fetchDashboardActivitySnapshot(params, signal)
  }, [scopeType, mePermissions, dateRange, timePreset])
  const activitySection = useDashboardSection(permissionsReady || permissionWaitExpired ? loadActivity : null)
  const revenueSection = useDashboardSection(fetchDashboardMonthlyRevenue)
  const monthlyRevenue = revenueSection.result.status === "ready" ? revenueSection.result.data : null
  const overview = activitySection.result.status === "ready" ? activitySection.result.data : null
  const activity = overview?.activity ?? null

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

  const funnel = <FunnelCard activity={activity} monthlyRevenue={monthlyRevenue} allTime={timePreset === "all"}
    actions={permissionsReady && <CrmOperatingReportDialog>
      <CrmOperatingDashboard start={dateRange.start} end={dateRange.end} period={timePreset} />
    </CrmOperatingReportDialog>} />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
            {activity && (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                {activity.dateLabel}
              </Badge>
            )}
            <Badge>{getModeLabel(mode)}</Badge>
          </div>
          <p className="mt-1 text-base font-medium text-foreground/70">
            {welcomeText ?? getModeLabel(mode)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">新增：创建时间</Badge>
          <Badge variant="outline">建联：电话/微信</Badge>
        </div>
      </div>

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

      {permissionsReady && <CrmProtectionNotices />}
      <DashboardLoadNotice label="销售过程数据" status={activitySection.result.status} retry={activitySection.retry} />
      <DashboardLoadNotice label="本月回款" status={revenueSection.result.status} retry={revenueSection.retry} />

      {(activity || monthlyRevenue !== null || permissionsReady) && (
        <div className={mode === "director" && activity ? "grid grid-cols-1 gap-6 xl:grid-cols-2" : undefined}>
          {funnel}
          {mode === "director" && activity && <TeamTable teams={activity.teams} />}
        </div>
      )}

      {!overview || !activity ? (
        activitySection.result.status === "loading" && <ChartSkeleton />
      ) : mode === "director" ? (
        <>
          <TrendChart activity={activity} />
          <DashboardMemberDetails snapshot={overview} byDepartment />
        </>
      ) : mode === "manager" ? (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.55fr]">
            <DashboardMemberDetails snapshot={overview} />
            <AlertsPanel alerts={activity?.alerts ?? []} />
          </div>
          <DashboardCustomerDetails loadCustomers={overview.loadCustomers} />
        </>
      ) : (
        <>
          <KpiGrid activity={activity} />
          <DashboardCustomerDetails loadCustomers={overview.loadCustomers} todoOnly />
        </>
      )}
    </div>
  )
}
