"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { MoreHorizontal, Plus, RefreshCw, Save, Pencil, Trash2 } from "lucide-react"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { toast } from "sonner"

interface GradeDefinitionSetting {
  key: string
  label: string
  description?: string
}

interface SourceChildSetting {
  key: string
  label: string
}

interface SourceChannelSetting {
  key: string
  label: string
  children: SourceChildSetting[]
}

type GradeDraft = {
  index: number | null
  key: string
  label: string
  description: string
}

type ChannelDraft = {
  index: number | null
  key: string
  label: string
}

type ChildDraft = {
  channelIndex: number
  childIndex: number | null
  key: string
  label: string
}

type PendingDelete =
  | {
      kind: "grade"
      index: number
      title: string
      description: string
    }
  | {
      kind: "channel"
      index: number
      channelKey: string
      title: string
      description: string
    }
  | {
      kind: "child"
      channelIndex: number
      childIndex: number
      title: string
      description: string
    }

function normalizeKey(value: string) {
  return value.trim()
}

const DEFAULT_COMPANY_RESOURCE_GROUPS: SourceChannelSetting[] = [
  {
    key: "social_media",
    label: "社媒渠道",
    children: [
      { key: "wechat_company", label: "视频号（公司号）" },
      { key: "wechat_ip_1", label: "视频号（IP号）" },
      { key: "wechat_ip_2", label: "视频号（IP号2）" },
      { key: "xiaohongshu", label: "小红书" },
      { key: "douyin", label: "抖音" },
      { key: "official_account", label: "公众号" },
      { key: "community", label: "社群" },
    ],
  },
  {
    key: "website",
    label: "官网来源",
    children: [
      { key: "website_form", label: "官网表单" },
      { key: "website_wechat", label: "官网加微信" },
    ],
  },
  {
    key: "offline_events",
    label: "线下活动",
    children: [
      { key: "strategy_course", label: "一号位战略课" },
      { key: "traffic_course", label: "流量系列课" },
      { key: "brand_course", label: "品牌系列课" },
      { key: "seo_course", label: "SEO系列课" },
      { key: "expo", label: "展会" },
      { key: "public_workshop", label: "公开课分享会" },
      { key: "other_event", label: "其他活动" },
    ],
  },
  {
    key: "livestream",
    label: "直播类",
    children: [{ key: "livestream_lead", label: "直播间线索" }],
  },
]

export function LeadGradesAndSourcesSettingsCard() {

  const [grades, setGrades] = useState<GradeDefinitionSetting[]>([])
  const [channels, setChannels] = useState<SourceChannelSetting[]>([])
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [gradeDialogOpen, setGradeDialogOpen] = useState(false)
  const [gradeDraft, setGradeDraft] = useState<GradeDraft | null>(null)

  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [channelDraft, setChannelDraft] = useState<ChannelDraft | null>(null)

  const [childDialogOpen, setChildDialogOpen] = useState(false)
  const [childDraft, setChildDraft] = useState<ChildDraft | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const selectedChannelIndex = useMemo(() => {
    if (!selectedChannelKey) return null
    const idx = channels.findIndex((c) => c.key === selectedChannelKey)
    return idx >= 0 ? idx : null
  }, [channels, selectedChannelKey])

  const selectedChannel = useMemo(() => {
    if (selectedChannelIndex == null) return null
    return channels[selectedChannelIndex] ?? null
  }, [channels, selectedChannelIndex])

  const selectedChildren = useMemo(() => {
    return selectedChannel?.children ?? []
  }, [selectedChannel])

  const reload = async () => {
    try {
      setIsLoading(true)
      const supabase = getBrowserSupabaseClient()

      const [gradeResult, sourceResult] = await Promise.all([
        supabase.from("settings").select("value").eq("key", "leads.grade_definitions").maybeSingle(),
        supabase.from("settings").select("value").eq("key", "leads.company_resource_source_groups").maybeSingle(),
      ])


      const gradeValue = (gradeResult.data?.value as any) ?? null
      const sourceValue = (sourceResult.data?.value as any) ?? null

      const nextGrades: GradeDefinitionSetting[] =
        gradeValue && Array.isArray(gradeValue.grades)
          ? gradeValue.grades
              .filter((g: any) => g && typeof g.key === "string" && typeof g.label === "string")
              .map((g: any) => ({
                key: String(g.key),
                label: String(g.label),
                description: typeof g.description === "string" ? g.description : "",
              }))
          : [
              {
                key: "S",
                label: "S级（强成交 / 立即跟进）",
                description: "项目需求明确，有清晰上线时间和预算，已接触关键决策人，近期有成交可能。",
              },
              {
                key: "A",
                label: "A级（重点培育 / 近期可成交）",
                description: "业务痛点明确，对方案认可，有初步预算意向，预计 1-3 个月内有项目机会。",
              },
              {
                key: "B",
                label: "B级（普通意向 / 需持续教育）",
                description: "有兴趣但需求和预算模糊，决策链较长，项目时间在 3 个月以后或未定。",
              },
              {
                key: "C",
                label: "C级（低优先级 / 长期培育）",
                description: "短期无法成交或仅了解阶段，可纳入长期培育与自动化触达。",
              },
            ]

      const nextChannels: SourceChannelSetting[] =
        sourceValue && Array.isArray(sourceValue.groups)
          ? sourceValue.groups
              .filter((c: any) => c && typeof c.key === "string" && typeof c.label === "string")
              .map((c: any) => ({
                  key: String(c.key),
                  label: String(c.label),
                  children: Array.isArray(c.children)
                    ? c.children
                        .filter((child: any) => child && typeof child.key === "string" && typeof child.label === "string")
                        .map((child: any) => ({
                          key: String(child.key),
                          label: String(child.label),
                        }))
                    : [],
                }))
          : DEFAULT_COMPANY_RESOURCE_GROUPS


      setGrades(nextGrades)
      setChannels(nextChannels)

      setSelectedChannelKey((prev) => {
        if (prev && nextChannels.some((c) => c.key === prev)) return prev
        return nextChannels.length > 0 ? nextChannels[0]!.key : null
      })

      setLoadError(null)
      setIsLoading(false)
    } catch (error) {
      console.error("Failed to load grade and source settings", error)
      setLoadError("客户级别和来源配置加载失败，请稍后重试")

      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true
    void (async () => {
      if (!isMounted) return
      await reload()
    })()
    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreateGrade = () => {
    setGradeDraft({ index: null, key: "", label: "", description: "" })
    setGradeDialogOpen(true)
  }

  const openEditGrade = (index: number) => {
    const row = grades[index]
    if (!row) return
    setGradeDraft({
      index,
      key: row.key,
      label: row.label,
      description: row.description ?? "",
    })
    setGradeDialogOpen(true)
  }

  const saveGradeDraft = () => {
    if (!gradeDraft) return

    const key = normalizeKey(gradeDraft.key).toUpperCase()
    const label = gradeDraft.label.trim()

    if (!key || !label) {
      toast.error("请填写客户级别 Key 与名称")
      return
    }

    setGrades((prev) => {
      const next = [...prev]
      const item: GradeDefinitionSetting = {
        key,
        label,
        description: gradeDraft.description.trim(),
      }

      if (gradeDraft.index == null) {
        next.push(item)
      } else {
        next[gradeDraft.index] = item
      }
      return next
    })

    setGradeDialogOpen(false)
    setGradeDraft(null)
  }

  const requestDeleteGrade = (index: number) => {
    const row = grades[index]
    if (!row) return

    setPendingDelete({
      kind: "grade",
      index,
      title: "删除客户级别",
      description: `确认删除客户级别「${row.key}」吗？此操作仅影响本地草稿，点击“保存配置”后才会生效。`,
    })
    setDeleteDialogOpen(true)
  }

  const openCreateChannel = () => {
    setChannelDraft({ index: null, key: "", label: "" })
    setChannelDialogOpen(true)
  }

  const openEditChannel = (index: number) => {
    const row = channels[index]
    if (!row) return
    setChannelDraft({ index, key: row.key, label: row.label })
    setChannelDialogOpen(true)
  }

  const saveChannelDraft = () => {
    if (!channelDraft) return

    const key = normalizeKey(channelDraft.key)
    const label = channelDraft.label.trim()
    if (!key || !label) {
      toast.error("请填写来源分类 Key 与名称")

      return
    }

    setChannels((prev) => {
      const next = [...prev]
      if (channelDraft.index == null) {
        next.push({ key, label, children: [] })
      } else {
        const old = next[channelDraft.index]
        next[channelDraft.index] = {
          key,
          label,
          children: old?.children ?? [],
        }
      }
      return next
    })

    // 如果编辑的是当前选中渠道且 key 发生变化，需要同步选中状态
    if (channelDraft.index != null) {
      const prevKey = channels[channelDraft.index]?.key
      if (prevKey && prevKey === selectedChannelKey && prevKey !== key) {
        setSelectedChannelKey(key)
      }
    } else if (!selectedChannelKey) {
      setSelectedChannelKey(key)
    }

    setChannelDialogOpen(false)
    setChannelDraft(null)
  }

  const requestDeleteChannel = (index: number) => {
    const row = channels[index]
    if (!row) return

    setPendingDelete({
      kind: "channel",
      index,
      channelKey: row.key,
      title: "删除来源分类",
      description: `确认删除来源分类「${row.label}」吗？其下所有二级来源也会被删除。此操作仅影响本地草稿，点击“保存配置”后才会生效。`,

    })
    setDeleteDialogOpen(true)
  }

  const openCreateChild = (channelIndex: number) => {
    setChildDraft({ channelIndex, childIndex: null, key: "", label: "" })
    setChildDialogOpen(true)
  }

  const openEditChild = (channelIndex: number, childIndex: number) => {
    const row = channels[channelIndex]?.children?.[childIndex]
    if (!row) return
    setChildDraft({ channelIndex, childIndex, key: row.key, label: row.label })
    setChildDialogOpen(true)
  }

  const saveChildDraft = () => {
    if (!childDraft) return

    const key = normalizeKey(childDraft.key)
    const label = childDraft.label.trim()
    if (!key || !label) {
      toast.error("请填写二级来源 Key 与名称")

      return
    }

    setChannels((prev) => {
      const next = [...prev]
      const channel = next[childDraft.channelIndex]
      if (!channel) return prev

      const nextChildren = [...(channel.children ?? [])]
      if (childDraft.childIndex == null) {
        nextChildren.push({ key, label })
      } else {
        nextChildren[childDraft.childIndex] = { key, label }
      }

      next[childDraft.channelIndex] = { ...channel, children: nextChildren }
      return next
    })

    setChildDialogOpen(false)
    setChildDraft(null)
  }

  const requestDeleteChild = (channelIndex: number, childIndex: number) => {
    const row = channels[channelIndex]?.children?.[childIndex]
    if (!row) return

    setPendingDelete({
      kind: "child",
      channelIndex,
      childIndex,
      title: "删除二级来源",
      description: `确认删除二级来源「${row.label}」吗？此操作仅影响本地草稿，点击“保存配置”后才会生效。`,

    })
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (!pendingDelete) return

    if (pendingDelete.kind === "grade") {
      setGrades((prev) => prev.filter((_, i) => i !== pendingDelete.index))
      toast.success("已删除（未保存）", { description: "点击右上角“保存配置”后才会生效" })
    }

    if (pendingDelete.kind === "channel") {
      const channelKey = pendingDelete.channelKey
      setChannels((prev) => {
        const next = prev.filter((_, i) => i !== pendingDelete.index)
        if (channelKey && channelKey === selectedChannelKey) {
          setSelectedChannelKey(next.length > 0 ? next[0]!.key : null)
        }
        return next
      })
      toast.success("已删除（未保存）", { description: "点击右上角“保存配置”后才会生效" })
    }

    if (pendingDelete.kind === "child") {
      setChannels((prev) =>
        prev.map((c, idx) =>
          idx === pendingDelete.channelIndex
            ? { ...c, children: c.children.filter((_, i) => i !== pendingDelete.childIndex) }
            : c,
        ),
      )
      toast.success("已删除（未保存）", { description: "点击右上角“保存配置”后才会生效" })
    }

    setDeleteDialogOpen(false)
    setPendingDelete(null)
  }

  const handleSave = async () => {
    const trimmedGrades = grades
      .map((g) => ({
        key: normalizeKey(g.key).toUpperCase(),
        label: g.label.trim(),
        description: (g.description ?? "").trim(),
      }))
      .filter((g) => g.key && g.label)

    if (trimmedGrades.length === 0) {
      toast.error("请至少配置一个客户级别")
      return
    }

    const trimmedChannels = channels
      .map((c) => ({
        key: normalizeKey(c.key),
        label: c.label.trim(),
        children: (c.children ?? [])
          .map((child) => ({ key: normalizeKey(child.key), label: child.label.trim() }))
          .filter((child) => child.key && child.label),
      }))
      .filter((c) => c.key && c.label)

    try {
      setIsSaving(true)
      const supabase = getBrowserSupabaseClient()

      const { error } = await supabase
        .from("settings")
        .upsert(
          [
            {
              key: "leads.grade_definitions",
              value: {
                grades: trimmedGrades,
              },
            },
            {
              key: "leads.company_resource_source_groups",
              value: {
                groups: trimmedChannels,
              },
            },

          ],
          { onConflict: "key" },
        )

      if (error) {
        console.error("Failed to save grade and source settings", error)
        const message = error.message ?? ""
        if (
          message.includes("ERR_NO_PERMISSION:settings.ui.manage") ||
          message.includes("ERR_NO_PERMISSION:settings.pipeline.manage")
        ) {
          toast.error("保存失败", {
            description: "当前账号无权修改线索配置，请联系系统管理员开通相应设置权限",
          })
        } else {
          toast.error("保存失败", { description: "保存客户级别与来源配置时出错，请稍后重试" })

        }
        return
      }

      toast.success("客户级别与来源配置已保存")
    } catch (error) {
      console.error("Unexpected error while saving grade and source settings", error)
      toast.error("保存失败", { description: "保存客户级别与来源配置时发生异常，请稍后重试或联系管理员" })

    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>客户级别与来源配置</CardTitle>
        <CardDescription>
          配置 S/A/B/C 客户级别含义，以及“公司分配资源”场景下的来源分类与二级来源枚举；历史渠道树继续用于兼容旧线索展示。
        </CardDescription>

        {loadError && <p className="mt-2 text-xs text-destructive/80">{loadError}</p>}
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            写入需要后端权限：<span className="font-medium">settings.pipeline.manage</span>（或管理员授予的设置权限）
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void reload()}
              disabled={isLoading || isSaving}
              aria-label="刷新"
              title="刷新"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isLoading}>
              <Save className="mr-2 h-4 w-4" /> {isSaving ? "保存中..." : "保存配置"}
            </Button>
          </div>
        </div>

        <Separator />

        {/* 主：来源配置 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">公司分配资源二级来源</h3>
              <p className="text-xs text-muted-foreground">左侧维护来源分类，右侧维护选中分类下的二级来源。</p>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {channels.length} 个一级
              </Badge>
              <Button size="sm" onClick={openCreateChannel} disabled={isLoading || isSaving}>
                <Plus className="mr-2 h-4 w-4" /> 新增分类
              </Button>

            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">来源分类</h4>
                <Badge variant="outline" className="text-xs">
                  {channels.length} 个
                </Badge>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
              <TableHead className="w-[160px]">Key</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-[110px] text-center">二级来源数</TableHead>

                      <TableHead className="w-[72px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {channels.map((row, idx) => (
                      <TableRow
                        key={`${row.key}-${idx}`}
                        className={selectedChannelKey === row.key ? "bg-primary/5" : ""}
                        onClick={() => setSelectedChannelKey(row.key)}
                      >
                        <TableCell className="font-mono text-sm">{row.key}</TableCell>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="text-center text-sm text-muted-foreground">{row.children?.length ?? 0}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label="操作">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditChannel(idx)}>
                                <Pencil className="h-4 w-4" /> 编辑
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => requestDeleteChannel(idx)}>
                                <Trash2 className="h-4 w-4" /> 删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}

                    {channels.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                          暂无来源分类，请先新增一个
                        </TableCell>
                      </TableRow>
                    )}

                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">二级来源</h4>
                  {selectedChannel ? (
                    <Badge variant="secondary" className="text-xs">

                      {selectedChannel.label}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (selectedChannelIndex == null) return
                    openCreateChild(selectedChannelIndex)
                  }}
                  disabled={isLoading || isSaving || selectedChannelIndex == null}
                >
                  <Plus className="mr-2 h-4 w-4" /> 新增二级来源

                </Button>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Key</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead className="w-[72px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedChannelIndex == null && (
                      <TableRow>
                        <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                          请先在左侧选择一个来源分类
                        </TableCell>
                      </TableRow>
                    )}

                    {selectedChannelIndex != null && selectedChildren.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                          当前来源分类下暂无二级来源
                        </TableCell>
                      </TableRow>
                    )}


                    {selectedChannelIndex != null &&
                      selectedChildren.map((row, childIndex) => (
                        <TableRow key={`${row.key}-${childIndex}`}>
                          <TableCell className="font-mono text-sm">{row.key}</TableCell>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label="操作">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditChild(selectedChannelIndex, childIndex)}>
                                  <Pencil className="h-4 w-4" /> 编辑
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => requestDeleteChild(selectedChannelIndex, childIndex)}
                                >
                                  <Trash2 className="h-4 w-4" /> 删除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* 次：客户级别 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">客户级别</h3>
              <p className="text-xs text-muted-foreground">用于线索与客户 360 视图的 S/A/B/C 分层与保护期计算。</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {grades.length} 个
              </Badge>
              <Button size="sm" onClick={openCreateGrade} disabled={isLoading || isSaving}>
                <Plus className="mr-2 h-4 w-4" /> 新增级别
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Key</TableHead>
                  <TableHead className="w-[320px]">名称</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead className="w-[72px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grades.map((row, idx) => (
                  <TableRow key={`${row.key}-${idx}`}>
                    <TableCell className="font-mono font-semibold">{row.key}</TableCell>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{row.description || "-"}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="操作">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditGrade(idx)}>
                            <Pencil className="h-4 w-4" /> 编辑
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => requestDeleteGrade(idx)}>
                            <Trash2 className="h-4 w-4" /> 删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {grades.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                      暂无客户级别，请先新增一个
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <Dialog open={gradeDialogOpen} onOpenChange={setGradeDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{gradeDraft?.index == null ? "新增客户级别" : "编辑客户级别"}</DialogTitle>
              <DialogDescription>Key 建议使用 S/A/B/C；名称与描述用于团队统一口径。</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Key *</Label>
                  <Input
                    value={gradeDraft?.key ?? ""}
                    onChange={(e) => setGradeDraft((prev) => (prev ? { ...prev, key: e.target.value.toUpperCase() } : prev))}
                    placeholder="例如：S"
                    className="uppercase"
                  />
                </div>
                <div className="space-y-2">
                  <Label>名称 *</Label>
                  <Input
                    value={gradeDraft?.label ?? ""}
                    onChange={(e) => setGradeDraft((prev) => (prev ? { ...prev, label: e.target.value } : prev))}
                    placeholder="例如：S级（强成交 / 立即跟进）"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>描述</Label>
                <Input
                  value={gradeDraft?.description ?? ""}
                  onChange={(e) => setGradeDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                  placeholder="用于团队共识，判定标准"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setGradeDialogOpen(false)} disabled={isSaving}>
                取消
              </Button>
              <Button onClick={saveGradeDraft} disabled={isSaving}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{channelDraft?.index == null ? "新增来源分类" : "编辑来源分类"}</DialogTitle>

              <DialogDescription>Key 用于存储与筛选，建议使用英文/短横线风格，避免随意变更。</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Key *</Label>
                  <Input
                    value={channelDraft?.key ?? ""}
                    onChange={(e) => setChannelDraft((prev) => (prev ? { ...prev, key: e.target.value } : prev))}
                    placeholder="例如：ads"
                  />
                </div>
                <div className="space-y-2">
                  <Label>名称 *</Label>
                  <Input
                    value={channelDraft?.label ?? ""}
                    onChange={(e) => setChannelDraft((prev) => (prev ? { ...prev, label: e.target.value } : prev))}
                    placeholder="例如：广告投放"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setChannelDialogOpen(false)} disabled={isSaving}>
                取消
              </Button>
              <Button onClick={saveChannelDraft} disabled={isSaving}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={childDialogOpen} onOpenChange={setChildDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{childDraft?.childIndex == null ? "新增二级来源" : "编辑二级来源"}</DialogTitle>
              <DialogDescription>二级来源会随来源分类一起用于线索录入与筛选。</DialogDescription>

            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Key *</Label>
                  <Input
                    value={childDraft?.key ?? ""}
                    onChange={(e) => setChildDraft((prev) => (prev ? { ...prev, key: e.target.value } : prev))}
                    placeholder="例如：douyin"
                  />
                </div>
                <div className="space-y-2">
                  <Label>名称 *</Label>
                  <Input
                    value={childDraft?.label ?? ""}
                    onChange={(e) => setChildDraft((prev) => (prev ? { ...prev, label: e.target.value } : prev))}
                    placeholder="例如：抖音"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setChildDialogOpen(false)} disabled={isSaving}>
                取消
              </Button>
              <Button onClick={saveChildDraft} disabled={isSaving}>
                保存
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
              <AlertDialogTitle>{pendingDelete?.title ?? "确认删除"}</AlertDialogTitle>
              <AlertDialogDescription>{pendingDelete?.description ?? ""}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSaving}>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault()
                  confirmDelete()
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
