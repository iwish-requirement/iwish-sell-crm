import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export const visitMethods = [
  { id: "onsite", label: "上门客户公司拜访" },
  { id: "office", label: "客户到公司来访" },
  { id: "video", label: "线上视频会议" },
  { id: "phone", label: "正式业务电话会议" },
  { id: "course", label: "艾维线下课程面访" },
  { id: "event", label: "展会及行业活动面访" },
] as const

export const visitTypes = [
  { id: "first", label: "全新客户首访" },
  ...["二", "三", "四", "五", "六", "七"].map((order, index) => ({
    id: `repeat_${index + 2}`,
    label: `意向客户${order}访`,
  })),
  { id: "expansion", label: "已合作客户二次开发" },
]

export const visitServices = [
  "Google广告运营", "Meta广告运营", "Bing广告运营", "Criteo广告运营", "Pinterest广告运营", "Moloco电视广告运营",
  "TK广告运营", "SEO营销", "GEO营销", "红人营销", "社媒营销", "PR营销", "EDM营销", "联盟营销",
  "独立站建站", "独立站整合全案运营服务", "课程培训", "素材营销服务（图片或视频）", "其他",
]

export const protectionLabels = {
  new_intent: "新增意向客户",
  key_intent: "重点意向客户",
  nurture: "待培育客户",
  cooperating: "已合作客户",
  awaiting_cooperation: "已签约 · 合作待确认",
  pool: "公海客户",
  invalid: "无效客户",
}

export const substantiveFollowUpKinds = {
  feedback: "客户反馈",
  demand: "需求变化",
  progress: "合作进展",
}

export type VisitFile = { path: string; name: string; kind: "meeting" | "attachment" }

export type VisitData = {
  visitDate: string
  method: string
  type: string
  contactName: string
  contactTitle: string
  services: string[]
  needs: string
  outcome: string
  expectedMargin: string
  expectedSignedOn: string
  nextAction: string
  nextContactOn: string
  meetingUrl: string
  missingReason: string
  files: VisitFile[]
}

export type CrmPerson = { id: string; name: string }

export type CrmVisit = {
  id: string
  data: VisitData
  participants: CrmPerson[]
  createdAt: string
  updatedAt: string
  submittedBy: string
  invalidReason: string | null
  protectionOn: string | null
  canEdit: boolean
}

export type ProtectionClass = keyof typeof protectionLabels
export type ExtensionRequest = { id: string; days: number; reason: string; kind: "extension" | "nurture"; canReview: boolean }

export type LeadWorkflow = {
  owner: CrmPerson | null
  actor: string
  canSubmit: boolean
  canReview: boolean
  canManageProtection: boolean
  canRequestProtection: boolean
  protectionClass: ProtectionClass
  reviewRequired: boolean
  expiresOn: string | null
  firstVisitSatisfied: boolean
  requests: ExtensionRequest[]
  visits: CrmVisit[]
}

export function crmDate(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(date)
}

export function requiresMeetingEvidence(method: string) {
  return method === "video" || method === "phone"
}

export function getCrmError(error: unknown, fallback: string) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : ""
  if (message.includes("ERR_CRM_VISIT_EVIDENCE")) return "请提交会议凭证，只有一项时须说明另一项的缺失原因。"
  if (message.includes("ERR_CRM_VISIT_EXPANSION")) return "二次开发拜访需关联已有生效合作合同的客户。"
  if (message.includes("ERR_CRM_PROTECTION_APPROVAL")) return "此操作需要销售管理审核。"
  if (message.includes("ERR_CRM_VISIT_EXISTS")) return "这条拜访已由其他操作更新，请刷新后重试。"
  if (message.includes("ERR_CRM_CONFLICT")) return "记录已更新，请刷新后重试。"
  if (message.includes("ERR_CRM_PAID_REQUIRES_FINANCE")) return "请由财务确认首笔到账。"
  if (message.includes("ERR_CRM_VISIT_REQUIRED")) return "请先提交一条有效拜访记录。"
  if (message.includes("42501") || message.includes("ERR_NO_PERMISSION")) return "当前账号无权操作该记录。"
  return fallback
}

export async function getLeadWorkflow(leadId: string) {
  const { data, error } = await getBrowserSupabaseClient().rpc("rpc_crm_lead_workflow", { p_lead_id: leadId })
  if (error) throw error
  return data as LeadWorkflow
}

export async function listVisitParticipants(leadId: string, query: string) {
  const { data, error } = await getBrowserSupabaseClient().rpc("rpc_crm_visit_participants", {
    p_lead_id: leadId,
    p_query: query,
  })
  if (error) throw error
  return (data ?? []) as CrmPerson[]
}

const VISIT_BUCKET = "crm-visit-materials"

export async function saveVisit({
  leadId, visitId, data, participants, previousUpdatedAt, meeting, attachments,
}: {
  leadId: string
  visitId: string
  data: VisitData
  participants: string[]
  previousUpdatedAt: string | null
  meeting: File | null
  attachments: File[]
}) {
  const client = getBrowserSupabaseClient()
  const bucket = client.storage.from(VISIT_BUCKET)
  const uploaded: VisitFile[] = []
  const pending: { file: File; kind: VisitFile["kind"] }[] = attachments.map((file) => ({ file, kind: "attachment" }))
  if (meeting) pending.push({ file: meeting, kind: "meeting" })
  try {
    for (const { file, kind } of pending) {
      const path = `${leadId}/${visitId}/${crypto.randomUUID()}`
      const { error } = await bucket.upload(path, file)
      if (error) throw error
      uploaded.push({ path, name: file.name, kind })
    }
    const files = meeting ? data.files.filter((file) => file.kind !== "meeting") : data.files
    const { error } = await client.rpc("rpc_crm_visit_save", {
      p_lead_id: leadId, p_id: visitId, p_payload: { ...data, files: [...files, ...uploaded] },
      p_participants: participants, p_previous_updated_at: previousUpdatedAt,
    })
    if (error) throw error
  } catch (error) {
    if (uploaded.length > 0) await bucket.remove(uploaded.map((file) => file.path))
    throw error
  }
}

export async function downloadVisitFile(file: VisitFile) {
  const { data, error } = await getBrowserSupabaseClient().storage.from(VISIT_BUCKET).download(file.path)
  if (error) throw error
  const url = URL.createObjectURL(data)
  const link = document.createElement("a")
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
