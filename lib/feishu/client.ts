// 飞书开放平台最小客户端：tenant_access_token 缓存、通讯录拉取、消息卡片发送/更新、回调解密。
// 凭据通过环境变量注入：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_VERIFICATION_TOKEN / FEISHU_ENCRYPT_KEY。
import { createHash, createDecipheriv } from "node:crypto"

const FEISHU_BASE = "https://open.feishu.cn/open-apis"

function getAppId(): string {
  return (process.env.FEISHU_APP_ID ?? "").trim()
}

function getAppSecret(): string {
  return (process.env.FEISHU_APP_SECRET ?? "").trim()
}

export function isFeishuConfigured(): boolean {
  return Boolean(getAppId() && getAppSecret())
}

export function getFeishuVerificationToken(): string {
  return (process.env.FEISHU_VERIFICATION_TOKEN ?? "").trim()
}

export function getFeishuEncryptKey(): string {
  return (process.env.FEISHU_ENCRYPT_KEY ?? "").trim()
}

let cachedToken: { token: string; expiresAt: number } | null = null

export async function getTenantAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: getAppId(), app_secret: getAppSecret() }),
  })
  const data = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number }
  if (!data.tenant_access_token) {
    throw new Error(`FEISHU_TOKEN_ERR_${data.code ?? -1}:${data.msg ?? "no_token"}`)
  }
  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + Math.max((data.expire ?? 7200) - 300, 60) * 1000,
  }
  return cachedToken.token
}

async function feishuPost(path: string, body: unknown): Promise<any> {
  const token = await getTenantAccessToken()
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function feishuPatch(path: string, body: unknown): Promise<any> {
  const token = await getTenantAccessToken()
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function feishuGetAll(path: string): Promise<any[]> {
  const token = await getTenantAccessToken()
  const items: any[] = []
  let pageToken = ""
  do {
    const sep = path.includes("?") ? "&" : "?"
    const url = `${FEISHU_BASE}${path}${sep}page_size=50${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    const data = (await res.json()) as { code?: number; msg?: string; data?: { items?: any[]; page_token?: string; has_more?: boolean } }
    if (data.code && data.code !== 0) {
      throw new Error(`FEISHU_API_ERR_${data.code}:${data.msg}`)
    }
    items.push(...(data.data?.items ?? []))
    pageToken = data.data?.has_more ? data.data?.page_token ?? "" : ""
  } while (pageToken)
  return items
}

export type FeishuDepartment = { openDepartmentId: string; name: string }

export async function listAllDepartments(): Promise<FeishuDepartment[]> {
  const items = await feishuGetAll(
    "/contact/v3/departments?parent_department_id=0&fetch_child=true&department_id_type=open_department_id&user_id_type=open_id",
  )
  return items
    .filter((d) => d?.open_department_id && d?.name)
    .map((d) => ({ openDepartmentId: String(d.open_department_id), name: String(d.name) }))
}

export type FeishuDirectoryUser = {
  openId: string
  unionId: string | null
  name: string
  email: string | null
  mobile: string | null
  jobTitle: string | null
  city: string | null
  employeeType: string | null
  departmentIds: string[]
}

export async function listUsersByDepartment(departmentId: string): Promise<FeishuDirectoryUser[]> {
  const items = await feishuGetAll(
    `/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=open_department_id&user_id_type=open_id`,
  )
  return items
    .filter((u) => u?.open_id && u?.name)
    .map((u) => ({
      openId: String(u.open_id),
      unionId: u.union_id ? String(u.union_id) : null,
      name: String(u.name),
      email: u.email ? String(u.email) : null,
      mobile: u.mobile ? String(u.mobile) : null,
      jobTitle: u.job_title ? String(u.job_title) : null,
      city: u.city ? String(u.city) : null,
      employeeType: u.employee_type != null ? String(u.employee_type) : null,
      departmentIds: Array.isArray(u.department_ids) ? u.department_ids.map(String) : [],
    }))
}

export async function sendCardToUser(openId: string, card: unknown): Promise<{ ok: boolean; messageId?: string; code?: number; msg?: string }> {
  const data = await feishuPost(
    "/im/v1/messages?receive_id_type=open_id",
    { receive_id: openId, msg_type: "interactive", content: JSON.stringify(card) },
  )
  const code = Number(data?.code ?? -1)
  if (code !== 0) return { ok: false, code, msg: data?.msg }
  return { ok: true, messageId: data?.data?.message_id ? String(data.data.message_id) : undefined }
}

export async function updateCardMessage(messageId: string, card: unknown): Promise<{ ok: boolean; code?: number; msg?: string }> {
  const data = await feishuPatch(`/im/v1/messages/${encodeURIComponent(messageId)}`, { content: JSON.stringify(card) })
  const code = Number(data?.code ?? -1)
  if (code !== 0) return { ok: false, code, msg: data?.msg }
  return { ok: true }
}

/** 飞书事件加密载荷：AES-256-CBC，key = sha256(encrypt_key)，iv 取密文前 16 字节。 */
export function decryptFeishuPayload(encrypt: string): string {
  const key = createHash("sha256").update(getFeishuEncryptKey(), "utf8").digest()
  const raw = Buffer.from(encrypt, "base64")
  const decipher = createDecipheriv("aes-256-cbc", key, raw.subarray(0, 16))
  const decrypted = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()])
  return decrypted.toString("utf8")
}
