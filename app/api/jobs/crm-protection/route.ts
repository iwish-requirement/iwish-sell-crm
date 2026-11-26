import { NextResponse } from "next/server"
import { authorizeOperations } from "@/lib/operations-handoffs/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export async function POST(request: Request) {
  if (!authorizeOperations(request, process.env.CRM_PROTECTION_JOB_TOKEN)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  try {
    const { data, error } = await createAdminSupabaseClient().rpc("rpc_crm_run_protection")
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("CRM protection job failed", error)
    return NextResponse.json({ error: "PROTECTION_JOB_UNAVAILABLE" }, { status: 503 })
  }
}
