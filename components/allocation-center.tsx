"use client"

import { useContext, useEffect, useMemo, useState } from "react"
import { Boxes, CheckCircle2, Clock3, ExternalLink, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MePermissionsContext } from "@/components/app-root"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { mapRpcError } from "@/lib/rpc-error-mapper"

type Allocation = {
  id: string | null; lead_id: string; company_name: string; customer_name: string | null; website: string | null
  source: string | null; budget: number | null; closed_at: string; allocation_status: string; product_category?: string | null
  sales_owner_name: string | null; department_id: string | null; department_name: string | null
  project_manager_id: string | null; project_manager_name: string | null
  google_optimizer_id: string | null; google_optimizer_name: string | null; meta_optimizer_id: string | null; meta_optimizer_name: string | null
  criteo_optimizer_id: string | null; criteo_optimizer_name: string | null; bing_optimizer_id: string | null; bing_optimizer_name: string | null
  edm_optimizer_id: string | null; edm_optimizer_name: string | null; influencer_marketing_id: string | null; influencer_marketing_name: string | null
  note: string | null; detail_link: string | null; assigned_at: string | null
  platforms?: string[] | null
  google_optimizer_ids?: string[] | null; google_optimizer_names?: string[] | null
  meta_optimizer_ids?: string[] | null; meta_optimizer_names?: string[] | null
  criteo_optimizer_ids?: string[] | null; criteo_optimizer_names?: string[] | null
  bing_optimizer_ids?: string[] | null; bing_optimizer_names?: string[] | null
  edm_optimizer_ids?: string[] | null; edm_optimizer_names?: string[] | null
  influencer_marketing_ids?: string[] | null; influencer_marketing_names?: string[] | null
  allocation_source?: "crm_manual" | "optimizer_sync" | "legacy" | null
  sync_status?: "not_connected" | "pending" | "submitted" | "accepted" | "rejected" | "synced" | "failed" | null
  external_assignment_id?: string | null
  sync_version?: number | null
  last_synced_at?: string | null
  sync_error?: string | null
  idempotency_key?: string | null
  confirmed_at?: string | null
}
type Person = { id: string; full_name: string; department_ids?: string[] }
type Department = { id: string; name: string; feishu_department_id: string; parent_feishu_department_id: string | null }

const platformOptions = [
  ["google", "Google"], ["meta", "Meta"], ["criteo", "Criteo"], ["bing", "Bing"],
  ["edm", "EDM"], ["influencer", "红人/联盟营销"],
] as const

const roleFields = [
  ["google_optimizer_ids", "Google 优化师", "google_optimizer_names"], ["meta_optimizer_ids", "Meta 优化师", "meta_optimizer_names"],
  ["criteo_optimizer_ids", "Criteo 优化师", "criteo_optimizer_names"], ["bing_optimizer_ids", "Bing 优化师", "bing_optimizer_names"],
  ["edm_optimizer_ids", "EDM 营销/优化师", "edm_optimizer_names"], ["influencer_marketing_ids", "红人/联盟营销", "influencer_marketing_names"],
] as const

const syncStatusLabels: Record<NonNullable<Allocation["sync_status"]>, string> = {
  not_connected: "待接入优化系统",
  pending: "待同步",
  submitted: "已提交",
  accepted: "已接收",
  rejected: "已拒绝",
  synced: "已同步",
  failed: "同步失败",
}

export function AllocationCenter() {
  const permissions = useContext(MePermissionsContext)
  const canRead = permissions?.canReadAllocations ?? false
  const canManage = permissions?.canManageAllocations ?? false
  const [rows, setRows] = useState<Allocation[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selected, setSelected] = useState<Allocation | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})

  const load = async () => {
    if (!canRead) { setLoading(false); return }
    setLoading(true)
    const supabase = getBrowserSupabaseClient()
    const [{ data, error }, { data: deptRows }, { data: memberRows }] = await Promise.all([
      supabase.rpc("rpc_project_allocations_list"),
      supabase.from("ops_departments").select("id,name,feishu_department_id,parent_feishu_department_id").eq("is_active", true).order("name"),
      supabase.from("ops_members").select("id,full_name,department_ids").eq("is_active", true).order("full_name"),
    ])
    if (error) { const friendly = mapRpcError(error, { title: "加载分配中心失败", description: "请稍后重试" }); toast.error(friendly.title, { description: friendly.description }); setRows([]) }
    else setRows((data ?? []) as Allocation[])
    setDepartments((deptRows ?? []) as Department[])
    setPeople((memberRows ?? []) as Person[])
    setLoading(false)
  }
  useEffect(() => { void load() }, [canRead])

  // 选中部门的子树（含自身及所有下级部门），负责人候选人限定在其中
  const candidateManagers = useMemo(() => {
    const deptId = form.department_id as string | undefined
    if (!deptId) return people
    const dept = departments.find((d) => d.id === deptId)
    if (!dept) return people
    const subtree = new Set<string>([dept.feishu_department_id])
    let grew = true
    while (grew) {
      grew = false
      for (const d of departments) {
        if (d.parent_feishu_department_id && subtree.has(d.parent_feishu_department_id) && !subtree.has(d.feishu_department_id)) {
          subtree.add(d.feishu_department_id)
          grew = true
        }
      }
    }
    return people.filter((p) => (p.department_ids ?? []).some((id) => subtree.has(id)))
  }, [form.department_id, departments, people])

  const getAccessToken = async () => {
    const supabase = getBrowserSupabaseClient()
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? ""
  }

  // 保存分配后把确认卡片发给项目负责人；负责人在飞书卡片上选人提交即完成闭环。
  const sendNotify = async (leadId: string): Promise<{ ok: boolean; error?: string; pmName?: string }> => {
    try {
      const token = await getAccessToken()
      if (!token) return { ok: false, error: "unauthorized" }
      const res = await fetch("/api/allocations/notify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ lead_id: leadId }),
      })
      const data = (await res.json().catch(() => ({ ok: false, error: "bad_response" }))) as { ok?: boolean; error?: string; pmName?: string }
      if (!res.ok || !data?.ok) return { ok: false, error: String(data?.error ?? `http_${res.status}`) }
      return { ok: true, pmName: data.pmName }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  const describeNotifyError = (error?: string) => {
    if (!error) return "请稍后重试"
    if (error.includes("pm_not_synced")) return "负责人尚未同步到 CRM 通讯录，请先「同步飞书通讯录」"
    if (error.includes("feishu_not_configured")) return "服务端尚未配置飞书应用凭据"
    if (error.includes("ERR_NO_PERMISSION")) return "需要分配管理权限"
    return "请稍后重试"
  }

  const resendNotify = async (row: Allocation) => {
    const result = await sendNotify(row.lead_id)
    if (result.ok) toast.success(`已发送飞书确认卡片给 ${result.pmName ?? row.project_manager_name ?? "项目负责人"}`)
    else toast.error("发送飞书通知失败", { description: describeNotifyError(result.error) })
  }

  const syncDirectory = async () => {
    setSyncing(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error("unauthorized")
      const res = await fetch("/api/jobs/feishu-sync", { method: "POST", headers: { authorization: `Bearer ${token}` } })
      const data = (await res.json().catch(() => ({ ok: false, error: "bad_response" }))) as { ok?: boolean; error?: string; departments?: number; members?: number; deactivated?: number }
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `http_${res.status}`))
      toast.success("飞书通讯录已同步", { description: `部门 ${data.departments} 个，成员 ${data.members} 人，停用 ${data.deactivated} 人` })
      await load()
    } catch (err: any) {
      toast.error("同步飞书通讯录失败", { description: String(err?.message ?? err) })
    } finally {
      setSyncing(false)
    }
  }

  const pending = useMemo(() => rows.filter((r) => r.allocation_status !== "assigned"), [rows])
  const openEditor = (row: Allocation) => {
    setSelected(row)
    const next: Record<string, any> = {
      department_id: row.department_id ?? "",
      project_manager_id: row.project_manager_id ?? "", note: row.note ?? "", detail_link: row.detail_link ?? "",
      platforms: row.platforms ?? [],
    }
    setForm(next); setOpen(true)
  }
  const save = async () => {
    if (!selected || !form.department_id || !form.project_manager_id) { toast.error("请选择部门/项目组和项目负责人"); return }
    const supabase = getBrowserSupabaseClient()
    const managerChanged = selected.project_manager_id !== form.project_manager_id
    const { error } = await supabase.rpc("rpc_project_allocation_upsert", {
      p_lead_id: selected.lead_id, p_department_id: form.department_id, p_project_manager_id: form.project_manager_id,
      p_platforms: form.platforms ?? [],
      p_note: form.note || null, p_detail_link: form.detail_link || null,
      p_preserve_team: true,
    })
    if (error) { const friendly = mapRpcError(error, { title: "保存分配失败", description: "请稍后重试" }); toast.error(friendly.title, { description: friendly.description }); return }
    toast.success("项目组分配已保存"); setOpen(false)
    // 团队名单由负责人在飞书卡片确认；仅在新分配、换负责人或负责人尚未确认时才发卡片
    if (managerChanged || !selected.confirmed_at) {
      const notify = await sendNotify(selected.lead_id)
      if (notify.ok) toast.success(`已发送飞书确认卡片给 ${notify.pmName ?? "项目负责人"}`)
      else toast.warning("已保存，但未发出飞书确认卡片", { description: describeNotifyError(notify.error) })
    }
    await load()
  }

  if (!canRead && permissions !== null) return <Card><CardContent className="py-12 text-center text-muted-foreground">暂无分配中心权限，请联系管理员开通。</CardContent></Card>
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="w-6 h-6 text-primary" />分配中心</h1><p className="text-sm text-muted-foreground mt-1">成交客户分配到部门项目组并确定负责人；各角色执行成员由负责人在飞书确认卡片中选定。</p></div>
      <div className="flex gap-2">
        {canManage && <Button variant="outline" onClick={() => void syncDirectory()} disabled={syncing}><RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />{syncing ? "同步中…" : "同步飞书通讯录"}</Button>}
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" />刷新</Button>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">待分配</CardTitle></CardHeader><CardContent className="text-3xl font-bold text-amber-600">{pending.length}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">已分配</CardTitle></CardHeader><CardContent className="text-3xl font-bold text-emerald-600">{rows.length - pending.length}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">成交客户总数</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{rows.length}</CardContent></Card></div>
    <Card><CardHeader><CardTitle>成交客户分配队列</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>客户</TableHead><TableHead>品类</TableHead><TableHead>投放平台</TableHead><TableHead>成交销售</TableHead><TableHead>部门/项目组</TableHead><TableHead>项目负责人</TableHead><TableHead>CRM 状态</TableHead><TableHead>优化系统</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={9} className="py-10 text-center">加载中…</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">暂无成交客户</TableCell></TableRow> : rows.map((row) => <TableRow key={row.lead_id}><TableCell><div className="font-semibold">{row.company_name || "未命名客户"}</div><div className="text-xs text-muted-foreground">{row.customer_name || ""}</div></TableCell><TableCell><div className="flex flex-wrap gap-1">{row.product_category || <span className="text-muted-foreground">历史数据未填写</span>}</div></TableCell><TableCell><div className="flex flex-wrap gap-1">{(row.platforms ?? []).length ? (row.platforms ?? []).map((p) => <Badge key={p} variant="secondary" className="text-xs">{platformOptions.find(([key]) => key === p)?.[1] ?? p}</Badge>) : "-"}</div></TableCell><TableCell>{row.sales_owner_name || "-"}</TableCell><TableCell>{row.department_name || "未分配"}</TableCell><TableCell><div className="font-semibold">{row.project_manager_name || "未分配"}</div>{row.confirmed_at ? <Badge variant="outline" className="mt-1 text-emerald-700 border-emerald-300 text-xs">运营已确认</Badge> : null}</TableCell><TableCell>{row.allocation_status === "assigned" ? <Badge className="bg-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" />已分配</Badge> : <Badge variant="secondary" className="text-amber-700"><Clock3 className="w-3 h-3 mr-1" />待分配</Badge>}</TableCell><TableCell><Badge variant={row.sync_status === "failed" || row.sync_status === "rejected" ? "destructive" : "outline"}>{syncStatusLabels[row.sync_status ?? "not_connected"]}</Badge>{row.sync_error ? <div className="mt-1 max-w-[180px] truncate text-xs text-destructive" title={row.sync_error}>{row.sync_error}</div> : null}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2">{canManage && row.allocation_status === "assigned" && row.project_manager_id && <Button size="sm" variant="ghost" onClick={() => void resendNotify(row)}>通知</Button>}{canManage && <Button size="sm" variant="outline" onClick={() => openEditor(row)}>{row.allocation_status === "assigned" ? "编辑" : "分配"}</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]"><DialogHeader><DialogTitle>分配项目组 · {selected?.company_name}</DialogTitle></DialogHeader><div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2"><div className="space-y-2"><Label>部门/项目组 *</Label><Select value={form.department_id ?? ""} onValueChange={(v) => setForm({ ...form, department_id: v, project_manager_id: "" })}><SelectTrigger><SelectValue placeholder="选择部门" /></SelectTrigger><SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>项目负责人 *</Label><Select value={form.project_manager_id ?? ""} onValueChange={(v) => setForm({ ...form, project_manager_id: v })}><SelectTrigger><SelectValue placeholder={form.department_id ? "选择负责人" : "先选择部门"} /></SelectTrigger><SelectContent>{candidateManagers.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent></Select>{form.department_id && candidateManagers.length === 0 ? <p className="text-xs text-amber-600">该部门（含下级）暂无在职成员，可先「同步飞书通讯录」或选择上级部门。</p> : null}</div><div className="space-y-2 sm:col-span-2"><Label>投放平台（可多选）</Label><div className="flex flex-wrap gap-2 rounded-md border p-3">{platformOptions.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><Checkbox checked={(form.platforms ?? []).includes(key)} onCheckedChange={(checked) => { const next = new Set(form.platforms ?? []); if (checked) next.add(key); else next.delete(key); setForm({ ...form, platforms: Array.from(next) }) }} />{label}</label>)}</div></div>{selected?.allocation_status === "assigned" && <div className="space-y-2 sm:col-span-2 rounded-md border p-3"><div className="flex items-center justify-between"><Label>项目组成员（负责人在飞书确认）</Label>{selected.confirmed_at ? <Badge variant="outline" className="border-emerald-300 text-emerald-700 text-xs">已确认</Badge> : <Badge variant="secondary" className="text-amber-700 text-xs">待负责人确认</Badge>}</div>{roleFields.map(([key, label, namesKey]) => <div key={key} className="flex gap-2 text-sm"><span className="w-32 shrink-0 text-muted-foreground">{label}</span><span>{((selected as any)[namesKey] as string[] | null)?.length ? ((selected as any)[namesKey] as string[]).join("、") : "未指定"}</span></div>)}</div>}
<div className="space-y-2 sm:col-span-2"><Label>客户详细情况链接</Label><Input value={form.detail_link || ""} onChange={(e) => setForm({ ...form, detail_link: e.target.value })} placeholder="https://docs.google.com/..." /></div><div className="space-y-2 sm:col-span-2"><Label>备注</Label><Input value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="补充项目执行要求" /></div><div className="space-y-1 sm:col-span-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">各角色执行成员无需在此填写：保存后系统向项目负责人发送飞书确认卡片，由负责人在飞书中选定并提交团队名单；更换负责人或部门后需重新确认。</div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button onClick={() => void save()}>保存分配</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
