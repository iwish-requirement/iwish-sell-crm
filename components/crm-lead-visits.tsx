"use client"

import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import {
  crmDate, downloadVisitFile, getCrmError, listVisitParticipants, protectionLabels,
  requiresMeetingEvidence, saveVisit, visitMethods, visitServices, visitTypes,
  type CrmPerson, type CrmVisit, type LeadWorkflow, type VisitData,
} from "@/lib/services/crm-visits"

const selectStyle = "w-full rounded-md border bg-background px-3 py-2 text-sm"
const protectionChoices = ["new_intent", "key_intent", "nurture"] as const

function VisitForm({ leadId, workflow, visit, contact, onSave, onCancel }: {
  leadId: string
  workflow: LeadWorkflow
  visit: CrmVisit | null
  contact: string
  onSave: () => void
  onCancel: () => void
}) {
  const [id] = useState(() => visit?.id ?? crypto.randomUUID())
  const [data, setData] = useState<VisitData>(() => visit?.data ?? {
    visitDate: crmDate(), method: "", type: "", contactName: contact, contactTitle: "", services: [],
    needs: "", outcome: "", expectedMargin: "待确认", expectedSignedOn: "待确认", nextAction: "",
    nextContactOn: "", meetingUrl: "", missingReason: "", files: [],
  })
  const [participants, setParticipants] = useState<CrmPerson[]>(visit?.participants ?? [])
  const [choices, setChoices] = useState<CrmPerson[]>([])
  const [query, setQuery] = useState("")
  const [meeting, setMeeting] = useState<File | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const isMeeting = requiresMeetingEvidence(data.method)
  const hasDocument = meeting !== null || data.files.some((file) => file.kind === "meeting")
  const hasUrl = data.meetingUrl.trim() !== ""
  const needsReason = isMeeting && hasDocument !== hasUrl

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      void listVisitParticipants(leadId, query).then((result) => {
        if (!active) return
        setChoices(result)
        if (!query && !visit) {
          const self = result.find((person) => person.id === workflow.actor)
          if (self) setParticipants((selected) => selected.length ? selected : [self])
        }
      }).catch(() => { if (active) toast.error("加载参与销售失败，请重试") })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [leadId, query, visit, workflow.actor])

  const update = <K extends keyof VisitData>(field: K, value: VisitData[K]) =>
    setData((current) => ({ ...current, [field]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!participants.length || !data.services.length) {
      toast.error("请选择实际参与销售和意向合作业务")
      return
    }
    if (isMeeting && ((!hasUrl && !hasDocument) || (needsReason && !data.missingReason.trim()))) {
      toast.error("会议链接与文档至少提交一项。缺少一项时，请填写原因。")
      return
    }
    setSaving(true)
    try {
      await saveVisit({
        leadId, visitId: id, previousUpdatedAt: visit?.updatedAt ?? null,
        data: {
          ...data,
          meetingUrl: isMeeting ? data.meetingUrl.trim() : "",
          missingReason: needsReason ? data.missingReason.trim() : "",
          files: isMeeting ? data.files : data.files.filter((file) => file.kind === "attachment"),
        },
        participants: participants.map((person) => person.id),
        meeting: isMeeting ? meeting : null,
        attachments: files,
      })
      toast.success(visit ? "拜访记录已更新" : "拜访已提交并生效")
      onSave()
    } catch (error) {
      toast.error(getCrmError(error, "保存拜访失败，请检查字段与附件后重试"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="grid gap-3 rounded-md border bg-muted/20 p-3" onSubmit={submit}>
      <div className="text-sm">销售负责人 <span className="font-medium">{workflow.owner?.name ?? "未分配"}</span></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">实际拜访日期
          <Input type="date" required max={crmDate()} value={data.visitDate} onChange={(event) => update("visitDate", event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">拜访方式
          <select required className={selectStyle} value={data.method} onChange={(event) => update("method", event.target.value)}>
            <option value="">选择拜访方式</option>
            {visitMethods.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">拜访类型
          <select required className={selectStyle} value={data.type} onChange={(event) => update("type", event.target.value)}>
            <option value="">选择拜访类型</option>
            {visitTypes.filter(({ id }) => id !== "expansion" || workflow.protectionClass === "cooperating" || visit?.data.type === id)
              .map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">客户沟通对象姓名
          <Input required value={data.contactName} onChange={(event) => update("contactName", event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">客户沟通对象职位
          <Input required value={data.contactTitle} onChange={(event) => update("contactTitle", event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">预计签单毛利
          <Input required placeholder="填写金额或待确认" value={data.expectedMargin} onChange={(event) => update("expectedMargin", event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">预计签单时间
          <Input required placeholder="YYYY-MM-DD 或待确认" value={data.expectedSignedOn} onChange={(event) => update("expectedSignedOn", event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">下次跟进时间
          <Input type="date" required min={data.visitDate} value={data.nextContactOn} onChange={(event) => update("nextContactOn", event.target.value)} />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">实际参与销售（含陪访）</legend>
        <Input aria-label="搜索销售人员" placeholder="按姓名搜索" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex flex-wrap gap-1">
          {participants.map((person) => <Button type="button" size="sm" variant="secondary" key={person.id}
            onClick={() => setParticipants((list) => list.filter((item) => item.id !== person.id))}>
            {person.name} ×
          </Button>)}
        </div>
        <div className="max-h-24 overflow-y-auto rounded-md border bg-background p-2">
          {choices.filter((person) => !participants.some((item) => item.id === person.id)).map((person) => (
            <Button type="button" size="sm" variant="ghost" key={person.id}
              onClick={() => setParticipants((list) => [...list, person])}>{person.name}</Button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-2 text-sm font-medium">意向合作业务</legend>
        {visitServices.map((service) => (
          <label key={service} className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={data.services.includes(service)} onCheckedChange={(checked) => update("services",
              checked === true ? [...data.services, service] : data.services.filter((item) => item !== service))} />
            {service}
          </label>
        ))}
      </fieldset>
      {([
        ["needs", "客户核心需求"], ["outcome", "本次拜访结果"], ["nextAction", "下一步行动计划"],
      ] as const).map(([field, label]) => <label key={field} className="space-y-1 text-sm">{label}
        <Textarea required value={data[field]} onChange={(event) => update(field, event.target.value)} />
      </label>)}
      {isMeeting && (
        <fieldset className="grid gap-2 rounded-md border p-2">
          <legend className="px-1 text-sm font-medium">会议凭证</legend>
          <label className="space-y-1 text-sm">会议链接
            <Input type="url" value={data.meetingUrl} onChange={(event) => update("meetingUrl", event.target.value)} placeholder="https://" />
          </label>
          <label className="space-y-1 text-sm">会议文档
            <Input type="file" onChange={(event) => setMeeting(event.target.files?.[0] ?? null)} />
          </label>
          <p className="text-xs text-muted-foreground">链接和文档均有时一并上传。只有一项时须填写另一项的缺失原因。</p>
          {needsReason && <label className="space-y-1 text-sm">{hasUrl ? "会议文档缺失原因" : "会议链接缺失原因"}
            <Input required value={data.missingReason} onChange={(event) => update("missingReason", event.target.value)} />
          </label>}
        </fieldset>
      )}
      <label className="space-y-1 text-sm">相关附件
        <Input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      </label>
      {data.files.filter((file) => file.kind !== "meeting" || isMeeting).map((file) => (
        <div className="flex items-center justify-between gap-2 text-sm" key={file.path}>
          <span className="truncate">{file.name}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => update("files", data.files.filter((item) => item.path !== file.path))}>移除</Button>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>取消</Button>
        <Button type="submit" disabled={saving}>{saving ? "保存中…" : visit ? "保存修改" : "提交拜访"}</Button>
      </div>
    </form>
  )
}

export function CrmLeadProtection({ leadId, workflow, onChange }: {
  leadId: string
  workflow: LeadWorkflow
  onChange: () => void
}) {
  const [customerClass, setCustomerClass] = useState<string>(workflow.protectionClass)
  const [confirmedUntil, setConfirmedUntil] = useState("")
  const [action, setAction] = useState<"extension" | "nurture" | null>(null)
  const [days, setDays] = useState("15")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  async function run(name: string, args: Record<string, unknown>) {
    setBusy(true)
    try {
      const { error } = await getBrowserSupabaseClient().rpc(name, args)
      if (error) throw error
      setAction(null)
      setReason("")
      toast.success("保护期记录已更新")
      onChange()
    } catch (error) {
      toast.error(getCrmError(error, "处理保护期操作失败，请检查到期日和当前状态"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md bg-primary/5 px-3 py-2 text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{protectionLabels[workflow.protectionClass]}</Badge>
        {workflow.reviewRequired && <Badge variant="secondary">历史保护期待确认</Badge>}
        {workflow.expiresOn && <span>保护期至 {workflow.expiresOn}</span>}
        {workflow.reviewRequired && workflow.legacyProtectedUntil && <span>历史保护日期 {crmDate(new Date(workflow.legacyProtectedUntil))}</span>}
        {workflow.protectionClass === "new_intent" && workflow.firstVisitSatisfied && <span>已完成首访</span>}
      </div>
      {workflow.canManageProtection && (
        <form className="grid gap-2 sm:grid-cols-3" onSubmit={(event) => {
          event.preventDefault()
          void run("rpc_crm_protection_configure", {
            p_lead_id: leadId, p_class: customerClass, p_confirmed_until: confirmedUntil || null,
          })
        }}>
          <select aria-label="客户管理分类" className={selectStyle} value={customerClass} onChange={(event) => setCustomerClass(event.target.value)}>
            {protectionChoices.map((item) => <option key={item} value={item}>{protectionLabels[item]}</option>)}
          </select>
          {workflow.reviewRequired && <Input aria-label="核定保护到期日" type="date" required value={confirmedUntil} onChange={(event) => setConfirmedUntil(event.target.value)} />}
          <Button type="submit" size="sm" variant="outline" disabled={busy}>{workflow.reviewRequired ? "确认历史保护期" : "保存分类"}</Button>
        </form>
      )}
      {workflow.canRequestProtection && (
        <div className="flex flex-wrap gap-2">
          {workflow.expiresOn && <Button type="button" size="sm" variant="outline" onClick={() => setAction("extension")}>申请延期</Button>}
          {workflow.protectionClass === "key_intent" && <Button type="button" size="sm" variant="outline" onClick={() => setAction("nurture")}>申请转待培育</Button>}
        </div>
      )}
      {action && <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
        event.preventDefault()
        void run("rpc_crm_protection_request", {
          p_lead_id: leadId, p_kind: action, p_days: action === "extension" ? Number(days) : 0, p_reason: reason,
        })
      }}>
        {action === "extension" && <Input type="number" className="w-20" aria-label="延期天数" required min={1} max={30} value={days} onChange={(event) => setDays(event.target.value)} />}
        <Input aria-label="申请原因" className="min-w-36 flex-1" required value={reason} onChange={(event) => setReason(event.target.value)} />
        <Button size="sm" type="submit" disabled={busy}>提交申请</Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setAction(null)}>取消</Button>
      </form>}
      {workflow.requests.map((request) => (
        <div key={request.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-xs">
          <span className="flex-1">{request.kind === "extension" ? "延期 " + request.days + " 天" : "转待培育"} · {request.reason}</span>
          {request.canReview ? <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run("rpc_crm_protection_review", { p_request_id: request.id, p_approve: true })}>通过</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("rpc_crm_protection_review", { p_request_id: request.id, p_approve: false })}>驳回</Button>
          </> : <Badge variant="secondary">待审核</Badge>}
        </div>
      ))}
    </div>
  )
}

export function CrmVisitDialog({ leadId, workflow, contact, visit, onClose, onSaved }: {
  leadId: string
  workflow: LeadWorkflow
  contact: string
  visit: CrmVisit | null
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{visit ? "修改拜访" : "记录拜访"}</DialogTitle>
          <DialogDescription>填写实际拜访情况和下一步跟进安排。</DialogDescription>
        </DialogHeader>
        <VisitForm leadId={leadId} workflow={workflow} contact={contact} visit={visit}
          onCancel={onClose} onSave={onSaved} />
      </DialogContent>
    </Dialog>
  )
}

export function CrmVisitActivity({ visit, leadId, contact, workflow, stageChange, onChanged }: {
  visit: CrmVisit
  leadId: string
  contact: string
  workflow: LeadWorkflow
  stageChange?: string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [invalidate, setInvalidate] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function markInvalid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const { error } = await getBrowserSupabaseClient().rpc("rpc_crm_visit_invalidate", { p_id: visit.id, p_reason: reason })
      if (error) throw error
      setInvalidate(false)
      toast.success("已判定无效并重新计算")
      onChanged()
    } catch (failure) {
      toast.error(getCrmError(failure, "处理拜访纠错失败"))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <details className="space-y-2 rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {visit.data.visitDate} · {visitMethods.find((method) => method.id === visit.data.method)?.label}
        <span className="ml-2 text-muted-foreground">{visit.submittedBy}</span>
        {stageChange && <Badge className="ml-2" variant="secondary">{stageChange}</Badge>}
        {visit.invalidReason && <Badge className="ml-2" variant="destructive">无效</Badge>}
      </summary>
      <dl className="grid gap-1 text-xs">
        <div><dt className="inline font-medium">拜访类型 </dt><dd className="inline">{visitTypes.find((type) => type.id === visit.data.type)?.label}</dd></div>
        <div><dt className="inline font-medium">实际参与销售 </dt><dd className="inline">{visit.participants.map((person) => person.name).join("、")}</dd></div>
        <div><dt className="inline font-medium">沟通对象 </dt><dd className="inline">{visit.data.contactName} {visit.data.contactTitle}</dd></div>
        <div><dt className="inline font-medium">意向合作业务 </dt><dd className="inline">{visit.data.services.join("、")}</dd></div>
        <div><dt className="inline font-medium">需求 </dt><dd className="inline whitespace-pre-wrap">{visit.data.needs}</dd></div>
        <div><dt className="inline font-medium">结果 </dt><dd className="inline whitespace-pre-wrap">{visit.data.outcome}</dd></div>
        <div><dt className="inline font-medium">下一步 </dt><dd className="inline whitespace-pre-wrap">{visit.data.nextAction}</dd></div>
        <div><dt className="inline font-medium">下次跟进 </dt><dd className="inline">{visit.data.nextContactOn}</dd></div>
        <div><dt className="inline font-medium">预计毛利／签约日期 </dt><dd className="inline">{visit.data.expectedMargin}／{visit.data.expectedSignedOn}</dd></div>
        <div><dt className="inline font-medium">已提交 </dt><dd className="inline">{new Date(visit.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} {visit.submittedBy}</dd></div>
        {visit.createdAt !== visit.updatedAt && <div><dt className="inline font-medium">最近更新 </dt><dd className="inline">{new Date(visit.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd></div>}
        {visit.protectionOn && <div><dt className="inline font-medium">记录生效时保护到期日 </dt><dd className="inline">{visit.protectionOn}</dd></div>}
        {visit.invalidReason && <div><dt className="inline font-medium">无效原因 </dt><dd className="inline">{visit.invalidReason}</dd></div>}
        {visit.data.missingReason && <div><dt className="inline font-medium">凭证缺失原因 </dt><dd className="inline">{visit.data.missingReason}</dd></div>}
      </dl>
      {visit.data.meetingUrl && <a className="text-xs underline" href={visit.data.meetingUrl} target="_blank" rel="noreferrer">查看会议链接</a>}
      <div className="flex flex-wrap gap-2">
        {visit.data.files.map((file) => <Button key={file.path} size="sm" variant="outline"
          onClick={() => downloadVisitFile(file).catch(() => toast.error("下载失败，请重试"))}>{file.name}</Button>)}
        {visit.canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>修改</Button>}
        {workflow.canReview && !visit.invalidReason && <Button size="sm" variant="ghost" onClick={() => { setInvalidate(true); setReason("") }}>判定无效</Button>}
      </div>
      {invalidate && <form className="flex items-center gap-2" onSubmit={(event) => markInvalid(event)}>
        <Input aria-label="无效原因" required value={reason} onChange={(event) => setReason(event.target.value)} />
        <Button size="sm" type="submit" variant="destructive" disabled={busy}>确认无效</Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setInvalidate(false)}>取消</Button>
      </form>}
    </details>
    {editing && <CrmVisitDialog leadId={leadId} workflow={workflow} contact={contact} visit={visit}
      onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />}
  </>
}
