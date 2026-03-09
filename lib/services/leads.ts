import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export interface LeadSecureRow {
  id: string
  team_id: number | null
  owner_id: string | null
  created_by: string | null
  name: string | null
  source: string | null
  stage: string | null
  status: string | null
  close_result: string | null
  close_reason: string | null
  last_contact_at: string | null
  created_at: string
  updated_at: string
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  address: string | null
  budget: number | null
  internal_score: number | null
  blacklist_reason: string | null
  next_contact_at: string | null
  wechat: string | null
  customer_grade: string | null
  source_level1: string | null
  source_level2: string | null
  tags: string[] | null
  first_contact_at?: string | null
  locked_by?: string | null
  locked_until?: string | null
  protected_until?: string | null
  business_categories?: { id: number; name: string }[] | null
  business_types?: { id: number; name: string; category_id: number }[] | null
  responsibility_type?: string | null
  dev_method_key?: string | null
  referral_customer_name?: string | null
  referral_type_key?: string | null
  activity_name?: string | null
  source_department_key?: string | null
  source_locked_at?: string | null
}





export interface LeadSecureQueryParams {
  status?: string
  teamId?: number
  ownerId?: string
  limit?: number
  ids?: string[]
}


export async function fetchLeadsSecureView(params: LeadSecureQueryParams = {}): Promise<LeadSecureRow[]> {
  const supabase = getBrowserSupabaseClient()

  let query = supabase
    .from("leads_secure_view")
    .select(
      "id, team_id, owner_id, created_by, name, source, stage, status, close_result, close_reason, last_contact_at, created_at, updated_at, customer_name, customer_phone, customer_email, address, budget, internal_score, blacklist_reason, next_contact_at, wechat, customer_grade, source_level1, source_level2, tags, first_contact_at, locked_by, locked_until, protected_until, business_categories, business_types, responsibility_type, dev_method_key, referral_customer_name, referral_type_key, activity_name, source_department_key, source_locked_at",
    )





  if (params.status) {
    query = query.eq("status", params.status)
  }

  if (params.teamId !== undefined) {
    query = query.eq("team_id", params.teamId)
  }

  if (params.ownerId) {
    query = query.eq("owner_id", params.ownerId)
  }

  if (params.ids && params.ids.length > 0) {
    query = query.in("id", params.ids)
  }

  if (params.limit !== undefined && params.limit > 0) {
    query = query.limit(params.limit)
  }


  const { data, error } = await query

  if (error) {
    console.error("Failed to fetch leads_secure_view", error)
    throw error
  }

  return (data ?? []) as LeadSecureRow[]
}

export async function createLead(payload: Record<string, unknown>): Promise<string> {
  const supabase = getBrowserSupabaseClient()

  const { data, error } = await supabase.rpc("rpc_lead_create", {
    payload,
  })

  if (error) {
    console.error("Failed to create lead", error)
    throw error
  }

  const leadId = data as string | null

  if (!leadId) {
    console.error("rpc_lead_create did not return a lead id")
    throw new Error("Failed to create lead")
  }

  return leadId
}

export async function updateLead(
  leadId: string,
  patch: Record<string, unknown>,
  reason?: string | null,
): Promise<void> {
  const supabase = getBrowserSupabaseClient()

  const { error } = await supabase.rpc("rpc_lead_update", {
    p_lead_id: leadId,
    patch,
    p_reason: reason ?? null,
  })

  if (error) {
    console.error("Failed to update lead", error)
    throw error
  }
}


export async function assignLead(leadId: string, newOwnerId: string, reason?: string | null): Promise<void> {
  const supabase = getBrowserSupabaseClient()

  const { error } = await supabase.rpc("rpc_lead_assign", {
    p_lead_id: leadId,
    p_new_owner: newOwnerId,
    p_reason: reason ?? null,
  })

  if (error) {
    console.error("Failed to assign lead", error)
    throw error
  }
}


export async function transferLead(leadId: string, newTeamId: number, newOwnerId: string): Promise<void> {
  const supabase = getBrowserSupabaseClient()

  const { error } = await supabase.rpc("rpc_lead_transfer", {
    p_lead_id: leadId,
    p_new_team_id: newTeamId,
    p_new_owner: newOwnerId,
  })

  if (error) {
    console.error("Failed to transfer lead", error)
    throw error
  }
}

export async function closeLead(leadId: string, result: string, reason: string | null): Promise<void> {
  const supabase = getBrowserSupabaseClient()

  const { error } = await supabase.rpc("rpc_lead_close", {
    p_lead_id: leadId,
    p_result: result,
    p_reason: reason,
  })

  if (error) {
    console.error("Failed to close lead", error)
    throw error
  }
}
