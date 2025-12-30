"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { mapRpcError, type RpcErrorFriendly } from "@/lib/rpc-error-mapper"
import { RpcErrorBanner } from "@/components/rpc-error-banner"
import { toast } from "sonner"
import { RefreshCw, Search } from "lucide-react"

interface AuditLogEntry {
  id: string
  actorId: string
  actorName?: string
  action: string
  targetType: string
  targetId: string
  reason: string | null
  createdAt: string
  before: unknown | null
  after: unknown | null
}

type TimeRange = "7d" | "30d" | "all"

type TargetFilter = "all" | "profile" | "lead" | "permission" | "other"

const actionLabels: Record<string, string> = {
  approve_user: "审批通过账号",
  reject_user: "驳回注册申请",
  disable_user: "禁用账号",
  restore_user: "恢复账号",
  create_lead: "创建线索",
  update_lead: "更新线索",
  assign_lead: "分配线索",
  transfer_lead: "转移线索",
  close_lead: "关闭线索",
  delete_lead: "删除线索",
  return_lead_to_pool: "退回公海",
  request_leads_import: "发起线索导入",
  complete_leads_import: "线索导入完成",
  request_leads_export: "发起线索导出",
  complete_leads_export: "线索导出完成",
  update_role_permissions: "角色权限矩阵变更",
  update_field_policies: "字段策略变更",
  update_scope_sets: "自定义范围更新",
  update_user_permissions: "用户覆盖权限变更",
  create_setting: "新增业务设置",
  update_setting: "更新业务设置",
  delete_setting: "删除业务设置",
  update_profile_org: "调整成员组织",
}




function getActionLabel(action: string): string {
  return actionLabels[action] ?? action
}

function getTargetCategory(targetType: string): TargetFilter {
  if (targetType === "profile") return "profile"
  if (targetType === "lead") return "lead"
  if (
    targetType === "role_permissions" ||
    targetType === "user_permissions" ||
    targetType === "permissions" ||
    targetType === "field_policies" ||
    targetType === "custom_scope_sets" ||
    targetType === "settings"
  ) {
    return "permission"
  }
  return "other"
}

export function AuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<RpcErrorFriendly | null>(null)
  const [searchText, setSearchText] = useState("")
  const [timeRange, setTimeRange] = useState<TimeRange>("7d")
  const [targetFilter, setTargetFilter] = useState<TargetFilter>("all")
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const retryLoad = useCallback(() => setReloadToken((token) => token + 1), [])


  useEffect(() => {
    let isMounted = true

    async function loadAuditLogs() {
      try {
        setIsLoading(true)
        setLoadError(null)

        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase
          .from("audit_logs")
          .select("id, actor_id, action, target_type, target_id, reason, created_at, before, after")
          .order("created_at", { ascending: false })
          .limit(200)

        if (!isMounted) return

        if (error) {
          console.error("Failed to load audit logs", error)
          const friendly = mapRpcError(error, {
            title: "加载失败",
            description: "加载审计日志失败，请稍后重试或联系管理员",
          })
          setLoadError(friendly)
          toast.error(friendly.title, {
            description: friendly.description,
            ...(friendly.canRetry ? { action: { label: "重试", onClick: retryLoad } } : {}),
          })
          setLogs([])
          return
        }

        const rows = (data ?? []) as any[]

        const actorIds = Array.from(new Set(rows.map((row) => row.actor_id).filter(Boolean))) as string[]
        const actorNameById = new Map<string, string>()

        if (actorIds.length > 0) {
          const { data: actors, error: actorsError } = await supabase
            .from("profiles_public")
            .select("id, full_name")
            .in("id", actorIds)

          if (!isMounted) return

          if (actorsError) {
            console.error("Failed to load audit actors", actorsError)
          } else {
            for (const actor of actors ?? []) {
              if (actor && actor.id) {
                actorNameById.set(actor.id as string, (actor.full_name as string) ?? "")
              }
            }
          }
        }

        const normalized: AuditLogEntry[] = rows.map((row) => ({
          id: row.id as string,
          actorId: row.actor_id as string,
          actorName: actorNameById.get(row.actor_id as string),
          action: row.action as string,
          targetType: row.target_type as string,
          targetId: row.target_id as string,
          reason: (row.reason as string | null) ?? null,
          createdAt: row.created_at as string,
          before: row.before ?? null,
          after: row.after ?? null,
        }))

        setLogs(normalized)
        setPage(1)
      } catch (error) {
        console.error("Unexpected error while loading audit logs", error)
        if (isMounted) {
          const friendly = mapRpcError(error as any, {
            title: "加载失败",
            description: "加载审计日志失败，请稍后重试或联系管理员",
          })
          setLoadError(friendly)
          toast.error(friendly.title, {
            description: friendly.description,
            ...(friendly.canRetry ? { action: { label: "重试", onClick: retryLoad } } : {}),
          })
          setLogs([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadAuditLogs()

    return () => {
      isMounted = false
    }
  }, [reloadToken])

  useEffect(() => {
    setPage(1)
  }, [searchText, timeRange, targetFilter])

  const filteredLogs = useMemo(() => {
    const now = new Date()
    const search = searchText.trim().toLowerCase()

    return logs.filter((entry) => {
      if (timeRange !== "all") {
        const created = new Date(entry.createdAt)
        const diffMs = now.getTime() - created.getTime()
        const diffDays = diffMs / (1000 * 60 * 60 * 24)
        if (timeRange === "7d" && diffDays > 7) return false
        if (timeRange === "30d" && diffDays > 30) return false
      }

      if (targetFilter !== "all") {
        const category = getTargetCategory(entry.targetType)
        if (category !== targetFilter) return false
      }

      if (search) {
        const haystack = [
          entry.actorName ?? "",
          entry.actorId,
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.reason ?? "",
        ]
          .join(" ")
          .toLowerCase()

        if (!haystack.includes(search)) {
          return false
        }
      }

      return true
    })
  }, [logs, searchText, timeRange, targetFilter])

  const total = filteredLogs.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const pageItems = filteredLogs.slice(startIndex, startIndex + pageSize)

  const handleOpenDetail = (entry: AuditLogEntry) => {
    setSelectedLog(entry)
    setDetailOpen(true)
  }

  const handleCloseDetail = () => {
    setDetailOpen(false)
    setSelectedLog(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">审计日志</h1>
          <p className="text-sm text-muted-foreground">
            查看关键操作的审计记录，支持按时间、对象和关键字筛选。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={retryLoad}
          disabled={isLoading}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">审计记录</CardTitle>
          <CardDescription className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 gap-2 max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="按操作人、动作、对象或原因搜索"
                  className="pl-8"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Select
                value={timeRange}
                onValueChange={(value: TimeRange) => setTimeRange(value)}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="时间范围" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">近 7 天</SelectItem>
                  <SelectItem value="30d">近 30 天</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={targetFilter}
                onValueChange={(value: TargetFilter) => setTargetFilter(value)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="对象类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部对象</SelectItem>
                  <SelectItem value="profile">账号/成员</SelectItem>
                  <SelectItem value="lead">线索</SelectItem>
                  <SelectItem value="permission">权限与设置</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loadError && (
            <RpcErrorBanner
              error={loadError}
              onRetry={loadError.canRetry ? retryLoad : undefined}
              onDismiss={() => setLoadError(null)}
              retryLabel="重试加载"
              className="mb-3"
            />
          )}

          <div className="border rounded-md">
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">时间</TableHead>
                    <TableHead className="w-[160px]">操作人</TableHead>
                    <TableHead className="w-[160px]">动作</TableHead>
                    <TableHead>对象</TableHead>
                    <TableHead className="w-[240px]">原因</TableHead>
                    <TableHead className="w-[100px] text-right">详情</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && pageItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        正在加载审计日志...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && pageItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        暂无审计日志，可能是尚未产生关键操作，或当前账号缺少 audit.read 权限。
                      </TableCell>
                    </TableRow>
                  )}
                  {pageItems.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-muted/40">
                      <TableCell className="align-top text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {entry.actorName || "未知用户"}
                          </span>
                          <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                            {entry.actorId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className="text-xs">
                          {getActionLabel(entry.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col text-sm">
                          <span className="font-medium">{entry.targetType}</span>
                          <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                            {entry.targetId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        <span className="line-clamp-2">
                          {entry.reason || "-"}
                        </span>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => handleOpenDetail(entry)}
                        >
                          查看详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>

          {total > 0 && (
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <div>
                共 {total} 条记录，第 {currentPage} / {totalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  &lt;
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  &gt;
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={(open) => (open ? setDetailOpen(true) : handleCloseDetail())}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>审计详情</DialogTitle>
            <DialogDescription>
              查看本次操作的前后数据变化，仅对具备审计权限的管理员可见。
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="grid gap-4 mt-2 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">操作前数据</span>
                  <Badge variant="outline" className="text-xs">
                    before
                  </Badge>
                </div>
                <ScrollArea className="h-[260px] border rounded-md bg-muted/40">
                  <pre className="p-3 text-xs whitespace-pre-wrap break-all">
                    {selectedLog.before ? JSON.stringify(selectedLog.before, null, 2) : "(空)"}
                  </pre>
                </ScrollArea>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">操作后数据</span>
                  <Badge variant="outline" className="text-xs">
                    after
                  </Badge>
                </div>
                <ScrollArea className="h-[260px] border rounded-md bg-muted/40">
                  <pre className="p-3 text-xs whitespace-pre-wrap break-all">
                    {selectedLog.after ? JSON.stringify(selectedLog.after, null, 2) : "(空)"}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
