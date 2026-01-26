import { NextRequest, NextResponse } from "next/server"

import { createRouteHandlerClient } from "@/lib/supabase/server"

export const runtime = "edge"

function getGatewayBaseUrl(): string {
  const raw = (process.env.WECOM_GATEWAY_BASE_URL ?? "https://requirement.iwishweb.com").trim()
  return raw.replace(/\/$/, "")
}

function getSystemKey(): string {
  return (
    (process.env.WECOM_GATEWAY_SYSTEM_KEY ?? "").trim() ||
    (process.env.SYSTEM_KEY ?? "").trim() ||
    (process.env.NEXT_PUBLIC_SYSTEM_KEY ?? "").trim() ||
    "crm"
  )
}

function createBindToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient(req)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }

    const bindToken = createBindToken()
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

    const { error: insertError } = await supabase.from("wecom_bind_tokens").insert({
      token: bindToken,
      user_id: user.id,
      expires_at: expiresAt,
      used: false,
    })

    if (insertError) {
      return NextResponse.json(
        { ok: false, error: "insert_failed", detail: insertError.message },
        { status: 400 },
      )
    }

    const gatewayBase = getGatewayBaseUrl()
    const systemKey = getSystemKey()
    const returnTo = "/profile"

    const url = new URL(`${gatewayBase}/api/wecom-gateway/bind/start`)
    url.searchParams.set("systemKey", systemKey)
    url.searchParams.set("bindToken", bindToken)
    url.searchParams.set("returnTo", returnTo)

    const gatewayRes = await fetch(url.toString(), { method: "GET", cache: "no-store" })
    const gatewayJson = (await gatewayRes.json().catch(() => ({}))) as any

    if (!gatewayRes.ok || !gatewayJson?.url) {
      return NextResponse.json(
        {
          ok: false,
          error: "gateway_failed",
          detail: {
            status: gatewayRes.status,
            payload: gatewayJson,
          },
        },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true, url: String(gatewayJson.url) })

  } catch (err: any) {
    console.error("/api/wecom/bind/start failed", err)
    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
