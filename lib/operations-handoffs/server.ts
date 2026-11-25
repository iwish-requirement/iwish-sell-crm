import { createHash, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

const jsonLimit = 64 * 1024
const identifier = z.string().min(1).max(256).refine(value => value.trim() === value)
const person = z.object({ id: identifier, name: z.string().trim().min(1).max(256) })
// 运营端按服务给的角色：经理 / 优化师 / 优化师助理（2026-11-25 起回传；旧回传没有，按优化师显示）
const member = person.extend({
  role: z.enum(["optimizer", "optimizer_manager", "optimizer_assistant", "project_manager"]).optional(),
})
const version = z.number().int().positive().safe()

export const staffingCallback = z.object({
  handoffId: z.string().uuid(),
  departmentId: z.string().uuid(),
  workOrderId: identifier,
  scopeVersion: version.max(2147483647),
  version,
  confirmedAt: z.string().datetime({ offset: true }),
  projectLead: person,
  staffing: z.array(z.object({
    serviceId: identifier,
    members: z.array(member).min(1).max(100),
  })).min(1).max(32),
}).superRefine((body, context) => {
  if (new Set(body.staffing.map(row => row.serviceId)).size !== body.staffing.length ||
      body.staffing.some(row => new Set(row.members.map(member => member.id)).size !== row.members.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate staffing entries" })
  }
})

export const handoffIdSchema = z.string().uuid()

export function operationsEnabled() {
  return process.env.CRM_OPERATIONS_ENABLED === "true"
}

export function authorizeOperations(request: Request, expected: string | undefined) {
  const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
  if (!expected || !supplied) return false
  const digest = (text: string) => createHash("sha256").update(text).digest()
  return timingSafeEqual(digest(supplied), digest(expected))
}

export async function readOperationsJson(message: Request | Response): Promise<unknown> {
  const reader = message.body?.getReader()
  if (Number(message.headers.get("content-length")) > jsonLimit || !reader) {
    await reader?.cancel()
    if (!reader) throw new SyntaxError("Missing JSON body")
    throw new RangeError("JSON body too large")
  }
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let size = 0
  let text = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > jsonLimit) throw new RangeError("JSON body too large")
      text += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

function intakeConfiguration() {
  const token = process.env.CRM_OPERATIONS_INTAKE_TOKEN
  const base = process.env.CRM_OPERATIONS_BASE_URL
  if (!token || !base) return null
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  const isLocalDemo = process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !isLocalDemo) return null
  return { url: new URL("/api/v1/operations/handoffs", url), token }
}

type IntakeConfiguration = NonNullable<ReturnType<typeof intakeConfiguration>>
type Delivery = { payload: { id: string; version: number }; lease: string }
type DeliveryResult = { workOrderId: string | null; error: string | null; retry: boolean }
const receiptSchema = z.object({ id: handoffIdSchema, workOrderId: identifier })

async function deliver({ payload }: Delivery, { url, token }: IntakeConfiguration): Promise<DeliveryResult> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    })
  } catch {
    return { workOrderId: null, error: "INTAKE_UNREACHABLE", retry: true }
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {})
    return { workOrderId: null, error: `INTAKE_HTTP_${response.status}`, retry: response.status === 429 || response.status >= 500 }
  }
  const receipt = receiptSchema.safeParse(await readOperationsJson(response).catch(() => null))
  if (!receipt.success || receipt.data.id !== payload.id) {
    return { workOrderId: null, error: "INTAKE_INVALID_RECEIPT", retry: true }
  }
  return { workOrderId: receipt.data.workOrderId, error: null, retry: false }
}

export async function dispatchOperationsHandoffs(retryId: string | null) {
  const target = intakeConfiguration()
  if (!target) return { status: 503, body: { error: "OPS_INTAKE_NOT_CONFIGURED" } }
  const admin = createAdminSupabaseClient()
  if (retryId) {
    const { data, error } = await admin.rpc("rpc_operations_handoff_retry", { p_handoff_id: retryId })
    if (error) throw error
    if (!data) return { status: 409, body: { error: "HANDOFF_NOT_RETRYABLE" } }
  }
  const { data, error } = await admin.rpc("rpc_operations_handoffs_claim", { p_limit: 8 })
  if (error) throw error
  const deliveries = (data ?? []) as Delivery[]
  const outcomes = await Promise.allSettled(deliveries.map(async delivery => {
    const result = await deliver(delivery, target)
    const finished = await admin.rpc("rpc_operations_handoff_finish", {
      p_handoff_id: delivery.payload.id,
      p_lease: delivery.lease,
      p_work_order_id: result.workOrderId,
      p_error: result.error,
      p_retry: result.retry,
    })
    if (finished.error) throw finished.error
  }))
  const errors = outcomes.filter(outcome => outcome.status === "rejected").length
  return {
    status: errors ? 503 : 200,
    body: { claimed: deliveries.length, persistenceErrors: errors },
  }
}
