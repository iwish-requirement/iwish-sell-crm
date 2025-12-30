"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { fetchAuditLogs, type AuditLogEntry } from "@/lib/services/audit"

interface RecentActivityItem {
  id: string
  title: string
  detail: string
  actorName: string
  createdAt: Date
  type: "progress" | "new" | "followup" | "won" | "risk" | "other"
}

const typeStyles: Record<string, string> = {
  progress: "bg-blue-50 text-blue-700",
  new: "bg-emerald-50 text-emerald-700",
  followup: "bg-slate-100 text-slate-700",
  won: "bg-green-50 text-green-700",
  risk: "bg-red-50 text-red-700",
  other: "bg-slate-100 text-slate-700",
}

function mapAuditToActivity(entry: AuditLogEntry): RecentActivityItem | null {
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : null

  if (!createdAt) {
    return null
  }

  const actorName = entry.actorName && entry.actorName.trim().length > 0 ? entry.actorName : "系统"

  // 账号生命周期相关
  if (entry.action === "approve_user") {
    return {
      id: entry.id,
      title: "审批通过账号",
      detail: entry.reason ?? "已通过账号审批",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "reject_user") {
    return {
      id: entry.id,
      title: "驳回注册申请",
      detail: entry.reason ?? "已驳回注册申请",
      actorName,
      createdAt,
      type: "risk",
    }
  }

  if (entry.action === "disable_user") {
    return {
      id: entry.id,
      title: "禁用账号",
      detail: entry.reason ?? "账号已被禁用",
      actorName,
      createdAt,
      type: "risk",
    }
  }

  if (entry.action === "restore_user") {
    return {
      id: entry.id,
      title: "恢复账号",
      detail: entry.reason ?? "账号已恢复启用",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  // 组织与权限配置相关
  if (entry.action === "update_profile_org") {
    return {
      id: entry.id,
      title: "调整成员组织",
      detail: entry.reason ?? "已更新成员所属团队/角色",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "update_role_permissions") {
    return {
      id: entry.id,
      title: "角色权限矩阵变更",
      detail: entry.reason ?? "已更新角色权限矩阵",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "update_user_permissions") {
    return {
      id: entry.id,
      title: "用户覆盖权限变更",
      detail: entry.reason ?? "已更新用户覆盖权限",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "update_field_policies") {
    return {
      id: entry.id,
      title: "字段策略变更",
      detail: entry.reason ?? "已更新字段级权限策略",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "update_scope_sets") {
    return {
      id: entry.id,
      title: "自定义范围更新",
      detail: entry.reason ?? "已更新自定义范围配置",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  // 设置与业务规则
  if (entry.action === "create_setting") {
    return {
      id: entry.id,
      title: "新增业务设置",
      detail: entry.reason ?? `设置项: ${entry.targetId}`,
      actorName,
      createdAt,
      type: "new",
    }
  }

  if (entry.action === "update_setting") {
    return {
      id: entry.id,
      title: "更新业务设置",
      detail: entry.reason ?? `设置项: ${entry.targetId}`,
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "delete_setting") {
    return {
      id: entry.id,
      title: "删除业务设置",
      detail: entry.reason ?? `设置项: ${entry.targetId}`,
      actorName,
      createdAt,
      type: "risk",
    }
  }

  // 导入导出作业
  if (entry.action === "request_leads_import") {
    return {
      id: entry.id,
      title: "发起线索导入",
      detail: entry.reason ?? "已创建线索导入任务",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "request_leads_export") {
    return {
      id: entry.id,
      title: "发起线索导出",
      detail: entry.reason ?? "已创建线索导出任务",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  // 线索业务
  if (entry.action === "create_lead") {
    return {
      id: entry.id,
      title: "新增线索",
      detail: `对象: ${entry.targetId.substring(0, 8)}…`,
      actorName,
      createdAt,
      type: "new",
    }
  }

  if (entry.action === "update_lead") {
    return {
      id: entry.id,
      title: "线索更新",
      detail: entry.reason ?? "已更新线索信息",
      actorName,
      createdAt,
      type: "progress",
    }
  }

  if (entry.action === "assign_lead" || entry.action === "transfer_lead") {
    return {
      id: entry.id,
      title: entry.action === "assign_lead" ? "线索分配" : "线索转移",
      detail: entry.reason ?? "负责人已调整",
      actorName,
      createdAt,
      type: "followup",
    }
  }

  if (entry.action === "close_lead") {
    return {
      id: entry.id,
      title: "线索关闭",
      detail: entry.reason ?? "线索已关闭",
      actorName,
      createdAt,
      type: "won",
    }
  }

  if (entry.action === "return_lead_to_pool") {
    return {
      id: entry.id,
      title: "退回公海",
      detail: entry.reason ?? "线索已退回公海池",
      actorName,
      createdAt,
      type: "risk",
    }
  }

  return {
    id: entry.id,
    title: entry.action,
    detail: entry.reason ?? "",
    actorName,
    createdAt,
    type: "other",
  }
}

function formatTimeDistance(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  if (diffMinutes < 1) {
    return "刚刚"
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} 小时前`
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) {
    return `${diffDays} 天前`
  }

  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths} 个月前`
}

export function RecentActivityTable() {
  const [activities, setActivities] = useState<RecentActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadActivities() {
      setIsLoading(true)
      setError(null)

      try {
        const entries = await fetchAuditLogs(32)

        if (!isMounted) {
          return
        }

        const mapped: RecentActivityItem[] = []

        for (const entry of entries) {
          const item = mapAuditToActivity(entry)
          if (item) {
            mapped.push(item)
          }
        }

        mapped.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

        setActivities(mapped.slice(0, 8))
      } catch (err: any) {
        console.error("Failed to load recent activities", err)
        if (!isMounted) {
          return
        }
        setError("最近动态加载失败，请稍后重试")
        setActivities([])
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadActivities().catch((err) => {
      console.error("Unexpected error in loadActivities", err)
    })

    return () => {
      isMounted = false
    }
  }, [])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-muted" />
              <div className="space-y-1">
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-3 w-40 rounded bg-muted" />
              </div>
            </div>
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-xs text-muted-foreground">
        <p>{error}</p>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-xs text-muted-foreground">
        <p>最近没有可以展示的关键动态。</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="text-xs">
                {activity.actorName ? activity.actorName[0] : "?"}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium text-foreground">{activity.title}</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={typeStyles[activity.type]}>
                  {activity.actorName}
                </Badge>
                <span className="text-xs text-muted-foreground">{activity.detail}</span>
              </div>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{formatTimeDistance(activity.createdAt)}</span>
        </div>
      ))}
    </div>
  )
}
