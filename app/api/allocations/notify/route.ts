// 分配保存后向项目负责人发送飞书确认卡片，并登记 message_id -> assignment 映射。
// 调用方：分配中心页面（携带当前用户 Bearer JWT，需 allocations.manage 权限）。
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isFeishuConfigured, sendCardToUser } from "@/lib/feishu/client"
import { buildAllocationConfirmCard } from "@/lib/feishu/card"

function resolveSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "")
}

function resolveAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "")
}

type NotifyPayload = {
  assignment_id: string
  lead_id: string
  company_name: string | null
  customer_name: string | null
  website: string | null
  department_name: string | null
  platforms: string[] | null
  note: string | null
  detail_link: string | null
  pm_open_id: string | null
  pm_name: string | null
  confirmed_at: string | null
}

export async function POST(req: NextRequest) {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!bearer) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  if (!isFeishuConfigured()) {
    return NextResponse.json({ ok: false, error: "feishu_not_configured" }, { status: 500 })
  }

  let leadId = ""
  try {
    const body = (await req.json()) as { lead_id?: string }
    leadId = String(body.lead_id ?? "").trim()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 })
  }
  if (!leadId) {
    return NextResponse.json({ ok: false, error: "lead_id_required" }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { data: authData, error: authError } = await admin.auth.getUser(bearer)
  if (authError || !authData?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  // 权限校验在 SQL 内完成（allocations.manage）。
  const userClient = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: payloadData, error: payloadError } = await userClient.rpc("rpc_allocation_notify_payload", {
    p_lead_id: leadId,
  })
  if (payloadError) {
    const message = payloadError.message || "payload_failed"
    const status = message.includes("ERR_NO_PERMISSION") ? 403 : message.includes("ERR_NOT_FOUND") ? 404 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }

  const payload = payloadData as unknown as NotifyPayload
  if (!payload?.pm_open_id) {
    return NextResponse.json({ ok: false, error: "pm_not_synced" }, { status: 400 })
  }

  const card = buildAllocationConfirmCard({
    companyName: payload.company_name || "未命名客户",
    customerName: payload.customer_name,
    departmentName: payload.department_name,
    salesOwnerName: null,
    platforms: payload.platforms ?? [],
    note: payload.note,
    detailLink: payload.detail_link,
  })

  const sent = await sendCardToUser(payload.pm_open_id, card)
  if (!sent.ok || !sent.messageId) {
    console.error("feishu send card failed", { pm: payload.pm_open_id, sent })
    return NextResponse.json({ ok: false, error: `feishu_send_failed:${sent.code ?? -1}:${sent.msg ?? ""}` }, { status: 502 })
  }

  const { error: mapError } = await admin
    .from("feishu_card_messages")
    .upsert({ message_id: sent.messageId, assignment_id: payload.assignment_id }, { onConflict: "message_id" })
  if (mapError) {
    console.error("feishu card mapping insert failed", mapError)
    return NextResponse.json({ ok: false, error: "mapping_insert_failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, messageId: sent.messageId, pmName: payload.pm_name })
}
