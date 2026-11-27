"use client"

import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { crmDate, getCrmError } from "@/lib/services/crm-visits"

type Goal = { profile_id: string; effective_on: string; monthly: number | null; quarterly: number | null; yearly: number | null; weekly_reference: string | null }
type SalesSettings = { people: { id: string; name: string; quota: number }[]; goals: Goal[] }
type PoolSettings = { enabled: boolean; earliest: string; preventPreviousOwnerReclaim: boolean }
type Notice = { id: string; lead_id: string; customer: string; deadline: string; offset_days: number; read_at: string | null }

export function CrmProtectionNotices() {
  const [notices, setNotices] = useState<Notice[]>([])
  useEffect(() => {
    let active = true
    void getBrowserSupabaseClient().rpc("rpc_crm_protection_notices").then(({ data, error }) => {
      if (active && !error) setNotices(data as Notice[])
    })
    return () => { active = false }
  }, [])
  if (!notices.length) return null
  return <details className="space-y-2 rounded-md border p-3 text-sm" open={notices.some((notice) => !notice.read_at)}>
    <summary className="cursor-pointer font-medium">保护期提醒（{notices.filter((n) => !n.read_at).length} 条未读）</summary>
    {notices.map((n) => <div key={n.id} className="flex flex-wrap items-center justify-between gap-2">
      <Link href={"/leads/" + n.lead_id} className="underline">{n.customer}</Link>
      <span>{n.offset_days ? "距到期 " + n.offset_days + " 天" : "到期当天"} · {n.deadline}</span>
      {!n.read_at && <Button size="sm" variant="ghost" onClick={async () => {
        const { error } = await getBrowserSupabaseClient().rpc("rpc_crm_protection_notice_read", { p_id: n.id })
        if (error) { toast.error("标记已读失败"); return }
        setNotices((list) => list.map((item) => item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item))
      }}>标为已读</Button>}
    </div>)}
  </details>
}

export function CrmSalesSettings() {
  const [settings, setSettings] = useState<SalesSettings | null>(null)
  const [pool, setPool] = useState<PoolSettings | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [profile, setProfile] = useState("")
  const [effectiveOn, setEffectiveOn] = useState(crmDate)
  const [monthly, setMonthly] = useState("")
  const [quarterly, setQuarterly] = useState("")
  const [yearly, setYearly] = useState("")
  const [weekly, setWeekly] = useState("")
  const [quota, setQuota] = useState("60")
  const [restoreId, setRestoreId] = useState("")
  const [restoreReason, setRestoreReason] = useState("")

  useEffect(() => {
    let active = true
    const client = getBrowserSupabaseClient()
    void Promise.all([client.rpc("rpc_crm_sales_settings"),client.rpc("rpc_crm_protection_admin")]).then(([sales, release]) => {
      if (!active) return
      if (sales.error || release.error) { setFailed(true); return }
      setFailed(false)
      setSettings(sales.data as SalesSettings)
      setPool(release.data as PoolSettings)
    })
    return () => { active = false }
  }, [reload])

  async function run(name: string, args: Record<string, unknown>) {
    setBusy(true)
    try {
      const { data, error } = await getBrowserSupabaseClient().rpc(name, args)
      if (error) throw error
      if (name === "rpc_crm_protection_admin") setPool(data as PoolSettings)
      toast.success("销售规则已更新")
      setReload((n) => n + 1)
    } catch (error) {
      toast.error(getCrmError(error, "操作失败，请检查生效时间、额度或流转状态"))
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

  if (failed) return <p className="text-sm text-muted-foreground">当前账号无法读取拜访目标和公海流转配置。</p>
  if (!settings || !pool) return <p role="status" className="text-sm">正在加载销售配置…</p>
  return <Card className="max-w-2xl">
    <CardHeader>
      <CardTitle>客户保护、公海与拜访目标</CardTitle>
      <CardDescription>统一管理客户保护期、认领、个人持有上限和拜访目标。</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-1 text-sm">
        <p>新增意向 15 天 · 重点意向 45 天 · 待培育 90 天</p>
        <p className="text-muted-foreground">到期前 7 天、3 天和到期当天发 CRM 站内提醒。下一次跟进日期以当前负责人有效拜访中提交的安排为准。</p>
      </div>
      <select aria-label="选择销售" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={profile} onChange={(event) => {
        const person = settings.people.find((item) => item.id === event.target.value)
        setProfile(person?.id ?? "")
        setQuota(String(person?.quota ?? 60))
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
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault()
          void run("rpc_crm_save_lead_quota", { p_profile: profile, p_quota: Number(quota) })
        }}>
          <label className="space-y-1 text-xs">个人持有上限（最多 60）<Input type="number" min={1} max={60} required value={quota} onChange={(event) => setQuota(event.target.value)} /></label>
          <Button type="submit" disabled={busy} variant="outline">保存持有上限</Button>
        </form>
      </>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>自动流转最早于 {pool.earliest} 生效 · 当前{pool.enabled ? "已开启" : "已关闭"}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run("rpc_crm_protection_admin", { p_enabled: !pool.enabled })}>
          {pool.enabled ? "关闭自动公海流转" : "开启自动公海流转"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>禁止原负责人再次认领 · 当前{pool.preventPreviousOwnerReclaim ? "已开启" : "已关闭"}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run("rpc_crm_protection_admin", {
          p_prevent_previous_owner_reclaim: !pool.preventPreviousOwnerReclaim,
        })}>
          {pool.preventPreviousOwnerReclaim ? "允许原负责人再次认领" : "禁止原负责人再次认领"}
        </Button>
      </div>
      {!pool.enabled && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault()
        void run("rpc_crm_restore_release", { p_lead_id: restoreId.trim(), p_reason: restoreReason })
      }}>
        <label className="space-y-1 text-xs">待恢复线索 ID<Input required value={restoreId} onChange={(event) => setRestoreId(event.target.value)} /></label>
        <label className="space-y-1 text-xs">异常恢复原因<Input required value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} /></label>
        <Button type="submit" disabled={busy} variant="outline">恢复为待核定客户</Button>
      </form>}
    </CardContent>
  </Card>
}
