"use client"

import { Fragment, useContext, useEffect, useMemo, useState } from "react"
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
import { FollowUpFunnel } from "@/components/follow-up-funnel"
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
  FOLLOW_UP_STAGE_FLOW,
  type DailyActivityUserRow,
  type DashboardCustomerDetailRow,
  type DashboardAlert,
  type DashboardSummary,
  type RoleDashboardActivity,
  type TeamActivityRow,
} from "@/lib/services/dashboard"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type RoleDashboardMode = "sales" | "manager" | "director"
type TimeRangePreset = "today" | "yesterday" | "week" | "month" | "quarter" | "custom"

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
  if (preset === "quarter") {
    const start = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)
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

function MemberRow({ row }: { row: DailyActivityUserRow }) {
  const actionTotal = row.newLeads + row.contactActions + row.visits + row.followUps
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

function ActivityTable({ users }: { users: DailyActivityUserRow[] }) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="text-lg">团队成员动作对比</CardTitle>
        <CardDescription>按人员聚合线索录入、建联、拜访、跟进和逾期情况。</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[460px] overflow-auto p-0">
        <Table>
          {MEMBER_TABLE_HEADERS}
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  暂无可统计的业务人员数据
                </TableCell>
              </TableRow>
            ) : (
              users.map((row) => <MemberRow key={row.id} row={row} />)
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
}: {
  users: DailyActivityUserRow[]
  teams: TeamActivityRow[]
}) {
  const groups: { key: string; name: string; members: DailyActivityUserRow[]; team: TeamActivityRow | null }[] = []
  for (const team of teams) {
    const members = users.filter((user) => user.teamId === team.teamId)
    if (members.length > 0) {
      groups.push({ key: `team-${team.teamId}`, name: team.teamName, members, team })
    }
  }
  const unassigned = users.filter(
    (user) => user.teamId == null || !teams.some((team) => team.teamId === user.teamId),
  )
  if (unassigned.length > 0) {
    groups.push({ key: "unassigned", name: "未分配团队", members: unassigned, team: null })
  }

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="text-lg">部门成员明细</CardTitle>
        <CardDescription>按部门展示各成员的线索与跟进数据。</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[560px] overflow-auto p-0">
        <Table>
          {MEMBER_TABLE_HEADERS}
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  暂无可统计的业务人员数据
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => {
                const wonTotal = group.team?.wonLeads ?? group.members.reduce((sum, m) => sum + m.wonLeads, 0)
                const overdueTotal = group.members.reduce((sum, m) => sum + m.overdueLeads, 0)
                return (
                  <Fragment key={group.key}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={8}>
                        <span className="font-semibold text-foreground">{group.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {group.members.length} 人 · 成交 {wonTotal} · 逾期 {overdueTotal}
                        </span>
                      </TableCell>
                    </TableRow>
                    {group.members.map((member) => (
                      <MemberRow key={member.id} row={member} />
                    ))}
                  </Fragment>
                )
              })
            )}
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
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  暂无可统计的部门数据
                </TableCell>
              </TableRow>
            ) : (
              teams.map((team) => (
                <TableRow key={team.teamId ?? team.teamName}>
                  <TableCell className="font-semibold">{team.teamName}</TableCell>
                  <TableCell className="text-right font-medium">{team.memberCount}</TableCell>
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
  const trendDays = activity?.trends.length ?? 7
  // 点位较少时直接在图上标注数值，总经理无需悬停即可读数
  const showLabels = trendDays <= 10
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="h-4 w-4 text-blue-600" />
          最近 {trendDays} 天新增与成交趋势
        </CardTitle>
        <CardDescription>对比每日新增线索与成交数量走势。</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="h-[260px]">
          {!activity || activity.trends.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无趋势数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity.trends} margin={{ top: 18, right: 20, left: -10, bottom: 0 }}>
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
                  label={showLabels ? { position: "top", fontSize: 11, fill: "#2563eb" } : undefined}
                />
                <Line
                  type="monotone"
                  dataKey="won"
                  name="成交"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  label={showLabels ? { position: "bottom", fontSize: 11, fill: "#16a34a" } : undefined}
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
  summary,
}: {
  activity: RoleDashboardActivity | null
  summary: DashboardSummary | null
}) {
  const bands = activity?.stageFunnel ?? []
  const total = bands.reduce((sum, band) => sum + band.count, 0)
  const wonCount = bands.find((band) => band.stageId === "won")?.count ?? 0
  const paymentCount = bands.find((band) => band.stageId === "payment_received")?.count ?? 0
  const paymentRate = wonCount > 0 ? `${((paymentCount / wonCount) * 100).toFixed(1)}%` : "—"

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="border-b border-muted/30">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">销售漏斗</CardTitle>
            <CardDescription>按当前跟进阶段的线索分布（不含公海与无效线索）。</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">成交 {formatNumber(wonCount)}</Badge>
            <Badge variant="outline">到款 {formatNumber(paymentCount)}</Badge>
            <Badge variant="outline">到款率 {paymentRate}</Badge>
            <Badge variant="outline">本月回款 {formatCurrency(summary?.monthlyRevenue ?? 0)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        <FollowUpFunnel bands={bands} total={total} />
      </CardContent>
    </Card>
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

  // 个人工作台：下次跟进时间已到或已逾期的线索优先展示
  const todoRows = useMemo(() => {
    const rows = activity?.customerDetails ?? []
    const endMs = dateRange.end.getTime()
    return rows
      .filter((row) => {
        if (row.isOverdue) return true
        if (!row.nextContactAt) return false
        return new Date(row.nextContactAt).getTime() < endMs
      })
      .sort((a, b) => (a.isOverdue === b.isOverdue ? 0 : a.isOverdue ? -1 : 1))
  }, [activity, dateRange])

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

      {mode === "director" ? (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <FunnelCard activity={activity} summary={summary} />
            <TeamTable teams={activity?.teams ?? []} />
          </div>
          <TrendChart activity={activity} />
          <DepartmentMemberTable users={activity?.users ?? []} teams={activity?.teams ?? []} />
        </>
      ) : mode === "manager" ? (
        <>
          <FunnelCard activity={activity} summary={summary} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.55fr]">
            <ActivityTable users={activity?.users ?? []} />
            <AlertsPanel alerts={activity?.alerts ?? []} />
          </div>
          <CustomerDetailsTable rows={activity?.customerDetails ?? []} />
        </>
      ) : (
        <>
          <FunnelCard activity={activity} summary={summary} />
          <KpiGrid activity={activity} />
          <CustomerDetailsTable
            rows={todoRows}
            title="待跟进与逾期"
            description="下次跟进时间已到或已逾期的线索，优先处理。"
          />
        </>
      )}
    </div>
  )
}
