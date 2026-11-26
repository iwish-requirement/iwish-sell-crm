"use client"

import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { crmDate } from "@/lib/services/crm-visits"
import { DEAL_CURRENCIES } from "@/lib/services/deal-contract-fields"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export function CrmFinanceReceipt({ leadId, currency, receivedOn, receivedAmount, onConfirmed }: {
  leadId: string
  currency?: string
  receivedOn?: string
  receivedAmount?: string
  onConfirmed: () => void
}) {
  const [authorized, setAuthorized] = useState(false)
  const [editing, setEditing] = useState(false)
  const [on, setOn] = useState(receivedOn ?? crmDate())
  const [amount, setAmount] = useState(receivedAmount ?? "")
  const [code, setCode] = useState(currency ?? "CNY")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void getBrowserSupabaseClient().rpc("rpc_crm_can_confirm_finance", { p_lead_id: leadId }).then(({ data, error }) => {
      if (active && !error) setAuthorized(data === true)
    })
    return () => { active = false }
  }, [leadId])

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const { error } = await getBrowserSupabaseClient().rpc("rpc_deal_contract_submission_confirm_finance", {
        p_lead_id: leadId,
        p_values: { receivedOn: on, receivedAmount: amount, currency: code },
      })
      if (error) throw error
      toast.success("已确认到账，并更新对应销售阶段")
      setEditing(false)
      onConfirmed()
    } catch {
      toast.error("财务确认失败，请检查权限、日期和金额")
    } finally {
      setSaving(false)
    }
  }

  if (!authorized) return null
  if (!editing) return (
    <Button type="button" variant="outline" onClick={() => {
      setOn(receivedOn ?? crmDate())
      setCode(currency ?? "CNY")
      setAmount(receivedAmount ?? "")
      setEditing(true)
    }}>{receivedOn ? "更正确认到账" : "确认首笔到账"}</Button>
  )
  return <form className="grid gap-2 rounded-md border p-3 sm:grid-cols-3" onSubmit={confirm}>
    <label className="space-y-1 text-sm">到账日<Input type="date" max={crmDate()} required value={on} onChange={(e) => setOn(e.target.value)} /></label>
    <label className="space-y-1 text-sm">确认到账金额<Input type="number" step=".01" min=".01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <label className="space-y-1 text-sm">币种
      <select className="w-full rounded-md border bg-background px-3 py-2" value={code} onChange={(e) => setCode(e.target.value)} required>
        {DEAL_CURRENCIES.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <div className="flex gap-2 sm:col-span-3">
      <Button type="submit" disabled={saving}>保存财务确认</Button>
      <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>取消</Button>
    </div>
  </form>
}
