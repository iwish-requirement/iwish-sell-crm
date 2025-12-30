import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type LeadStage = "L1" | "L2" | "L3" | "L4" | "Won" | "Lost"

interface StatusBadgeProps {
  stage: LeadStage | string
  className?: string
}

export function getStageConfig(stage: string) {
  switch (stage) {
    case "L1":
      return {
        label: "L1 询盘",
        className: "bg-blue-100 text-blue-700 hover:bg-blue-100",
        dotColor: "bg-blue-500",
      }
    case "L2":
      return {
        label: "L2 意向",
        className: "bg-sky-100 text-sky-700 hover:bg-sky-100",
        dotColor: "bg-sky-500",
      }
    case "L3":
      return {
        label: "L3 关键意向",
        className: "bg-orange-100 text-orange-700 hover:bg-orange-100",
        dotColor: "bg-orange-500",
      }
    case "L4":
      return {
        label: "L4 谈判",
        className: "bg-red-100 text-red-700 hover:bg-red-100",
        dotColor: "bg-red-500",
      }
    case "Won":
      return {
        label: "成交",
        className: "bg-green-100 text-green-700 hover:bg-green-100",
        dotColor: "bg-green-500",
      }
    case "Lost":
      return {
        label: "流失",
        className: "bg-slate-100 text-slate-500 hover:bg-slate-100",
        dotColor: "bg-slate-400",
      }
    default:
      return {
        label: stage,
        className: "bg-slate-100 text-slate-600 hover:bg-slate-100",
        dotColor: "bg-slate-400",
      }
  }
}

export function StatusBadge({ stage, className }: StatusBadgeProps) {
  const config = getStageConfig(stage)

  return (
    <Badge variant="secondary" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  )
}

export function StatusDot({ stage }: { stage: string }) {
  const config = getStageConfig(stage)
  return <div className={cn("w-3 h-3 rounded-full", config.dotColor)} />
}
