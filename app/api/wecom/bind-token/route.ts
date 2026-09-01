import { NextRequest, NextResponse } from "next/server"

import { createRouteHandlerClient } from "@/lib/supabase/server"




type RequestBody = {
  ttlMinutes?: number
}

function createBindToken(): string {
  // 32 bytes -> 64 hex chars
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}


export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient(req)


    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody

    const ttlMinutesRaw = typeof body.ttlMinutes === "number" ? body.ttlMinutes : 10
    const ttlMinutes = Number.isFinite(ttlMinutesRaw) ? Math.max(1, Math.min(60, Math.floor(ttlMinutesRaw))) : 10

    const bindToken = createBindToken()
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString()

    const { error } = await supabase.from("wecom_bind_tokens").insert({
      token: bindToken,
      user_id: user.id,
      expires_at: expiresAt,
      used: false,
    })

    if (error) {
      return NextResponse.json({ ok: false, error: "insert_failed", detail: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, bindToken, expiresAt })
  } catch (err: any) {
    const message = String(err?.message ?? "")
    console.error("/api/wecom/bind-token failed", err)

    const isSupabaseConfigError = message.toLowerCase().includes("supabase") && message.toLowerCase().includes("not configured")

    return NextResponse.json(
      {
        ok: false,
        error: isSupabaseConfigError ? "server_misconfigured" : "unexpected",
        detail: message,
      },
      { status: 500 },
    )
  }
}

