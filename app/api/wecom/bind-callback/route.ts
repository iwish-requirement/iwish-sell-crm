import { NextResponse } from "next/server"

import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

type RequestBody = {
  bindToken?: string
  wecomUserId?: string
}

function getCallbackToken(): string {
  return process.env.YOUR_BIND_CALLBACK_TOKEN ?? ""
}

export async function POST(req: Request) {
  try {
    const headerToken = req.headers.get("x-wecom-gateway-token") ?? ""
    const expectedToken = getCallbackToken()

    if (!expectedToken) {
      return NextResponse.json({ ok: false, error: "server_misconfigured" }, { status: 500 })
    }

    if (!headerToken || headerToken !== expectedToken) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody
    const bindToken = String(body.bindToken ?? "").trim()
    const wecomUserId = String(body.wecomUserId ?? "").trim()

    if (!bindToken) {
      return NextResponse.json({ ok: false, error: "missing_bindToken" }, { status: 400 })
    }

    if (!wecomUserId) {
      return NextResponse.json({ ok: false, error: "missing_wecomUserId" }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    const { error } = await admin.rpc("rpc_wecom_bind_callback", {
      p_bind_token: bindToken,
      p_wecom_user_id: wecomUserId,
    })

    if (error) {
      // map RPC error message for gateway
      const message = error.message || "bind_callback_failed"
      const status = message.includes("ERR_") ? 400 : 500
      return NextResponse.json({ ok: false, error: message }, { status })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    const message = String(err?.message ?? "")
    return NextResponse.json({ ok: false, error: "unexpected", detail: message }, { status: 500 })
  }
}
