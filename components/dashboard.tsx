"use client"

import { useContext, useEffect, useState } from "react"
import { AlertTriangle, ArrowDown, ArrowUp, DollarSign, TrendingUp, Users } from "lucide-react"

import { MePermissionsContext } from "@/components/app-root"
import { RecentDealsCard } from "@/components/recent-deals-card"
import { SalesFunnel } from "@/components/sales-funnel"
import { ChartSkeleton, KPICardSkeleton, TableSkeleton } from "@/components/skeleton-loaders"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchCurrentUserProfile, fetchCurrentUserPublicProfile } from "@/lib/auth/profile"
import { fetchDashboardSummary } from "@/lib/services/dashboard"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

interface DashboardSummary {
  totalLeads: number
  winRate: number
  monthlyRevenue: number
  riskLeadCount: number
}

type DashboardCardKey = "totalLeads" | "winRate" | "monthlyRevenue" | "riskLeads"

interface DashboardCardDefinition {
  key: DashboardCardKey
  title: string
  icon: typeof Users
  color: string
  bgColor: string
  trend: "up" | "down"
}

const DASHBOARD_CARDS: DashboardCardDefinition[] = [
  {
    key: "totalLeads",
    title: "总线索数",
    icon: Users,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    trend: "up",
  },
  {
    key: "winRate",
    title: "转化率",
    icon: TrendingUp,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    trend: "up",
  },
  {
    key: "monthlyRevenue",
    title: "本月销售额",
    icon: DollarSign,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    trend: "up",
  },
  {
    key: "riskLeads",
    title: "风险线索",
    icon: AlertTriangle,
    color: "text-red-600",
    bgColor: "bg-red-50",
    trend: "down",
  },
]

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "¥0"
  }

  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatKpiValue(card: DashboardCardDefinition, summary: DashboardSummary | null): string {
  if (!summary) {
    return card.key === "winRate" ? "--" : "0"
  }

  if (card.key === "totalLeads") {
    return summary.totalLeads.toLocaleString("zh-CN")
  }

  if (card.key === "winRate") {
    return `${summary.winRate.toFixed(1)}%`
  }

  if (card.key === "monthlyRevenue") {
    return formatCurrency(summary.monthlyRevenue)
  }

  if (card.key === "riskLeads") {
    return summary.riskLeadCount.toString()
  }

  return "0"
}

function getBadgeVariant(card: DashboardCardDefinition): "default" | "destructive" {
  return card.key === "riskLeads" ? "destructive" : "default"
}

export function Dashboard() {
  const [isLoading, setIsLoading] = useState(true)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [welcomeText, setWelcomeText] = useState<string | null>(null)
  const mePermissions = useContext(MePermissionsContext)

  useEffect(() => {
    let isMounted = true

    async function loadSummary() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const supabase = getBrowserSupabaseClient()
        const profile = await fetchCurrentUserProfile(supabase)

        const scopeType = mePermissions?.leadScopeType ?? "self"
        const params: { teamId?: number; ownerId?: string } = {}

        if (scopeType === "self" && profile?.id) {
          params.ownerId = profile.id
        } else if (scopeType === "team" && profile?.teamId != null) {
          params.teamId = profile.teamId
        }

        const nextSummary = await fetchDashboardSummary(params)

        if (!isMounted) {
          return
        }

        setSummary(nextSummary)
        setIsLoading(false)
      } catch (error) {
        console.error("Failed to load dashboard summary", error)
        if (!isMounted) {
          return
        }
        setLoadError("仪表盘数据加载失败，请稍后重试。")
        setIsLoading(false)
      }
    }

    void loadSummary()

    return () => {
      isMounted = false
    }
  }, [mePermissions])

  useEffect(() => {
    let isMounted = true

    async function loadWelcomeText() {
      try {
        const supabase = getBrowserSupabaseClient()
        const publicProfile = await fetchCurrentUserPublicProfile(supabase)

        let displayName = "伙伴"

        if (publicProfile) {
          displayName = publicProfile.fullName || publicProfile.email || displayName
        }

        let template = "欢迎回来，{fullName}。以下是您的销售概览。"

        try {
          const { data: settingsRows, error: settingsError } = await supabase
            .from("settings")
            .select("key, value")
            .eq("key", "dashboard.welcome_template")
            .limit(1)

          if (!settingsError && settingsRows && settingsRows.length > 0) {
            const row = settingsRows[0] as any
            const raw = row.value as any
            if (raw && typeof raw === "object") {
              if (typeof raw.template === "string" && raw.template.trim()) {
                template = raw.template as string
              }
              if (!publicProfile && typeof raw.fallback_name === "string" && raw.fallback_name.trim()) {
                displayName = raw.fallback_name as string
              }
            }
          }
        } catch (settingsErr) {
          console.error("Failed to load dashboard welcome template from settings", settingsErr)
        }

        const finalText = template.replace("{fullName}", displayName)

        if (isMounted) {
          setWelcomeText(finalText)
        }
      } catch (err) {
        console.error("Unexpected error while building dashboard welcome text", err)
        if (isMounted) {
          setWelcomeText("欢迎回来，以下是您的销售概览。")
        }
      }
    }

    void loadWelcomeText()

    return () => {
      isMounted = false
    }
  }, [])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">仪表盘</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">正在同步销售概览数据...</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KPICardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartSkeleton />
          <TableSkeleton rows={4} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight">仪表盘</h1>
        <p className="mt-1 text-base font-medium text-foreground/70">
          {welcomeText ?? "欢迎回来，以下是您的销售概览。"}
        </p>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          仪表盘部分数据暂时无法加载，请稍后重试。
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DASHBOARD_CARDS.map((card) => (
          <Card key={card.key} className="group overflow-hidden border-muted-foreground/10 shadow-sm transition-shadow hover:shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className={`rounded-xl p-3 shadow-inner transition-transform group-hover:scale-110 ${card.bgColor}`}>
                  <card.icon className={`h-6 w-6 ${card.color}`} />
                </div>
                <Badge variant={getBadgeVariant(card)} className="flex items-center gap-1 rounded-full px-2 py-0.5 font-bold">
                  {card.trend === "up" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  <span className="text-[10px] uppercase tracking-wider">{summary ? "实时" : "同步"}</span>
                </Badge>
              </div>
              <div className="mt-5">
                <p className="text-3xl font-bold tracking-tight text-foreground">{formatKpiValue(card, summary)}</p>
                <p className="mt-1 text-sm font-bold uppercase tracking-widest text-muted-foreground">{card.title}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="border-b border-muted/30 pb-4">
            <CardTitle className="text-lg font-bold tracking-tight">销售漏斗概览</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <SalesFunnel />
          </CardContent>
        </Card>

        <div className="h-full">
          <RecentDealsCard />
        </div>
      </div>
    </div>
  )
}
