import { NextResponse } from "next/server"
import { authorizeOperations, dispatchOperationsHandoffs, handoffIdSchema, operationsEnabled } from "@/lib/operations-handoffs/server"

export async function POST(request: Request) {
  if (!operationsEnabled()) return NextResponse.json({ error: "OPS_INTEGRATION_DISABLED" }, { status: 503 })
  if (!authorizeOperations(request, process.env.CRM_OPERATIONS_JOB_TOKEN)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  const retryId = new URL(request.url).searchParams.get("retry")
  if (retryId !== null && !handoffIdSchema.safeParse(retryId).success) {
    return NextResponse.json({ error: "INVALID_HANDOFF_ID" }, { status: 400 })
  }
  try {
    const result = await dispatchOperationsHandoffs(retryId)
    return NextResponse.json(result.body, { status: result.status })
  } catch {
    return NextResponse.json({ error: "DISPATCH_TEMPORARILY_UNAVAILABLE" }, { status: 503 })
  }
}
