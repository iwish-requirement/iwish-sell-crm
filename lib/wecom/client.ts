// 兼容层：统一使用 requirement.iwishweb.com 的 WeCom Gateway
// - 发送消息：走网关鉴权，避免业务系统直连企微受“固定出口 IP 白名单”影响

import { sendWecomGatewayText } from "@/lib/wecom/gateway"

export async function sendWecomText(args: { toUser: string; content: string }): Promise<{ msgId?: string }> {
  const res = await sendWecomGatewayText({ toUserIds: [args.toUser], content: args.content })

  if (!res.ok) {
    const errcode = res.errcode ?? -1
    const errmsg = res.errmsg ?? "WECOM_GATEWAY_SEND_FAILED"
    throw new Error(`WECOM_GATEWAY_SEND_ERR_${errcode}:${errmsg}`)
  }

  return {}
}

