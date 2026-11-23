import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { DEAL_CONTRACT_SERVICES, type DealContractData, type DealContractFinance } from "@/lib/services/deal-contract-fields"
import type { DealContractAttachment } from "@/lib/services/deal-contract-submissions"

export type AllocationSource = "lead" | "history"
export type LeadDepartmentState = "needs_contract" | "ready" | "assigned"
export type DepartmentHandoff = { id: string; departmentId: string; departmentName: string; services: string[] }
export type DepartmentResult = { revision: number; assignedAt?: string; handoffs: DepartmentHandoff[] }
export type AllocationRow = DepartmentResult & {
  source: AllocationSource
  id: string
  company: string
  mainlandCompanyName?: string | null
  hongKongCompanyName?: string | null
  salesperson: string | null
  submitted_at: string | null
  services: DealContractData["services"] | null
  legacy_department: string | null
}
export type AllocationDepartment = { category: string; id: string; name: string }
export type AllocationWorkspace = { rows: AllocationRow[]; departments: AllocationDepartment[] }
export type AllocationDetails = DepartmentResult & {
  requiredAfter: string
  data?: DealContractData
  finance?: DealContractFinance
  attachments?: DealContractAttachment[]
  submitted_at?: string
}

export async function loadDepartmentAllocationRelease() {
  const { data, error } = await getBrowserSupabaseClient().rpc("rpc_department_allocation_release")
  if (error?.code === "PGRST202") return null
  if (error) throw error
  return typeof data === "string" ? data : null
}

export async function loadDepartmentAllocationWorkspace(pending: boolean) {
  const { data, error } = await getBrowserSupabaseClient().rpc("rpc_department_allocation_workspace", { p_pending: pending })
  if (error) throw error
  return data as AllocationWorkspace
}

export async function loadDepartmentAllocationLeadStates(ids: string[]) {
  const client = getBrowserSupabaseClient()
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += 500) batches.push(ids.slice(index, index + 500))
  const lists = await Promise.all(batches.map(async batch => {
    const { data, error } = await client.rpc("rpc_department_allocation_lead_states", { p_lead_ids: batch })
    if (error) throw error
    return data as Record<string, LeadDepartmentState>
  }))
  return Object.assign({} as Record<string, LeadDepartmentState>, ...lists)
}

export async function loadDepartmentAllocationDetails(source: AllocationSource, id: string) {
  const { data, error } = await getBrowserSupabaseClient().rpc("rpc_department_allocation_details", { p_source: source, p_id: id })
  if (error?.code === "PGRST202") return null
  if (error) throw error
  return data as AllocationDetails | null
}

export async function saveServiceDepartments(row: AllocationRow, departments: Record<string, string[]>) {
  const { data, error } = await getBrowserSupabaseClient().rpc("rpc_department_allocation_save", {
    p_source: row.source, p_id: row.id, p_submitted_at: row.submitted_at, p_revision: row.revision, p_departments: departments,
  })
  if (error?.code === "40001") throw new Error("合同资料或分配已更新，请刷新列表后重新确认。")
  if (error) throw new Error("分配保存失败，请检查每项服务的承接部门及账号权限。")
  return data as DepartmentResult
}

export function selectedAllocationServices(services: DealContractData["services"] | null | undefined) {
  return DEAL_CONTRACT_SERVICES.flatMap(({ key, label, options }) => {
    if (!services || !Object.hasOwn(services, key)) return []
    if (!options.length) return [{ id: key, category: key, name: label }]
    return options.filter(([id]) => services[key].includes(id))
      .map(([id, name]) => ({ id: key + "/" + id, category: key, name: label + " · " + name }))
  })
}
