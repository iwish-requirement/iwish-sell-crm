import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import type { DealContractAttachment } from "@/lib/services/deal-contract-submissions"
import { loadDepartmentAllocationDetails, type AllocationDetails } from "@/lib/services/department-allocation"

const BUCKET = "deal-history-materials"

export type HistoryCell = string | number | boolean | null
export type HistorySummary = {
  id: string
  source_row: number
  owner_id: string | null
  signed_on: string | null
  company: string
  salesperson: string | null
  contract_number: string | null
  base_fee: string | null
  contact_name: string | null
  website: string | null
}
export type HistoryRecord = {
  id: string
  source_row: number
  raw_values: HistoryCell[]
  fields: Record<string, string>
  attachments: DealContractAttachment[]
  version: number
  canEdit: boolean
  departmentAllocation?: AllocationDetails | null
}

export async function listDealHistory() {
  const { data, error } = await getBrowserSupabaseClient().rpc("rpc_deal_history_list")
  if (error) throw error
  return (data ?? []) as HistorySummary[]
}

export async function loadDealHistory(id: string): Promise<HistoryRecord> {
  const client = getBrowserSupabaseClient()
  const [record, access, departmentAllocation] = await Promise.all([
    client.from("deal_history_records").select("id,source_row,raw_values,fields,attachments,version").eq("id", id).single(),
    client.rpc("rpc_deal_history_can_edit", { p_id: id }),
    loadDepartmentAllocationDetails("history", id).catch(() => null),
  ])
  if (record.error) throw record.error
  if (access.error) throw access.error
  return { ...record.data, canEdit: access.data === true, departmentAllocation } as HistoryRecord
}

export async function saveDealHistory(row: HistoryRecord, fields: Record<string, string>, files: File[], services?: Record<string, string[]>): Promise<HistoryRecord> {
  const client = getBrowserSupabaseClient()
  const storage = client.storage.from(BUCKET)
  const uploaded: DealContractAttachment[] = []
  try {
    for (const file of files) {
      const path = `${row.id}/${crypto.randomUUID()}`
      const { error } = await storage.upload(path, file)
      if (error) throw error
      uploaded.push({ path, name: file.name })
    }
    const args = {
      p_id: row.id, p_changes: fields, p_new_attachments: uploaded, p_version: row.version,
    }
    const { data, error } = await (services
      ? client.rpc("rpc_department_allocation_history_confirm", { ...args, p_services: services })
      : client.rpc("rpc_deal_history_save", args))
    if (error?.code === "40001") throw new Error("资料已更新，请重新打开后再补填。")
    if (error?.message?.includes("department_allocation_history_required")) {
      throw new Error("请补齐销售必填字段并上传交接附件，再确认提交。")
    }
    if (error) throw error
    const departmentAllocation = services ? await loadDepartmentAllocationDetails("history", row.id).catch(() => null) : row.departmentAllocation
    return { ...data, canEdit: row.canEdit, departmentAllocation } as HistoryRecord
  } catch (error) {
    if (uploaded.length) await storage.remove(uploaded.map(file => file.path)).catch(() => {})
    throw error
  }
}

export async function downloadDealHistoryAttachment(attachment: DealContractAttachment) {
  const { data, error } = await getBrowserSupabaseClient().storage.from(BUCKET).download(attachment.path)
  if (error) throw error
  const url = URL.createObjectURL(data)
  const link = document.createElement("a")
  link.href = url
  link.download = attachment.name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
