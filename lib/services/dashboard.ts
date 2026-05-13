import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import type { LeadSecureRow } from "@/lib/services/leads"

export interface DashboardSummary {
  totalLeads: number
  winRate: number
  monthlyRevenue: number
  riskLeadCount: number
}

export interface DashboardFilterParams {
  teamId?: number
  ownerId?: string
}

export interface DashboardActivityFilterParams extends DashboardFilterParams {
  startDate?: string
  endDate?: string
}

export interface DailyActivityUserRow {
  id: string
  name: string
  avatarUrl: string | null
  teamId: number | null
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

export interface RoleDashboardActivity {
  dateLabel: string
  totals: {
    newLeads: number
    contactActions: number
    visits: number
    followUps: number
    qualifiedLeads: number
    wonLeads: number
    overdueLeads: number
    pendingToday: number
    newlyAssigned: number
  }
  users: DailyActivityUserRow[]
  trends: DashboardTrendPoint[]
  alerts: DashboardAlert[]
  customerDetails: DashboardCustomerDetailRow[]
  funnel: {
    newLeads: number
    contacted: number
    visited: number
    inProgress: number
    won: number
  }
}

export interface RecentDealSummary {
  id: string
  customerName: string
  companyName: string
  budget: number
  budgetLabel: string
  source: string
  createdAt: string
  closedAt: string | null
}

type SupabaseLikeError = {
  code?: string | null
  message?: string | null
}

function isMissingRelationError(error: SupabaseLikeError | null): boolean {
  if (!error) {
    return false
  }

  const message = `${error.message ?? ""}`.toLowerCase()
  return error.code === "PGRST205" || error.code === "42P01" || message.includes("could not find the table")
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function readExcludedIds(
  teamExclusionRow: any,
  profileExclusionRow: any,
): { excludedTeamIds: Set<number>; excludedProfileIds: Set<string> } {
  const excludedTeamIds = new Set<number>(
    teamExclusionRow &&
      teamExclusionRow.value &&
      Array.isArray((teamExclusionRow.value as any).team_ids)
      ? ((teamExclusionRow.value as any).team_ids as any[]).filter((v: any) => typeof v === "number")
      : [],
  )

  const excludedProfileIds = new Set<string>(
    profileExclusionRow &&
      profileExclusionRow.value &&
      Array.isArray((profileExclusionRow.value as any).profile_ids)
      ? ((profileExclusionRow.value as any).profile_ids as any[]).filter((v: any) => typeof v === "string")
      : [],
  )

  return { excludedTeamIds, excludedProfileIds }
}

function isQualifiedLead(lead: Pick<LeadSecureRow, "stage" | "customer_grade">): boolean {
  const stage = (lead.stage ?? "").trim()
  const grade = (lead.customer_grade ?? "").trim().toUpperCase()
  return ["L2", "L3", "L4", "Won"].includes(stage) || ["S", "A", "B"].includes(grade)
}

function isWonLead(lead: Pick<LeadSecureRow, "stage" | "status" | "close_result">): boolean {
  const stage = (lead.stage ?? "").trim()
  const closeResult = (lead.close_result ?? "").trim()
  return (
    stage === "Won" ||
    (lead.status === "closed" && (closeResult === "won" || closeResult === "成交"))
  )
}

function getLeadOwnerKey(lead: Pick<LeadSecureRow, "owner_id" | "created_by">): string | null {
  return lead.owner_id ?? lead.created_by ?? null
}

function getDateRange(params: DashboardActivityFilterParams): {
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

export async function fetchDashboardSummary(
  params: DashboardFilterParams = {},
): Promise<DashboardSummary> {
  const supabase = getBrowserSupabaseClient()

  let query = supabase
    .from("leads_secure_view")
    .select("id, team_id, owner_id, created_by, status, close_result, budget, last_contact_at, created_at")
    .neq("status", "pool")

  if (params.teamId !== undefined) {
    query = query.eq("team_id", params.teamId)
  }

  if (params.ownerId) {
    query = query.eq("owner_id", params.ownerId)
  }

  const [
    { data, error },
    { data: teamExclusionRow, error: teamExclusionError },
    { data: profileExclusionRow, error: profileExclusionError },
    { data: businessRulesRpcResult, error: businessRulesError },
  ] = await Promise.all([
    query,
    supabase.from("settings").select("value").eq("key", "analytics.excluded_teams").maybeSingle(),
    supabase.from("settings").select("value").eq("key", "analytics.excluded_profiles").maybeSingle(),
    supabase.rpc("rpc_get_pipeline_business_rules"),
  ])

  if (teamExclusionError && teamExclusionError.code !== "PGRST116") {
    console.error("Failed to load analytics excluded teams for dashboard summary", teamExclusionError)
  }
  if (profileExclusionError && profileExclusionError.code !== "PGRST116") {
    console.error("Failed to load analytics excluded profiles for dashboard summary", profileExclusionError)
  }
  if (businessRulesError) {
    console.error("Failed to load pipeline business rules via RPC for dashboard summary", businessRulesError)
  }

  const excludedTeamIds = new Set<number>(
    teamExclusionRow &&
      (teamExclusionRow as any).value &&
      Array.isArray(((teamExclusionRow as any).value as any).team_ids)
      ? (((teamExclusionRow as any).value as any).team_ids as any[]).filter((v: any) => typeof v === "number")
      : [],
  )

  const excludedProfileIds = new Set<string>(
    profileExclusionRow &&
      (profileExclusionRow as any).value &&
      Array.isArray(((profileExclusionRow as any).value as any).profile_ids)
      ? (((profileExclusionRow as any).value as any).profile_ids as any[]).filter((v: any) => typeof v === "string")
      : [],
  )

  if (error) {
    console.error("Failed to load dashboard summary leads", error)
    throw error
  }

  const rawLeads = (data ?? []) as LeadSecureRow[]

  const leads = rawLeads.filter((lead) => {
    const teamId = (lead.team_id as number | null) ?? null
    if (teamId != null && excludedTeamIds.has(teamId)) {
      return false
    }

    const ownerId = (lead.owner_id as string | null) ?? null
    if (ownerId && excludedProfileIds.has(ownerId)) {
      return false
    }

    return true
  })

  const now = new Date()
  const totalLeads = leads.length

  // 默认预警/风险阈值：72 小时预警，168 小时风险
  const DEFAULT_WARNING_HOURS = 72
  const DEFAULT_DANGER_HOURS = 168

  let warningHours = DEFAULT_WARNING_HOURS
  let dangerHours = DEFAULT_DANGER_HOURS

  const businessRulesValue = (businessRulesRpcResult as any) ?? null
  if (businessRulesValue && typeof businessRulesValue === "object") {
    const rawWarning = (businessRulesValue as any).warning_hours
    const rawDanger = (businessRulesValue as any).danger_hours

    if (typeof rawWarning === "number" && Number.isFinite(rawWarning) && rawWarning > 0) {
      warningHours = rawWarning
    }
    if (typeof rawDanger === "number" && Number.isFinite(rawDanger) && rawDanger > 0) {
      dangerHours = rawDanger
    }
  }

  let closedWon = 0
  let closedLost = 0
  let monthlyRevenue = 0
  let riskLeadCount = 0

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  for (const lead of leads) {
    const status = lead.status ?? "open"
    const closeResult = lead.close_result ?? ""
    const createdAt = lead.created_at ? new Date(lead.created_at) : null
    const lastContact = lead.last_contact_at ? new Date(lead.last_contact_at) : createdAt

    const isClosedWon = status === "closed" && (closeResult === "won" || closeResult === "成交")

    if (status === "closed") {
      if (isClosedWon) {
        closedWon += 1
      } else {
        closedLost += 1
      }
    }

    // 仪表盘“风险线索”仅统计在谈线索，成交/丢单不计入
    if (status === "open") {
      if (lastContact) {
        const diffHours = (now.getTime() - lastContact.getTime()) / (1000 * 60 * 60)
        if (diffHours >= dangerHours) {
          riskLeadCount += 1
        }
      } else {
        // 从未跟进的在谈线索视为高风险
        riskLeadCount += 1
      }
    }
  }

  if (warningHours < dangerHours && warningHours > 0) {
    // 保留对业务规则的读取，后续如果仪表盘增加“预警线索”卡片可直接复用
  }

  const denominator = closedWon + closedLost
  const winRate = denominator > 0 ? (closedWon / denominator) * 100 : 0

  const { data: payments, error: paymentsError } = await supabase
    .from("contract_payments_secure_view")
    .select("amount, paid_at")
    .gte("paid_at", monthStart.toISOString())
    .lte("paid_at", now.toISOString())

  if (paymentsError) {
    if (!isMissingRelationError(paymentsError)) {
      console.error("Failed to load dashboard payments summary", paymentsError)
    }
  } else {
    const paymentRows = (payments ?? []) as { amount: number | null }[]
    for (const row of paymentRows) {
      if (row.amount != null) {
        monthlyRevenue += row.amount
      }
    }
  }

  return {
    totalLeads,
    winRate,
    monthlyRevenue,
    riskLeadCount,
  }
}

type LeadStageRow = Pick<LeadSecureRow, "id" | "team_id" | "owner_id" | "stage" | "status" | "close_result">

export interface SalesFunnelCounts {
  byStage: Record<string, number>
}

export async function fetchSalesFunnelCounts(
  params: DashboardFilterParams = {},
): Promise<SalesFunnelCounts> {
  const supabase = getBrowserSupabaseClient()

  let query = supabase.from("leads_secure_view").select("id, team_id, owner_id, stage, status, close_result")

  if (params.teamId !== undefined) {
    query = query.eq("team_id", params.teamId)
  }

  if (params.ownerId) {
    query = query.eq("owner_id", params.ownerId)
  }

  const [
    { data, error },
    { data: teamExclusionRow, error: teamExclusionError },
    { data: profileExclusionRow, error: profileExclusionError },
  ] = await Promise.all([
    query,
    supabase.from("settings").select("value").eq("key", "analytics.excluded_teams").maybeSingle(),
    supabase.from("settings").select("value").eq("key", "analytics.excluded_profiles").maybeSingle(),
  ])

  if (teamExclusionError && teamExclusionError.code !== "PGRST116") {
    console.error("Failed to load analytics excluded teams for dashboard funnel", teamExclusionError)
  }
  if (profileExclusionError && profileExclusionError.code !== "PGRST116") {
    console.error("Failed to load analytics excluded profiles for dashboard funnel", profileExclusionError)
  }

  if (error) {
    console.error("Failed to load sales funnel leads", error)
    throw error
  }

  const excludedTeamIds = new Set<number>(
    teamExclusionRow &&
      (teamExclusionRow as any).value &&
      Array.isArray(((teamExclusionRow as any).value as any).team_ids)
      ? (((teamExclusionRow as any).value as any).team_ids as any[]).filter((v: any) => typeof v === "number")
      : [],
  )

  const excludedProfileIds = new Set<string>(
    profileExclusionRow &&
      (profileExclusionRow as any).value &&
      Array.isArray(((profileExclusionRow as any).value as any).profile_ids)
      ? (((profileExclusionRow as any).value as any).profile_ids as any[]).filter((v: any) => typeof v === "string")
      : [],
  )

  const rawLeads = (data ?? []) as LeadStageRow[]

  const leads = rawLeads.filter((lead) => {
    const teamId = (lead.team_id as number | null) ?? null
    if (teamId != null && excludedTeamIds.has(teamId)) {
      return false
    }

    const ownerId = (lead.owner_id as string | null) ?? null
    if (ownerId && excludedProfileIds.has(ownerId)) {
      return false
    }

    return true
  })

  const byStage: Record<string, number> = {}

  for (const lead of leads) {
    const status = lead.status ?? "open"

    if (status === "pool") {
      continue
    }

    const rawStage = (lead.stage ?? "").trim()
    let logicalStage = rawStage || "L1"

    if (
      status === "closed" &&
      (lead.close_result === "won" ||
        lead.close_result === "成交" ||
        rawStage === "Won" ||
        rawStage === "成交")
    ) {
      logicalStage = "Won"
    }

    if (!byStage[logicalStage]) {
      byStage[logicalStage] = 0
    }

    byStage[logicalStage] += 1
  }

  return {
    byStage,
  }
}

export async function fetchRoleDashboardActivity(
  params: DashboardActivityFilterParams = {},
): Promise<RoleDashboardActivity> {
  const supabase = getBrowserSupabaseClient()
  const now = new Date()
  const { rangeStart, rangeEnd, trendStart, dateLabel } = getDateRange(params)

  const [
    { data: teamExclusionRow, error: teamExclusionError },
    { data: profileExclusionRow, error: profileExclusionError },
    { data: businessRulesRpcResult, error: businessRulesError },
  ] = await Promise.all([
    supabase.from("settings").select("value").eq("key", "analytics.excluded_teams").maybeSingle(),
    supabase.from("settings").select("value").eq("key", "analytics.excluded_profiles").maybeSingle(),
    supabase.rpc("rpc_get_pipeline_business_rules"),
  ])

  if (teamExclusionError && teamExclusionError.code !== "PGRST116") {
    console.error("Failed to load analytics excluded teams for role dashboard", teamExclusionError)
  }
  if (profileExclusionError && profileExclusionError.code !== "PGRST116") {
    console.error("Failed to load analytics excluded profiles for role dashboard", profileExclusionError)
  }
  if (businessRulesError) {
    console.error("Failed to load pipeline business rules for role dashboard", businessRulesError)
  }

  const { excludedTeamIds, excludedProfileIds } = readExcludedIds(teamExclusionRow, profileExclusionRow)

  let warningHours = 72
  let dangerHours = 168
  const businessRulesValue = (businessRulesRpcResult as any) ?? null
  if (businessRulesValue && typeof businessRulesValue === "object") {
    const rawWarning = (businessRulesValue as any).warning_hours
    const rawDanger = (businessRulesValue as any).danger_hours
    if (typeof rawWarning === "number" && Number.isFinite(rawWarning) && rawWarning > 0) {
      warningHours = rawWarning
    }
    if (typeof rawDanger === "number" && Number.isFinite(rawDanger) && rawDanger > 0) {
      dangerHours = rawDanger
    }
  }

  let leadsQuery = supabase
    .from("leads_secure_view")
    .select(
      "id, team_id, owner_id, created_by, name, customer_name, stage, status, close_result, last_contact_at, next_contact_at, created_at, updated_at, customer_grade",
    )
    .neq("status", "pool")
    .limit(5000)

  if (params.teamId !== undefined) {
    leadsQuery = leadsQuery.eq("team_id", params.teamId)
  }
  if (params.ownerId) {
    leadsQuery = leadsQuery.eq("owner_id", params.ownerId)
  }

  let profilesQuery = supabase
    .from("profiles_public_view")
    .select("id, full_name, avatar_url, team_id, status")
    .eq("status", "active")
    .limit(500)

  if (params.teamId !== undefined) {
    profilesQuery = profilesQuery.eq("team_id", params.teamId)
  }
  if (params.ownerId) {
    profilesQuery = profilesQuery.eq("id", params.ownerId)
  }

  const [{ data: leadRows, error: leadsError }, { data: profileRows, error: profilesError }] =
    await Promise.all([leadsQuery, profilesQuery])

  if (leadsError) {
    console.error("Failed to load role dashboard leads", leadsError)
    throw leadsError
  }
  if (profilesError) {
    console.error("Failed to load role dashboard profiles", profilesError)
  }

  const leads = ((leadRows ?? []) as LeadSecureRow[]).filter((lead) => {
    const teamId = lead.team_id ?? null
    const ownerId = lead.owner_id ?? null
    if (teamId != null && excludedTeamIds.has(teamId)) return false
    if (ownerId && excludedProfileIds.has(ownerId)) return false
    return true
  })

  const usersById = new Map<string, DailyActivityUserRow>()
  for (const row of (profileRows ?? []) as any[]) {
    const id = row.id as string
    const teamId = (row.team_id as number | null) ?? null
    if (excludedProfileIds.has(id)) continue
    if (teamId != null && excludedTeamIds.has(teamId)) continue
    usersById.set(id, {
      id,
      name: (row.full_name as string | null) || id.slice(0, 8),
      avatarUrl: (row.avatar_url as string | null) ?? null,
      teamId,
      newLeads: 0,
      contactActions: 0,
      visits: 0,
      followUps: 0,
      qualifiedLeads: 0,
      wonLeads: 0,
      overdueLeads: 0,
    })
  }

  for (const lead of leads) {
    const ownerKey = getLeadOwnerKey(lead)
    if (ownerKey && !usersById.has(ownerKey)) {
      usersById.set(ownerKey, {
        id: ownerKey,
        name: ownerKey.slice(0, 8),
        avatarUrl: null,
        teamId: lead.team_id ?? null,
        newLeads: 0,
        contactActions: 0,
        visits: 0,
        followUps: 0,
        qualifiedLeads: 0,
        wonLeads: 0,
        overdueLeads: 0,
      })
    }
  }

  const trendMap = new Map<string, DashboardTrendPoint>()
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(trendStart, i)
    const key = toDateKey(day)
    trendMap.set(key, { date: key.slice(5), newLeads: 0, contactActions: 0, visits: 0 })
  }

  let periodNewLeads = 0
  let qualifiedLeads = 0
  let wonLeads = 0
  let overdueLeads = 0
  let pendingInRange = 0
  let newlyAssigned = 0
  let funnelContacted = 0
  let funnelVisited = 0
  let funnelInProgress = 0
  const customerDetailsById = new Map<string, DashboardCustomerDetailRow>()

  const leadIds = leads.map((lead) => lead.id).filter(Boolean)
  const leadById = new Map<string, LeadSecureRow>()
  for (const lead of leads) {
    leadById.set(lead.id, lead)
  }

  const addCustomerDetail = (lead: LeadSecureRow): DashboardCustomerDetailRow | null => {
    const ownerKey = getLeadOwnerKey(lead)
    const createdAt = lead.created_at ? new Date(lead.created_at) : null
    const nextContactAt = lead.next_contact_at ? new Date(lead.next_contact_at) : null
    const lastContactAt = lead.last_contact_at ? new Date(lead.last_contact_at) : createdAt
    const status = lead.status ?? "open"
    const ownerName = ownerKey ? usersById.get(ownerKey)?.name ?? ownerKey.slice(0, 8) : "未分配"
    const existing = customerDetailsById.get(lead.id)
    if (existing) return existing

    const detail: DashboardCustomerDetailRow = {
      id: lead.id,
      companyName: lead.name || "未命名线索",
      contactName: (lead as any).customer_name || "-",
      ownerId: ownerKey,
      ownerName,
      stage: lead.stage || "-",
      status: lead.status || "-",
      grade: lead.customer_grade ?? null,
      createdAt: lead.created_at ?? null,
      lastContactAt: lead.last_contact_at ?? null,
      nextContactAt: lead.next_contact_at ?? null,
      contactActions: 0,
      visits: 0,
      followUps: 0,
      isQualified: isQualifiedLead(lead),
      isWon: isWonLead(lead),
      isOverdue:
        status === "open" &&
        Boolean(
          (nextContactAt && nextContactAt < now) ||
            (!nextContactAt &&
              (!lastContactAt || (now.getTime() - lastContactAt.getTime()) / (1000 * 60 * 60) >= dangerHours)),
        ),
    }
    customerDetailsById.set(lead.id, detail)
    return detail
  }

  for (const lead of leads) {
    const ownerKey = getLeadOwnerKey(lead)
    const user = ownerKey ? usersById.get(ownerKey) : null
    const createdAt = lead.created_at ? new Date(lead.created_at) : null
    const updatedAt = lead.updated_at ? new Date(lead.updated_at) : null
    const nextContactAt = lead.next_contact_at ? new Date(lead.next_contact_at) : null
    const lastContactAt = lead.last_contact_at ? new Date(lead.last_contact_at) : createdAt
    const status = lead.status ?? "open"

    if (createdAt && createdAt >= rangeStart && createdAt < rangeEnd) {
      periodNewLeads += 1
      user && (user.newLeads += 1)
    }

    if (createdAt && createdAt >= trendStart && createdAt < rangeEnd) {
      const point = trendMap.get(toDateKey(startOfLocalDay(createdAt)))
      if (point) point.newLeads += 1
    }

    if (updatedAt && updatedAt >= rangeStart && updatedAt < rangeEnd) {
      newlyAssigned += 1
    }

    if (isQualifiedLead(lead)) {
      qualifiedLeads += 1
      user && (user.qualifiedLeads += 1)
    }

    if (isWonLead(lead)) {
      wonLeads += 1
      user && (user.wonLeads += 1)
    }

    if (status === "open") {
      const isDueInRange = nextContactAt && nextContactAt >= rangeStart && nextContactAt < rangeEnd
      const isNextContactOverdue = nextContactAt && nextContactAt < now
      const isRiskByAge =
        !nextContactAt &&
        (!lastContactAt || (now.getTime() - lastContactAt.getTime()) / (1000 * 60 * 60) >= dangerHours)

      if (isDueInRange) pendingInRange += 1
      if (isNextContactOverdue || isRiskByAge) {
        overdueLeads += 1
        user && (user.overdueLeads += 1)
      }

      const stage = (lead.stage ?? "").trim()
      if (["L2", "L3", "L4"].includes(stage)) {
        funnelInProgress += 1
      }
    }

    const shouldShowDetail =
      (createdAt && createdAt >= rangeStart && createdAt < rangeEnd) ||
      (nextContactAt && nextContactAt >= rangeStart && nextContactAt < rangeEnd)

    if (shouldShowDetail) {
      addCustomerDetail(lead)
    }
  }

  if (leadIds.length > 0) {
    const { data: notesRows, error: notesError } = await supabase
      .from("lead_notes")
      .select("author_id, lead_id, note_type, created_at, is_deleted")
      .in("lead_id", leadIds)
      .gte("created_at", trendStart.toISOString())
      .lte("created_at", rangeEnd.toISOString())
      .limit(5000)

    if (notesError) {
      console.error("Failed to load role dashboard notes", notesError)
    } else {
      for (const note of (notesRows ?? []) as any[]) {
        if (note.is_deleted) continue
        const authorId = (note.author_id as string | null) ?? null
        const noteType = ((note.note_type as string | null) ?? "note").trim()
        const createdAt = note.created_at ? new Date(note.created_at as string) : null
        if (!createdAt) continue

        const isInRange = createdAt >= rangeStart && createdAt < rangeEnd
        const point = trendMap.get(toDateKey(startOfLocalDay(createdAt)))
        const user = authorId ? usersById.get(authorId) : null
        const isContact = noteType === "call" || noteType === "wechat"
        const isVisit = noteType === "visit"
        const noteLeadId = (note.lead_id as string | null) ?? null
        const leadForNote = noteLeadId ? leadById.get(noteLeadId) : null
        const detail = isInRange && leadForNote ? addCustomerDetail(leadForNote) : null

        if (isContact) {
          funnelContacted += 1
          if (point) point.contactActions += 1
          if (isInRange) {
            user && (user.contactActions += 1)
            if (detail) detail.contactActions += 1
          }
        }
        if (isVisit) {
          funnelVisited += 1
          if (point) point.visits += 1
          if (isInRange) {
            user && (user.visits += 1)
            if (detail) detail.visits += 1
          }
        }
        if (isInRange) {
          if (user) user.followUps += 1
          if (detail) detail.followUps += 1
        }
      }
    }
  }

  const users = Array.from(usersById.values()).sort((a, b) => {
    if (b.overdueLeads !== a.overdueLeads) return b.overdueLeads - a.overdueLeads
    return b.newLeads + b.contactActions + b.visits - (a.newLeads + a.contactActions + a.visits)
  })

  const totals = users.reduce(
    (acc, user) => {
      acc.contactActions += user.contactActions
      acc.visits += user.visits
      acc.followUps += user.followUps
      return acc
    },
    {
      newLeads: periodNewLeads,
      contactActions: 0,
      visits: 0,
      followUps: 0,
      qualifiedLeads,
      wonLeads,
      overdueLeads,
      pendingToday: pendingInRange,
      newlyAssigned,
    },
  )

  const alerts: DashboardAlert[] = []
  const noNewLeadUsers = users.filter((user) => user.newLeads === 0)
  const noContactUsers = users.filter((user) => user.contactActions === 0)
  const noVisitUsers = users.filter((user) => user.visits === 0)
  const highOverdueUsers = users.filter((user) => user.overdueLeads > 0).slice(0, 3)

  if (overdueLeads > 0) {
    alerts.push({
      id: "overdue-leads",
      type: "danger",
      title: `${overdueLeads} 条线索逾期未跟进`,
      description: "建议优先处理高等级和已约定下次跟进时间的线索。",
    })
  }
  if (noNewLeadUsers.length > 0) {
    alerts.push({
      id: "no-new-leads",
      type: "warning",
      title: `${noNewLeadUsers.length} 人今日暂无新增线索`,
      description: noNewLeadUsers.slice(0, 4).map((user) => user.name).join("、"),
    })
  }
  if (noContactUsers.length > 0) {
    alerts.push({
      id: "no-contact-actions",
      type: "warning",
      title: `${noContactUsers.length} 人今日暂无建联行动`,
      description: noContactUsers.slice(0, 4).map((user) => user.name).join("、"),
    })
  }
  if (noVisitUsers.length > 0) {
    alerts.push({
      id: "no-visits",
      type: "info",
      title: `${noVisitUsers.length} 人今日暂无拜访记录`,
      description: "拜访包含线下拜访和需要记录为拜访的深度客户沟通。",
    })
  }
  for (const user of highOverdueUsers) {
    alerts.push({
      id: `user-overdue-${user.id}`,
      type: "danger",
      title: `${user.name} 有 ${user.overdueLeads} 条逾期线索`,
      description: "可进入线索页按负责人和风险状态进一步处理。",
    })
  }

  return {
    dateLabel,
    totals,
    users,
    trends: Array.from(trendMap.values()),
    alerts: alerts.slice(0, 6),
    customerDetails: Array.from(customerDetailsById.values())
      .sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
        const aTime = a.lastContactAt ?? a.createdAt ?? ""
        const bTime = b.lastContactAt ?? b.createdAt ?? ""
        return bTime.localeCompare(aTime)
      })
      .slice(0, 50),
    funnel: {
      newLeads: periodNewLeads,
      contacted: funnelContacted,
      visited: funnelVisited,
      inProgress: funnelInProgress,
      won: wonLeads,
    },
  }
}
