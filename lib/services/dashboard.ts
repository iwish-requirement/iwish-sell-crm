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
    supabase
      .from("settings")
      .select("value")
      .eq("key", "analytics.excluded_teams")
      .maybeSingle(),
    supabase
      .from("settings")
      .select("value")
      .eq("key", "analytics.excluded_profiles")
      .maybeSingle(),
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
    teamExclusionRow && (teamExclusionRow as any).value &&
    Array.isArray(((teamExclusionRow as any).value as any).team_ids)
      ? (((teamExclusionRow as any).value as any).team_ids as any[]).filter(
          (v: any) => typeof v === "number",
        )
      : [],
  )

  const excludedProfileIds = new Set<string>(
    profileExclusionRow && (profileExclusionRow as any).value &&
    Array.isArray(((profileExclusionRow as any).value as any).profile_ids)
      ? (((profileExclusionRow as any).value as any).profile_ids as any[]).filter(
          (v: any) => typeof v === "string",
        )
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

  // 默认预警/风险阈值：72 小时（3 天）预警，168 小时（7 天）风险
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
    const budget = lead.budget ?? 0
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

    // 仪表盘“风险线索”：只统计在谈线索（open），成交/丢单都不计入
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




  const denominator = closedWon + closedLost
  const winRate = denominator > 0 ? (closedWon / denominator) * 100 : 0

  const { data: payments, error: paymentsError } = await supabase
    .from("contract_payments_secure_view")
    .select("amount, paid_at")
    .gte("paid_at", monthStart.toISOString())
    .lte("paid_at", now.toISOString())

  if (paymentsError) {
    console.error("Failed to load dashboard payments summary", paymentsError)
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

  let query = supabase
    .from("leads_secure_view")
    .select("id, team_id, owner_id, stage, status, close_result")


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
    supabase
      .from("settings")
      .select("value")
      .eq("key", "analytics.excluded_teams")
      .maybeSingle(),
    supabase
      .from("settings")
      .select("value")
      .eq("key", "analytics.excluded_profiles")
      .maybeSingle(),
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
    teamExclusionRow && (teamExclusionRow as any).value &&
    Array.isArray(((teamExclusionRow as any).value as any).team_ids)
      ? (((teamExclusionRow as any).value as any).team_ids as any[]).filter(
          (v: any) => typeof v === "number",
        )
      : [],
  )

  const excludedProfileIds = new Set<string>(
    profileExclusionRow && (profileExclusionRow as any).value &&
    Array.isArray(((profileExclusionRow as any).value as any).profile_ids)
      ? (((profileExclusionRow as any).value as any).profile_ids as any[]).filter(
          (v: any) => typeof v === "string",
        )
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

    let logicalStage = rawStage

    if (!logicalStage) {
      logicalStage = "L1"
    }

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
