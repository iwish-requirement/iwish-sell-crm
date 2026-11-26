"use client"

import { useEffect, useState, type ComponentType, type ReactNode } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { crmDate, visitMethods, visitTypes } from "@/lib/services/crm-visits"

const stageLabels = [
  ["uncontacted", "未建联"], ["connected", "已建联"], ["offline_visit", "有效拜访"],
  ["proposal_quotation", "方案及报价"], ["intent_confirmed", "合作意向已确认"],
  ["contract_review", "合同确认"], ["won", "已签约"], ["payment_received", "已到款"],
] as const

const resourceColumns = [
  ["held", "未成交客户"], ["key_intent", "重点意向"], ["nurture", "待培育"], ["expiring", "7 天内到期"],
  ["expired", "已超期"], ["pending_review", "待核定保护期"], ["released", "本月释放公海"], ["cooperating", "已合作"],
] as const

const orderLabels: Record<string, string> = { first: "全新单", expansion: "二次开发单", renewal: "续费单", history: "历史未分类" }
const serviceLabels: Record<string, string> = {
  performance: "效果营销", brand: "品牌营销", seo: "SEO", website: "建站", creative: "素材",
  google: "Google", meta: "Meta", criteo: "Criteo", bing: "Bing", pinterest: "Pinterest",
  tiktok: "TikTok", ctv: "CTV", influencer: "红人营销", social: "社媒营销", edm: "EDM", pr: "PR",
  full_service: "整合全案运营", sem: "SEM",
}

type Person = {
  id: string; name: string; team_id: number | null; team: string | null
  own: number; accompanied: number; total: number; goal: number | null; weekly_reference: string | null
  first: number; repeat: number; expansion: number
}

type Resource = { id: string; name: string; quota: number } & Record<(typeof resourceColumns)[number][0], number>
type Order = { lead_id: string; signed_on: string; customer: string; contract_number: string; kind: string; services: Record<string, string[]> }
type Report = {
  asOf: string
  canExport: boolean
  canCompare: boolean
  people: Person[]
  resources: Resource[]
  funnel: Record<string, { new: number; active: number }>
  stageRates: Record<string, number | null> | null
  newCustomers: number; teamVisits: number; firstVisits: number
  expectedMargin: number | null
  firstOrders: number; expansionOrders: number; renewalOrders: number; newSignedCustomers: number
  unclassifiedHistoryOrders: number
  profits: { currency: string; orders: number; confirmed: number; amount: number | null }[]
  released: number; conversionBase: number; conversionWon: number; conversionComplete: boolean
  receipts: { currency: string; amount: number }[]
  orders: Order[]
}

type VisitDetail = { lead_id: string | null; customer: string; visited_on: string; seller: string; own: boolean | null; method: string; visit_type: string }
type ResourceDetail = { id: string; customer: string; deadline: string | null }
type Detail = { kind: "visits"; owner: string | null; title: string } |
  { kind: "resource"; owner: string; metric: string; title: string } | { kind: "orders"; title: string }
const selectStyle = "rounded-md border bg-background px-2 py-1.5 text-sm"
const pageSize = 200
const divide = (n: number, d: number, scale = 1) => d > 0 ? (scale * n / d).toFixed(1) : "—"
const percent = (n: number, d: number) => d > 0 ? divide(n, d, 100) + "%" : "—"
const formatServices = (order: Order) => Object.entries(order.services).flatMap(([key, list]) =>
  list.length ? list.map((item) => serviceLabels[item] ?? item) : [serviceLabels[key] ?? key])
const methodLabel = (id: string) => id.split(",").map((key) => visitMethods.find((m) => m.id === key)?.label ?? key).join("、")
const typeLabel = (id: string) => id.split(",").map((key) => visitTypes.find((t) => t.id === key)?.label ?? key).join("、")
const roleLabel = (own: boolean | null) => own === null ? "多人参与" : own ? "自己客户拜访" : "陪访"

function visitQuery(startOn: string, endOn: string, team: string, person: string | null, includeGm: boolean, method = "", visitType = "") {
  return {
    p_start: startOn, p_end: endOn, p_team: team ? Number(team) : null, p_profile: person || null,
    p_method: method || null, p_type: visitType || null, p_include_gm: includeGm,
  }
}

async function exportableVisitRows(query: ReturnType<typeof visitQuery>) {
  const client = getBrowserSupabaseClient()
  const details = [["客户", "拜访日期", "销售", "身份", "类型", "方式"]]
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.rpc("rpc_crm_operating_visit_details", { ...query, p_offset: offset })
    if (error) throw error
    const rows = data as VisitDetail[]
    details.push(...rows.map((r) => [r.customer, r.visited_on, r.seller, roleLabel(r.own), typeLabel(r.visit_type), methodLabel(r.method)]))
    if (rows.length < pageSize) return details
  }
}

function CustomerLink({ id, name }: { id: string | null; name: string }) {
  return id ? <Link className="underline" href={"/leads/" + id}>{name}</Link> : <span>{name}</span>
}

type FunnelChartProps = {
  funnelData: { stage: string; fullName: string; count: number }[]
  rates: (string | null)[]
  stock: string
  setStock: (stock: string) => void
  output: string
  asOf: string
  onExport?: () => void
  exporting: boolean
  actions: ReactNode
}

export function CrmOperatingReportDialog({ children }: { children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild><Button size="sm" variant="outline">经营明细</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>销售经营明细</DialogTitle>
          <DialogDescription>查看当前统计周期的拜访、客户资源与合同订单。</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function CrmOperatingDashboard({ start, end, period, analytics = false, reportTeam, renderFunnel: FunnelChart }: {
  start: Date
  end: Date
  period: string
  analytics?: boolean
  reportTeam?: string
  renderFunnel?: ComponentType<FunnelChartProps>
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [options, setOptions] = useState<Person[]>([])
  const [chosenTeam, setTeam] = useState("")
  const team = reportTeam ?? chosenTeam
  const [person, setPerson] = useState("")
  const [stock, setStock] = useState("new")
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [visits, setVisits] = useState<VisitDetail[]>([])
  const [resources, setResources] = useState<ResourceDetail[]>([])
  const [orderDetails, setOrderDetails] = useState<Order[]>([])
  const [method, setMethod] = useState("")
  const [visitType, setVisitType] = useState("")
  const [page, setPage] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const startOn = crmDate(start)
  const endOn = crmDate(end)
  const includeGm = !analytics
  const reportQuery = { p_start: startOn, p_end: endOn, p_period: period, p_team: team ? Number(team) : null, p_profile: person || null, p_include_gm: includeGm }

  useEffect(() => {
    let active = true
    setReport(null)
    setError(false)
    void getBrowserSupabaseClient().rpc("rpc_crm_operating_dashboard", {
      ...reportQuery,
    }).then(({ data, error: failed }) => {
      if (!active) return
      if (failed || !data?.people) { setError(true); return }
      const next = data as Report
      setReport(next)
      if ((!team || reportTeam !== undefined) && !person) setOptions(next.people)
    })
    return () => { active = false }
  }, [startOn, endOn, period, team, person, retry, reportTeam, includeGm])

  useEffect(() => {
    if (!detail) return
    let active = true
    setDetailLoading(true)
    setVisits([])
    setResources([])
    setOrderDetails([])
    const client = getBrowserSupabaseClient()
    const request = detail.kind === "visits"
      ? client.rpc("rpc_crm_operating_visit_details", {
          ...visitQuery(startOn, endOn, team, detail.owner || person, includeGm, method, visitType), p_offset: page * pageSize,
        })
      : detail.kind === "resource" ? client.rpc("rpc_crm_resource_details", { p_owner: detail.owner, p_metric: detail.metric, p_offset: page * pageSize,
        p_team: reportQuery.p_team, p_start: startOn, p_end: endOn, p_include_gm: includeGm })
      : client.rpc("rpc_crm_operating_dashboard", {
          ...reportQuery, p_order_offset: page * pageSize,
        })
    void request.then(({ data, error: failed }) => {
      if (!active) return
      setDetailLoading(false)
      if (failed) { toast.error("明细加载失败"); return }
      if (detail.kind === "visits") setVisits(data as VisitDetail[])
      else if (detail.kind === "resource") setResources(data as ResourceDetail[])
      else setOrderDetails((data as Report).orders)
    })
    return () => { active = false }
  }, [detail, startOn, endOn, period, team, person, method, visitType, page, includeGm])

  function openDetail(value: Detail) {
    setPage(0)
    setMethod("")
    setVisitType("")
    setDetail(value)
  }

  async function exportVisitDetail() {
    if (!report?.canExport || detail?.kind !== "visits" || exporting) return
    setExporting(true)
    try {
      const query = visitQuery(startOn, endOn, team, detail.owner || person, includeGm, method, visitType)
      const [XLSX, rows] = await Promise.all([import("xlsx"), exportableVisitRows(query)])
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "拜访明细")
      XLSX.writeFile(book, "CRM拜访明细-" + startOn + ".xlsx")
    } catch {
      toast.error("导出拜访明细失败，请重试")
    } finally {
      setExporting(false)
    }
  }

  async function exportReport() {
    if (!report?.canExport || exporting) return
    setExporting(true)
    try {
      const db = getBrowserSupabaseClient()
      const [XLSX, refreshed] = await Promise.all([import("xlsx"), db.rpc("rpc_crm_operating_dashboard", reportQuery)])
      if (refreshed.error || !refreshed.data?.canExport) throw refreshed.error ?? new Error("无导出权限")
      const report = refreshed.data as Report
      const book = XLSX.utils.book_new()
      const sheet = (label: string, rows: (string | number | null)[][]) =>
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), label)
      sheet("经营汇总", [["开始日期", startOn], ["结束日期（不含）", endOn], ["统计截至", report.asOf],
        ["本期新增", report.newCustomers], ["有效拜访（客户和日期去重）", report.teamVisits], ["全新首访", report.firstVisits],
        ["全新单", report.firstOrders], ["二次开发单", report.expansionOrders], ["续费单", report.renewalOrders],
        ["历史未分类订单", report.unclassifiedHistoryOrders],
        ["首签客户", report.newSignedCustomers], ["预计签单毛利", report.expectedMargin], ["释放公海", report.released],
        ["成交转化率", report.conversionComplete ? percent(report.conversionWon, report.conversionBase) : "数据不足"],
        ...report.receipts.map((item) => ["实际到账 " + item.currency, item.amount]),
        ...report.profits.flatMap((item) => [
          ["实际签单毛利 " + item.currency, item.amount],
          ["平均订单毛利 " + item.currency, item.amount === null ? null : divide(item.amount,item.orders)],
          ["每次拜访对应毛利 " + item.currency, item.amount === null ? null : divide(item.amount,report.teamVisits)],
        ])])
      sheet("拜访目标", [
        ["销售", "团队", "自己客户拜访", "陪访", "个人总量", "首访", "复访", "二次开发", "目标", "完成率"],
        ...report.people.map((p) => [p.name, p.team, p.own, p.accompanied, p.total, p.first, p.repeat, p.expansion, p.goal, percent(p.total, p.goal ?? 0)]),
      ])
      sheet("资源管理", [["销售", "持有上限", "剩余名额", ...resourceColumns.map(([,label]) => label)],
        ...report.resources.map((r) => [r.name, r.quota, Math.max(0, r.quota-r.held), ...resourceColumns.map(([key]) => r[key])])])
      sheet("销售漏斗", [["阶段", "本期新增", "全部跟进", "同批下一阶段转化率"],
        ...stageLabels.map(([id,label]) => [label, report.funnel[id]?.new ?? 0, report.funnel[id]?.active ?? 0,
          report.stageRates ? report.stageRates[id] ?? "—" : "数据不足"])])
      const allOrders = [...report.orders]
      for (let offset = pageSize; allOrders.length === offset; offset += pageSize) {
        const { data, error: failure } = await db.rpc("rpc_crm_operating_dashboard", {
          ...reportQuery, p_order_offset: offset,
        })
        if (failure) throw failure
        allOrders.push(...(data as Report).orders)
      }
      sheet("订单明细", [["客户", "合同编号", "签约日期", "类型", "服务"],
        ...allOrders.flatMap((r) => (formatServices(r).length ? formatServices(r) : [""]).map((service) =>
          [r.customer, r.contract_number, r.signed_on, orderLabels[r.kind] ?? r.kind, service]))])
      sheet("拜访明细", await exportableVisitRows(visitQuery(startOn, endOn, team, person, includeGm)))
      XLSX.writeFile(book, "CRM经营统计-" + startOn + ".xlsx")
    } catch {
      toast.error("生成 Excel 失败，请重试")
    } finally {
      setExporting(false)
    }
  }

  if (error) return <div className="rounded-md border p-3 text-sm">新版经营数据加载失败 <Button variant="ghost" size="sm" onClick={() => setRetry((n) => n + 1)}>重试</Button></div>
  if (!report) return <p role="status" className="text-sm text-muted-foreground">正在读取销售经营数据…</p>

  const teams = Array.from(new Map(options.filter((p) => p.team_id !== null).map((p) => [p.team_id, p.team])).entries())
  const cohortDisplay = report.conversionComplete ? percent(report.conversionWon, report.conversionBase) : "数据不足"
  const orders = report.firstOrders + report.expansionOrders + report.renewalOrders + report.unclassifiedHistoryOrders
  const showProfit = (value: (amount: number, count: number) => string) => report.profits.map((p) => (
    p.amount !== null && p.currency ? p.currency + " " + value(p.amount, p.orders) : "待核定 " + p.confirmed + "/" + p.orders
  )).join(" / ") || "—"
  const quickMetrics = [
    ["本期新增客户", report.newCustomers], ["全新首访", report.firstVisits], ["首签客户", report.newSignedCustomers],
    ["本期全新单", report.firstOrders], ["二次开发单", report.expansionOrders], ["续费单", report.renewalOrders],
    ["历史未分类订单", report.unclassifiedHistoryOrders], ["预计签单毛利", report.expectedMargin ?? "—"],
    ["实际签单毛利", showProfit((amount) => amount.toLocaleString())], ["平均订单毛利", showProfit((amount,count) => divide(amount,count))],
    ["每单对应拜访量", divide(report.teamVisits, orders)], ["签单量与拜访量比值", percent(orders, report.teamVisits)],
    ["每次拜访对应毛利", showProfit((amount) => divide(amount,report.teamVisits))], ["同期回款", report.receipts.map((r) => r.currency + " " + r.amount.toLocaleString()).join(" / ") || "—"],
    ["公海释放", report.released],
  ] as const

  const reportContent = (
    <section className="space-y-5 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">销售经营</h2>
        <div className="flex flex-wrap gap-2">
          {report.canCompare && <>
            {reportTeam === undefined && <select aria-label="筛选部门" className={selectStyle} value={team} onChange={(event) => { setTeam(event.target.value); setPerson("") }}>
              <option value="">全部授权部门</option>
              {teams.map(([id, name]) => <option key={id} value={String(id)}>{name || String(id)}</option>)}
            </select>}
            <select aria-label="筛选销售" className={selectStyle} value={person} onChange={(event) => setPerson(event.target.value)}>
              <option value="">全部授权销售</option>
              {options.filter((p) => reportTeam !== undefined || !team || String(p.team_id) === team).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>}
          {report.canExport && <Button size="sm" variant="outline" disabled={exporting} onClick={exportReport}>导出 Excel</Button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Button variant="outline" size="sm" onClick={() => openDetail({ kind: "visits", owner: null, title: "有效拜访明细" })}>
          有效拜访 {report.teamVisits} 次
        </Button>
        <Button variant="outline" size="sm" onClick={() => openDetail({ kind: "orders", title: "签约订单与服务明细" })}>合同订单 {orders} 笔</Button>
        <Badge variant="secondary">同批客户成交转化 {report.conversionWon}/{report.conversionBase} · {cohortDisplay}</Badge>
        <Badge variant="outline">统计截至 {report.asOf}</Badge>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {quickMetrics.map(([name, value]) => <div key={name} className="rounded-md border p-2">
          <dt className="text-xs text-muted-foreground">{name}</dt><dd className="font-medium">{value}</dd>
        </div>)}
      </dl>
      {!FunnelChart && <><div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">销售漏斗与实际产出</h3>
        <select aria-label="漏斗统计口径" className={selectStyle} value={stock} onChange={(event) => setStock(event.target.value)}>
          <option value="new">本期新增客户</option><option value="active">全部在跟进客户</option><option value="output">本期实际经营产出</option>
        </select>
      </div>
      {stock === "output" ? (
        <p className="text-sm">有效拜访 {report.teamVisits} 次 · 合同订单 {orders} 笔 · 到账 {report.receipts.map((r) => r.currency + " " + r.amount.toLocaleString()).join(" / ") || "—"}</p>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>阶段</TableHead><TableHead>客户数</TableHead><TableHead>同批客户进入下一阶段</TableHead></TableRow></TableHeader>
          <TableBody>{stageLabels.map(([id, label]) => {
            const counts = report.funnel[id]
            const rate = report.stageRates?.[id]
            return <TableRow key={id}><TableCell>{label}</TableCell><TableCell>{(stock === "new" ? counts?.new : counts?.active) ?? 0}</TableCell>
              <TableCell>{id === "payment_received" ? "—" : report.stageRates ? rate == null ? "—" : rate + "%" : "数据不足"}</TableCell></TableRow>
          })}</TableBody>
        </Table>
      )}</>}
      {!analytics && <>
        <h3 className="text-sm font-semibold">个人拜访目标</h3>
        <Table>
          <TableHeader><TableRow>{["销售", "自己客户拜访", "陪访", "总量", "首访", "复访", "二次开发", "目标", "完成率", "剩余"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{report.people.map((p) => <TableRow key={p.id}>
            <TableCell>{p.name}</TableCell><TableCell>{p.own}</TableCell><TableCell>{p.accompanied}</TableCell>
            <TableCell><Button size="sm" variant="link" onClick={() => openDetail({ kind: "visits", owner: p.id, title: p.name + " · 拜访明细" })}>{p.total}</Button></TableCell>
            <TableCell>{p.first}</TableCell><TableCell>{p.repeat}</TableCell><TableCell>{p.expansion}</TableCell>
            <TableCell>{period === "week" ? p.weekly_reference ?? "—" : p.goal ?? "—"}</TableCell>
            <TableCell>{percent(p.total, p.goal ?? 0)}</TableCell><TableCell>{p.goal === null ? "—" : Math.max(0, p.goal - p.total)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        <h3 className="text-sm font-semibold">客户资源管理</h3>
        <Table>
          <TableHeader><TableRow>{["销售", "持有上限", "剩余名额", ...resourceColumns.map(([,label]) => label)].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{report.resources.map((r) => <TableRow key={r.id}>
            <TableCell>{r.name}</TableCell><TableCell>{r.quota}</TableCell><TableCell>{Math.max(0, r.quota-r.held)}</TableCell>
            {resourceColumns.map(([metric,label]) => <TableCell key={metric}><Button size="sm" variant="link"
              onClick={() => openDetail({ kind: "resource", owner: r.id, metric, title: r.name + " · " + label })}>{r[metric]}</Button></TableCell>)}
          </TableRow>)}</TableBody>
        </Table>
      </>}
      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null) }}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>查看当前筛选范围内的记录。</DialogDescription>
          </DialogHeader>
          {detail?.kind === "visits" && <>
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
          {detail?.kind === "resource" && <Table><TableHeader><TableRow><TableHead>客户</TableHead><TableHead>保护到期日</TableHead></TableRow></TableHeader>
            <TableBody>{resources.map((r) => <TableRow key={r.id}><TableCell><CustomerLink id={r.id} name={r.customer} /></TableCell><TableCell>{r.deadline ?? "—"}</TableCell></TableRow>)}</TableBody>
          </Table>}
          {detail?.kind === "orders" && <Table><TableHeader><TableRow>{["客户", "合同编号", "签约日期", "类型", "服务明细"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{orderDetails.map((o) => <TableRow key={o.lead_id}><TableCell>{o.customer}</TableCell><TableCell>{o.contract_number}</TableCell>
              <TableCell>{o.signed_on}</TableCell><TableCell>{orderLabels[o.kind] ?? o.kind}</TableCell>
              <TableCell><ul>{formatServices(o).map((service) => <li key={service}>{service}</li>)}</ul></TableCell></TableRow>)}</TableBody>
          </Table>}
          {detailLoading && <p role="status" className="text-sm">加载明细中…</p>}
          {detail && <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page===0 || detailLoading} onClick={() => setPage((n) => n-1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={detailLoading || (detail.kind === "visits" ? visits.length : detail.kind === "resource" ? resources.length : orderDetails.length) < pageSize} onClick={() => setPage((n) => n+1)}>下一页</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </section>
  )

  if (!FunnelChart) return reportContent

  return <FunnelChart
    stock={stock}
    setStock={setStock}
    funnelData={stageLabels.map(([id, label]) => ({
      stage: label,
      fullName: label,
      count: (stock === "active" ? report.funnel[id]?.active : report.funnel[id]?.new) ?? 0,
    }))}
    rates={stageLabels.map(([id]) => {
      if (stock !== "new") return null
      if (!report.stageRates) return "数据不足"
      const rate = report.stageRates[id]
      return rate == null ? null : rate + "%"
    })}
    output={`有效拜访 ${report.teamVisits} 次 · 合同订单 ${orders} 笔 · 到账 ${report.receipts.map((r) => r.currency + " " + r.amount.toLocaleString()).join(" / ") || "—"}`}
    asOf={report.asOf}
    onExport={report.canExport ? exportReport : undefined}
    exporting={exporting}
    actions={<CrmOperatingReportDialog>{reportContent}</CrmOperatingReportDialog>}
  />
}
