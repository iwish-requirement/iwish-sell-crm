"use client"

import { useContext, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, Clock, RefreshCcw } from "lucide-react"

import { MePermissionsContext } from "@/components/app-root"
import type { RenewalContractListItem } from "@/lib/services/contracts"
import { fetchRenewalContracts } from "@/lib/services/contracts"


const TIME_FILTER_OPTIONS = [
  { value: "30d", label: "未来 30 天" },
  { value: "60d", label: "未来 60 天" },
  { value: "90d", label: "未来 90 天" },
  { value: "all", label: "全部时间" },
] as const

function formatServiceStatus(item: RenewalContractListItem): string {
  if (!item.endDate || item.daysToEnd === null) {
    return "未设置结束日期"
  }

  if (item.daysToEnd < 0) {
    const days = Math.abs(item.daysToEnd)
    return days === 0 ? "已到期" : `已到期 ${days} 天`
  }

  if (item.daysToEnd === 0) {
    return "今天到期"
  }

  if (item.daysToEnd <= 30) {
    return `即将到期（${item.daysToEnd} 天内）`
  }

  return `距离到期 ${item.daysToEnd} 天`
}

export function RenewalCenter() {
  const mePermissions = useContext(MePermissionsContext)
  const [timeFilter, setTimeFilter] = useState<string>("90d")
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [items, setItems] = useState<RenewalContractListItem[]>([])
  useEffect(() => {
    let isMounted = true

    async function loadRenewals() {
      if (!mePermissions) {
        return
      }

      if (!mePermissions.canReadContracts) {
        if (!isMounted) return
        setItems([])
        setIsLoading(false)
        setLoadError("no-permission")
        return
      }

      setIsLoading(true)
      setLoadError(null)

      const isAllTime = timeFilter === "all"
      const horizon = timeFilter === "30d" ? 30 : timeFilter === "60d" ? 60 : 90

      fetchRenewalContracts(isAllTime ? null : horizon, isAllTime ? null : 30)
        .then((data) => {
          if (!isMounted) return
          setItems(data)
          setIsLoading(false)
        })
        .catch((error) => {
          console.error("Failed to load renewal contracts", error)
          if (!isMounted) return
          setItems([])
          setIsLoading(false)
          setLoadError("error")
        })

    }

    void loadRenewals()

    return () => {
      isMounted = false
    }
  }, [timeFilter, mePermissions])

  const stats = useMemo(() => {
    const total = items.length
    const expiring = items.filter((item) => item.daysToEnd !== null && item.daysToEnd >= 0).length
    const expired = items.filter((item) => item.daysToEnd !== null && item.daysToEnd < 0).length
    const customerCount = new Set(items.map((item) => item.customerName || item.companyName || "")).size

    return { total, expiring, expired, customerCount }
  }, [items])

  const hasNoPermission = loadError === "no-permission"

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">续费中心</h1>
          <p className="text-sm text-muted-foreground mt-1">
            基于合同服务周期，集中查看即将到期和最近到期的客户合同，为续费跟进提供节奏参考。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">服务到期窗口</span>
          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger className="h-9 w-[140px] text-sm">
              <SelectValue placeholder="选择时间范围" />
            </SelectTrigger>

            <SelectContent>
              {TIME_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">当前窗口内合同数</CardTitle>
            <RefreshCcw className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-12" /> : <p className="text-3xl font-bold">{stats.total}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">即将到期</CardTitle>
            <Clock className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p className="text-3xl font-bold text-amber-600">{stats.expiring}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">最近已到期</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p className="text-3xl font-bold text-destructive">{stats.expired}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">涉及客户数</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-bold text-foreground">{stats.customerCount}</p>
            )}
          </CardContent>
        </Card>
      </div>


      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base font-bold text-foreground">续费预警列表</CardTitle>
        </CardHeader>
        <CardContent>
          {hasNoPermission ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="w-4 h-4 text-muted-foreground" />
              <span>当前账号无权访问续费中心，如需调整合同相关权限，请联系系统管理员。</span>
            </div>

          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-5 w-24" />
                </div>
              ))}
            </div>
          ) : loadError === "error" ? (
            <div className="flex items-center gap-2 text-sm text-destructive/80">
              <AlertCircle className="w-4 h-4" />
              <span>续费数据加载失败，请稍后重试。</span>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前时间窗口内暂无需要续费关注的合同。</p>
          ) : (
            <div className="space-y-3">
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">到期日期</TableHead>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">服务周期</TableHead>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">客户 / 合同</TableHead>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">负责人</TableHead>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">合同类型</TableHead>
                      <TableHead className="whitespace-nowrap text-right text-xs font-semibold">合同金额</TableHead>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">续费状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.contractId} className="text-sm">
                        <TableCell className="whitespace-nowrap">
                          {item.endDate ? new Date(item.endDate).toLocaleDateString("zh-CN") : "--"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.startDate && item.endDate
                            ? `${new Date(item.startDate).toLocaleDateString("zh-CN")} ~ ${new Date(item.endDate).toLocaleDateString("zh-CN")}`
                            : "--"}
                        </TableCell>
                        <TableCell className="min-w-[220px]">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground truncate">
                              {item.companyName || item.customerName || "未命名客户"}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {item.contractNumber || "未填写合同编号"}
                            </span>
                            {item.signedAt && (
                              <span className="text-xs text-muted-foreground truncate">
                                签约：{new Date(item.signedAt).toLocaleDateString("zh-CN")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium">
                          {item.ownerName ?? "未分配"}
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline" className="text-[11px]">
                            {item.isRenewal ? "续费合同" : "首单合同"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-right whitespace-nowrap text-primary font-bold">
                          {new Intl.NumberFormat("zh-CN", {
                            style: "currency",
                            currency: item.currency || "CNY",
                            maximumFractionDigits: 0,
                          }).format(item.amount || 0)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.daysToEnd === null ? (
                            <span className="text-xs text-muted-foreground">{formatServiceStatus(item)}</span>
                          ) : (
                            <Badge
                              variant="outline"
                              className={
                                item.daysToEnd < 0
                                  ? "text-[11px] border-destructive/40 text-destructive bg-destructive/5"
                                  : item.daysToEnd === 0
                                    ? "text-[11px] border-amber-500/50 text-amber-700 bg-amber-50"
                                    : item.daysToEnd <= 30
                                      ? "text-[11px] border-amber-400/50 text-amber-600 bg-amber-50"
                                      : "text-[11px] border-primary/30 text-primary bg-primary/5"
                              }
                            >
                              {formatServiceStatus(item)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>

                </Table>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  )
}
