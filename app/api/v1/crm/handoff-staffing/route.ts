import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { authorizeOperations, operationsEnabled, readOperationsJson, staffingCallback } from "@/lib/operations-handoffs/server"

export async function POST(request: Request) {
  if (!operationsEnabled()) return NextResponse.json({ error: "OPS_INTEGRATION_DISABLED" }, { status: 503 })
  if (!authorizeOperations(request, process.env.CRM_OPERATIONS_CALLBACK_TOKEN)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  let input: unknown
  try {
    input = await readOperationsJson(request)
  } catch (error) {
    return error instanceof RangeError
      ? NextResponse.json({ error: "BODY_TOO_LARGE" }, { status: 413 })
      : NextResponse.json({ error: "INVALID_JSON" }, { status: 400 })
  }
  const parsed = staffingCallback.safeParse(input)
  if (!parsed.success) return NextResponse.json({ error: "INVALID_STAFFING" }, { status: 400 })

  try {
    const body = parsed.data
    const { data, error } = await createAdminSupabaseClient().rpc("rpc_operations_staffing_accept", {
      p_handoff_id: body.handoffId,
      p_department_id: body.departmentId,
      p_body: body,
    })
    if (error || !data) throw new Error("Staffing write failed")
    return NextResponse.json(data, {
      status: data.accepted ? 200 : data.error === "OPS_INTEGRATION_DISABLED" ? 503 : 409,
    })
  } catch {
    return NextResponse.json({ error: "STAFFING_TEMPORARILY_UNAVAILABLE" }, { status: 503 })
  }
}
