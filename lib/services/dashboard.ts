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

export async function fetchDashboardSummary(
  params: DashboardFilterParams = {},
): Promise<DashboardSummary> {
  const supabase = getBrowserSupabaseClient()

  let query = supabase
    .from("leads_secure_view")
    .select("id, status, close_result, budget, last_contact_at, created_at")
    .neq("status", "pool")


  if (params.teamId !== undefined) {
    query = query.eq("team_id", params.teamId)
  }

  if (params.ownerId) {
    query = query.eq("owner_id", params.ownerId)
  }

  const { data, error } = await query

  if (error) {
    console.error("Failed to load dashboard summary leads", error)
    throw error
  }

  const leads = (data ?? []) as LeadSecureRow[]

  const now = new Date()
  const totalLeads = leads.length

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

    if (status === "closed") {
      if (closeResult === "won" || closeResult === "成交") {
        closedWon += 1

        if (createdAt && createdAt >= monthStart) {
          monthlyRevenue += budget
        }
      } else {
        closedLost += 1
      }
    }

    if (status === "open") {
      if (lastContact) {
        const diffDays = (now.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24)
        if (diffDays >= 7) {
          riskLeadCount += 1
        }
      } else {
        riskLeadCount += 1
      }
    }
  }

  const denominator = closedWon + closedLost
  const winRate = denominator > 0 ? (closedWon / denominator) * 100 : 0

  return {
    totalLeads,
    winRate,
    monthlyRevenue,
    riskLeadCount,
  }
}

type LeadStageRow = Pick<LeadSecureRow, "id" | "stage" | "status" | "close_result">

export interface SalesFunnelCounts {
  byStage: Record<string, number>
}

export async function fetchSalesFunnelCounts(
  params: DashboardFilterParams = {},
): Promise<SalesFunnelCounts> {
  const supabase = getBrowserSupabaseClient()

  let query = supabase
    .from("leads_secure_view")
    .select("id, stage, status, close_result")

  if (params.teamId !== undefined) {
    query = query.eq("team_id", params.teamId)
  }

  if (params.ownerId) {
    query = query.eq("owner_id", params.ownerId)
  }

  const { data, error } = await query

  if (error) {
    console.error("Failed to load sales funnel leads", error)
    throw error
  }

  const leads = (data ?? []) as LeadStageRow[]

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
