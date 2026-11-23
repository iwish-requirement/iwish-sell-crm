"use client"

import { useContext, useEffect, useState } from "react"
import { MePermissionsContext } from "@/components/app-root"
import { DealContractSubmissionDialog } from "@/components/deal-contract-submission"
import { DealBonusTermsValue } from "@/components/deal-bonus-terms"
import { DepartmentHandoffResults } from "@/components/department-handoff-results"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { downloadDealContractAttachment } from "@/lib/services/deal-contract-submissions"
import { downloadDealHistoryAttachment } from "@/lib/services/deal-history"
import { formatDealDate } from "@/lib/services/deal-date"
import { DEAL_CONTRACT_FIELDS, DEAL_COOPERATION_MODES, DEAL_FINANCE_FIELDS, NO_CONTRACT_ATTACHMENTS, isDealContractFieldVisible } from "@/lib/services/deal-contract-fields"
import {
  loadDepartmentAllocationDetails, loadDepartmentAllocationWorkspace, saveServiceDepartments, selectedAllocationServices,
  type AllocationDepartment, type AllocationDetails, type AllocationRow, type AllocationWorkspace,
} from "@/lib/services/department-allocation"

export function ServiceDepartmentAllocation({ pending = false, cutoff }: { pending?: boolean; cutoff: string }) {
  const permissions = useContext(MePermissionsContext)
  const [workspace, setWorkspace] = useState<AllocationWorkspace | null>(null)
  const [current, setCurrent] = useState<AllocationRow | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState("")
  const [failed, setFailed] = useState(false)
  const refresh = () => setAttempt(value => value + 1)
  useEffect(() => {
    let active = true
    loadDepartmentAllocationWorkspace(pending).then(
      value => { if (active) { setWorkspace(value); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [attempt, pending])
  const query = search.trim().toLowerCase()
  const rows = workspace?.rows.filter(row => !query || [row.company, row.salesperson].some(value => value?.toLowerCase().includes(query)))
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{pending ? "待补合同资料" : "分配中心"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{pending
          ? "补齐并确认合同资料后进入分配中心。"
          : "按已确认的合作服务选择承接部门，每项可多选。"}</p>
      </div>
      <Input className="sm:w-56" placeholder="搜索客户或销售人员" aria-label="搜索客户或销售人员"
        value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    <Card>
      <CardContent className="p-0">
        {failed ? <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm">
          加载失败，请重试。<Button type="button" size="sm" variant="outline" onClick={refresh}>重试</Button>
        </div> : !rows ? <p role="status" className="p-4 text-sm">正在加载…</p> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>客户名称</TableHead><TableHead>销售人员</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(row => {
                const assigned = row.handoffs.length > 0 && row.assignedAt === row.submitted_at
                return <TableRow key={row.source + row.id}>
                  <TableCell>
                    {row.mainlandCompanyName && row.hongKongCompanyName ? <div className="space-y-1">
                      <p className="whitespace-normal break-words font-medium"><span className="mr-2 text-xs text-muted-foreground">大陆公司</span>{row.mainlandCompanyName}</p>
                      <p className="whitespace-normal break-words font-medium"><span className="mr-2 text-xs text-muted-foreground">香港公司</span>{row.hongKongCompanyName}</p>
                    </div> : <p className="whitespace-normal break-words font-medium">{row.company}</p>}
                    {row.source === "history" && <p className="text-xs text-muted-foreground">历史成交</p>}
                  </TableCell>
                  <TableCell>{row.salesperson}</TableCell>
                  <TableCell>
                    <Badge variant={assigned ? "default" : "secondary"}>
                      {pending ? "待补合同资料" : assigned ? "已分配部门 · 待运营交接" : "待分配部门"}
                    </Badge>
                    {row.legacy_department && <p className="mt-1 text-xs text-muted-foreground">原分配 {row.legacy_department}</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => setCurrent(row)}>
                      {pending ? "合同资料提交" : permissions?.canManageAllocations ? "查看并分配" : "查看资料"}
                    </Button>
                  </TableCell>
                </TableRow>
              })}
              {!rows.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                {pending ? "当前范围暂无待补合同资料" : "暂无已确认的分配资料"}
              </TableCell></TableRow>}
            </TableBody>
          </Table>}
      </CardContent>
    </Card>
    {current && (pending
      ? <DealContractSubmissionDialog key={current.id} leadId={current.id} companyName={current.company} salesperson={current.salesperson}
          open onOpenChange={open => { if (!open) { setCurrent(null); refresh() } }} requiredAfter={cutoff} />
      : <DepartmentAllocationDialog key={current.source + current.id} row={current} departments={workspace?.departments ?? []}
          canManage={Boolean(permissions?.canManageAllocations)} close={() => setCurrent(null)}
          saved={() => { setCurrent(null); refresh() }} />)}
  </div>
}

function DepartmentAllocationDialog({ row, departments, canManage, close, saved }: {
  row: AllocationRow; departments: AllocationDepartment[]; canManage: boolean; close: () => void; saved: () => void
}) {
  const services = selectedAllocationServices(row.services)
  const [details, setDetails] = useState<AllocationDetails | null>(null)
  const [detailFailed, setDetailFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [selection, setSelection] = useState<Record<string, string[]>>(() => Object.fromEntries(
    services.map(service => [service.id, row.handoffs.filter(item =>
      item.services.includes(service.id) && departments.some(dept => dept.category === service.category && dept.id === item.departmentId))
      .map(item => item.departmentId)])
  ))
  useEffect(() => {
    let active = true
    loadDepartmentAllocationDetails(row.source, row.id).then(
      value => { if (active) { setDetails(value); setDetailFailed(!value?.data) } },
      () => { if (active) setDetailFailed(true) },
    )
    return () => { active = false }
  }, [row.source, row.id])
  const current = details?.submitted_at === row.submitted_at && details?.revision === row.revision
  const ready = canManage && current && services.length > 0 && services.every(service => selection[service.id]?.length)

  async function confirm() {
    setSaving(true)
    setError("")
    try {
      await saveServiceDepartments(row, selection)
      saved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。")
    } finally {
      setSaving(false)
    }
  }
  const data = details?.data ? { ...details.data, ...details.finance } : null
  return <Dialog open onOpenChange={open => { if (!open && !saving) close() }}>
    <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>承接部门</DialogTitle><DialogDescription>{row.company}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-5 overflow-y-auto px-1 pb-2">
        {detailFailed ? <p role="alert" className="text-sm text-destructive">合同资料读取失败，请重新打开。</p> : !data ?
          <p role="status" className="text-sm">正在加载合同资料…</p> : <>
            {!current && <p role="alert" className="text-sm text-destructive">资料已更新，请刷新分配列表。</p>}
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">已确认合同资料</summary>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                {!data.mainlandCompanyName && !data.hongKongCompanyName && data.companyName && <div>
                  <dt className="text-xs text-muted-foreground">原客户名称</dt>
                  <dd className="break-words">{data.companyName}</dd>
                </div>}
                {DEAL_CONTRACT_FIELDS.filter(([key]) => row.source === "history" || isDealContractFieldVisible(key, data.cooperation))
                  .map(([key, label, kind]) => data[key] && <div key={key} className={key === "bonusTerms" ? "min-w-0 sm:col-span-2" : undefined}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="whitespace-pre-wrap break-all">
                      {key === "bonusTerms" ? <DealBonusTermsValue text={data[key]} html={data.bonusTermsHtml} />
                        : kind === "date" || key === "actualPayment" ? formatDealDate(data[key]) : kind === "cooperation"
                        ? DEAL_COOPERATION_MODES.find(([id]) => id === data[key])?.[1] ?? data[key] : data[key]}
                    </dd>
                  </div>)}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {!details?.attachments?.length && data.attachmentStatus === NO_CONTRACT_ATTACHMENTS &&
                  <p className="text-sm text-muted-foreground">客户售前信息和售后目标：暂无附件</p>}
                {details?.attachments?.map(file => <Button type="button" key={file.path} variant="outline" size="sm"
                  onClick={() => void (row.source === "history" ? downloadDealHistoryAttachment : downloadDealContractAttachment)(file)
                    .catch(() => setError("交接附件下载失败。"))}>{file.name}</Button>)}
              </div>
            </details>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {DEAL_FINANCE_FIELDS.map(([key,label]) => <div key={key}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd>{(key === "receivedOn" ? formatDealDate(details?.finance?.[key]) : details?.finance?.[key]) || "待财务确认"}
                  {key === "receivedAmount" && details?.finance?.receivedAmount && details.finance.currency ? " " + details.finance.currency : ""}</dd>
              </div>)}
            </dl>
            <DepartmentHandoffResults handoffs={details?.handoffs ?? []} />
            {canManage && <div className="grid gap-3 sm:grid-cols-2">
              {services.map(service => {
                const candidates = departments.filter(dept => dept.category === service.category)
                return <fieldset key={service.id} disabled={saving || !current} className="min-w-0 space-y-2 rounded-md border p-3">
                  <legend className="px-1 text-sm font-semibold">{service.name}</legend>
                  {!candidates.length && <p className="text-sm text-muted-foreground">待配置承接部门</p>}
                  {candidates.map(dept => <label key={dept.id} className="flex min-h-9 items-center gap-2 text-sm">
                    <Checkbox checked={selection[service.id]?.includes(dept.id) ?? false}
                      onCheckedChange={next => setSelection(old => ({
                        ...old,
                        [service.id]: next === true ? [...old[service.id], dept.id] : old[service.id].filter(id => id !== dept.id),
                      }))} />
                    {dept.name}
                  </label>)}
                </fieldset>
              })}
            </div>}
          </>}
      </div>
      <DialogFooter className="border-t pt-3">
        {error && <p role="alert" className="mr-auto text-sm text-destructive">{error}</p>}
        <Button type="button" variant="outline" disabled={saving} onClick={close}>关闭</Button>
        {canManage && <Button type="button" disabled={!ready || saving} onClick={() => void confirm()}>{saving ? "正在保存…" : "确认分配"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
