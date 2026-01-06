import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import type { LeadSecureRow } from "@/lib/services/leads"
import { fetchLeadsSecureView } from "@/lib/services/leads"

export type ContractStatus = "pending" | "active" | "closed" | "cancelled"

export interface ContractRow {
  id: string
  leadId: string
  contractNumber: string
  title: string | null
  amount: number
  currency: string
  signedAt: string
  startDate: string | null
  endDate: string | null
  isRenewal: boolean
  originalContractId: string | null
  status: ContractStatus
  createdBy: string
  createdAt: string
  updatedAt: string
}

export async function fetchContractByLeadId(leadId: string): Promise<ContractRow | null> {
  const supabase = getBrowserSupabaseClient()

  const { data, error } = await supabase
    .from("contracts_secure_view")
    .select(
      "id, lead_id, contract_number, title, amount, currency, signed_at, start_date, end_date, is_renewal, original_contract_id, status, created_by, created_at, updated_at",
    )
    .eq("lead_id", leadId)
    .maybeSingle()

  if (error) {
    // PGRST116 表示无记录，其它视为错误
    if (error.code === "PGRST116") {
      return null
    }

    console.error("Failed to fetch contract by lead id", error)
    return null
  }

  if (!data) {
    return null
  }

  return {
    id: data.id as string,
    leadId: (data as any).lead_id as string,
    contractNumber: (data as any).contract_number as string,
    title: (data as any).title as string | null,
    amount: (data as any).amount as number,
    currency: (data as any).currency as string,
    signedAt: (data as any).signed_at as string,
    startDate: (data as any).start_date as string | null,
    endDate: (data as any).end_date as string | null,
    isRenewal: Boolean((data as any).is_renewal),
    originalContractId: (data as any).original_contract_id as string | null,
    status: (data as any).status as ContractStatus,
    createdBy: (data as any).created_by as string,
    createdAt: (data as any).created_at as string,
    updatedAt: (data as any).updated_at as string,
  }
}

export interface ContractUpsertPayload {
  contractNumber: string
  title?: string
  amount: number
  currency?: string
  signedAt: string
  startDate?: string
  endDate?: string
  isRenewal?: boolean
  originalContractId?: string | null
  status?: ContractStatus
}

export async function upsertContractForLead(leadId: string, payload: ContractUpsertPayload): Promise<string> {
  const supabase = getBrowserSupabaseClient()

  const { data, error } = await supabase.rpc("rpc_contract_upsert", {
    p_lead_id: leadId,
    payload: {
      contract_number: payload.contractNumber,
      title: payload.title ?? null,
      amount: payload.amount,
      currency: payload.currency ?? "CNY",
      signed_at: payload.signedAt,
      start_date: payload.startDate ?? null,
      end_date: payload.endDate ?? null,
      is_renewal: payload.isRenewal ?? false,
      original_contract_id: payload.originalContractId ?? null,
      status: payload.status ?? "active",
    },
  })

  if (error) {
    console.error("Failed to upsert contract", error)
    throw error
  }

  const id = data as string | null
  if (!id) {
    throw new Error("rpc_contract_upsert did not return an id")
  }

  return id
}

export interface RenewalContractListItem {
  contractId: string
  leadId: string
  customerName: string | null
  companyName: string | null
  contractNumber: string
  amount: number
  currency: string
  signedAt: string | null
  startDate: string | null
  endDate: string | null
  isRenewal: boolean
  status: ContractStatus
  daysToEnd: number | null
  ownerId: string | null
  ownerName: string | null
  teamId: number | null
}


export async function fetchRenewalContracts(horizonDays = 90, expiredWindowDays = 30): Promise<RenewalContractListItem[]> {
  const supabase = getBrowserSupabaseClient()

  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const minDate = new Date(startOfToday.getTime() - expiredWindowDays * 24 * 60 * 60 * 1000)
  const maxDate = new Date(startOfToday.getTime() + horizonDays * 24 * 60 * 60 * 1000)

  const minDateStr = minDate.toISOString().slice(0, 10)
  const maxDateStr = maxDate.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from("contracts_secure_view")
    .select(
      "id, lead_id, contract_number, title, amount, currency, signed_at, start_date, end_date, is_renewal, original_contract_id, status, created_by, created_at, updated_at",
    )
    .not("end_date", "is", null)
    .gte("end_date", minDateStr)
    .lte("end_date", maxDateStr)
    .limit(1000)


  if (error) {
    console.error("Failed to fetch renewal contracts", error)
    throw error
  }

  const rows = (data ?? []) as any[]

  if (rows.length === 0) {
    return []
  }

  const leadIds = Array.from(new Set(rows.map((row) => row.lead_id as string).filter(Boolean)))

  let leadsById: Record<string, LeadSecureRow> = {}

  if (leadIds.length > 0) {
    const leadRows = await fetchLeadsSecureView({ ids: leadIds })

    leadsById = leadRows.reduce<Record<string, LeadSecureRow>>((acc, lead) => {
      acc[lead.id] = lead
      return acc
    }, {})
  }

  const startOfTodayMs = startOfToday.getTime()

  const items: RenewalContractListItem[] = rows.map((row) => {

    const lead = leadsById[row.lead_id as string]
    const endDateStr = row.end_date as string | null

    let daysToEnd: number | null = null
    if (endDateStr) {
      const endDate = new Date(endDateStr)
      const diffMs = endDate.getTime() - startOfTodayMs
      daysToEnd = Math.floor(diffMs / (24 * 60 * 60 * 1000))
    }

    const customerName = (lead?.customer_name as string | null) ?? null
    const companyName = (lead?.name as string | null) ?? customerName
    const ownerId = (lead?.owner_id as string | null) ?? null
    const teamId = (lead?.team_id as number | null) ?? null

    return {
      contractId: row.id as string,
      leadId: row.lead_id as string,
      customerName,
      companyName,
      contractNumber: (row.contract_number as string) ?? "",
      amount: (row.amount as number) ?? 0,
      currency: (row.currency as string) ?? "CNY",
      signedAt: (row.signed_at as string | null) ?? null,
      startDate: (row.start_date as string | null) ?? null,
      endDate: endDateStr,
      isRenewal: Boolean(row.is_renewal),
      status: (row.status as ContractStatus) ?? "active",
      daysToEnd,
      ownerId,
      ownerName: null,
      teamId,
    }
  })


  const ownerIds = Array.from(
    new Set(items.map((item) => item.ownerId).filter((id): id is string => Boolean(id))),
  )

  let enrichedItems = items

  if (ownerIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles_public")
      .select("id, full_name")
      .in("id", ownerIds)

    if (profilesError) {
      console.error("Failed to load owners for renewal contracts", profilesError)
    } else if (profiles && profiles.length > 0) {
      const nameById: Record<string, string> = {}
      for (const row of profiles as any[]) {
        const id = row.id as string
        const fullName = (row.full_name as string | null) ?? null
        if (id && fullName) {
          nameById[id] = fullName
        }
      }

      enrichedItems = items.map((item) => ({
        ...item,
        ownerName: item.ownerId ? nameById[item.ownerId] ?? null : null,
      }))
    }
  }

  enrichedItems.sort((a, b) => {
    if (!a.endDate && !b.endDate) return 0
    if (!a.endDate) return 1
    if (!b.endDate) return -1
    return new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
  })

  return enrichedItems
}


export interface ContractPaymentRow {
  id: string
  contractId: string
  amount: number
  currency: string
  paidAt: string
  method: string | null
  note: string | null
  status: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export async function fetchContractPayments(contractId: string): Promise<ContractPaymentRow[]> {
  const supabase = getBrowserSupabaseClient()

  const { data, error } = await supabase
    .from("contract_payments_secure_view")
    .select("id, contract_id, amount, currency, paid_at, method, note, status, created_by, created_at, updated_at")
    .eq("contract_id", contractId)
    .order("paid_at", { ascending: false })

  if (error) {
    console.error("Failed to fetch contract payments", error)
    throw error
  }

  const rows = (data ?? []) as any[]

  return rows.map((row) => ({
    id: row.id as string,
    contractId: row.contract_id as string,
    amount: (row.amount as number) ?? 0,
    currency: (row.currency as string) ?? "CNY",
    paidAt: (row.paid_at as string) ?? new Date().toISOString(),
    method: (row.method as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    status: (row.status as string) ?? "confirmed",
    createdBy: (row.created_by as string) ?? "",
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  }))
}

export interface ContractPaymentCreatePayload {
  amount: number
  currency?: string
  paidAt: string
  method?: string
  note?: string
  status?: string
}

export async function addContractPayment(contractId: string, payload: ContractPaymentCreatePayload): Promise<string> {
  const supabase = getBrowserSupabaseClient()

  const { data, error } = await supabase.rpc("rpc_contract_payment_add", {
    p_contract_id: contractId,
    payload: {
      amount: payload.amount,
      currency: payload.currency ?? "CNY",
      paid_at: payload.paidAt,
      method: payload.method ?? null,
      note: payload.note ?? null,
      status: payload.status ?? "confirmed",
    },
  })

  if (error) {
    console.error("Failed to add contract payment", error)
    throw error
  }

  const id = data as string | null
  if (!id) {
    throw new Error("rpc_contract_payment_add did not return an id")
  }

  return id
}
