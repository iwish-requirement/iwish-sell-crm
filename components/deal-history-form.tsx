"use client"

import { useState } from "react"
import { HISTORY_COLUMNS, HISTORY_HEADERS, type HistoryColumn } from "@/lib/services/deal-history-fields"
import { downloadDealHistoryAttachment, saveDealHistory, type HistoryRecord } from "@/lib/services/deal-history"
import { DealBonusTermsEditor, DealBonusTermsValue } from "@/components/deal-bonus-terms"
import { DealContractReadOnlyField, DealContractReturnedFields } from "@/components/deal-contract-returned-fields"
import { DepartmentHandoffResults } from "@/components/department-handoff-results"
import { Badge } from "@/components/ui/badge"
import { dealDateInputValue, formatDealDate } from "@/lib/services/deal-date"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  CONTRACT_FILE_SIZE_LIMIT, DEAL_CONTRACT_FIELDS, DEAL_COOPERATION_MODES, DEAL_CONTRACT_SERVICES, DEAL_CURRENCIES,
  MAX_BONUS_TERMS_HTML_LENGTH, NO_WEBSITE, NOT_PAID, NO_CONTRACT_ATTACHMENTS, isDealCurrency, normalizeDealWebsite,
} from "@/lib/services/deal-contract-fields"

const dateColumns = new Set(["B", "C", "D", "E", "F", "AO", "AQ"])
const newRequiredFields = ["mainlandCompanyName", "hongKongCompanyName", "currency"]

function original(row: HistoryRecord, key: string): string {
  const value = row.raw_values[HISTORY_COLUMNS.indexOf(key as HistoryColumn)]
  if (value == null) return ""
  return dateColumns.has(key) && typeof value === "string" ? formatDealDate(value) : String(value)
}

const sections: { title: string; keys: string[] }[] = [
  { title: "客户与签约信息", keys: ["A","B","C","D","E","F","G","mainlandCompanyName","hongKongCompanyName","I","J","K","L","M","N","O","AD"] },
  { title: "合作模式与费用", keys: ["P","currency","spendRatio","Q","R","S","T"] },
  { title: "服务内容", keys: ["U","Y","Z","AA","AB"] },
  { title: "客户需求与资料", keys: ["AC","AM"] },
]

function ServiceOptions({ label, saved, change }: { label: string; saved: string; change: (value: string) => void }) {
  const group = DEAL_CONTRACT_SERVICES.find(group => group.label === label)!
  const picked = saved.split("、").filter(Boolean)
  const [enabled, setEnabled] = useState(Boolean(saved))
  return <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={enabled} onChange={event => {
        const checked = event.currentTarget.checked
        setEnabled(checked)
        if (!checked) change("")
        else if (!group.options.length) change(label)
      }} />
      {label}
    </label>
    {enabled && group.options.length > 0 && <div className="flex flex-wrap gap-x-5 gap-y-2 pl-5">
      {group.options.map(([key, option]) => <label key={key} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={picked.includes(option)} onChange={event =>
          change((event.currentTarget.checked ? [...picked, option] : picked.filter(name => name !== option)).join("、"))
        } />{option}
      </label>)}
    </div>}
  </div>
}

export function HistoryContractForm({ row, close, save, allocationCutoff }: {
  row: HistoryRecord; close: () => void; save: (updated: HistoryRecord, confirmed: boolean) => void; allocationCutoff?: string | null
}) {
  const [changes, setChanges] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [services, setServices] = useState<Record<string, string[]>>(row.departmentAllocation?.data?.services ?? {})
  const labelFor = (key: string) => HISTORY_HEADERS[1][HISTORY_COLUMNS.indexOf(key as HistoryColumn)]
    ?? DEAL_CONTRACT_FIELDS.find(([name]) => name === key)?.[1] ?? ""
  const entered = (key: string) => changes[key] ?? row.fields[key] ?? ""
  const fixedValue = (key: string) => key === "I" && row.generated_contract_number
    ? row.generated_contract_number : original(row, key)
  const update = (key: string, value: string, bonusTermsHtml?: string) => {
    setChanges(current => ({ ...current, [key]: value, ...(bonusTermsHtml === undefined ? {} : { bonusTermsHtml }) }))
    setSaved(false)
    setError("")
  }
  const cooperation = original(row, "P") || entered("P")
  const isRatio = cooperation === "消耗比例服务费"
  const isBonus = cooperation === "基础服务费+激励奖金"
  const bonusTermsTooLong = isBonus && entered("bonusTermsHtml").length > MAX_BONUS_TERMS_HTML_LENGTH

  const missing = [...newRequiredFields, "B","C","D","E","F","I","J","K","L","M","N","O","P","Q","R","AC","AD",
    ...(isRatio ? ["spendRatio"] : []), ...(isBonus ? ["S","T"] : []),
  ].filter(key => key === "currency" ? !isDealCurrency(entered(key))
    : !(fixedValue(key) || entered(key) || (key === "D" ? original(row, "AQ") : "")).trim())
  const incompleteServices = !Object.keys(services).length || DEAL_CONTRACT_SERVICES.some(group =>
    Object.hasOwn(services, group.key) && group.options.length > 0 && !services[group.key].length)
  const attachmentCount = row.attachments.length + files.length
  const noAttachments = !attachmentCount && entered("attachmentStatus") === NO_CONTRACT_ATTACHMENTS
  const canConfirm = !missing.length && !incompleteServices && (attachmentCount > 0 || noAttachments)

  async function saveDraft(confirm = false) {
    if (!row.canEdit || bonusTermsTooLong || (confirm && !canConfirm)) return
    const fields = { ...changes }
    if (fields.D?.trim()) fields.D = dealDateInputValue(fields.D) || fields.D
    if (fields.J?.trim()) {
      const website = normalizeDealWebsite(fields.J)
      if (!website) { setError("请填写有效的网址域名。"); return }
      fields.J = website
    }
    if (fields.spendRatio?.trim() && (!/^\d+(\.\d+)?$/.test(fields.spendRatio.trim()) || Number(fields.spendRatio) <= 0 || Number(fields.spendRatio) > 100)) {
      setError("消耗比例须大于 0% 且不超过 100%。")
      return
    }
    if (!isRatio) delete fields.spendRatio
    if (!isBonus) { delete fields.S; delete fields.T; delete fields.bonusTermsHtml }
    setSaving(true)
    setError("")
    try {
      save(await saveDealHistory(row, fields, files, confirm ? services : undefined), confirm)
      setChanges({})
      setFiles([])
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。")
    } finally {
      setSaving(false)
    }
  }

  function renderField(key: string, locked = false) {
    const label = labelFor(key)
    if (!label || (key === "spendRatio" && !isRatio) || (["S", "T"].includes(key) && !isBonus && !original(row, key))) return null
    const old = key === "U" ? ["U","V","W","X"].map(column => original(row, column)).filter(Boolean).join("\n") : fixedValue(key)
    const kind = DEAL_CONTRACT_FIELDS.find(([, name]) => name === label)?.[2]
    const id = `history-${row.source_row}-${key}`
    if (key === "AM") {
      return <div key={key} className="space-y-2 sm:col-span-2">
        {row.canEdit ? <Label htmlFor={id}>{label}</Label> : <p className="text-xs text-muted-foreground">{label}</p>}
        {old && <p className="whitespace-pre-wrap break-all text-sm">{old}</p>}
        {row.canEdit && <>
        <div className="flex items-center gap-2">
          <Input id={id} className="min-w-0 flex-1" type="file" multiple disabled={saving} onChange={event => {
            const added = Array.from(event.currentTarget.files ?? [])
            const valid = added.filter(file => file.size > 0 && file.size <= CONTRACT_FILE_SIZE_LIMIT)
            if (valid.length && noAttachments) update("attachmentStatus", "")
            if (valid.length !== added.length) setError("附件须有内容，单个文件不超过 20 MB。")
            setFiles(previous => [...previous, ...valid])
            setSaved(false)
            event.currentTarget.value = ""
          }} />
          <Button type="button" variant={noAttachments ? "secondary" : "outline"} size="sm"
            aria-label="暂无附件" aria-pressed={noAttachments} disabled={saving || attachmentCount > 0}
            onClick={() => update("attachmentStatus", noAttachments ? "" : NO_CONTRACT_ATTACHMENTS)}>暂无</Button>
        </div>
        <p className="text-xs text-muted-foreground">可上传多个文件，每个最多 20 MB。</p>
        </>}
        {noAttachments && <p className="text-sm text-muted-foreground">已标记暂无附件</p>}
        <ul className="space-y-1 text-sm">
          {row.attachments.map(file => <li key={file.path}>
            <Button type="button" variant="link" className="max-w-full justify-start truncate px-0"
              onClick={() => void downloadDealHistoryAttachment(file).catch(() => setError("附件下载失败，请重试。"))}>
              {file.name}
            </Button>
          </li>)}
          {files.map((file, index) => <li className="flex items-center gap-2 break-all" key={index}>
            {file.name}<Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setFiles(items => items.filter((_, i) => index !== i))}>移除</Button>
          </li>)}
        </ul>
      </div>
    }
    if (!allocationCutoff && !old && !locked && DEAL_CONTRACT_SERVICES.some(group => group.label === label)) {
      return <ServiceOptions key={key} label={label} saved={entered(key)} change={value => update(key, value)} />
    }
    const value = entered(key)
    if (key === "T") {
      const html = old ? undefined : entered("bonusTermsHtml")
      if (old || locked) return <DealContractReadOnlyField key={key} label={label} wide
        value={<DealBonusTermsValue text={old || value} html={html} />} />
      return <div key={key} className="space-y-2 sm:col-span-2">
        <Label id={id + "-label"}>{label}</Label>
        <DealBonusTermsEditor id={id} text={value} html={html} onChange={(text, formatted) => update(key, text, formatted)} />
      </div>
    }
    const long = kind === "multiline" || old.includes("\n") || old.length > 65
    if (old || locked) {
      const display = old || (dateColumns.has(key) && value ? formatDealDate(value) : value)
      return <DealContractReadOnlyField key={key} label={label} value={display} wide={long} />
    }
    let control
    if (kind === "cooperation" || kind === "currency") control = (
      <select id={id} className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={kind === "currency" && !isDealCurrency(value) ? "" : value}
        aria-required={kind === "currency" || undefined} onChange={e => update(key, e.currentTarget.value)}>
        <option value="">请选择</option>
        {kind === "currency"
          ? DEAL_CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)
          : DEAL_COOPERATION_MODES.map(([option, name]) => <option key={option} value={name}>{name}</option>)}
      </select>
    )
    else if (kind === "website") control = <div className="flex flex-wrap items-center gap-2">
      {value !== NO_WEBSITE && <span className="text-sm text-muted-foreground">https://</span>}
      <Input id={id} className="min-w-24 flex-1" value={value.replace(/^https:\/\//i, "")} onChange={e => update(key, e.currentTarget.value)} />
      <Button type="button" variant="outline" size="sm" onClick={() => update(key, NO_WEBSITE)}>暂无网站</Button>
    </div>
    else if (long) control = <Textarea id={id} value={value} onChange={e => update(key, e.currentTarget.value)} />
    else control = <div className="flex items-center gap-2">
      <Input id={id} type={kind === "date" || kind === "email" || kind === "tel" ? kind : "text"}
        inputMode={kind === "amount" || kind === "percentage" ? "decimal" : undefined}
        value={value} aria-required={newRequiredFields.includes(key) || undefined} onChange={e => update(key, e.currentTarget.value)} />
      {key === "D" && <Button type="button" variant="outline" size="sm" onClick={() => update(key, NOT_PAID)}>未到账</Button>}
      {kind === "percentage" && <span className="text-sm text-muted-foreground">%</span>}
    </div>
    return <div key={key} className={long ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Label htmlFor={id}>{label}{newRequiredFields.includes(key) && <span className="text-destructive">*</span>}</Label>
      {control}
    </div>
  }

  const returnedFields = (keys: string[]) => keys.map(key => [labelFor(key), original(row, key)] as const)
  const allocations = returnedFields(["AE","AF","AG","AH","AI","AJ","AK","AL"])
  const finance = returnedFields(["AP","AQ","AR"])
  return <Dialog open onOpenChange={open => { if (!open && !saving) close() }}>
    <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>合同资料补充</DialogTitle>
          <DialogDescription>{original(row, "H")}</DialogDescription>
        {allocationCutoff && row.departmentAllocation?.submitted_at &&
          Date.parse(row.departmentAllocation.submitted_at) >= Date.parse(allocationCutoff) &&
          <Badge className="w-fit">已确认提交</Badge>}
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto px-1 pb-2">
        <fieldset className="space-y-6" disabled={saving}>
          {sections.map(({ title, keys }) => <section key={title} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
            <h3 className="font-semibold">{title}</h3>
            <div className="grid gap-4 sm:grid-cols-2">{keys.map(key => renderField(key,
              !row.canEdit || ["A", "G"].includes(key) || Boolean(allocationCutoff && ["U","Y","Z","AA","AB"].includes(key))))}</div>
          </section>)}
          {allocationCutoff && row.canEdit && <section className="space-y-3 border-t pt-4">
            <h3 className="font-semibold">确认合作服务</h3>
            <p className="text-sm text-muted-foreground">按当前合同勾选要交接的服务，原表服务内容可在上方查看。</p>
            {DEAL_CONTRACT_SERVICES.map(group => <fieldset key={group.key} className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={Object.hasOwn(services, group.key)} onChange={event => {
                  const checked = event.currentTarget.checked
                  setServices(old => {
                    const next = { ...old }
                    if (checked) next[group.key] = []
                    else delete next[group.key]
                    return next
                  })
                }} />
                {group.label}
              </label>
              {Object.hasOwn(services, group.key) && group.options.length > 0 && <div className="flex flex-wrap gap-3">
                {group.options.map(([id, name]) => <label key={id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={services[group.key].includes(id)} onChange={event => {
                    const checked = event.currentTarget.checked
                    setServices(old => ({
                      ...old, [group.key]: checked ? [...old[group.key], id] : old[group.key].filter(value => value !== id),
                    }))
                  }} />{name}
                </label>)}
              </div>}
            </fieldset>)}
          </section>}
          <DealContractReturnedFields title="分配结果"
            fields={allocations} status={allocations.some(([,value]) => value) ? undefined : "分配完成后回传"} />
          <DepartmentHandoffResults handoffs={row.departmentAllocation?.handoffs ?? []} source="history" recordId={row.id} />
          <DealContractReturnedFields title={HISTORY_HEADERS[0][HISTORY_COLUMNS.indexOf("AN")] ?? "审批记录"}
            fields={returnedFields(["AN","AO"])} />
          <DealContractReturnedFields title="财务确认"
            fields={finance} status={finance.some(([,value]) => value) ? undefined : "财务确认后回传"} />
        </fieldset>
      </div>
      <DialogFooter className="shrink-0 border-t pt-3 sm:items-center">
        <div className="mr-auto text-sm">
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {saved && <p role="status">补充资料已保存。</p>}
          {allocationCutoff && row.canEdit && missing.length > 0 && <p className="text-muted-foreground">
            待补 {missing.slice(0, 3).map(labelFor).join("、")}{missing.length > 3 ? "等" : ""}。
          </p>}
        </div>
        <Button type="button" variant="outline" disabled={saving} onClick={close}>关闭</Button>
        {row.canEdit && <Button type="button" disabled={saving || bonusTermsTooLong || (!Object.keys(changes).length && !files.length)} onClick={() => void saveDraft()}>
          {saving ? "正在保存…" : "保存补充"}
        </Button>}
        {allocationCutoff && row.canEdit && <Button type="button" disabled={saving || bonusTermsTooLong || !canConfirm} onClick={() => void saveDraft(true)}>
          确认提交
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
