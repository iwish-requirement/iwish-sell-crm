"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { loadDepartmentAllocationDetails, selectedAllocationServices, type AllocationSource, type DepartmentHandoff } from "@/lib/services/department-allocation"
import { DEAL_CONTRACT_SERVICES } from "@/lib/services/deal-contract-fields"

const serviceNames = new Map(DEAL_CONTRACT_SERVICES.flatMap(group =>
  selectedAllocationServices({ [group.key]: group.options.map(([id]) => id) }).map(service => [service.id, service.name] as const)
))

const ROLE_ORDER = [
  ["optimizer_manager", "优化经理"],
  ["optimizer", "优化师"],
  ["optimizer_assistant", "优化师助理"],
] as const
// 效果营销各平台（Google、Meta、Criteo、Bing、Pinterest、TikTok、CTV）固定预留优化经理 / 优化师 / 优化师助理三行
// （2026-11-25「其他平台的对应的优化师也补充」），没人显示「-」；其他服务只列有人的角色。
const reservesRoles = (serviceId: string) => serviceId.startsWith("performance/")

function staffingRows(serviceId: string, members: { name: string; role?: string }[]) {
  const service = serviceNames.get(serviceId) ?? serviceId
  return ROLE_ORDER.flatMap(([role, label]) => {
    const names = members.filter(person => (person.role ?? "optimizer") === role).map(person => person.name)
    if (!names.length && !reservesRoles(serviceId)) return []
    return [{ key: `${serviceId}:${role}`, label: `${service} ${label}`, names: names.join("、") || "-" }]
  })
}

function formatAcceptedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

export function DepartmentHandoffResults({ handoffs, source, recordId }: {
  handoffs: DepartmentHandoff[]
  source: AllocationSource
  recordId: string
}) {
  const [updated, setUpdated] = useState<{ initial: DepartmentHandoff[]; handoffs: DepartmentHandoff[] }>()
  const enabled = handoffs.some(handoff => handoff.delivery)
  useEffect(() => {
    if (!enabled) return
    let active = true
    let loading = false
    async function refresh() {
      if (loading || document.visibilityState !== "visible") return
      loading = true
      try {
        const details = await loadDepartmentAllocationDetails(source, recordId)
        if (active) setUpdated({ initial: handoffs, handoffs: details?.handoffs ?? [] })
      } catch {
        // Keep the last result if a refresh fails.
      } finally {
        loading = false
      }
    }
    const timer = window.setInterval(() => void refresh(), 10000)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [enabled, handoffs, recordId, source])

  const rows = updated?.initial === handoffs ? updated.handoffs : handoffs
  if (!rows.length) return null
  return <section className="space-y-3 border-t pt-4" aria-label="部门承接进度">
    <h3 className="font-semibold">部门承接进度</h3>
    <ul className="space-y-2">
      {rows.map(handoff => (
        <li key={handoff.id} className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">{handoff.departmentName}</p>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">{handoff.staffing ? "人员已确认" : handoff.workOrderId ? "运营已收单" : handoff.delivery ? "待运营收单" : "待运营交接"}</Badge>
              {handoff.delivery === "retrying" && <Badge variant="secondary">自动重试中</Badge>}
              {handoff.delivery === "failed" && <Badge variant="destructive">送单失败</Badge>}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">{handoff.services.map(service => serviceNames.get(service) ?? service).join("、")}</p>
            {handoff.workOrderId && <p className="break-words text-muted-foreground">运营工单 {handoff.workOrderId}</p>}
            {(handoff.delivery === "retrying" || handoff.delivery === "failed") &&
              <p className="text-muted-foreground">已尝试 {handoff.deliveryAttempts} 次</p>}
          </div>
          {handoff.staffing && <dl className="grid gap-2 border-t pt-2 sm:grid-cols-2">
            <div><dt className="text-muted-foreground">项目负责人</dt><dd>{handoff.staffing.projectLead.name}</dd></div>
            {handoff.staffing.staffing.flatMap(item => staffingRows(item.serviceId, item.members)).map(row => <div key={row.key}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="break-words">{row.names}</dd>
            </div>)}
          </dl>}
          {(handoff.staffingHistory?.length ?? 0) > 1 && <details className="border-t pt-2">
            <summary className="cursor-pointer text-muted-foreground">人员调整记录（{handoff.staffingHistory!.length} 版）</summary>
            <ol className="mt-2 space-y-2">
              {handoff.staffingHistory!.map(entry => <li key={entry.version} className="rounded border p-2">
                <p className="font-medium">第 {entry.version} 版 · {formatAcceptedAt(entry.acceptedAt)}</p>
                <p className="break-words text-muted-foreground">
                  项目负责人 {entry.projectLead?.name ?? "-"}；{entry.staffing.flatMap(item => staffingRows(item.serviceId, item.members))
                    .filter(row => row.names !== "-").map(row => `${row.label} ${row.names}`).join("；")}
                </p>
              </li>)}
            </ol>
          </details>}
        </li>
      ))}
    </ul>
  </section>
}
