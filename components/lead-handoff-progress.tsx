"use client"

import { useEffect, useState } from "react"
import { DepartmentHandoffResults } from "@/components/department-handoff-results"
import { loadDepartmentAllocationDetails, type DepartmentHandoff } from "@/lib/services/department-allocation"

/** 客户详情里的「部门承接进度」：运营端确认的项目负责人和各服务承接人员。没有交接、没有查看权限时不显示。 */
export function LeadHandoffProgress({ leadId }: { leadId: string }) {
  const [loaded, setLoaded] = useState<{ leadId: string; handoffs: DepartmentHandoff[] }>()

  useEffect(() => {
    let active = true
    loadDepartmentAllocationDetails("lead", leadId)
      .then(details => { if (active) setLoaded({ leadId, handoffs: details?.handoffs ?? [] }) })
      .catch(() => { if (active) setLoaded({ leadId, handoffs: [] }) })
    return () => { active = false }
  }, [leadId])

  if (loaded?.leadId !== leadId || !loaded.handoffs.length) return null
  return <DepartmentHandoffResults handoffs={loaded.handoffs} source="lead" recordId={leadId} />
}
