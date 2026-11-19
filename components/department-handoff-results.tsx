import { Badge } from "@/components/ui/badge"
import { selectedAllocationServices, type DepartmentHandoff } from "@/lib/services/department-allocation"
import { DEAL_CONTRACT_SERVICES } from "@/lib/services/deal-contract-fields"

const serviceNames = new Map(DEAL_CONTRACT_SERVICES.flatMap(group =>
  selectedAllocationServices({ [group.key]: group.options.map(([id]) => id) }).map(service => [service.id, service.name] as const)
))

export function DepartmentHandoffResults({ handoffs }: { handoffs: DepartmentHandoff[] }) {
  if (!handoffs.length) return null
  return <section className="space-y-3 border-t pt-4" aria-label="部门承接进度">
    <h3 className="font-semibold">部门承接进度</h3>
    <ul className="space-y-2">
      {handoffs.map(handoff => (
        <li key={handoff.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm">
          <div className="space-y-1">
            <p className="font-medium">{handoff.departmentName}</p>
            <p className="text-muted-foreground">{handoff.services.map(service => serviceNames.get(service) ?? service).join("、")}</p>
          </div>
          <Badge variant="outline">待运营交接</Badge>
        </li>
      ))}
    </ul>
  </section>
}
