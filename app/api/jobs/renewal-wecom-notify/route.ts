import { NextRequest, NextResponse } from "next/server"

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendWecomGatewayText, buildPublicUrl } from "@/lib/wecom/gateway"

export const runtime = "edge"

function getJobToken(): string {
  return (process.env.RENEWAL_WECHAT_JOB_TOKEN ?? process.env.WECOM_RENEWAL_JOB_TOKEN ?? "").trim()
}

export async function POST(req: NextRequest) {
  const headerToken = (req.headers.get("x-job-token") ?? "").trim()
  const expectedToken = getJobToken()

  if (!expectedToken) {
    return NextResponse.json({ ok: false, error: "server_misconfigured" }, { status: 500 })
  }

  if (!headerToken || headerToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()

  try {
    const { data, error } = await admin.rpc("rpc_get_renewal_upcoming_wecom_targets")

    if (error) {
      console.error("rpc_get_renewal_upcoming_wecom_targets failed", error)
      const message = error.message || "load_targets_failed"
      const status = message.includes("ERR_") ? 400 : 500
      return NextResponse.json({ ok: false, error: message }, { status })
    }

    const targets = (data ?? []) as any[]

    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ ok: true, notifiedProfiles: 0, totalContracts: 0 })
    }

    let notifiedProfiles = 0
    let totalContracts = 0
    const notifiedProfileIds: string[] = []

    for (const item of targets) {
      const profileId = String(item.profile_id ?? "").trim()
      const fullName = String(item.full_name ?? "").trim() || "同事"
      const wecomUserId = String(item.wecom_user_id ?? "").trim()
      const contracts = Array.isArray(item.contracts) ? (item.contracts as any[]) : []

      if (!profileId || !wecomUserId || contracts.length === 0) {
        continue
      }

      totalContracts += contracts.length

      const lines: string[] = []
      lines.push(`${fullName}，以下客户合同即将到期，请提前安排续费跟进：`)

      for (const c of contracts) {
        const companyName = String(c.company_name ?? c.customer_name ?? "未命名客户")
        const contractNumber = String(c.contract_number ?? "-")
        const endDate = c.end_date ? new Date(c.end_date as string).toLocaleDateString("zh-CN") : "--"
        const amount = Number(c.amount ?? 0)
        const currency = String(c.currency ?? "CNY")

        const amountText = new Intl.NumberFormat("zh-CN", {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(amount)

        lines.push(`- ${companyName}｜合同编号：${contractNumber}｜到期日：${endDate}｜金额：${amountText}`)
      }

      const dashboardUrl = buildPublicUrl("/renewals")
      lines.push("")
      lines.push(`你可以在续费中心查看详情：${dashboardUrl}`)

      const content = lines.join("\n")

      const res = await sendWecomGatewayText({
        toUserIds: [wecomUserId],
        content,
      })

      if (!res.ok) {
        console.error("sendWecomGatewayText for renewal_upcoming failed", { wecomUserId, profileId, res })
        continue
      }

      notifiedProfiles += 1
      notifiedProfileIds.push(profileId)
    }

    if (notifiedProfileIds.length > 0) {
      const { error: markError } = await admin.rpc("rpc_wecom_mark_notified", {
        p_profile_ids: notifiedProfileIds,
      })

      if (markError) {
        console.error("rpc_wecom_mark_notified failed", markError)
      }
    }

    return NextResponse.json({
      ok: true,
      notifiedProfiles,
      totalContracts,
    })
  } catch (err: any) {
    console.error("/api/jobs/renewal-wecom-notify failed", err)
    const message = String(err?.message ?? "unexpected_error")
    return NextResponse.json({ ok: false, error: "unexpected", detail: message }, { status: 500 })
  }
}
