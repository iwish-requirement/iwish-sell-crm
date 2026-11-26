"use client"

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { DealBonusTermsEditor, DealBonusTermsValue } from "@/components/deal-bonus-terms"
import { DealContractReadOnlyField, DealContractReturnedFields } from "@/components/deal-contract-returned-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  CONTRACT_FILE_SIZE_LIMIT, DEAL_CONTRACT_FIELDS, DEAL_CONTRACT_IDENTITY_FIELDS, DEAL_CONTRACT_SERVICES, DEAL_COOPERATION_MODES, DEAL_CURRENCIES,
  DEAL_ALLOCATION_FIELDS, DEAL_FINANCE_FIELDS, MAX_BONUS_TERMS_HTML_LENGTH,
  NOT_PAID, NO_CONTRACT_ATTACHMENTS, NO_WEBSITE, dealContractSubmissionErrors, isDealContractFieldVisible, isDealCurrency, normalizeDealWebsite,
  type DealContractData, type DealContractField,
} from "@/lib/services/deal-contract-fields"
import { formatDealDate } from "@/lib/services/deal-date"
import { CrmFinanceReceipt } from "@/components/crm-finance-receipt"
import { crmDate } from "@/lib/services/crm-visits"
import { DepartmentHandoffResults } from "@/components/department-handoff-results"
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
  onConfirmed?: () => void
  children?: ReactNode
  requiredAfter?: string
}

export function DealContractSubmissionDialog({ leadId, companyName, salesperson, open, onOpenChange, onConfirmed, children, requiredAfter }: Props) {
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
  const visibleData = data ? {
    ...data, ...returned,
    currency: !canEdit || isDealCurrency(returned.currency) ? returned.currency ?? data.currency : data.currency,
  } : null
  const attachmentCount = attachments.length + files.length
  const bonusTermsTooLong = data?.cooperation === "base_bonus" && (data.bonusTermsHtml?.length ?? 0) > MAX_BONUS_TERMS_HTML_LENGTH
  const noAttachments = !attachmentCount && data?.attachmentStatus === NO_CONTRACT_ATTACHMENTS
  const errors = visibleData ? dealContractSubmissionErrors(visibleData, attachmentCount) : []
  const editable = canEdit && !saving
  const cutoff = requiredAfter ?? loaded?.departmentAllocation?.requiredAfter
  const submittedAt = loaded?.record?.submitted_at
  const awaitingSignature = loaded?.awaitingSignature ?? false
  const needsConfirmation = cutoff && (!submittedAt || Date.parse(submittedAt) < Date.parse(cutoff))

  function update(field: DealContractField, value: string) {
    setLoaded((current) => current ? { ...current, data: { ...current.data, [field]: value } } : current)
  }

  function setAttachmentStatus(attachmentStatus: DealContractData["attachmentStatus"]) {
    setLoaded(current => current ? { ...current, data: { ...current.data, attachmentStatus } } : current)
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
    if (valid.length) setAttachmentStatus("")
    setFiles((current) => [...current, ...valid])
    event.currentTarget.value = ""
  }

  async function save(confirm: boolean) {
    if (!editable || !loaded || !data || bonusTermsTooLong || (confirm && errors.length)) return
    setSaving(true)
    const payload = { ...data }
    if (payload.cooperation !== "base_bonus") delete payload.bonusTermsHtml
    for (const [key] of DEAL_CONTRACT_FIELDS) {
      if (payload[key] !== undefined) payload[key] = payload[key].trim()
    }
    if (!payload.actualPayment && loaded.confirmedReceipt) payload.actualPayment = loaded.confirmedReceipt.actualPayment
    if (isDealCurrency(visibleData?.currency)) payload.currency = visibleData.currency
    if (payload.website) payload.website = normalizeDealWebsite(payload.website) ?? payload.website
    try {
      const record = await saveDealContractSubmission(
        leadId, payload, attachments, files, removedPaths, loaded.record?.version ?? 0, confirm,
      )
      setLoaded({ ...loaded, data: record.draft, record, awaitingSignature: !confirm && awaitingSignature })
      setFiles([])
      setRemovedPaths([])
      toast.success(confirm ? awaitingSignature ? "合同已关联，线索已更新为已签约" : "合同资料已确认提交" : "草稿已保存")
      if (confirm) onConfirmed?.()
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null
      const message = cause && typeof cause === "object" && "message" in cause ? String(cause.message) : ""
      toast.error(message.includes("ERR_CRM_CONTRACT_SIGNED_DATE") ? "请填写合同编号及不晚于今天的实际签约日期"
        : code === "40001" ? "这份资料已有更新，请重新打开后再保存" : "合同资料保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  function renderField(field: (typeof DEAL_CONTRACT_FIELDS)[number]) {
    const [key, label, kind] = field
    if (!isDealContractFieldVisible(key, visibleData?.cooperation)) return null
    const value = visibleData?.[key] ?? ""
    const locked = !editable || (key === "currency" ? isDealCurrency(returned.currency) : returned[key] !== undefined)
    const id = `deal-contract-${key}`
    if (key === "bonusTerms") {
      const html = data?.bonusTermsHtml
      if (locked) return <DealContractReadOnlyField key={key} label={label} wide
        value={<DealBonusTermsValue text={value} html={html} />} />
      return <div key={key} className="space-y-2 sm:col-span-2">
        <Label id={id + "-label"}>{label}<span className="text-destructive">*</span></Label>
        <DealBonusTermsEditor id={id} text={value} html={html} onChange={(bonusTerms, bonusTermsHtml) =>
          setLoaded(current => current ? { ...current, data: { ...current.data, bonusTerms, bonusTermsHtml } } : current)
        } />
      </div>
    }
    if (locked) {
      let display = value
      if (value) {
        if (kind === "date" || key === "actualPayment") display = formatDealDate(value)
        if (kind === "cooperation") display = DEAL_COOPERATION_MODES.find(([option]) => option === value)?.[1] ?? value
        if (kind === "percentage") display = value + "%"
      }
      return <DealContractReadOnlyField key={key} label={label} value={display} wide={kind === "multiline"} />
    }
    let control: ReactNode
    if (kind === "website") {
      control = <div className="flex flex-wrap items-center gap-2">
        {value !== NO_WEBSITE && <span className="text-sm text-muted-foreground">https://</span>}
        <Input id={id} className="min-w-40 flex-1" placeholder="example.com" value={value.replace(/^https:\/\//i, "")}
          onChange={(event) => update(key, event.target.value)}
          onBlur={() => { const normalized = normalizeDealWebsite(value); if (normalized) update(key, normalized) }} />
        <Button type="button" variant="outline" size="sm" onClick={() => update(key, NO_WEBSITE)}>暂无网站</Button>
      </div>
    } else if (kind === "cooperation" || kind === "currency") {
      control = <select id={id} className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value} aria-required="true" onChange={(event) => update(key, event.target.value)}>
        <option value="">请选择</option>
        {kind === "currency"
          ? DEAL_CURRENCIES.map(currency => <option value={currency} key={currency}>{currency}</option>)
          : DEAL_COOPERATION_MODES.map(([option, name]) => <option value={option} key={option}>{name}</option>)}
      </select>
    } else if (kind === "multiline") {
      control = <Textarea id={id} value={value} onChange={(event) => update(key, event.target.value)} />
    } else if (kind === "percentage") {
      control = <div className="flex items-center gap-2">
        <Input id={id} type="text" inputMode="decimal" placeholder="例如 15" value={value}
          onChange={(event) => update(key, event.target.value)} />
        <span className="shrink-0 text-sm text-muted-foreground">%</span>
      </div>
    } else {
      control = <div className="flex items-center gap-2">
        <Input id={id} type={kind === "amount" ? "text" : kind} inputMode={kind === "amount" ? "decimal" : undefined}
          max={key === "signedOn" && awaitingSignature ? crmDate() : undefined}
          value={value} aria-required={key !== "shortName"}
          placeholder={key === "shortName" ? "选填，例如品牌名" : key === "actualPayment" ? "填写到账时间，尚未到账请写明「未到账」" : undefined}
          onChange={(event) => update(key, event.target.value)} />
        {key === "actualPayment" &&
          <Button type="button" variant="outline" size="sm" onClick={() => update(key, NOT_PAID)}>未到账</Button>}
      </div>
    }
    return <div key={key} className={kind === "multiline" ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Label htmlFor={id}>{label}{key !== "shortName" && <span className="text-destructive">*</span>}</Label>
      {control}
    </div>
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>合同资料提交</DialogTitle>
          <DialogDescription>{companyName}{awaitingSignature && " · 确认提交后，合同自动关联到线索并更新为「已签约」。"}</DialogDescription>
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
                {needsConfirmation ? <Badge variant="outline">待补合同资料</Badge> : submittedAt && <Badge>已确认提交</Badge>}
                {loaded.record?.finance_confirmed_at && <Badge variant="outline">财务已确认</Badge>}
              </div>
              <section className="space-y-3">
                <h3 className="font-semibold">客户与签约信息</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <DealContractReadOnlyField label="年份" value={visibleData.signedOn?.slice(0, 4)} />
                  {DEAL_CONTRACT_IDENTITY_FIELDS.map(renderField)}
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
              {editable ? <fieldset className="space-y-3 border-t pt-4">
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
              </fieldset> : <section className="border-t pt-4">
                <DealContractReadOnlyField label="服务内容" value={DEAL_CONTRACT_SERVICES.flatMap(group => {
                  const selected = visibleData.services[group.key]
                  if (!selected) return []
                  const names = group.options.filter(([id]) => selected.includes(id)).map(([, name]) => name)
                  return [names.length ? group.label + " · " + names.join("、") : group.label]
                }).join("\n")} />
              </section>}
              <section className="space-y-3 border-t pt-4">
                {DEAL_CONTRACT_FIELDS.filter(([key]) => key === "needs").map(renderField)}
                {editable ? <>
                  <Label htmlFor="deal-contract-files">
                    客户售前信息和售后目标（如：方案，目标，客户相关信息）<span className="text-destructive">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input id="deal-contract-files" className="min-w-0 flex-1" type="file" multiple onChange={pickFiles} />
                    <Button type="button" variant={noAttachments ? "secondary" : "outline"} size="sm"
                      aria-label="暂无附件" aria-pressed={noAttachments} disabled={attachmentCount > 0}
                      onClick={() => setAttachmentStatus(noAttachments ? "" : NO_CONTRACT_ATTACHMENTS)}>暂无</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">可上传多个文件，每个最多 20 MB。</p>
                </> : <p className="text-xs text-muted-foreground">客户售前信息和售后目标（如：方案，目标，客户相关信息）</p>}
                {noAttachments && <p className="text-sm text-muted-foreground">已标记暂无附件</p>}
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
              <DepartmentHandoffResults handoffs={loaded.departmentAllocation?.handoffs ?? []} source="lead" recordId={leadId} />
              <DealContractReturnedFields title="财务确认"
                status={DEAL_FINANCE_FIELDS.some(([key]) => returned[key]) ? undefined : "财务确认后回传"}
                fields={DEAL_FINANCE_FIELDS.map(([key, label]) => [label, key === "receivedOn" ? formatDealDate(returned[key]) : returned[key]])} />
              {submittedAt && <CrmFinanceReceipt
                leadId={leadId} currency={returned.currency ?? data?.currency}
                receivedOn={returned.receivedOn} receivedAmount={returned.receivedAmount}
                grossProfit={returned.grossProfit} grossProfitCurrency={returned.grossProfitCurrency}
                onConfirmed={() => setAttempt((item) => item + 1)}
              />}
              {children}
            </div>
            {canEdit && <DialogFooter className="shrink-0 border-t pt-3 sm:items-center">
              {errors.length > 0 && <p className="mr-auto max-w-sm text-sm text-muted-foreground">
                待完善 {errors.length} 项，含{errors.slice(0, 3).join("、")}{errors.length > 3 ? "等" : ""}
              </p>}
              <Button type="button" variant="outline" disabled={saving || bonusTermsTooLong} onClick={() => void save(false)}>保存草稿</Button>
              <Button type="button" disabled={saving || bonusTermsTooLong || errors.length > 0} onClick={() => void save(true)}>
                {awaitingSignature ? "确认签约并提交" : "确认提交"}
              </Button>
            </DialogFooter>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
