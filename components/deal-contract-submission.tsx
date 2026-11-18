"use client"

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { DealContractReturnedFields } from "@/components/deal-contract-returned-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  CONTRACT_FILE_SIZE_LIMIT, DEAL_CONTRACT_FIELDS, DEAL_CONTRACT_SERVICES, DEAL_COOPERATION_MODES,
  DEAL_ALLOCATION_FIELDS, DEAL_FINANCE_FIELDS,
  NOT_PAID, NO_WEBSITE, dealContractSubmissionErrors, isDealContractFieldVisible, normalizeDealWebsite,
  type DealContractData, type DealContractField,
} from "@/lib/services/deal-contract-fields"
import { formatDealDate } from "@/lib/services/deal-date"
import {
  downloadDealContractAttachment, loadDealContractSubmission, saveDealContractSubmission,
} from "@/lib/services/deal-contract-submissions"

type Loaded = Awaited<ReturnType<typeof loadDealContractSubmission>>
type Props = {
  leadId: string
  companyName: string
  salesperson: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  children?: ReactNode
}

export function DealContractSubmissionDialog({ leadId, companyName, salesperson, open, onOpenChange, children }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [removedPaths, setRemovedPaths] = useState<string[]>([])

  useEffect(() => {
    let active = true
    if (!open) return
    setLoaded(null)
    setError(false)
    setFiles([])
    setRemovedPaths([])
    void loadDealContractSubmission(leadId, salesperson).then(
      (result) => { if (active) setLoaded(result) },
      () => { if (active) setError(true) },
    )
    return () => { active = false }
  }, [leadId, salesperson, open, attempt])

  const returned = { ...loaded?.confirmedReceipt, ...loaded?.record?.finance }
  const canEdit = loaded?.canEdit === true
  const attachments = (loaded?.record?.draft_attachments ?? []).filter((file) => !removedPaths.includes(file.path))
  const data = loaded?.data
  const visibleData = data ? { ...data, ...returned } : null
  const errors = visibleData ? dealContractSubmissionErrors(visibleData, attachments.length + files.length) : []
  const editable = canEdit && !saving

  function update(field: DealContractField, value: string) {
    setLoaded((current) => current ? { ...current, data: { ...current.data, [field]: value } } : current)
  }

  function updateService(group: string, child?: string) {
    setLoaded((current) => {
      if (!current) return current
      const services = { ...current.data.services }
      if (child === undefined) {
        if (group in services) delete services[group]
        else services[group] = []
      } else {
        const selected = services[group] ?? []
        services[group] = selected.includes(child) ? selected.filter((key) => key !== child) : [...selected, child]
      }
      return { ...current, data: { ...current.data, services } }
    })
  }

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? [])
    const valid = selected.filter((file) => file.size > 0 && file.size <= CONTRACT_FILE_SIZE_LIMIT)
    if (valid.length !== selected.length) toast.error("附件须有内容，单个文件不超过 20 MB")
    setFiles((current) => [...current, ...valid])
    event.currentTarget.value = ""
  }

  async function save(confirm: boolean) {
    if (!editable || !loaded || !data || (confirm && errors.length)) return
    setSaving(true)
    const payload = { ...data }
    for (const [key] of DEAL_CONTRACT_FIELDS) {
      if (payload[key] !== undefined) payload[key] = payload[key].trim()
    }
    if (!payload.actualPayment && loaded.confirmedReceipt) payload.actualPayment = loaded.confirmedReceipt.actualPayment
    if (payload.website) payload.website = normalizeDealWebsite(payload.website) ?? payload.website
    try {
      const record = await saveDealContractSubmission(
        leadId, payload, attachments, files, removedPaths, loaded.record?.version ?? 0, confirm,
      )
      setLoaded({ ...loaded, data: payload, record })
      setFiles([])
      setRemovedPaths([])
      toast.success(confirm ? "合同资料已确认提交" : "草稿已保存")
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null
      toast.error(code === "40001" ? "这份资料已有更新，请重新打开后再保存" : "合同资料保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  function renderField(field: (typeof DEAL_CONTRACT_FIELDS)[number]) {
    const [key, label, kind] = field
    if (!isDealContractFieldVisible(key, visibleData?.cooperation)) return null
    const value = visibleData?.[key] ?? ""
    const locked = !editable || returned[key] !== undefined
    const id = `deal-contract-${key}`
    let control: ReactNode
    if (kind === "website") {
      control = <div className="flex flex-wrap items-center gap-2">
        {value !== NO_WEBSITE && <span className="text-sm text-muted-foreground">https://</span>}
        <Input id={id} className="min-w-40 flex-1" placeholder="example.com" value={value.replace(/^https:\/\//i, "")}
          onChange={(event) => update(key, event.target.value)}
          onBlur={() => { const normalized = normalizeDealWebsite(value); if (normalized) update(key, normalized) }}
          readOnly={locked} />
        {editable && <Button type="button" variant="outline" size="sm" onClick={() => update(key, NO_WEBSITE)}>暂无网站</Button>}
      </div>
    } else if (kind === "cooperation") {
      control = <select id={id} className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value} onChange={(event) => update(key, event.target.value)} disabled={locked}>
        <option value="">请选择</option>
        {DEAL_COOPERATION_MODES.map(([option, name]) => <option value={option} key={option}>{name}</option>)}
      </select>
    } else if (kind === "multiline") {
      control = <Textarea id={id} value={value} onChange={(event) => update(key, event.target.value)} readOnly={locked} />
    } else if (kind === "percentage") {
      control = <div className="flex items-center gap-2">
        <Input id={id} type="text" inputMode="decimal" placeholder="例如 15" value={value} readOnly={locked}
          onChange={(event) => update(key, event.target.value)} />
        <span className="shrink-0 text-sm text-muted-foreground">%</span>
      </div>
    } else {
      control = <div className="flex items-center gap-2">
        <Input id={id} type={kind === "amount" ? "text" : kind} inputMode={kind === "amount" ? "decimal" : undefined}
          placeholder={key === "actualPayment" ? "填写到账时间，尚未到账请写明「未到账」" : undefined}
          value={value} readOnly={locked}
          onChange={(event) => update(key, key === "currency" ? event.target.value.toUpperCase() : event.target.value)} />
        {key === "actualPayment" && !locked &&
          <Button type="button" variant="outline" size="sm" onClick={() => update(key, NOT_PAID)}>未到账</Button>}
      </div>
    }
    return <div key={key} className={kind === "multiline" ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Label htmlFor={id}>{label}<span className="text-destructive">*</span></Label>
      {control}
    </div>
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>合同资料提交</DialogTitle>
          <DialogDescription>{companyName}</DialogDescription>
        </DialogHeader>
        {error && <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">合同资料加载失败。</p>
          <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>重新加载</Button>
        </div>}
        {!error && !loaded && <p role="status" className="text-sm text-muted-foreground">正在加载合同资料…</p>}
        {loaded && visibleData && (
          <>
            <div className="min-h-0 space-y-6 overflow-y-auto px-1 pb-2">
              <div className="flex flex-wrap gap-2">
                {loaded.record?.submitted_at && <Badge>已确认提交</Badge>}
                {loaded.record?.finance_confirmed_at && <Badge variant="outline">财务已确认</Badge>}
              </div>
              <section className="space-y-3">
                <h3 className="font-semibold">客户与签约信息</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="deal-contract-year">年份</Label>
                    <Input id="deal-contract-year" readOnly value={visibleData.signedOn?.slice(0, 4) ?? ""} />
                  </div>
                  {DEAL_CONTRACT_FIELDS.slice(0, 14).map(renderField)}
                  {DEAL_CONTRACT_FIELDS.filter(([key]) => key === "address").map(renderField)}
                </div>
              </section>
              <section className="space-y-3 border-t pt-4">
                <h3 className="font-semibold">合作模式与费用</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {DEAL_CONTRACT_FIELDS.filter(([key]) =>
                    ["cooperation", "currency", "spendRatio", "baseFee", "serviceFees", "bonusAmount", "bonusTerms"].includes(key),
                  ).map(renderField)}
                </div>
              </section>
              <fieldset className="space-y-3 border-t pt-4" disabled={!editable}>
                <legend className="font-semibold">服务内容 <span className="text-destructive">*</span></legend>
                {DEAL_CONTRACT_SERVICES.map((group) => {
                  const selected = visibleData.services[group.key]
                  return (
                    <div key={group.key} className="space-y-2 rounded-md border p-3">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={selected !== undefined} onChange={() => updateService(group.key)} />
                        {group.label}
                      </label>
                      {selected && group.options.length > 0 && <div className="flex flex-wrap gap-x-5 gap-y-2 pl-5">
                        {group.options.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={selected.includes(key)} onChange={() => updateService(group.key, key)} />
                          {label}
                        </label>)}
                      </div>}
                    </div>
                  )
                })}
              </fieldset>
              <section className="space-y-3 border-t pt-4">
                {DEAL_CONTRACT_FIELDS.filter(([key]) => key === "needs").map(renderField)}
                <Label htmlFor="deal-contract-files">
                  客户售前信息和售后目标（如：方案，目标，客户相关信息）<span className="text-destructive">*</span>
                </Label>
                {editable && <Input id="deal-contract-files" type="file" multiple onChange={pickFiles} />}
                {editable && <p className="text-xs text-muted-foreground">可上传多个文件，每个最多 20 MB。</p>}
                <ul className="space-y-1">
                  {attachments.map((attachment) => <li className="flex items-center justify-between gap-2 text-sm" key={attachment.path}>
                    <Button type="button" variant="link" className="max-w-[85%] truncate px-0" onClick={() =>
                      void downloadDealContractAttachment(attachment).catch(() => toast.error("附件下载失败"))}>
                      {attachment.name}
                    </Button>
                    {editable && <Button type="button" variant="ghost" size="sm"
                      onClick={() => setRemovedPaths((paths) => [...paths, attachment.path])}>移除</Button>}
                  </li>)}
                  {files.map((file, index) => <li className="flex items-center justify-between gap-2 text-sm" key={`${index}-${file.name}`}>
                    <span className="truncate">{file.name}</span>
                    <Button type="button" variant="ghost" size="sm" disabled={!editable}
                      onClick={() => setFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))}>移除</Button>
                  </li>)}
                </ul>
              </section>
              <DealContractReturnedFields title="分配结果"
                status={loaded.allocationUnavailable ? "暂时无法读取分配结果" : !loaded.allocation ? "分配完成后回传" : undefined}
                fields={DEAL_ALLOCATION_FIELDS.map(([key, label]) => [label, loaded.allocation?.[key]])} />
              <DealContractReturnedFields title="财务确认"
                status={DEAL_FINANCE_FIELDS.some(([key]) => returned[key]) ? undefined : "财务确认后回传"}
                fields={DEAL_FINANCE_FIELDS.map(([key, label]) => [label, key === "receivedOn" ? formatDealDate(returned[key]) : returned[key]])} />
              {children}
            </div>
            {canEdit && <DialogFooter className="shrink-0 border-t pt-3 sm:items-center">
              {errors.length > 0 && <p className="mr-auto max-w-sm text-sm text-muted-foreground">
                待完善 {errors.length} 项，含{errors.slice(0, 3).join("、")}{errors.length > 3 ? "等" : ""}
              </p>}
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save(false)}>保存草稿</Button>
              <Button type="button" disabled={saving || errors.length > 0} onClick={() => void save(true)}>确认提交</Button>
            </DialogFooter>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
