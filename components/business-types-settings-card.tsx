"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type BusinessCategoryRow = {
  id: number
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type BusinessTypeRow = {
  id: number
  category_id: number
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type CategoryDraft = {
  id?: number
  name: string
  description: string
  sort_order: string
  is_active: boolean
}

type TypeDraft = {
  id?: number
  category_id: number | null
  name: string
  description: string
  sort_order: string
  is_active: boolean
}

type PendingDelete =
  | {
      kind: "category"
      row: BusinessCategoryRow
    }
  | {
      kind: "type"
      row: BusinessTypeRow
    }

function isRlsDenied(error: any) {
  const message = String(error?.message ?? "")
  return (
    message.includes("row-level security") ||
    message.includes("permission denied") ||
    message.includes("ERR_NO_PERMISSION") ||
    String(error?.code ?? "") === "42501"
  )
}

export function BusinessTypesSettingsCard() {
  const [categories, setCategories] = useState<BusinessCategoryRow[]>([])
  const [types, setTypes] = useState<BusinessTypeRow[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null)

  const [typeDialogOpen, setTypeDialogOpen] = useState(false)
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const typesByCategory = useMemo(() => {
    const map = new Map<number, BusinessTypeRow[]>()
    for (const row of types) {
      const list = map.get(row.category_id) ?? []
      list.push(row)
      map.set(row.category_id, list)
    }
    // 稳定排序（即便后端排序没生效）
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.name.localeCompare(b.name))
      map.set(k, list)
    }
    return map
  }, [types])

  const selectedCategory = useMemo(() => {
    if (selectedCategoryId == null) return null
    return categories.find((c) => c.id === selectedCategoryId) ?? null
  }, [categories, selectedCategoryId])

  const selectedTypes = useMemo(() => {
    if (selectedCategoryId == null) return []
    return typesByCategory.get(selectedCategoryId) ?? []
  }, [selectedCategoryId, typesByCategory])

  const reload = async () => {
    try {
      setIsLoading(true)
      setLoadError(null)
      const supabase = getBrowserSupabaseClient()

      const [catRes, typeRes] = await Promise.all([
        supabase
          .from("business_categories")
          .select("id, name, description, sort_order, is_active")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("business_types")
          .select("id, category_id, name, description, sort_order, is_active")
          .order("category_id", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
      ])

      if (catRes.error) {
        throw catRes.error
      }
      if (typeRes.error) {
        throw typeRes.error
      }

      const nextCats = ((catRes.data ?? []) as any[]).map((row) => ({
        id: Number(row.id),
        name: String(row.name ?? ""),
        description: row.description != null ? String(row.description) : null,
        sort_order: row.sort_order != null ? Number(row.sort_order) : 100,
        is_active: Boolean(row.is_active),
      }))

      const nextTypes = ((typeRes.data ?? []) as any[]).map((row) => ({
        id: Number(row.id),
        category_id: Number(row.category_id),
        name: String(row.name ?? ""),
        description: row.description != null ? String(row.description) : null,
        sort_order: row.sort_order != null ? Number(row.sort_order) : 100,
        is_active: Boolean(row.is_active),
      }))

      setCategories(nextCats)
      setTypes(nextTypes)

      // 选中项兜底
      setSelectedCategoryId((prev) => {
        if (prev != null && nextCats.some((c) => c.id === prev)) {
          return prev
        }
        return nextCats.length > 0 ? nextCats[0]!.id : null
      })

      setIsLoading(false)
    } catch (err) {
      console.error("Failed to load business taxonomy", err)
      const message = isRlsDenied(err)
        ? "当前账号无权读取业务类型配置，请联系管理员开通 settings.pipeline.manage 或相关读取权限"
        : "业务类型配置加载失败，请稍后重试"
      setLoadError(message)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    void (async () => {
      if (!mounted) return
      await reload()
    })()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreateCategory = () => {
    setCategoryDraft({ name: "", description: "", sort_order: "100", is_active: true })
    setCategoryDialogOpen(true)
  }

  const openEditCategory = (row: BusinessCategoryRow) => {
    setCategoryDraft({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      sort_order: String(row.sort_order ?? 100),
      is_active: row.is_active,
    })
    setCategoryDialogOpen(true)
  }

  const saveCategory = async () => {
    if (!categoryDraft) return

    const name = categoryDraft.name.trim()
    if (!name) {
      toast.error("请填写分类名称")
      return
    }

    const sortOrder = Number.parseInt(categoryDraft.sort_order, 10)
    if (Number.isNaN(sortOrder) || sortOrder < 0) {
      toast.error("排序值不合法", { description: "请填写大于等于 0 的整数" })
      return
    }

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()

      if (categoryDraft.id == null) {
        const { error } = await supabase.from("business_categories").insert({
          name,
          description: categoryDraft.description.trim() || null,
          sort_order: sortOrder,
          is_active: categoryDraft.is_active,
        })

        if (error) throw error
        toast.success("已新增业务分类")
      } else {
        const { error } = await supabase
          .from("business_categories")
          .update({
            name,
            description: categoryDraft.description.trim() || null,
            sort_order: sortOrder,
            is_active: categoryDraft.is_active,
          })
          .eq("id", categoryDraft.id)

        if (error) throw error
        toast.success("已更新业务分类")
      }

      setCategoryDialogOpen(false)
      setCategoryDraft(null)
      await reload()
    } catch (err) {
      console.error("Failed to save business category", err)
      if (isRlsDenied(err)) {
        toast.error("保存失败", { description: "当前账号无权修改业务类型配置（需要 settings.pipeline.manage 权限）" })
      } else {
        toast.error("保存失败", { description: "保存业务分类时出错，请稍后重试" })
      }
    } finally {
      setIsSaving(false)
    }
  }

  const toggleCategoryActive = async (row: BusinessCategoryRow, next: boolean) => {
    try {
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.from("business_categories").update({ is_active: next }).eq("id", row.id)
      if (error) throw error
      setCategories((prev) => prev.map((c) => (c.id === row.id ? { ...c, is_active: next } : c)))
    } catch (err) {
      console.error("Failed to toggle business category", err)
      toast.error("操作失败", {
        description: isRlsDenied(err) ? "无权限修改业务类型配置" : "更新分类状态失败，请稍后重试",
      })
    }
  }

  const deleteCategory = async (row: BusinessCategoryRow) => {
    try {
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.from("business_categories").delete().eq("id", row.id)
      if (error) throw error
      toast.success("分类已删除")
      await reload()
    } catch (err) {
      console.error("Failed to delete business category", err)
      toast.error("删除失败", {
        description: isRlsDenied(err) ? "无权限删除业务分类" : "该分类可能仍有关联子类型/线索引用，请先清理关联后再删除",
      })
    }
  }

  const openCreateType = () => {
    setTypeDraft({
      category_id: selectedCategoryId,
      name: "",
      description: "",
      sort_order: "100",
      is_active: true,
    })
    setTypeDialogOpen(true)
  }

  const openEditType = (row: BusinessTypeRow) => {
    setTypeDraft({
      id: row.id,
      category_id: row.category_id,
      name: row.name,
      description: row.description ?? "",
      sort_order: String(row.sort_order ?? 100),
      is_active: row.is_active,
    })
    setTypeDialogOpen(true)
  }

  const saveType = async () => {
    if (!typeDraft) return

    const name = typeDraft.name.trim()
    if (!name) {
      toast.error("请填写子类型名称")
      return
    }

    if (typeDraft.category_id == null) {
      toast.error("请选择所属分类")
      return
    }

    const sortOrder = Number.parseInt(typeDraft.sort_order, 10)
    if (Number.isNaN(sortOrder) || sortOrder < 0) {
      toast.error("排序值不合法", { description: "请填写大于等于 0 的整数" })
      return
    }

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()

      if (typeDraft.id == null) {
        const { error } = await supabase.from("business_types").insert({
          category_id: typeDraft.category_id,
          name,
          description: typeDraft.description.trim() || null,
          sort_order: sortOrder,
          is_active: typeDraft.is_active,
        })
        if (error) throw error
        toast.success("已新增业务子类型")
      } else {
        const { error } = await supabase
          .from("business_types")
          .update({
            category_id: typeDraft.category_id,
            name,
            description: typeDraft.description.trim() || null,
            sort_order: sortOrder,
            is_active: typeDraft.is_active,
          })
          .eq("id", typeDraft.id)
        if (error) throw error
        toast.success("已更新业务子类型")
      }

      setTypeDialogOpen(false)
      setTypeDraft(null)
      await reload()
    } catch (err) {
      console.error("Failed to save business type", err)
      toast.error("保存失败", {
        description: isRlsDenied(err) ? "无权限修改业务类型配置" : "保存业务子类型时出错，请稍后重试",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const toggleTypeActive = async (row: BusinessTypeRow, next: boolean) => {
    try {
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.from("business_types").update({ is_active: next }).eq("id", row.id)
      if (error) throw error
      setTypes((prev) => prev.map((t) => (t.id === row.id ? { ...t, is_active: next } : t)))
    } catch (err) {
      console.error("Failed to toggle business type", err)
      toast.error("操作失败", {
        description: isRlsDenied(err) ? "无权限修改业务类型配置" : "更新子类型状态失败，请稍后重试",
      })
    }
  }

  const deleteType = async (row: BusinessTypeRow) => {
    try {
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.from("business_types").delete().eq("id", row.id)
      if (error) throw error
      toast.success("子类型已删除")
      await reload()
    } catch (err) {
      console.error("Failed to delete business type", err)
      toast.error("删除失败", {
        description: isRlsDenied(err) ? "无权限删除业务子类型" : "该子类型可能已被线索引用，请先清理关联后再删除",
      })
    }
  }

  const requestDeleteCategory = (row: BusinessCategoryRow) => {
    setPendingDelete({ kind: "category", row })
    setDeleteDialogOpen(true)
  }

  const requestDeleteType = (row: BusinessTypeRow) => {
    setPendingDelete({ kind: "type", row })
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return

    setDeleteDialogOpen(false)

    if (pendingDelete.kind === "category") {
      await deleteCategory(pendingDelete.row)
    } else {
      await deleteType(pendingDelete.row)
    }

    setPendingDelete(null)
  }

  const deleteTitle = pendingDelete?.kind === "category" ? "删除业务分类" : "删除业务子类型"
  const deleteDescription =
    pendingDelete?.kind === "category"
      ? `确认删除分类「${pendingDelete.row.name}」吗？若分类下仍有子类型或已被线索引用，将无法删除。`
      : pendingDelete?.kind === "type"
        ? `确认删除子类型「${pendingDelete.row.name}」吗？若已被线索引用，将无法删除。`
        : ""

  return (
    <Card>
      <CardHeader>
        <CardTitle>业务类型配置</CardTitle>
        <CardDescription>
          配置业务分类与子类型（线索新增/编辑/导入依赖此配置）。建议至少启用一个子类型，否则新增线索会被拦截。
        </CardDescription>
        {loadError && <p className="mt-2 text-xs text-destructive/80">{loadError}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            写入需要后端权限：<span className="font-medium">settings.pipeline.manage</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => void reload()} disabled={isLoading || isSaving}>
              <RefreshCw className="mr-2 h-4 w-4" /> 刷新
            </Button>
            <Button onClick={openCreateCategory} disabled={isLoading || isSaving}>
              <Plus className="mr-2 h-4 w-4" /> 新增分类
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">业务分类</h3>
              <Badge variant="outline" className="text-xs">
                {categories.length} 个
              </Badge>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[240px]">名称</TableHead>
                    <TableHead className="w-[90px] text-center">启用</TableHead>
                    <TableHead className="w-[90px] text-center">排序</TableHead>
                    <TableHead className="w-[72px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((row) => (
                    <TableRow
                      key={row.id}
                      className={
                        selectedCategoryId === row.id
                          ? "bg-primary/5"
                          : row.is_active
                            ? ""
                            : "opacity-70"
                      }
                      onClick={() => setSelectedCategoryId(row.id)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{row.name}</span>
                          {!row.is_active && (
                            <Badge variant="secondary" className="text-[10px]">
                              已停用
                            </Badge>
                          )}
                        </div>
                        {row.description ? (
                          <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{row.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={row.is_active}
                          onCheckedChange={(next) => void toggleCategoryActive(row, next)}
                          disabled={isLoading || isSaving}
                        />
                      </TableCell>
                      <TableCell className="text-center text-sm" onClick={(e) => e.stopPropagation()}>
                        {row.sort_order}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="操作">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditCategory(row)}>
                              <Pencil className="h-4 w-4" /> 编辑
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => requestDeleteCategory(row)}>
                              <Trash2 className="h-4 w-4" /> 删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {categories.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                        暂无业务分类，请先新增一个分类
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">业务子类型</h3>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {selectedTypes.length} 个
                </Badge>
                <Button size="sm" onClick={openCreateType} disabled={isLoading || isSaving || selectedCategoryId == null}>
                  <Plus className="mr-2 h-4 w-4" /> 新增子类型
                </Button>
              </div>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[240px]">名称</TableHead>
                    <TableHead className="w-[90px] text-center">启用</TableHead>
                    <TableHead className="w-[90px] text-center">排序</TableHead>
                    <TableHead className="w-[72px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTypes.map((row) => (
                    <TableRow key={row.id} className={row.is_active ? "" : "opacity-70"}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{row.name}</span>
                          {!row.is_active && (
                            <Badge variant="secondary" className="text-[10px]">
                              已停用
                            </Badge>
                          )}
                        </div>
                        {row.description ? (
                          <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{row.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={row.is_active}
                          onCheckedChange={(next) => void toggleTypeActive(row, next)}
                          disabled={isLoading || isSaving}
                        />
                      </TableCell>
                      <TableCell className="text-center text-sm">{row.sort_order}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="操作">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditType(row)}>
                              <Pencil className="h-4 w-4" /> 编辑
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => requestDeleteType(row)}>
                              <Trash2 className="h-4 w-4" /> 删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}

                  {selectedCategoryId == null && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                        请先选择一个分类
                      </TableCell>
                    </TableRow>
                  )}

                  {selectedCategoryId != null && selectedTypes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                        当前分类下暂无子类型
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {selectedCategory && (
              <div className="text-xs text-muted-foreground">
                当前分类：<span className="font-medium">{selectedCategory.name}</span>
              </div>
            )}
          </div>
        </div>

        <Separator />
        <div className="text-xs text-muted-foreground leading-relaxed">
          提示：
          <br />
          - 线索表单里会要求至少选择 1 个业务子类型。
          <br />
          - 停用分类/子类型不会删除历史线索的关联，只会影响后续可选项。
        </div>

        <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{categoryDraft?.id == null ? "新增业务分类" : "编辑业务分类"}</DialogTitle>
              <DialogDescription>分类用于承载多个业务子类型，可用于统计与筛选。</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>分类名称 *</Label>
                <Input
                  value={categoryDraft?.name ?? ""}
                  onChange={(e) =>
                    setCategoryDraft((prev) =>
                      prev
                        ? { ...prev, name: e.target.value }
                        : { name: e.target.value, description: "", sort_order: "100", is_active: true },
                    )
                  }
                  placeholder="例如：工业设备、品牌服务..."
                />
              </div>

              <div className="space-y-2">
                <Label>描述</Label>
                <Input
                  value={categoryDraft?.description ?? ""}
                  onChange={(e) => setCategoryDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                  placeholder="可选：用于说明该分类覆盖的业务范围"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>排序</Label>
                  <Input
                    type="number"
                    value={categoryDraft?.sort_order ?? "100"}
                    onChange={(e) => setCategoryDraft((prev) => (prev ? { ...prev, sort_order: e.target.value } : prev))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>启用</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={Boolean(categoryDraft?.is_active)}
                      onCheckedChange={(next) => setCategoryDraft((prev) => (prev ? { ...prev, is_active: next } : prev))}
                    />
                    <span className="text-xs text-muted-foreground">停用后将不再出现在可选列表中</span>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCategoryDialogOpen(false)} disabled={isSaving}>
                取消
              </Button>
              <Button onClick={() => void saveCategory()} disabled={isSaving}>
                {isSaving ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{typeDraft?.id == null ? "新增业务子类型" : "编辑业务子类型"}</DialogTitle>
              <DialogDescription>子类型是线索表单的必选项，用于更精细的业务统计与分配。</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>所属分类 *</Label>
                <Select
                  value={typeDraft?.category_id != null ? String(typeDraft.category_id) : ""}
                  onValueChange={(value) =>
                    setTypeDraft((prev) => (prev ? { ...prev, category_id: value ? Number(value) : null } : prev))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择所属分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>子类型名称 *</Label>
                <Input
                  value={typeDraft?.name ?? ""}
                  onChange={(e) =>
                    setTypeDraft((prev) =>
                      prev
                        ? { ...prev, name: e.target.value }
                        : { category_id: selectedCategoryId, name: e.target.value, description: "", sort_order: "100", is_active: true },
                    )
                  }
                  placeholder="例如：定制代工、品牌全案..."
                />
              </div>

              <div className="space-y-2">
                <Label>描述</Label>
                <Input
                  value={typeDraft?.description ?? ""}
                  onChange={(e) => setTypeDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                  placeholder="可选：补充说明该子类型的典型客户/需求"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>排序</Label>
                  <Input
                    type="number"
                    value={typeDraft?.sort_order ?? "100"}
                    onChange={(e) => setTypeDraft((prev) => (prev ? { ...prev, sort_order: e.target.value } : prev))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>启用</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={Boolean(typeDraft?.is_active)}
                      onCheckedChange={(next) => setTypeDraft((prev) => (prev ? { ...prev, is_active: next } : prev))}
                    />
                    <span className="text-xs text-muted-foreground">停用后将不再出现在可选列表中</span>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setTypeDialogOpen(false)} disabled={isSaving}>
                取消
              </Button>
              <Button onClick={() => void saveType()} disabled={isSaving}>
                {isSaving ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open)
            if (!open) setPendingDelete(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
              <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSaving}>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault()
                  void confirmDelete()
                }}
                disabled={isSaving}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
