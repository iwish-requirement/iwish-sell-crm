"use client"

import { useEffect, useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Plus, Trash2, Save } from "lucide-react"
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

export function LeadGradesAndSourcesSettingsCard() {
  const [grades, setGrades] = useState<GradeDefinitionSetting[]>([])
  const [channels, setChannels] = useState<SourceChannelSetting[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadSettings() {
      try {
        setIsLoading(true)
        const supabase = getBrowserSupabaseClient()

        const [gradeResult, sourceResult] = await Promise.all([
          supabase
            .from("settings")
            .select("value")
            .eq("key", "leads.grade_definitions")
            .maybeSingle(),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "leads.source_tree")
            .maybeSingle(),
        ])

        if (!isMounted) return

        const gradeValue = (gradeResult.data?.value as any) ?? null
        if (gradeValue && Array.isArray(gradeValue.grades)) {
          const nextGrades: GradeDefinitionSetting[] = gradeValue.grades
            .filter((g: any) => g && typeof g.key === "string" && typeof g.label === "string")
            .map((g: any) => ({
              key: String(g.key),
              label: String(g.label),
              description: typeof g.description === "string" ? g.description : "",
            }))
          setGrades(nextGrades)
        } else {
          setGrades([
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
          ])
        }

        const sourceValue = (sourceResult.data?.value as any) ?? null
        if (sourceValue && Array.isArray(sourceValue.channels)) {
          const nextChannels: SourceChannelSetting[] = sourceValue.channels
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
          setChannels(nextChannels)
        } else {
          setChannels([])
        }

        setLoadError(null)
        setIsLoading(false)
      } catch (error) {
        console.error("Failed to load grade and source settings", error)
        if (isMounted) {
          setLoadError("客户级别和渠道配置加载失败，请稍后重试")
          setIsLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      isMounted = false
    }
  }, [])

  const handleAddGrade = () => {
    setGrades((prev) => [
      ...prev,
      {
        key: "",
        label: "",
        description: "",
      },
    ])
  }

  const handleRemoveGrade = (index: number) => {
    setGrades((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAddChannel = () => {
    setChannels((prev) => [
      ...prev,
      {
        key: "",
        label: "",
        children: [],
      },
    ])
  }

  const handleRemoveChannel = (index: number) => {
    setChannels((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAddChild = (channelIndex: number) => {
    setChannels((prev) =>
      prev.map((channel, idx) =>
        idx === channelIndex
          ? {
              ...channel,
              children: [
                ...channel.children,
                {
                  key: "",
                  label: "",
                },
              ],
            }
          : channel,
      ),
    )
  }

  const handleRemoveChild = (channelIndex: number, childIndex: number) => {
    setChannels((prev) =>
      prev.map((channel, idx) =>
        idx === channelIndex
          ? {
              ...channel,
              children: channel.children.filter((_, i) => i !== childIndex),
            }
          : channel,
      ),
    )
  }

  const handleSave = async () => {
    const trimmedGrades = grades
      .map((g) => ({
        key: g.key.trim(),
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
        key: c.key.trim(),
        label: c.label.trim(),
        children: c.children
          .map((child) => ({ key: child.key.trim(), label: child.label.trim() }))
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
              key: "leads.source_tree",
              value: {
                channels: trimmedChannels,
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
          toast.error("保存失败", { description: "保存客户级别与渠道配置时出错，请稍后重试" })
        }
        return
      }

      toast.success("客户级别与渠道配置已保存")
    } catch (error) {
      console.error("Unexpected error while saving grade and source settings", error)
      toast.error("保存失败", { description: "保存客户级别与渠道配置时发生异常，请稍后重试或联系管理员" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-foreground">客户级别与渠道配置</CardTitle>
        <CardDescription className="text-sm">
          配置 S/A/B/C 客户级别含义，以及线索来源的一级渠道与二级渠道枚举，前端录入和筛选会使用这里的配置。
        </CardDescription>
        {loadError && <p className="mt-2 text-sm text-destructive/80">{loadError}</p>}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">客户级别</h3>
                <p className="text-xs text-muted-foreground">用于线索与客户 360 视图中的 S/A/B/C 客户分层和保护期计算。</p>
              </div>
              <Button size="icon" variant="outline" onClick={handleAddGrade} disabled={isLoading || isSaving} className="h-8 w-8">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="h-[260px] rounded-md border bg-muted/5">
              <div className="p-3 space-y-3">
                {grades.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂未配置客户级别，可点击右上角按钮新增。</p>
                ) : (
                  grades.map((grade, index) => (
                    <div key={index} className="space-y-2 rounded-md border bg-background p-3 shadow-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 grid grid-cols-[80px,1fr] items-center gap-2">
                          <Label className="text-xs font-semibold text-muted-foreground" htmlFor={`grade-key-${index}`}>
                            Key
                          </Label>
                          <Input
                            id={`grade-key-${index}`}
                            value={grade.key}
                            onChange={(e) => {
                              const value = e.target.value
                              setGrades((prev) =>
                                prev.map((g, idx) => (idx === index ? { ...g, key: value.toUpperCase() } : g)),
                              )
                            }}
                            placeholder="例如：S/A/B/C"
                            disabled={isLoading || isSaving}
                            className="h-8 text-sm uppercase font-bold"
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleRemoveGrade(index)}
                          disabled={isLoading || isSaving}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-[80px,1fr] items-center gap-2">
                        <Label className="text-xs font-semibold text-muted-foreground" htmlFor={`grade-label-${index}`}>
                          名称
                        </Label>
                        <Input
                          id={`grade-label-${index}`}
                          value={grade.label}
                          onChange={(e) => {
                            const value = e.target.value
                            setGrades((prev) =>
                              prev.map((g, idx) => (idx === index ? { ...g, label: value } : g)),
                            )
                          }}
                          placeholder="例如：S级（强成交 / 立即跟进）"
                          disabled={isLoading || isSaving}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-[80px,1fr] items-start gap-2">
                        <Label className="text-xs font-semibold text-muted-foreground" htmlFor={`grade-desc-${index}`}>
                          描述
                        </Label>
                        <Input
                          id={`grade-desc-${index}`}
                          value={grade.description ?? ""}
                          onChange={(e) => {
                            const value = e.target.value
                            setGrades((prev) =>
                              prev.map((g, idx) => (idx === index ? { ...g, description: value } : g)),
                            )
                          }}
                          placeholder="用于团队共识，判定标准"
                          disabled={isLoading || isSaving}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">线索来源渠道</h3>
                <p className="text-xs text-muted-foreground">
                  配置来源的一级与二级渠道，用于新增线索表单和看板筛选。
                </p>
              </div>
              <Button size="icon" variant="outline" onClick={handleAddChannel} disabled={isLoading || isSaving} className="h-8 w-8">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="h-[260px] rounded-md border bg-muted/5">
              <div className="p-3 space-y-3">
                {channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂未配置来源渠道，请点击新增。</p>
                ) : (
                  channels.map((channel, channelIndex) => (
                    <div key={channelIndex} className="space-y-2 rounded-md border bg-background p-3 shadow-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 grid grid-cols-[80px,1fr] items-center gap-2">
                          <Label className="text-xs font-semibold text-muted-foreground" htmlFor={`channel-key-${channelIndex}`}>
                            一级 Key
                          </Label>
                          <Input
                            id={`channel-key-${channelIndex}`}
                            value={channel.key}
                            onChange={(e) => {
                              const value = e.target.value
                              setChannels((prev) =>
                                prev.map((c, idx) => (idx === channelIndex ? { ...c, key: value } : c)),
                              )
                            }}
                            placeholder="例如：ads"
                            disabled={isLoading || isSaving}
                            className="h-8 text-sm"
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleRemoveChannel(channelIndex)}
                          disabled={isLoading || isSaving}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-[80px,1fr] items-center gap-2">
                        <Label className="text-xs font-semibold text-muted-foreground" htmlFor={`channel-label-${channelIndex}`}>
                          一级名称
                        </Label>
                        <Input
                          id={`channel-label-${channelIndex}`}
                          value={channel.label}
                          onChange={(e) => {
                            const value = e.target.value
                            setChannels((prev) =>
                              prev.map((c, idx) => (idx === channelIndex ? { ...c, label: value } : c)),
                            )
                          }}
                          placeholder="例如：广告投放"
                          disabled={isLoading || isSaving}
                          className="h-8 text-sm"
                        />
                      </div>

                      <Separator className="my-2" />

                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">二级渠道</p>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => handleAddChild(channelIndex)}
                          disabled={isLoading || isSaving}
                          className="h-6 w-6"
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>

                      {channel.children.length === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          暂无二级渠道。
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {channel.children.map((child, childIndex) => (
                            <div key={childIndex} className="grid grid-cols-[80px,1fr,auto] items-center gap-2 bg-muted/20 p-2 rounded">
                              <div className="space-y-1">
                                <Label className="text-[10px] font-bold text-muted-foreground uppercase" htmlFor={`child-key-${channelIndex}-${childIndex}`}>
                                  Key
                                </Label>
                                <Input
                                  id={`child-key-${channelIndex}-${childIndex}`}
                                  value={child.key}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    setChannels((prev) =>
                                      prev.map((c, idx) => {
                                        if (idx !== channelIndex) return c
                                        return {
                                          ...c,
                                          children: c.children.map((childItem, ci) =>
                                            ci === childIndex ? { ...childItem, key: value } : childItem,
                                          ),
                                        }
                                      }),
                                    )
                                  }}
                                  className="h-7 text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] font-bold text-muted-foreground uppercase" htmlFor={`child-label-${channelIndex}-${childIndex}`}>
                                  名称
                                </Label>
                                <Input
                                  id={`child-label-${channelIndex}-${childIndex}`}
                                  value={child.label}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    setChannels((prev) =>
                                      prev.map((c, idx) => {
                                        if (idx !== channelIndex) return c
                                        return {
                                          ...c,
                                          children: c.children.map((childItem, ci) =>
                                            ci === childIndex ? { ...childItem, label: value } : childItem,
                                          ),
                                        }
                                      }),
                                    )
                                  }}
                                  className="h-7 text-xs"
                                />
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive mt-4"
                                onClick={() => handleRemoveChild(channelIndex, childIndex)}
                                disabled={isLoading || isSaving}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>


        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "保存中..." : "保存配置"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
