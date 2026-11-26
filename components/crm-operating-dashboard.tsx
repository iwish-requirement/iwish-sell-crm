"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { crmDate, visitMethods, visitTypes } from "@/lib/services/crm-visits"

type Person = {
  id: string; name: string; team_id: number | null; team: string | null
  own: number; accompanied: number; total: number; goal: number | null; weekly_reference: string | null
  first: number; repeat: number; expansion: number
}

type Report = {
  canExport: boolean
  canCompare: boolean
  people: Person[]
  teamVisits: number
}
type VisitDetail = { lead_id: string | null; customer: string; visited_on: string; seller: string; own: boolean | null; method: string; visit_type: string }
const selectStyle = "rounded-md border bg-background px-2 py-1.5 text-sm"
const pageSize = 200
const divide = (n: number, d: number, scale = 1) => d > 0 ? (scale * n / d).toFixed(1) : "—"
const percent = (n: number, d: number) => d > 0 ? divide(n, d, 100) + "%" : "—"
const methodLabel = (id: string) => id.split(",").map((key) => visitMethods.find((m) => m.id === key)?.label ?? key).join("、")
const typeLabel = (id: string) => id.split(",").map((key) => visitTypes.find((t) => t.id === key)?.label ?? key).join("、")
const roleLabel = (own: boolean | null) => own === null ? "多人参与" : own ? "自己客户拜访" : "陪访"

function visitQuery(startOn: string, endOn: string, team: string, person: string | null, method = "", visitType = "") {
  return {
    p_start: startOn, p_end: endOn, p_team: team ? Number(team) : null, p_profile: person || null,
    p_method: method || null, p_type: visitType || null,
  }
}

async function exportableVisitRows(query: ReturnType<typeof visitQuery>) {
  const client = getBrowserSupabaseClient()
  const details = [["客户", "拜访日期", "销售", "身份", "类型", "方式"]]
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.rpc("rpc_crm_visit_details", { ...query, p_offset: offset })
    if (error) throw error
    const rows = data as VisitDetail[]
    details.push(...rows.map((r) => [r.customer, r.visited_on, r.seller, roleLabel(r.own), typeLabel(r.visit_type), methodLabel(r.method)]))
    if (rows.length < pageSize) return details
  }
}

function CustomerLink({ id, name }: { id: string | null; name: string }) {
  return id ? <Link className="underline" href={"/leads/" + id}>{name}</Link> : <span>{name}</span>
}

export function CrmOperatingReportDialog({ children }: { children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild><Button size="sm" variant="outline">经营明细</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>销售经营明细</DialogTitle>
          <DialogDescription>查看当前统计周期的拜访和目标完成情况。</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function CrmOperatingDashboard({ start, end, period }: { start: Date; end: Date; period: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [options, setOptions] = useState<Person[]>([])
  const [team, setTeam] = useState("")
  const [person, setPerson] = useState("")
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [detail, setDetail] = useState<{ owner: string | null; title: string } | null>(null)
  const [visits, setVisits] = useState<VisitDetail[]>([])
  const [method, setMethod] = useState("")
  const [visitType, setVisitType] = useState("")
  const [page, setPage] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const startOn = crmDate(start)
  const endOn = crmDate(end)

  useEffect(() => {
    let active = true
    setReport(null)
    setError(false)
    void getBrowserSupabaseClient().rpc("rpc_crm_visit_goal_report", {
      p_start: startOn, p_end: endOn, p_period: period, p_team: team ? Number(team) : null, p_profile: person || null,
    }).then(({ data, error: failed }) => {
      if (!active) return
      if (failed || !data?.people) { setError(true); return }
      const next = data as Report
      setReport(next)
      if (!team && !person) setOptions(next.people)
    })
    return () => { active = false }
  }, [startOn, endOn, period, team, person, retry])

  useEffect(() => {
    if (!detail) return
    let active = true
    setDetailLoading(true)
    setVisits([])
    const client = getBrowserSupabaseClient()
    const request = client.rpc("rpc_crm_visit_details", {
      ...visitQuery(startOn, endOn, team, detail.owner || person, method, visitType), p_offset: page * pageSize,
    })
    void request.then(({ data, error: failed }) => {
      if (!active) return
      setDetailLoading(false)
      if (failed) { toast.error("明细加载失败"); return }
      setVisits(data as VisitDetail[])
    })
    return () => { active = false }
  }, [detail, startOn, endOn, period, team, person, method, visitType, page])

  function openDetail(value: { owner: string | null; title: string }) {
    setPage(0)
    setMethod("")
    setVisitType("")
    setDetail(value)
  }

  async function exportVisitDetail() {
    if (!report?.canExport || exporting) return
    setExporting(true)
    try {
      const query = detail ? visitQuery(startOn, endOn, team, detail.owner || person, method, visitType) : visitQuery(startOn, endOn, team, person)
      const [XLSX, rows] = await Promise.all([import("xlsx"), exportableVisitRows(query)])
      const book = XLSX.utils.book_new()
      if (!detail) {
        const summary = [
          ["开始日期", "结束日期", "销售", "部门", "自己客户拜访", "陪访", "总量", "首访", "复访", "二次开发", "目标", "完成率", "剩余"],
          ...report.people.map((person) => [
            startOn, endOn, person.name, person.team ?? "", person.own, person.accompanied, person.total,
            person.first, person.repeat, person.expansion, period === "week" ? person.weekly_reference ?? "" : person.goal ?? "",
            percent(person.total, person.goal ?? 0), person.goal === null ? "" : Math.max(0, person.goal - person.total),
          ]),
        ]
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(summary), "拜访目标")
      }
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "拜访明细")
      XLSX.writeFile(book, (detail ? "CRM拜访明细-" : "CRM拜访目标-") + startOn + ".xlsx")
    } catch {
      toast.error("导出拜访明细失败，请重试")
    } finally {
      setExporting(false)
    }
  }

  if (error) return <div className="rounded-md border p-3 text-sm">新版经营数据加载失败 <Button variant="ghost" size="sm" onClick={() => setRetry((n) => n + 1)}>重试</Button></div>
  if (!report) return <p role="status" className="text-sm text-muted-foreground">正在读取销售经营数据…</p>

  const teams = Array.from(new Map(options.filter((p) => p.team_id !== null).map((p) => [p.team_id, p.team])).entries())
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {report.canCompare && <>
          <select aria-label="筛选部门" className={selectStyle} value={team} onChange={(event) => { setTeam(event.target.value); setPerson("") }}>
            <option value="">全部授权部门</option>
            {teams.map(([id, name]) => <option key={id} value={String(id)}>{name || String(id)}</option>)}
          </select>
          <select aria-label="筛选销售" className={selectStyle} value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="">全部授权销售</option>
            {options.filter((p) => !team || String(p.team_id) === team).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>}
        {report.canExport && <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportVisitDetail()}>导出 Excel</Button>}
        <Button variant="outline" size="sm" onClick={() => openDetail({ owner: null, title: "有效拜访明细" })}>
          有效拜访 {report.teamVisits} 次
        </Button>
      </div>
        <h3 className="text-sm font-semibold">个人拜访目标</h3>
        <Table>
          <TableHeader><TableRow>{["销售", "自己客户拜访", "陪访", "总量", "首访", "复访", "二次开发", "目标", "完成率", "剩余"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{report.people.map((p) => <TableRow key={p.id}>
            <TableCell>{p.name}</TableCell><TableCell>{p.own}</TableCell><TableCell>{p.accompanied}</TableCell>
            <TableCell><Button size="sm" variant="link" onClick={() => openDetail({ owner: p.id, title: p.name + " · 拜访明细" })}>{p.total}</Button></TableCell>
            <TableCell>{p.first}</TableCell><TableCell>{p.repeat}</TableCell><TableCell>{p.expansion}</TableCell>
            <TableCell>{period === "week" ? p.weekly_reference ?? "—" : p.goal ?? "—"}</TableCell>
            <TableCell>{percent(p.total, p.goal ?? 0)}</TableCell><TableCell>{p.goal === null ? "—" : Math.max(0, p.goal - p.total)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null) }}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>查看当前筛选范围内的记录。</DialogDescription>
          </DialogHeader>
          {detail && <>
            <div className="flex flex-wrap gap-2">
              <select className={selectStyle} aria-label="按拜访方式筛选" value={method} onChange={(event) => { setMethod(event.target.value); setPage(0) }}>
                <option value="">全部方式</option>{visitMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <select className={selectStyle} aria-label="按拜访类型筛选" value={visitType} onChange={(event) => { setVisitType(event.target.value); setPage(0) }}>
                <option value="">全部类型</option>{visitTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              {report.canExport && <Button size="sm" variant="outline" disabled={detailLoading || exporting} onClick={exportVisitDetail}>
                导出当前明细
              </Button>}
            </div>
            <Table><TableHeader><TableRow>{["客户", "日期", "销售", "参与身份", "方式", "类型"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{visits.map((v,i) => <TableRow key={i}>
                <TableCell><CustomerLink id={v.lead_id} name={v.customer} /></TableCell><TableCell>{v.visited_on}</TableCell>
                <TableCell>{v.seller}</TableCell><TableCell>{roleLabel(v.own)}</TableCell>
                <TableCell>{methodLabel(v.method)}</TableCell><TableCell>{typeLabel(v.visit_type)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </>}

          {detailLoading && <p role="status" className="text-sm">加载明细中…</p>}
          {detail && <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || detailLoading} onClick={() => setPage((n) => n-1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={detailLoading || visits.length < pageSize} onClick={() => setPage((n) => n+1)}>下一页</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </section>
  )
}
