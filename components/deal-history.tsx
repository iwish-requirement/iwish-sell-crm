"use client"

import { useEffect, useState } from "react"
import { DollarSign, Search } from "lucide-react"
import { HistoryContractForm } from "@/components/deal-history-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listDealHistory, loadDealHistory, type HistoryRecord, type HistorySummary } from "@/lib/services/deal-history"
import { formatDealDate } from "@/lib/services/deal-date"

const pageSize = 20

function DealHistoryDetail({ row, close, edit, loading, failed }: {
  row: HistorySummary; close: () => void; edit: () => void; loading: boolean; failed: boolean;
}) {
  return (
    <Sheet open onOpenChange={open => { if (!open) close() }}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:w-[480px] sm:max-w-[540px]">
        <SheetHeader className="border-b p-6 pt-12">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <DollarSign className="size-6 text-primary" />
            </div>
            <div className="min-w-0 space-y-1">
              <SheetTitle className="break-words text-left text-xl font-bold">{row.company}</SheetTitle>
              <SheetDescription>{row.salesperson} · 旧表第 {row.source_row} 行</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="space-y-6 p-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {[
              ["签订合同时间", formatDealDate(row.signed_on)], ["合同编号", row.contract_number],
              ["合同基础服务费总金额", row.base_fee], ["销售人员", row.salesperson], ["网址", row.website],
            ].map(([label, value]) => (
              <div className="min-w-0 space-y-1" key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="min-h-5 whitespace-pre-wrap break-words font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-2 border-t pt-4">
            <Button type="button" disabled={loading} onClick={edit}>{loading ? "正在加载合同资料…" : "合同资料补充"}</Button>
            {failed && <p role="alert" className="text-sm text-destructive">历史合同资料加载失败，请重试。</p>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DealHistory({ allocationCutoff = null }: { allocationCutoff?: string | null }) {
  const [rows, setRows] = useState<HistorySummary[]>([])
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">("loading")
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const [ownerId, setOwnerId] = useState("all")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<HistorySummary | null>(null)
  const [details, setDetails] = useState<HistoryRecord | null>(null)
  const [isOpening, setIsOpening] = useState(false)
  const [detailsError, setDetailsError] = useState(false)

  useEffect(() => {
    let active = true
    listDealHistory().then(
      result => { if (active) { setRows(result); setListStatus("ready") } },
      () => { if (active) setListStatus("error") },
    )
    return () => { active = false }
  }, [attempt])

  useEffect(() => {
    if (!isOpening || !selected) return
    let active = true
    loadDealHistory(selected.id).then(
      result => { if (active) { setDetails(result); setIsOpening(false) } },
      () => { if (active) { setDetailsError(true); setIsOpening(false) } },
    )
    return () => { active = false }
  }, [isOpening, selected])

  const owners = new Map(rows.flatMap(row =>
    row.owner_id && row.salesperson ? [[row.owner_id, row.salesperson.trim()] as const] : []))
  const filter = query.trim().toLowerCase()
  const filtered = rows.filter(row => (
    ownerId === "all" || (ownerId === "unassigned" ? !row.owner_id : row.owner_id === ownerId)
  ) && (!filter || String(row.source_row) === filter ||
    [row.company, row.salesperson, row.contract_number, row.website].some(value => value?.toLowerCase().includes(filter))))
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, lastPage)

  function close() {
    setSelected(null)
    setDetails(null)
    setIsOpening(false)
    setDetailsError(false)
  }

  function update(updated: HistoryRecord) {
    setDetails(updated)
    const value = (index: number, key: string) => String(updated.raw_values[index] ?? "") || updated.fields[key] || null
    const changed = {
      signed_on: value(1, "B"), contract_number: updated.generated_contract_number ?? value(8, "I"), website: value(9, "J"),
      contact_name: value(11, "L"), base_fee: value(16, "Q"),
    }
    setRows(current => current.map(row => row.id === updated.id ? { ...row, ...changed } : row))
    setSelected(current => current ? { ...current, ...changed } : current)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">成交中心</h1>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base font-bold">历史成交</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-72">
                <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" aria-label="搜索历史成交" className="h-9 pl-9 text-sm"
                  placeholder="搜索客户、销售人员或合同编号" value={query}
                  onChange={event => { setQuery(event.currentTarget.value); setPage(1) }} />
              </div>
              <Select value={ownerId} onValueChange={id => { setOwnerId(id); setPage(1) }}>
                <SelectTrigger aria-label="销售人员筛选" className="h-9 w-full text-sm sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部销售人员</SelectItem>
                  {[...owners].sort((a, b) => a[1].localeCompare(b[1], "zh-CN")).map(([id, name]) =>
                    <SelectItem key={id} value={id}>{name}</SelectItem>,
                  )}
                  {rows.some(row => !row.owner_id) && <SelectItem value="unassigned">无对应 CRM 人员</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {listStatus === "loading" ? <p role="status" className="py-4 text-sm text-muted-foreground">正在加载历史成交…</p>
            : listStatus === "error" ? <div className="flex items-center gap-3 text-sm">
              <p role="alert">历史成交加载失败。</p>
              <Button size="sm" variant="outline" onClick={() => { setListStatus("loading"); setAttempt(value => value + 1) }}>重试</Button>
            </div>
            : <>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>签订合同时间</TableHead><TableHead>客户全称</TableHead><TableHead>销售人员</TableHead>
                  <TableHead>合同编号</TableHead><TableHead className="text-right">合同基础服务费总金额</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(row => (
                    <TableRow key={row.id} className="cursor-pointer text-sm hover:bg-accent/40" onClick={() => setSelected(row)}>
                      <TableCell className="whitespace-nowrap">{formatDealDate(row.signed_on)}</TableCell>
                      <TableCell className="min-w-45">
                        <Button type="button" variant="link" className="h-auto whitespace-normal px-0 py-0 text-left font-semibold"
                          onClick={event => { event.stopPropagation(); setSelected(row) }}>{row.company}</Button>
                        {row.contact_name && <p className="text-xs text-muted-foreground">{row.contact_name}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.salesperson}</TableCell>
                      <TableCell>{row.contract_number}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{row.base_fee}</TableCell>
                    </TableRow>
                  ))}
                  {!filtered.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">当前范围暂无历史成交。</TableCell></TableRow>}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm text-muted-foreground">
                <p role="status">共 {filtered.length} 条</p>
                <nav aria-label="历史成交分页" className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</Button>
                  <span>{currentPage} / {lastPage}</span>
                  <Button size="sm" variant="outline" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>下一页</Button>
                </nav>
              </div>
            </>}
        </CardContent>
      </Card>
      {selected && !details && <DealHistoryDetail row={selected} close={close} loading={isOpening} failed={detailsError} edit={() => {
        setIsOpening(true)
        setDetailsError(false)
      }} />}
      {details && <HistoryContractForm row={details} key={details.id} allocationCutoff={allocationCutoff} save={update} close={() => setDetails(null)} />}
    </div>
  )
}
