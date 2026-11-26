"use client"
import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { crmDate, getCrmError } from "@/lib/services/crm-visits"

type Goal = { profile_id: string; effective_on: string; monthly: number | null; quarterly: number | null; yearly: number | null; weekly_reference: string | null }
type SalesSettings = { people: { id: string; name: string }[]; goals: Goal[] }

export function CrmSalesSettings() {
  const [settings, setSettings] = useState<SalesSettings | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [profile, setProfile] = useState("")
  const [effectiveOn, setEffectiveOn] = useState(crmDate)
  const [monthly, setMonthly] = useState("")
  const [quarterly, setQuarterly] = useState("")
  const [yearly, setYearly] = useState("")
  const [weekly, setWeekly] = useState("")

  useEffect(() => {
    let active = true
    const client = getBrowserSupabaseClient()
    void client.rpc("rpc_crm_sales_settings").then((sales) => {
      if (!active) return
      if (sales.error) { setFailed(true); return }
      setFailed(false)
      setSettings(sales.data as SalesSettings)
    })
    return () => { active = false }
  }, [reload])

  async function run(name: string, args: Record<string, unknown>) {
    setBusy(true)
    try {
      const { error } = await getBrowserSupabaseClient().rpc(name, args)
      if (error) throw error
      toast.success("销售规则已更新")
      setReload((n) => n + 1)
    } catch (error) {
      toast.error(getCrmError(error, "操作失败，请检查数值与生效日期"))
    } finally {
      setBusy(false)
    }
  }

  function editGoal(target: Goal) {
    setEffectiveOn(target.effective_on)
    setMonthly(target.monthly?.toString() ?? "")
    setQuarterly(target.quarterly?.toString() ?? "")
    setYearly(target.yearly?.toString() ?? "")
    setWeekly(target.weekly_reference ?? "")
  }

  function submitGoal(event: FormEvent) {
    event.preventDefault()
    void run("rpc_crm_save_visit_goal", {
      p_profile: profile, p_effective_on: effectiveOn, p_monthly: monthly ? Number(monthly) : null,
      p_quarterly: quarterly ? Number(quarterly) : null, p_yearly: yearly ? Number(yearly) : null, p_weekly_reference: weekly || null,
    })
  }

  if (failed) return <p className="text-sm text-muted-foreground">当前账号无法读取拜访目标配置。</p>
  if (!settings) return <p role="status" className="text-sm">正在加载销售配置…</p>
  return <section className="space-y-4 rounded-md border p-4">
    <h3 className="font-semibold">拜访目标配置</h3>
    <select aria-label="选择销售" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={profile} onChange={(event) => {
      const person = settings.people.find((item) => item.id === event.target.value)
      setProfile(person?.id ?? "")
      const last = settings.goals.find((goal) => goal.profile_id === person?.id)
      editGoal(last ?? { profile_id: "", effective_on: crmDate(), monthly: null, quarterly: null, yearly: null, weekly_reference: null })
    }}>
      <option value="">选择销售</option>
      {settings.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select>
    {profile && <>
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={submitGoal}>
        <label className="space-y-1 text-xs">生效日期<Input type="date" required value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} /></label>
        <label className="space-y-1 text-xs">周参考值<Input maxLength={40} value={weekly} onChange={(event) => setWeekly(event.target.value)} /></label>
        <label className="space-y-1 text-xs">月度目标<Input type="number" min={0} value={monthly} onChange={(event) => setMonthly(event.target.value)} /></label>
        <label className="space-y-1 text-xs">季度目标<Input type="number" min={0} value={quarterly} onChange={(event) => setQuarterly(event.target.value)} /></label>
        <label className="space-y-1 text-xs">年度目标<Input type="number" min={0} value={yearly} onChange={(event) => setYearly(event.target.value)} /></label>
        <Button type="submit" disabled={busy} className="self-end">保存拜访目标</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {settings.goals.filter((goal) => goal.profile_id === profile).map((goal) =>
          <Button key={goal.effective_on} size="sm" variant="ghost" onClick={() => editGoal(goal)}>{goal.effective_on} 生效</Button>)}
      </div>
    </>}
  </section>
}
