import { NextRequest, NextResponse } from "next/server"

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { createRouteHandlerClient } from "@/lib/supabase/server"

export const runtime = "edge"

type RejectRequestBody = {
  userId?: string
  reason?: string
}

function errorStatus(message: string): number {
  if (message.includes("ERR_NO_PERMISSION:auth.reject")) {
    return 403
  }

  if (message.includes("ERR_INVALID_STATUS:only_pending_can_reject")) {
    return 409
  }

  if (message.includes("ERR_VALIDATION:rejection_reason_required")) {
    return 400
  }

  return 500
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as RejectRequestBody
    const userId = String(body.userId ?? "").trim()
    const reason = String(body.reason ?? "").trim()

    if (!userId) {
      return NextResponse.json({ ok: false, error: "ERR_VALIDATION:user_id_required" }, { status: 400 })
    }

    if (!reason) {
      return NextResponse.json({ ok: false, error: "ERR_VALIDATION:rejection_reason_required" }, { status: 400 })
    }

    const supabase = createRouteHandlerClient(req)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }

    // Create this before the RPC so server misconfiguration cannot leave a profile rejected
    // while the Auth user remains registered.
    const admin = createAdminSupabaseClient()

    const { error: rejectError } = await supabase.rpc("rpc_auth_reject", {
      p_user_id: userId,
      p_reason: reason,
    })

    if (rejectError) {
      const message = rejectError.message || "ERR_REJECT_FAILED"
      return NextResponse.json({ ok: false, error: message }, { status: errorStatus(message) })
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId)

    if (deleteError) {
      const message = deleteError.message || "delete_auth_user_failed"
      const missingUser = message.toLowerCase().includes("not found")

      if (!missingUser) {
        console.error("delete rejected auth user failed", { userId, message })
        return NextResponse.json(
          { ok: false, error: "ERR_AUTH_DELETE_FAILED", detail: message },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    const message = String(err?.message ?? "")
    console.error("/api/auth/reject failed", err)

    const isSupabaseConfigError = message.toLowerCase().includes("supabase") && message.toLowerCase().includes("not configured")

    return NextResponse.json(
      {
        ok: false,
        error: isSupabaseConfigError ? "ERR_SERVER_MISCONFIGURED" : "unexpected",
        detail: message,
      },
      { status: 500 },
    )
  }
}
