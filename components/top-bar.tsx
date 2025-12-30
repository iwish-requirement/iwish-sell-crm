"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, Search, Bell, ChevronRight, Download } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

const viewLabels: Record<string, string> = {
  dashboard: "仪表盘",
  leads: "我的线索",
  pool: "公海池",
  analytics: "数据分析",
  settings: "系统设置",
  audit: "审计中心",
}

function getViewFromPathname(pathname: string): keyof typeof viewLabels {
  if (pathname.startsWith("/leads")) {
    return "leads"
  }

  if (pathname.startsWith("/settings")) {
    return "settings"
  }

  if (pathname.startsWith("/reports")) {
    return "analytics"
  }

  if (pathname.startsWith("/pool")) {
    return "pool"
  }

  if (pathname.startsWith("/audit")) {
    return "audit"
  }

  return "dashboard"
}

type LeadImportJob = {
  id: string
  source: string
  fileName: string
  fileSize: number | null
  status: string
  totalCount: number | null
  successCount: number | null
  duplicateCount: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

type LeadExportJob = {
  id: string
  source: string
  format: string
  status: string
  totalCount: number | null
  exportedCount: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

type CurrentUserInfo = {
  fullName: string
  avatarUrl: string | null
  status: string
}

function getProfileStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "待审批"
    case "active":
      return "已启用"
    case "disabled":
      return "已禁用"
    case "rejected":
      return "已驳回"
    default:
      return "已登录"
  }
}

export function TopBar() {
  const router = useRouter()
  const pathname = usePathname() ?? "/"
  const activeKey = getViewFromPathname(pathname)
  const [jobSheetOpen, setJobSheetOpen] = useState(false)
  const [importJobs, setImportJobs] = useState<LeadImportJob[]>([])
  const [exportJobs, setExportJobs] = useState<LeadExportJob[]>([])
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null)
  const [isLoadingUser, setIsLoadingUser] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadCurrentUser() {
      try {
        setIsLoadingUser(true)
        const supabase = getBrowserSupabaseClient()
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) {
          console.error("Failed to get auth user for top bar", userError)
          return
        }

        if (!user) {
          return
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles_public")
          .select("full_name, avatar_url, status")
          .eq("id", user.id)
          .single()

        if (profileError) {
          console.error("Failed to load current user public profile", profileError)
          return
        }

        if (!isMounted) return

        setCurrentUser({
          fullName: (profile.full_name as string) ?? user.email ?? "未命名用户",
          avatarUrl: (profile.avatar_url as string | null) ?? null,
          status: profile.status as string,
        })
      } catch (err) {
        console.error("Unexpected error while loading current user info in top bar", err)
      } finally {
        if (isMounted) {
          setIsLoadingUser(false)
        }
      }
    }

    void loadCurrentUser()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!jobSheetOpen) return

    let isMounted = true

    async function loadJobs() {
      try {
        setIsLoadingJobs(true)
        const supabase = getBrowserSupabaseClient()

        const [importRes, exportRes] = await Promise.all([
          supabase
            .from("lead_import_jobs")
            .select(
              "id, source, file_name, file_size, status, total_count, success_count, duplicate_count, error_message, created_at, completed_at",
            )
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("lead_export_jobs")
            .select("id, source, format, status, total_count, exported_count, error_message, created_at, completed_at")
            .order("created_at", { ascending: false })
            .limit(20),
        ])

        if (!isMounted) return

        if (!importRes.error) {
          const mappedImport: LeadImportJob[] =
            importRes.data?.map((row: any) => ({
              id: row.id as string,
              source: (row.source as string) ?? "public_pool",
              fileName: (row.file_name as string) ?? "-",
              fileSize: (row.file_size as number | null) ?? null,
              status: (row.status as string) ?? "pending",
              totalCount: (row.total_count as number | null) ?? null,
              successCount: (row.success_count as number | null) ?? null,
              duplicateCount: (row.duplicate_count as number | null) ?? null,
              errorMessage: (row.error_message as string | null) ?? null,
              createdAt: row.created_at as string,
              completedAt: (row.completed_at as string | null) ?? null,
            })) ?? []

          setImportJobs(mappedImport)
        }

        if (!exportRes.error) {
          const mappedExport: LeadExportJob[] =
            exportRes.data?.map((row: any) => ({
              id: row.id as string,
              source: (row.source as string) ?? "public_pool",
              format: (row.format as string) ?? "-",
              status: (row.status as string) ?? "pending",
              totalCount: (row.total_count as number | null) ?? null,
              exportedCount: (row.exported_count as number | null) ?? null,
              errorMessage: (row.error_message as string | null) ?? null,
              createdAt: row.created_at as string,
              completedAt: (row.completed_at as string | null) ?? null,
            })) ?? []

          setExportJobs(mappedExport)
        }
      } catch (err) {
        console.error("Failed to load lead import/export jobs from top bar", err)
      } finally {
        if (isMounted) {
          setIsLoadingJobs(false)
        }
      }
    }

    void loadJobs()

    return () => {
      isMounted = false
    }
  }, [jobSheetOpen])

  return (
    <>
      <header className="h-16 border-b border-border bg-card px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm pl-12 md:pl-0">
          <span className="text-muted-foreground hidden sm:inline">首页</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
          <span className="text-foreground font-medium">{viewLabels[activeKey]}</span>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="relative w-48 lg:w-64 hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="搜索线索、客户..." className="pl-9" />
          </div>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Search className="w-5 h-5" />
          </Button>
          {/* 顶部通知入口暂时隐藏，后续如接入个人通知再启用 */}
          {/* <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center">
              3
            </span>
          </Button> */}
          {/* 移动端图标版任务中心入口 */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setJobSheetOpen(true)}
          >
            <Download className="w-5 h-5" />
            <span className="sr-only">打开任务中心</span>
          </Button>
          {/* 桌面端带文案按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="hidden md:inline-flex gap-2"
            onClick={() => setJobSheetOpen(true)}
          >
            <Download className="w-4 h-4" />
            任务中心
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 focus:outline-none" suppressHydrationWarning type="button">
                <Avatar className="w-9 h-9">
                  {currentUser?.avatarUrl ? <AvatarImage src={currentUser.avatarUrl} /> : null}
                  <AvatarFallback>{(currentUser?.fullName ?? "用户").slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="hidden sm:flex flex-col items-start">
                  <span className="text-sm font-medium">
                    {currentUser?.fullName ?? (isLoadingUser ? "加载中..." : "当前用户")}
                  </span>
                  <Badge variant="secondary" className="text-xs w-fit">
                    {getProfileStatusLabel(currentUser?.status)}
                  </Badge>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="flex flex-col items-start">
                <span className="text-sm font-medium truncate">
                  {currentUser?.fullName ?? "当前用户"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {getProfileStatusLabel(currentUser?.status)}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    const supabase = getBrowserSupabaseClient()
                    await supabase.auth.signOut()
                  } catch (err) {
                    console.error("Failed to sign out", err)
                  } finally {
                    router.push("/auth/login")
                  }
                }}
                variant="destructive"
              >
                <LogOut className="w-4 h-4" />
                <span>退出登录</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Sheet open={jobSheetOpen} onOpenChange={setJobSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-4 flex flex-col">
          <SheetHeader>
            <SheetTitle>导入 / 导出任务</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4 flex-1 overflow-y-auto pr-1">
            <p className="text-xs text-muted-foreground">仅显示当前账号最近 20 条任务记录。</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">导入任务</h3>
                {isLoadingJobs && <span className="text-[11px] text-muted-foreground">加载中...</span>}
              </div>
              {importJobs.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无导入任务</p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">文件名</TableHead>
                        <TableHead className="text-xs">状态</TableHead>
                        <TableHead className="text-xs">统计</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importJobs.map((job) => (
                        <TableRow key={job.id} className="text-xs">
                          <TableCell className="max-w-[140px] truncate" title={job.fileName}>
                            {job.fileName}
                          </TableCell>
                          <TableCell>{job.status}</TableCell>
                          <TableCell>
                            {job.totalCount != null || job.successCount != null || job.duplicateCount != null ? (
                              <span>
                                {job.successCount ?? 0}/{job.totalCount ?? "?"}
                                {job.duplicateCount ? `，重复 ${job.duplicateCount}` : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">--</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">导出任务</h3>
              </div>
              {exportJobs.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无导出任务</p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">格式</TableHead>
                        <TableHead className="text-xs">状态</TableHead>
                        <TableHead className="text-xs">统计</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exportJobs.map((job) => (
                        <TableRow key={job.id} className="text-xs">
                          <TableCell>{job.format.toUpperCase()}</TableCell>
                          <TableCell>{job.status}</TableCell>
                          <TableCell>
                            {job.totalCount != null || job.exportedCount != null ? (
                              <span>
                                {job.exportedCount ?? 0}/{job.totalCount ?? "?"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">--</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
