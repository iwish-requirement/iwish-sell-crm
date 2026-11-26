"use client"

import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { crmDate } from "@/lib/services/crm-visits"
import { DEAL_CURRENCIES } from "@/lib/services/deal-contract-fields"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export function CrmFinanceReceipt({ leadId, currency, receivedOn, receivedAmount, grossProfit, grossProfitCurrency, onConfirmed }: {
  leadId: string
  currency?: string
  receivedOn?: string
  receivedAmount?: string
  grossProfit?: string
  grossProfitCurrency?: string
  onConfirmed: () => void
}) {
  const [authorized, setAuthorized] = useState(false)
  const [mode, setMode] = useState<"payment" | "profit" | null>(null)
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
        p_values: mode === "payment" ? { receivedOn: on, receivedAmount: amount, currency: code } : { grossProfit: amount, currency: code },
      })
      if (error) throw error
      toast.success(mode === "payment" ? "已确认到账，并更新对应销售阶段" : "已记录实际签单毛利")
      setMode(null)
      onConfirmed()
    } catch {
      toast.error("财务确认失败，请检查权限、日期和金额")
    } finally {
      setSaving(false)
    }
  }

  if (!authorized) return null
  if (!mode) return <div className="flex flex-wrap gap-2">
    <Button type="button" variant="outline" onClick={() => {
      setOn(receivedOn ?? crmDate())
      setCode(currency ?? "CNY")
      setAmount(receivedAmount ?? "")
      setMode("payment")
    }}>{receivedOn ? "更正确认到账" : "确认首笔到账"}</Button>
    <Button type="button" variant="outline" onClick={() => {
      setCode(grossProfitCurrency ?? currency ?? "CNY")
      setAmount(grossProfit ?? "")
      setMode("profit")
    }}>确认实际签单毛利</Button>
  </div>
  return <form className="grid gap-2 rounded-md border p-3 sm:grid-cols-3" onSubmit={confirm}>
    {mode === "payment" && <label className="space-y-1 text-sm">到账日<Input type="date" max={crmDate()} required value={on} onChange={(e) => setOn(e.target.value)} /></label>}
    <label className="space-y-1 text-sm">{mode === "payment" ? "确认到账金额" : "按财务口径核定的实际毛利"}<Input type="number" step=".01" min={mode === "payment" ? ".01" : undefined} required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <label className="space-y-1 text-sm">币种
      <select className="w-full rounded-md border bg-background px-3 py-2" value={code} onChange={(e) => setCode(e.target.value)} required>
        {DEAL_CURRENCIES.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <div className="flex gap-2 sm:col-span-3">
      <Button type="submit" disabled={saving}>保存财务确认</Button>
      <Button type="button" variant="ghost" disabled={saving} onClick={() => setMode(null)}>取消</Button>
    </div>
  </form>
}
