"use client"

import { useState, useEffect, useContext } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, TrendingUp, DollarSign, AlertTriangle, ArrowUp, ArrowDown } from "lucide-react"
import { SalesFunnel } from "@/components/sales-funnel"
import { RecentActivityTable } from "@/components/recent-activity-table"
import { KPICardSkeleton, ChartSkeleton, TableSkeleton } from "@/components/skeleton-loaders"
import { fetchDashboardSummary } from "@/lib/services/dashboard"
import { RecentDealsCard } from "@/components/recent-deals-card"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { MePermissionsContext } from "@/components/app-root"
import { fetchCurrentUserProfile } from "@/lib/auth/profile"

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
    if (card.key === "winRate") {
      return "--"
    }
    return "0"
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
  if (card.key === "riskLeads") {
    return "destructive"
  }

  return "default"
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

        if (scopeType === "self") {
          if (profile?.id) {
            params.ownerId = profile.id
          }
        } else if (scopeType === "team") {
          if (profile?.teamId != null) {
            params.teamId = profile.teamId
          }
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
        setLoadError("仪表盘数据加载失败，请稍后重试")
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
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) {
          console.error("Failed to get auth user for dashboard welcome text", userError)
        }

        let displayName = "伙伴"

        if (user) {
          displayName = user.email ?? displayName

          try {
            const { data: profile, error: profileError } = await supabase
              .from("profiles_public")
              .select("full_name")
              .eq("id", user.id)
              .single()

            if (!profileError && profile && (profile.full_name as string | null)) {
              displayName = profile.full_name as string
            }
          } catch (profileErr) {
            console.error("Failed to load profile for dashboard welcome text", profileErr)
          }
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
              if (!user && typeof raw.fallback_name === "string" && raw.fallback_name.trim()) {
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
          <h1 className="text-2xl font-semibold text-foreground">仪表盘</h1>
          <p className="text-muted-foreground">加载中...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KPICardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton />
          <TableSkeleton rows={4} />
        </div>
      </div>
    )
  }

  const showErrorBanner = !!loadError

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">仪表盘</h1>
        <p className="text-muted-foreground">
          {welcomeText ?? "欢迎回来，以下是您的销售概览。"}
        </p>
      </div>

      {showErrorBanner ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          仪表盘部分数据暂时无法加载，请稍后重试。
        </div>
      ) : null}

      {/* KPI Cards - responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {DASHBOARD_CARDS.map((card) => (
          <Card key={card.key}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className={`p-3 rounded-lg ${card.bgColor}`}>
                  <card.icon className={`w-5 h-5 ${card.color}`} />
                </div>
                <Badge variant={getBadgeVariant(card)} className="flex items-center gap-1">
                  {card.trend === "up" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  <span>{summary ? "实时" : "加载中"}</span>
                </Badge>
              </div>
              <div className="mt-4">
                <p className="text-2xl font-bold text-foreground">{formatKpiValue(card, summary)}</p>
                <p className="text-sm text-muted-foreground">{card.title}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Funnel */}
        <Card>
          <CardHeader>
            <CardTitle>销售漏斗</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesFunnel />
          </CardContent>
        </Card>

        {/* Recent Deals */}
        <div>
          <RecentDealsCard />
        </div>
      </div>
    </div>
  )
}
