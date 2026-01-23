type WecomGatewaySendBody = {
  msgType: "text"
  toUserIds: string[]
  content: string
}

type WecomGatewayResponse = {
  ok: boolean
  errcode?: number
  errmsg?: string
  detail?: any
}

const WECOM_GATEWAY_BASE_URL = "https://requirement.iwishweb.com"

function getSystemKey(): string {
  return (
    (process.env.SYSTEM_KEY ?? "").trim() ||
    (process.env.NEXT_PUBLIC_SYSTEM_KEY ?? "").trim() ||
    (process.env.WECOM_GATEWAY_SYSTEM_KEY ?? "").trim() ||
    "crm"
  )
}

function getSystemToken(): string {
  return (
    (process.env.SYSTEM_TOKEN ?? "").trim() ||
    (process.env.WECOM_GATEWAY_SYSTEM_TOKEN ?? "").trim() ||
    (process.env.WECOM_GATEWAY_SYSTEMKEY_TOKEN ?? "").trim()
  )
}

function getPublicBaseUrl(): string {
  return ((process.env.PUBLIC_BASE_URL ?? "").trim() || (process.env.APP_PUBLIC_URL ?? "").trim()).replace(/\/$/, "")
}

function getMessagePrefix(): string {
  const raw = (process.env.WECOM_MESSAGE_PREFIX ?? "").trim()
  if (raw) return raw

  const name = (process.env.WECOM_SYSTEM_NAME ?? "CRM").trim() || "CRM"
  return `【${name}】`
}

function ensurePrefixed(content: string): string {
  const prefix = getMessagePrefix()
  const trimmed = content.trim()

  if (!trimmed.startsWith(prefix)) {
    return `${prefix}${trimmed ? " " + trimmed : ""}`
  }

  return trimmed
}


function normalizeUserIds(ids: Array<string | null | undefined>): string[] {
  const unique = new Set<string>()
  for (const raw of ids) {
    const v = String(raw ?? "").trim()
    if (!v) continue
    unique.add(v)
  }
  return Array.from(unique)
}

export function buildPublicUrl(pathname: string): string {
  const base = getPublicBaseUrl()
  if (!base) {
    // 调用方可以自行处理；这里返回 path 本身避免抛错影响业务
    return pathname
  }

  if (!pathname.startsWith("/")) {
    return `${base}/${pathname}`
  }

  return `${base}${pathname}`
}

export async function sendWecomGatewayText(args: {
  toUserIds: Array<string | null | undefined>
  content: string
}): Promise<WecomGatewayResponse> {
  const systemKey = getSystemKey()
  const systemToken = getSystemToken()

  if (!systemToken) {
    return { ok: false, errcode: -1, errmsg: "SYSTEM_TOKEN_MISSING" }
  }

  const toUserIds = normalizeUserIds(args.toUserIds)
  const content = ensurePrefixed(args.content)

  const body: WecomGatewaySendBody = {
    msgType: "text",
    toUserIds,
    content,
  }

  const url = `${WECOM_GATEWAY_BASE_URL}/api/wecom-gateway/message/send`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-system-key": systemKey,
      "x-system-token": systemToken,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  const json = (await res.json().catch(() => ({}))) as WecomGatewayResponse

  if (!res.ok) {
    return {
      ok: false,
      errcode: json.errcode ?? 502,
      errmsg: json.errmsg ?? "GATEWAY_HTTP_ERROR",
      detail: json.detail ?? json,
    }
  }

  return json
}
