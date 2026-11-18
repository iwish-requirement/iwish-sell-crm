import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export interface DashboardActivityFilterParams {
  scope?: "self" | "team" | "org" | "custom"
  startDate?: string
  endDate?: string
  // 全部时间：阶段分布等按全量线索统计，dateLabel 显示"全部"
  allTime?: boolean
}

export interface DailyActivityUserRow {
  id: string
  name: string
  avatarUrl: string | null
  teamId: number | null
  // 在管有效线索数：open、非无效、非成交/到款终态（即占用配额的线索）
  activeLeads: number
  // 本时段新增线索的阶段分布（key 为 FOLLOW_UP_STAGE_FLOW 的 stageId），与部门对比同口径
  stageCounts: Record<string, number>
  // 附加团队（成员以主团队计入统计，附加团队明细中仅作查看）
  isAdditional?: boolean
  newLeads: number
  contactActions: number
  visits: number
  followUps: number
  qualifiedLeads: number
  wonLeads: number
  overdueLeads: number
}

export interface DashboardTrendPoint {
  date: string
  newLeads: number
  contactActions: number
  visits: number
  won: number
}

export interface DashboardAlert {
  id: string
  type: "danger" | "warning" | "info"
  title: string
  description: string
}

export interface DashboardCustomerDetailRow {
  id: string
  companyName: string
  contactName: string
  ownerId: string | null
  ownerName: string
  stage: string
  status: string
  grade: string | null
  createdAt: string | null
  lastContactAt: string | null
  nextContactAt: string | null
  contactActions: number
  visits: number
  followUps: number
  isQualified: boolean
  isWon: boolean
  isOverdue: boolean
}

export interface FollowUpFunnelBand {
  stageId: string
  label: string
  count: number
}

export interface TeamActivityRow {
  teamId: number | null
  teamName: string
  memberCount: number
  // 在管有效线索：open、非无效、非成交/到款终态
  activeLeads: number
  newLeads: number
  contactActions: number
  visits: number
  followUps: number
  wonLeads: number
  paymentReceived: number
  overdueLeads: number
  // 各跟进阶段的线索数量（不含公海与无效线索），key 为 FOLLOW_UP_STAGE_FLOW 的 stageId
  stageCounts: Record<string, number>
  // 配额占用率 = 在管有效线索 / (配额上限 × 成员数)
  quotaUsage: number | null
}

export interface RoleDashboardActivity {
  dateLabel: string
  totals: {
    newLeads: number
    contactActions: number
    visits: number
    followUps: number
    qualifiedLeads: number
    wonLeads: number
    wonInRange: number
    overdueLeads: number
    pendingToday: number
    newlyAssigned: number
  }
  teams: TeamActivityRow[]
  trends: DashboardTrendPoint[]
  alerts: DashboardAlert[]
  stageFunnel: FollowUpFunnelBand[]
  // 单人有效线索配额上限（来自系统设置，默认 60）
  quotaLimit: number
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export const FOLLOW_UP_STAGE_FLOW = [
  { id: "uncontacted", label: "未建联" },
  { id: "connected", label: "已建联" },
  { id: "online_communication", label: "线上沟通" },
  { id: "offline_visit", label: "线下拜访" },
  { id: "proposal_quotation", label: "方案及报价" },
  { id: "intent_confirmed", label: "合作意向已确认" },
  { id: "contract_review", label: "审合同" },
  { id: "won", label: "成交" },
  { id: "payment_received", label: "到款" },
] as const

export type FollowUpStageId = (typeof FOLLOW_UP_STAGE_FLOW)[number]["id"]

export function getFollowUpStageLabel(value: string | null | undefined): string {
  const key = (value ?? "").trim()
  return FOLLOW_UP_STAGE_FLOW.find((stage) => stage.id === key)?.label ?? (key || "未设置")
}

export function getDateRange(params: DashboardActivityFilterParams): {
  rangeStart: Date
  rangeEnd: Date
  trendStart: Date
  dateLabel: string
} {
  const now = new Date()
  const todayStart = startOfLocalDay(now)
  const fallbackStart = todayStart
  const fallbackEnd = addDays(todayStart, 1)
  const rawStart = params.startDate ? new Date(params.startDate) : fallbackStart
  const rawEnd = params.endDate ? new Date(params.endDate) : fallbackEnd
  const rangeStart = Number.isNaN(rawStart.getTime()) ? fallbackStart : rawStart
  const rangeEnd = Number.isNaN(rawEnd.getTime()) || rawEnd <= rangeStart ? fallbackEnd : rawEnd
  const diffDays = Math.max(1, Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)))
  const trendDays = Math.min(Math.max(diffDays, 7), 31)
  const trendStart = addDays(startOfLocalDay(rangeEnd), -trendDays)
  const startLabel = toDateKey(rangeStart)
  const endInclusive = addDays(startOfLocalDay(rangeEnd), -1)
  const endLabel = toDateKey(endInclusive)

  return {
    rangeStart,
    rangeEnd,
    trendStart,
    dateLabel: startLabel === endLabel ? startLabel : `${startLabel} 至 ${endLabel}`,
  }
}

export async function fetchDashboardMonthlyRevenue(signal: AbortSignal): Promise<number> {
  const supabase = getBrowserSupabaseClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const { data, error } = await supabase
    .from("contract_payments_secure_view")
    .select("amount")
    .gte("paid_at", monthStart.toISOString())
    .lte("paid_at", now.toISOString())
    .abortSignal(signal)

  signal.throwIfAborted()
  if (error) throw error
  return (data ?? []).reduce((total, payment) => total + (payment.amount ?? 0), 0)
}

type DashboardOverviewResponse = Omit<RoleDashboardActivity, "dateLabel" | "stageFunnel" | "alerts"> & {
  stageCounts: Record<string, number>
  alerts: {
    noNew: number
    noContact: number
    noVisits: number
    noNewNames: string[]
    noContactNames: string[]
    highOverdue: Pick<DailyActivityUserRow, "id" | "name" | "overdueLeads">[]
  }
}

export type DashboardCursor =
  | { id: string; overdue: number; score: number }
  | { id: string; overdue: boolean; sortAt: string }
  | { id: string; legacy: true }

export interface DashboardPage<Row> {
  rows: Row[]
  nextCursor: DashboardCursor | null
}

export interface DashboardMemberFilter {
  departmentId?: number
  unassigned?: boolean
}

export interface DashboardActivitySnapshot {
  activity: RoleDashboardActivity
  loadMembers: (
    filter: DashboardMemberFilter, after: DashboardCursor | null, signal: AbortSignal,
  ) => Promise<DashboardPage<DailyActivityUserRow>>
  loadCustomers: (
    todoOnly: boolean, after: DashboardCursor | null, signal: AbortSignal,
  ) => Promise<DashboardPage<DashboardCustomerDetailRow>>
}

export const DETAIL_PAGE_SIZE = 20

export async function fetchDashboardActivitySnapshot(
  params: DashboardActivityFilterParams,
  signal: AbortSignal,
): Promise<DashboardActivitySnapshot> {
  try {
    return {
      activity: await fetchRoleDashboardActivity(params, signal),
      loadMembers: (filter, after, pageSignal) => fetchDashboardMembers(params, filter, after, pageSignal),
      loadCustomers: (todoOnly, after, pageSignal) => fetchDashboardCustomers(params, todoOnly, after, pageSignal),
    }
  } catch (error) {
    signal.throwIfAborted()
    // PostgREST returns PGRST202 while the RPC is missing from its schema cache.
    // Other errors stay on the normal timeout/retry path.
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "PGRST202") throw error
    const { fetchLegacyDashboardSnapshot } = await import("@/lib/services/dashboard-legacy")
    signal.throwIfAborted()
    return fetchLegacyDashboardSnapshot(params, signal)
  }
}

async function fetchDashboardPart<Result>(
  part: "overview" | "members" | "customers",
  params: DashboardActivityFilterParams,
  range: ReturnType<typeof getDateRange>,
  signal: AbortSignal,
  options: {
    p_department_id?: number
    p_unassigned?: boolean
    p_todo_only?: boolean
    p_limit?: number
    p_after?: DashboardCursor | null
  } = {},
): Promise<Result> {
  const { data, error } = await getBrowserSupabaseClient()
    .rpc("rpc_sales_dashboard", {
      p_part: part,
      p_range_start: range.rangeStart.toISOString(),
      p_range_end: range.rangeEnd.toISOString(),
      p_trend_start: range.trendStart.toISOString(),
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      p_scope: params.scope ?? null,
      ...options,
    })
    .abortSignal(signal)

  signal.throwIfAborted()
  if (error) throw error
  return data as Result
}

export async function fetchRoleDashboardActivity(
  params: DashboardActivityFilterParams,
  signal: AbortSignal,
): Promise<RoleDashboardActivity> {
  const range = getDateRange(params)
  const { stageCounts, alerts, ...overview } = await fetchDashboardPart<DashboardOverviewResponse>(
    "overview", params, range, signal,
  )
  const notices: DashboardAlert[] = []
  const overdue = overview.totals.overdueLeads
  if (overdue > 0) {
    notices.push({
      id: "overdue-leads",
      type: "danger",
      title: `${overdue} 条线索逾期未跟进`,
      description: "建议优先处理高等级和已约定下次跟进时间的线索。",
    })
  }
  if (alerts.noNew > 0) {
    notices.push({
      id: "no-new-leads",
      type: "warning",
      title: `${alerts.noNew} 人今日暂无新增线索`,
      description: alerts.noNewNames.join("、"),
    })
  }
  if (alerts.noContact > 0) {
    notices.push({
      id: "no-contact-actions",
      type: "warning",
      title: `${alerts.noContact} 人今日暂无建联行动`,
      description: alerts.noContactNames.join("、"),
    })
  }
  if (alerts.noVisits > 0) {
    notices.push({
      id: "no-visits",
      type: "info",
      title: `${alerts.noVisits} 人今日暂无拜访记录`,
      description: "拜访包含线下拜访和需要记录为拜访的深度客户沟通。",
    })
  }
  for (const user of alerts.highOverdue) {
    notices.push({
      id: `user-overdue-${user.id}`,
      type: "danger",
      title: `${user.name} 有 ${user.overdueLeads} 条逾期线索`,
      description: "可进入线索页按负责人和风险状态进一步处理。",
    })
  }
  return {
    ...overview,
    dateLabel: params.allTime ? "全部" : range.dateLabel,
    stageFunnel: FOLLOW_UP_STAGE_FLOW.map(({ id, label }) => ({ stageId: id, label, count: stageCounts[id] ?? 0 })),
    alerts: notices.slice(0, 6),
  }
}

export async function fetchDashboardMembers(
  params: DashboardActivityFilterParams,
  filter: DashboardMemberFilter,
  after: DashboardCursor | null,
  signal: AbortSignal,
): Promise<DashboardPage<DailyActivityUserRow>> {
  const page = await fetchDashboardPart<(DailyActivityUserRow & { actionScore: number })[]>(
    "members", params, getDateRange(params), signal, {
      p_limit: DETAIL_PAGE_SIZE,
      p_after: after,
      p_department_id: filter.departmentId,
      p_unassigned: filter.unassigned,
    },
  )
  const last = page.length > DETAIL_PAGE_SIZE ? page[DETAIL_PAGE_SIZE - 1] : null
  return {
    rows: page.slice(0, DETAIL_PAGE_SIZE),
    nextCursor: last ? { id: last.id, overdue: last.overdueLeads, score: last.actionScore } : null,
  }
}

export async function fetchDashboardCustomers(
  params: DashboardActivityFilterParams,
  todoOnly: boolean,
  after: DashboardCursor | null,
  signal: AbortSignal,
): Promise<DashboardPage<DashboardCustomerDetailRow>> {
  type CustomerResponse = Omit<DashboardCustomerDetailRow, "stage"> & { stage: string | null; sortAt: string }
  const page = await fetchDashboardPart<CustomerResponse[]>(
    "customers", params, getDateRange(params), signal, {
      p_limit: DETAIL_PAGE_SIZE,
      p_after: after,
      p_todo_only: todoOnly,
    },
  )
  const last = page.length > DETAIL_PAGE_SIZE ? page[DETAIL_PAGE_SIZE - 1] : null
  return {
    rows: page.slice(0, DETAIL_PAGE_SIZE).map(({ sortAt, stage, ...row }) => ({
      ...row,
      stage: getFollowUpStageLabel(stage),
    })),
    nextCursor: last ? { id: last.id, overdue: last.isOverdue, sortAt: last.sortAt } : null,
  }
}
