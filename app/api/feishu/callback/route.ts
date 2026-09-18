// 飞书事件/卡片回调入口：
// 1. URL 验证（challenge）
// 2. 卡片回传（card.action.trigger）：负责人提交团队名单 -> 校验身份 -> 写入分配单 -> 更新卡片
// 飞书要求回调在 3 秒内响应，处理逻辑保持轻量，异常也返回 200 避免重试风暴。
import { NextRequest, NextResponse } from "next/server"

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  decryptFeishuPayload,
  getFeishuEncryptKey,
  getFeishuVerificationToken,
  isFeishuConfigured,
  sendCardToUser,
  updateCardMessage,
} from "@/lib/feishu/client"
import { buildAllocationConfirmedCard, ROLE_FIELDS } from "@/lib/feishu/card"

type CardActionBody = {
  type?: string
  challenge?: string
  token?: string
  encrypt?: string
  schema?: string
  header?: { event_type?: string; token?: string; event_id?: string }
  event?: {
    operator?: { open_id?: string }
    context?: { open_message_id?: string }
    action?: { form_value?: Record<string, unknown>; input_value?: unknown; value?: unknown }
  }
}

function tokenMatches(received: string | undefined): boolean {
  const expected = getFeishuVerificationToken()
  if (!expected) return false
  return Boolean(received) && received === expected
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  if (typeof value === "string" && value) return [value]
  return []
}

async function handleCardAction(body: CardActionBody): Promise<void> {
  const admin = createAdminSupabaseClient()
  const operatorOpenId = body.event?.operator?.open_id ?? ""
  const messageId = body.event?.context?.open_message_id ?? ""
  const rawForm = (body.event?.action?.form_value ?? body.event?.action?.input_value ?? {}) as Record<string, unknown>

  if (!operatorOpenId || !messageId) return

  const { data: mapping, error: mappingError } = await admin
    .from("feishu_card_messages")
    .select("assignment_id")
    .eq("message_id", messageId)
    .maybeSingle()
  if (mappingError || !mapping?.assignment_id) {
    console.error("feishu card mapping not found", { messageId, mappingError })
    // 给点击者可见反馈，避免"点了没反应"
    await updateCardMessage(messageId, {
      schema: "2.0",
      config: { update_multi: true },
      header: { title: { tag: "plain_text", content: "卡片已失效" }, template: "red" },
      body: {
        elements: [
          { tag: "div", text: { tag: "lark_md", content: "该卡片对应的分配单不存在或已被重新分配。请在 CRM 分配中心点击「通知」重新发送确认卡片。" } },
        ],
      },
    }).catch(() => undefined)
    return
  }

  const roles: Record<string, string[]> = {}
  for (const [key] of ROLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawForm, key)) {
      roles[key] = toStringArray(rawForm[key])
    }
  }

  try {
    const { data: summary, error } = await admin.rpc("rpc_allocation_confirm_from_feishu", {
      p_assignment_id: mapping.assignment_id,
      p_feishu_user_id: operatorOpenId,
      p_roles: roles,
    })
    if (error) throw error

    const payload = (summary ?? {}) as { company_name?: string; roles?: Record<string, string[]> }
    const card = buildAllocationConfirmedCard({
      companyName: payload.company_name ?? "",
      roleNames: payload.roles ?? {},
      confirmedBy: operatorOpenId,
    })
    const updated = await updateCardMessage(messageId, card)
    if (!updated.ok) {
      await sendCardToUser(operatorOpenId, card)
    }
  } catch (err: any) {
    const message = String(err?.message ?? err)
    console.error("feishu card confirm failed", { messageId, operatorOpenId, message })
    let hint = "提交失败，请稍后重试或联系 CRM 管理员。"
    if (message.includes("not_project_manager")) hint = "只有该分配单的项目负责人可以提交团队名单。"
    else if (message.includes("member_not_synced")) hint = "所选成员尚未同步到 CRM 通讯录，请联系管理员先执行「同步飞书通讯录」。"
    await sendCardToUser(operatorOpenId, {
      schema: "2.0",
      header: { title: { tag: "plain_text", content: "提交未成功" }, template: "red" },
      body: { elements: [{ tag: "div", text: { tag: "lark_md", content: hint } }] },
    }).catch(() => undefined)
  }
}

export async function POST(req: NextRequest) {
  let body: CardActionBody
  try {
    body = (await req.json()) as CardActionBody
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  if (typeof body.encrypt === "string" && body.encrypt) {
    if (!getFeishuEncryptKey()) {
      return NextResponse.json({ ok: false, error: "encrypt_key_not_configured" }, { status: 400 })
    }
    try {
      body = JSON.parse(decryptFeishuPayload(body.encrypt)) as CardActionBody
    } catch (err) {
      console.error("feishu payload decrypt failed", err)
      return NextResponse.json({ ok: false, error: "decrypt_failed" }, { status: 400 })
    }
  }

  if (body.type === "url_verification") {
    if (!tokenMatches(body.token)) {
      return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 403 })
    }
    return NextResponse.json({ challenge: body.challenge ?? "" })
  }

  const headerToken = body.header?.token ?? (body as any).token
  if (!tokenMatches(headerToken)) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 403 })
  }

  if (!isFeishuConfigured()) {
    return NextResponse.json({ ok: false, error: "feishu_not_configured" }, { status: 500 })
  }

  const eventType = body.header?.event_type ?? ""
  try {
    if (eventType === "card.action.trigger") {
      await handleCardAction(body)
    }
    // 其他事件（如消息、通讯录变更）当前不处理，直接确认。
  } catch (err) {
    console.error("feishu callback handling failed", err)
  }

  return NextResponse.json({ ok: true })
}
