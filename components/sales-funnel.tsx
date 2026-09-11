"use client"

import { useEffect, useState, useContext } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { fetchSalesFunnelCounts, type DashboardFilterParams } from "@/lib/services/dashboard"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import { MePermissionsContext } from "@/components/app-root"

interface SalesFunnelPoint {
  stage: string
  value: number
  fill: string
}

const FUNNEL_CONFIG = [
  { key: "all", label: "线索", fill: "#3b82f6" },
  { key: "uncontacted", label: "未建联", fill: "#60a5fa" },
  { key: "connected", label: "已建联", fill: "#93c5fd" },
  { key: "online_communication", label: "线上/电话沟通", fill: "#a5b4fc" },
  { key: "offline_visit", label: "线下拜访", fill: "#818cf8" },
  { key: "proposal_quotation", label: "方案及报价", fill: "#f59e0b" },
  { key: "proposal_negotiation", label: "方案谈判", fill: "#f97316" },
  { key: "intent_confirmed", label: "合作意向已确认", fill: "#fb923c" },
  { key: "contract_review", label: "审合同/合同推进", fill: "#f97316" },
  { key: "won", label: "成交", fill: "#22c55e" },
] as const

export function SalesFunnel() {
  const [data, setData] = useState<SalesFunnelPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const mePermissions = useContext(MePermissionsContext)

  useEffect(() => {
    let isMounted = true

    async function loadFunnel() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const supabase = getBrowserSupabaseClient()
        const profile = await fetchCurrentUserProfile(supabase)

        const scopeType = mePermissions?.leadScopeType ?? "self"
        const params: DashboardFilterParams = {}

        if (scopeType === "self") {
          if (profile?.id) {
            params.ownerId = profile.id
          }
        } else if (scopeType === "team") {
          if (profile?.teamId != null) {
            params.teamId = profile.teamId
          }
        }

        const { byStage } = await fetchSalesFunnelCounts(params)

        if (!isMounted) {
          return
        }

        const total = Object.values(byStage).reduce((sum, value) => sum + value, 0)

        const nextData: SalesFunnelPoint[] = FUNNEL_CONFIG.map((config) => {
          if (config.key === "all") {
            return {
              stage: config.label,
              value: total,
              fill: config.fill,
            }
          }

          const value = byStage[config.key] ?? 0

          return {
            stage: config.label,
            value,
            fill: config.fill,
          }
        })

        setData(nextData)
        setIsLoading(false)
      } catch (error) {
        console.error("Failed to load sales funnel data", error)
        if (!isMounted) {
          return
        }
        setLoadError("销售漏斗数据加载失败")
        setData([])
        setIsLoading(false)
      }
    }

    void loadFunnel()

    return () => {
      isMounted = false
    }
  }, [mePermissions])

  const hasData = data.some((item) => item.value > 0)

  return (
    <div className="space-y-4">
      <div className="h-[280px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            正在加载销售漏斗数据...
          </div>
        ) : !hasData ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            暂无可统计的线索数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 80, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="stage"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "#64748b" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                formatter={(value: number | undefined) => [`${value ?? 0} 条`, "线索数"]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span>早期阶段</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-amber-500" />
          <span>关键阶段</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>成交</span>
        </div>
      </div>
      {loadError && (
        <p className="text-[11px] text-center text-destructive/80">{loadError}</p>
      )}
    </div>
  )
}
