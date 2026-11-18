import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { fetchContractByLeadId, fetchContractPayments } from "@/lib/services/contracts"
import { DEAL_CONTRACT_FIELDS, normalizeDealWebsite, type DealContractAllocation, type DealContractData, type DealContractFinance } from "@/lib/services/deal-contract-fields"
import { dealDateInputValue } from "@/lib/services/deal-date"

const BUCKET = "deal-contract-materials"

export interface DealContractAttachment {
  path: string
  name: string
}

interface Submission {
  lead_id: string
  draft: DealContractData
  draft_attachments: DealContractAttachment[]
  submitted: DealContractData | null
  submitted_attachments: DealContractAttachment[]
  submitted_at: string | null
  finance: DealContractFinance
  finance_confirmed_at: string | null
  version: number
}

export async function loadDealContractSubmission(leadId: string, salesperson: string | null) {
  const client = getBrowserSupabaseClient()
  const [submission, lead, access, contract, allocation] = await Promise.all([
    client.from("deal_contract_submissions")
      .select("lead_id,draft,draft_attachments,submitted,submitted_attachments,submitted_at,finance,finance_confirmed_at,version")
      .eq("lead_id", leadId).maybeSingle(),
    client.from("leads_secure_view")
      .select("name,website,product_category,customer_name,customer_phone,customer_email,address")
      .eq("id", leadId).single(),
    client.rpc("rpc_deal_contract_submission_can_edit", { p_lead_id: leadId }),
    fetchContractByLeadId(leadId),
    client.rpc("rpc_deal_contract_allocation_result", { p_lead_id: leadId }),
  ])
  if (submission.error) throw submission.error
  if (lead.error) throw lead.error
  if (access.error) throw access.error

  const payments = contract ? await fetchContractPayments(contract.id) : []
  const confirmed = payments.filter((entry) => entry.status === "confirmed")
  const firstReceipt = confirmed.at(-1)
  const latestReceipt = confirmed[0]
  const record = submission.data as Submission | null
  const data: DealContractData = {
    services: record?.draft.services ?? {},
    signedOn: dealDateInputValue(contract?.signedAt),
    serviceStartsOn: dealDateInputValue(contract?.startDate),
    salesperson: salesperson ?? "",
    companyName: lead.data.name ?? "",
    contractNumber: contract?.contractNumber ?? "",
    website: normalizeDealWebsite(lead.data.website ?? "") ?? (lead.data.website ?? ""),
    category: lead.data.product_category ?? "",
    contactName: lead.data.customer_name ?? "",
    phone: lead.data.customer_phone ?? "",
    email: lead.data.customer_email ?? "",
    address: lead.data.address ?? "",
    currency: contract?.currency ?? "CNY",
    actualPayment: dealDateInputValue(firstReceipt?.paidAt),
  }
  for (const [key] of DEAL_CONTRACT_FIELDS) {
    const draftValue = record?.draft[key]
    if (draftValue !== undefined) data[key] = draftValue
  }
  return {
    record,
    data,
    canEdit: access.data === true,
    allocation: allocation.data as DealContractAllocation | null,
    allocationUnavailable: Boolean(allocation.error),
    confirmedReceipt: firstReceipt && latestReceipt ? {
      actualPayment: dealDateInputValue(firstReceipt.paidAt),
      receivedOn: dealDateInputValue(latestReceipt.paidAt),
      receivedAmount: String(latestReceipt.amount),
    } : undefined,
  }
}

export async function saveDealContractSubmission(
  leadId: string,
  data: DealContractData,
  attachments: DealContractAttachment[],
  pendingFiles: File[],
  removedPaths: string[],
  version: number,
  confirm: boolean,
) {
  const client = getBrowserSupabaseClient()
  const storage = client.storage.from(BUCKET)
  const uploaded: DealContractAttachment[] = []
  try {
    for (const file of pendingFiles) {
      const path = `${leadId}/${crypto.randomUUID()}`
      const { error } = await storage.upload(path, file)
      if (error) throw error
      uploaded.push({ path, name: file.name })
    }

    const { data: record, error } = await client.rpc("rpc_deal_contract_submission_save", {
      p_lead_id: leadId,
      p_data: data,
      p_attachments: [...attachments, ...uploaded],
      p_version: version,
      p_confirm: confirm,
    })
    if (error) throw error
    const saved = record as Submission
    if (removedPaths.length) {
      const referenced = new Set([...saved.draft_attachments, ...saved.submitted_attachments].map(({ path }) => path))
      const unreferenced = removedPaths.filter((path) => !referenced.has(path))
      if (unreferenced.length) await storage.remove(unreferenced).catch(() => {})
    }
    return saved
  } catch (error) {
    if (uploaded.length) {
      await storage.remove(uploaded.map(({ path }) => path)).catch(() => {})
    }
    throw error
  }
}

export async function downloadDealContractAttachment(attachment: DealContractAttachment) {
  const { data, error } = await getBrowserSupabaseClient().storage.from(BUCKET).download(attachment.path)
  if (error) throw error
  const objectUrl = URL.createObjectURL(data)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = attachment.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}
