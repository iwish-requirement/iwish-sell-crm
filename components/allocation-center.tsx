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
  source: string | null; budget: number | null; closed_at: string; allocation_status: string; product_category?: string | null; categories: { id: number; name: string }[]
  sales_owner_name: string | null; department_team_id: number | null; department_name: string | null
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
}
type Person = { id: string; full_name: string }

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
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Allocation | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})

  const load = async () => {
    if (!canRead) { setLoading(false); return }
    setLoading(true)
    const supabase = getBrowserSupabaseClient()
    const [{ data, error }, { data: teamRows }, { data: profileRows }] = await Promise.all([
      supabase.rpc("rpc_project_allocations_list"),
      supabase.from("teams").select("id,name").eq("is_active", true).order("name"),
      supabase.from("profiles_public").select("id,full_name").eq("status", "active").order("full_name"),
    ])
    if (error) { const friendly = mapRpcError(error, { title: "加载分配中心失败", description: "请稍后重试" }); toast.error(friendly.title, { description: friendly.description }); setRows([]) }
    else setRows((data ?? []) as Allocation[])
    setTeams((teamRows ?? []) as { id: number; name: string }[])
    setPeople((profileRows ?? []) as Person[])
    setLoading(false)
  }
  useEffect(() => { void load() }, [canRead])

  const pending = useMemo(() => rows.filter((r) => r.allocation_status !== "assigned"), [rows])
  const openEditor = (row: Allocation) => {
    setSelected(row)
    const next: Record<string, any> = {
      department_team_id: row.department_team_id ? String(row.department_team_id) : "",
      project_manager_id: row.project_manager_id ?? "", note: row.note ?? "", detail_link: row.detail_link ?? "",
      platforms: row.platforms ?? [],
    }
    for (const [key] of roleFields) {
      const legacyKey = key.replace("_ids", "_id")
      next[key] = Array.isArray((row as any)[key]) ? (row as any)[key] : ((row as any)[legacyKey] ? [(row as any)[legacyKey]] : [])
    }
    setForm(next); setOpen(true)
  }
  const save = async () => {
    if (!selected || !form.department_team_id || !form.project_manager_id) { toast.error("请选择项目组和项目负责人"); return }
    const supabase = getBrowserSupabaseClient()
    const { error } = await supabase.rpc("rpc_project_allocation_upsert", {
      p_lead_id: selected.lead_id, p_department_team_id: Number(form.department_team_id), p_project_manager_id: form.project_manager_id,
      p_platforms: form.platforms ?? [],
      p_google_optimizer_ids: form.google_optimizer_ids ?? [], p_meta_optimizer_ids: form.meta_optimizer_ids ?? [],
      p_criteo_optimizer_ids: form.criteo_optimizer_ids ?? [], p_bing_optimizer_ids: form.bing_optimizer_ids ?? [],
      p_edm_optimizer_ids: form.edm_optimizer_ids ?? [], p_influencer_marketing_ids: form.influencer_marketing_ids ?? [],
      p_note: form.note || null, p_detail_link: form.detail_link || null,
    })
    if (error) { const friendly = mapRpcError(error, { title: "保存分配失败", description: "请稍后重试" }); toast.error(friendly.title, { description: friendly.description }); return }
    toast.success("项目组分配已保存"); setOpen(false); await load()
  }

  if (!canRead && permissions !== null) return <Card><CardContent className="py-12 text-center text-muted-foreground">暂无分配中心权限，请联系管理员开通。</CardContent></Card>
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="w-6 h-6 text-primary" />分配中心</h1><p className="text-sm text-muted-foreground mt-1">成交客户进入项目组后续执行分配，字段与运营分配表保持一致。</p></div>
      <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" />刷新</Button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">待分配</CardTitle></CardHeader><CardContent className="text-3xl font-bold text-amber-600">{pending.length}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">已分配</CardTitle></CardHeader><CardContent className="text-3xl font-bold text-emerald-600">{rows.length - pending.length}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">成交客户总数</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{rows.length}</CardContent></Card></div>
    <Card><CardHeader><CardTitle>成交客户分配队列</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>客户</TableHead><TableHead>品类</TableHead><TableHead>投放平台</TableHead><TableHead>成交销售</TableHead><TableHead>部门/项目组</TableHead><TableHead>项目负责人</TableHead><TableHead>CRM 状态</TableHead><TableHead>优化系统</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={9} className="py-10 text-center">加载中…</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">暂无成交客户</TableCell></TableRow> : rows.map((row) => <TableRow key={row.lead_id}><TableCell><div className="font-semibold">{row.company_name || "未命名客户"}</div><div className="text-xs text-muted-foreground">{row.customer_name || ""}</div></TableCell><TableCell><div className="flex flex-wrap gap-1">{row.product_category || ((row.categories ?? []).length ? row.categories.map((c) => <Badge key={c.id} variant="outline" className="text-xs">{c.name}</Badge>) : <span className="text-muted-foreground">历史数据未填写</span>)}</div></TableCell><TableCell><div className="flex flex-wrap gap-1">{(row.platforms ?? []).length ? (row.platforms ?? []).map((p) => <Badge key={p} variant="secondary" className="text-xs">{platformOptions.find(([key]) => key === p)?.[1] ?? p}</Badge>) : "-"}</div></TableCell><TableCell>{row.sales_owner_name || "-"}</TableCell><TableCell>{row.department_name || "未分配"}</TableCell><TableCell>{row.project_manager_name || "未分配"}</TableCell><TableCell>{row.allocation_status === "assigned" ? <Badge className="bg-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" />已分配</Badge> : <Badge variant="secondary" className="text-amber-700"><Clock3 className="w-3 h-3 mr-1" />待分配</Badge>}</TableCell><TableCell><Badge variant={row.sync_status === "failed" || row.sync_status === "rejected" ? "destructive" : "outline"}>{syncStatusLabels[row.sync_status ?? "not_connected"]}</Badge>{row.sync_error ? <div className="mt-1 max-w-[180px] truncate text-xs text-destructive" title={row.sync_error}>{row.sync_error}</div> : null}</TableCell><TableCell className="text-right">{canManage && <Button size="sm" variant="outline" onClick={() => openEditor(row)}>{row.allocation_status === "assigned" ? "编辑" : "分配"}</Button>}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]"><DialogHeader><DialogTitle>分配项目组 · {selected?.company_name}</DialogTitle></DialogHeader><div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2"><div className="space-y-2"><Label>部门/项目组 *</Label><Select value={form.department_team_id ?? ""} onValueChange={(v) => setForm({ ...form, department_team_id: v })}><SelectTrigger><SelectValue placeholder="选择项目组" /></SelectTrigger><SelectContent>{teams.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>项目负责人 *</Label><Select value={form.project_manager_id ?? ""} onValueChange={(v) => setForm({ ...form, project_manager_id: v })}><SelectTrigger><SelectValue placeholder="选择负责人" /></SelectTrigger><SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2 sm:col-span-2"><Label>投放平台（可多选）</Label><div className="flex flex-wrap gap-2 rounded-md border p-3">{platformOptions.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><Checkbox checked={(form.platforms ?? []).includes(key)} onCheckedChange={(checked) => { const next = new Set(form.platforms ?? []); if (checked) next.add(key); else next.delete(key); setForm({ ...form, platforms: Array.from(next) }) }} />{label}</label>)}</div></div>{roleFields.map(([key, label]) => <div className="space-y-2 sm:col-span-2" key={key}><Label>{label}（可多选）</Label><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3 max-h-36 overflow-y-auto">{people.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><Checkbox checked={(form[key] ?? []).includes(p.id)} onCheckedChange={(checked) => { const next = new Set(form[key] ?? []); if (checked) next.add(p.id); else next.delete(p.id); setForm({ ...form, [key]: Array.from(next) }) }} />{p.full_name}</label>)}</div></div>)}<div className="space-y-2 sm:col-span-2"><Label>客户详细情况链接</Label><Input value={form.detail_link || ""} onChange={(e) => setForm({ ...form, detail_link: e.target.value })} placeholder="https://docs.google.com/..." /></div><div className="space-y-2 sm:col-span-2"><Label>备注</Label><Input value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="补充项目执行要求" /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button onClick={() => void save()}>保存分配</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
