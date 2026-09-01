"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, FileSpreadsheet, Upload } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import type { CompanyResourceAssignmentMode } from "@/lib/lead-import/shared/company-resource-template"

type SalesRepOption = {
  id: string
  name: string
  teamId?: number | null
}

type PreviewRow = {
  rowIndex: number
  company: string
  website: string
  contact: string
  phone: string
  wechat: string
  sourceLabel: string
  businessCategoryNames?: string[]
  productCategory?: string
  budget: string
  ownerName: string
  duplicate: boolean
  errors: string[]
  canImport: boolean
}

type PreviewResponse = {
  ok?: boolean
  detail?: string
  jobId: string
  totalCount: number
  validCount: number
  duplicateCount: number
  errorCount: number
  missingHeaders: string[]
  rows: PreviewRow[]
  rowErrors?: Array<{ rowIndex: number; message: string }>
}

export function LeadKanbanImportDialog({
  canImportLeads,
  salesReps,
  currentTeamId,
  onImported,
}: {
  canImportLeads: boolean
  salesReps: SalesRepOption[]
  currentTeamId: number | null
  onImported: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [assignmentMode, setAssignmentMode] = useState<CompanyResourceAssignmentMode>("uniform_owner")
  const [uniformOwnerId, setUniformOwnerId] = useState("")
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [showOnlyIssues, setShowOnlyIssues] = useState(true)

  const teamSalesReps = useMemo(
    () => salesReps.filter((rep) => currentTeamId == null || rep.teamId == null || rep.teamId === currentTeamId),
    [currentTeamId, salesReps],
  )
  const visiblePreviewRows = useMemo(() => {
    if (!preview) return []
    if (!showOnlyIssues) return preview.rows
    return preview.rows.filter((row) => !row.canImport || row.duplicate || row.errors.length > 0)
  }, [preview, showOnlyIssues])

  useEffect(() => {
    if (!uniformOwnerId && teamSalesReps.length > 0) {
      setUniformOwnerId(teamSalesReps[0].id)
    }
  }, [teamSalesReps, uniformOwnerId])

  function resetState() {
    setFile(null)
    setPreview(null)
    setIsPreviewing(false)
    setIsImporting(false)
    setShowOnlyIssues(true)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  async function handlePreview() {
    if (!file) {
      toast.error("请选择文件", { description: "请先上传标准模板文件" })
      return
    }

    if (assignmentMode === "uniform_owner" && !uniformOwnerId) {
      toast.error("请选择统一负责人", { description: "当前模式下必须指定一个负责人" })
      return
    }

    try {
      setIsPreviewing(true)
      setPreview(null)

      const formData = new FormData()
      formData.append("file", file)
      formData.append("assignmentMode", assignmentMode)
      if (uniformOwnerId) {
        formData.append("uniformOwnerId", uniformOwnerId)
      }

      const res = await fetch("/api/leads/import-preview", {
        method: "POST",
        body: formData,
      })
      const json = (await res.json().catch(() => null)) as PreviewResponse | null
      if (!res.ok || !json?.ok) {
        toast.error("导入预检查失败", {
          description: json?.detail || "服务端未能完成预检查，请稍后重试",
        })
        return
      }

      setPreview(json)
    } catch (error) {
      console.error("Failed to preview lead kanban import", error)
      toast.error("导入预检查失败", { description: "请求预检查时出错，请稍后重试" })
    } finally {
      setIsPreviewing(false)
    }
  }

  async function handleImport() {
    if (!file || !preview?.jobId) {
      toast.error("无法开始导入", { description: "请先完成预检查" })
      return
    }

    try {
      setIsImporting(true)
      const formData = new FormData()
      formData.append("file", file)
      formData.append("jobId", preview.jobId)
      formData.append("assignmentMode", assignmentMode)
      if (uniformOwnerId) {
        formData.append("uniformOwnerId", uniformOwnerId)
      }

      const res = await fetch("/api/leads/import-run", {
        method: "POST",
        body: formData,
      })
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean
        detail?: string
        importedCount?: number
        failedCount?: number
        duplicateCount?: number
        totalCount?: number
        rowErrors?: Array<{ rowIndex: number; message: string }>
      } | null

      if (!res.ok || !json?.ok) {
        const detail =
          json?.rowErrors && json.rowErrors.length > 0
            ? `第 ${json.rowErrors[0].rowIndex} 行：${json.rowErrors[0].message}`
            : json?.detail || "执行导入时出错，请稍后重试"
        toast.error("导入失败", { description: detail })
        return
      }

      toast.success("导入完成", {
        description: `共导入 ${json.importedCount ?? 0} 条线索，已直接进入线索看板`,
      })
      setOpen(false)
      resetState()
      onImported()
    } catch (error) {
      console.error("Failed to run lead kanban import", error)
      toast.error("导入失败", { description: "执行导入时出错，请稍后重试" })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          resetState()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="h-11 px-5 font-semibold" disabled={!canImportLeads}>
          <Upload className="mr-2 h-4 w-4" />
          导入到线索看板
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>导入到线索看板</DialogTitle>
          <DialogDescription>
            模板字段已对齐当前新增线索表单；品类是客户产品品类，可自由填写，旧模板可继续使用。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto py-1 pr-1">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium">标准模板</div>
                <div className="text-xs text-muted-foreground">
                  支持责任归因、二级来源、开发方式、转介绍信息、业务类型、客户级别、标签等当前看板字段，导入后直接进入 L1 阶段。
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <a href="/api/leads/import-template">
                  <Download className="mr-2 h-4 w-4" />
                  下载模板
                </a>
              </Button>
            </div>

            <div className="space-y-2">
              <Label>分配方式</Label>
              <Select value={assignmentMode} onValueChange={(value) => setAssignmentMode(value as CompanyResourceAssignmentMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="uniform_owner">统一负责人</SelectItem>
                  <SelectItem value="file_owner">按文件内负责人分配</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {assignmentMode === "uniform_owner" && (
              <div className="space-y-2">
                <Label>统一负责人</Label>
                <Select value={uniformOwnerId} onValueChange={setUniformOwnerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择负责人" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamSalesReps.map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>上传文件</Label>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed px-4 py-4 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{file?.name || "选择标准模板文件"}</div>
                    <div className="text-xs text-muted-foreground">支持 .xlsx / .xls / .csv</div>
                  </div>
                </div>
                <span className="text-sm text-primary font-medium">选择文件</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            {isPreviewing && <Progress value={65} className="h-2" />}

            <Button onClick={handlePreview} disabled={isPreviewing || isImporting || !file}>
              {isPreviewing ? "预检查中..." : "开始预检查"}
            </Button>
          </div>

          {preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground">总条数</div>
                  <div className="mt-1 text-lg font-semibold">{preview.totalCount}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground">通过校验</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-600">{preview.validCount}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground">重复号码</div>
                  <div className="mt-1 text-lg font-semibold text-amber-600">{preview.duplicateCount}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground">需处理</div>
                  <div className="mt-1 text-lg font-semibold text-rose-600">{preview.errorCount}</div>
                </div>
              </div>

              {preview.missingHeaders.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  当前文件缺少模板列：{preview.missingHeaders.join("、")}
                </div>
              )}

              {preview.errorCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  当前导入为严格模式：预检查中只要存在异常行，就不会执行正式导入。请先把所有报错处理干净。
                </div>
              )}

              <div className="rounded-lg border overflow-hidden">
                <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                  <div className="text-sm font-medium">预检查结果（前 {preview.rows.length} 条）</div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={showOnlyIssues} onCheckedChange={(checked) => setShowOnlyIssues(checked === true)} />
                    只看需处理行
                  </label>
                </div>
                <div className="max-h-80 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>行</TableHead>
                        <TableHead>公司</TableHead>
                        <TableHead>联系人</TableHead>
                        <TableHead>电话</TableHead>
                        <TableHead>来源</TableHead>
                        <TableHead>品类</TableHead>
                        <TableHead>负责人</TableHead>
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visiblePreviewRows.map((row) => (
                        <TableRow key={`${row.rowIndex}-${row.phone}-${row.company}`}>
                          <TableCell>{row.rowIndex}</TableCell>
                          <TableCell>
                            <div className="font-medium">{row.company || row.website || "-"}</div>
                            {row.website && <div className="text-xs text-muted-foreground">{row.website}</div>}
                          </TableCell>
                          <TableCell>{row.contact || "-"}</TableCell>
                          <TableCell>{row.phone || row.wechat || "-"}</TableCell>
                          <TableCell>{row.sourceLabel || "-"}</TableCell>
                          <TableCell>{row.productCategory || row.businessCategoryNames?.join("、") || "-"}</TableCell>
                          <TableCell>{row.ownerName || "-"}</TableCell>
                          <TableCell>
                            {row.canImport ? (
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-900">可导入</Badge>
                            ) : (
                              <div className="space-y-1">
                                <Badge variant="destructive">需处理</Badge>
                                {row.errors.slice(0, 2).map((error) => (
                                  <div key={error} className="text-xs text-muted-foreground">{error}</div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={handleImport}
            disabled={!preview || preview.validCount === 0 || preview.errorCount > 0 || isImporting || isPreviewing}
          >
            {isImporting ? "导入中..." : "确认导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
