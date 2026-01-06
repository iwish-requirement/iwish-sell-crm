"use client"

import { useEffect, useState, useContext } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { MePermissionsContext } from "@/components/app-root"
import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import type { UserProfile } from "@/lib/auth/profile"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import type { DashboardFilterParams, RecentDealSummary } from "@/lib/services/dashboard"

interface RecentDealsCardProps {
  limit?: number
}

export function RecentDealsCard({ limit = 8 }: RecentDealsCardProps) {
  const [deals, setDeals] = useState<RecentDealSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const mePermissions = useContext(MePermissionsContext)
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadDeals() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const supabase = getBrowserSupabaseClient()

        let profile = currentProfile
        if (!profile) {
          profile = await fetchCurrentUserProfile(supabase)
          if (!isMounted) {
            return
          }
          setCurrentProfile(profile)
        }

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

        let query = supabase
          .from("leads_secure_view")
          .select(
            "id, team_id, owner_id, created_by, status, close_result, customer_name, name, budget, source, created_at",
          )
          .eq("status", "closed")

        if (params.teamId !== undefined) {
          query = query.eq("team_id", params.teamId)
        }

        if (params.ownerId) {
          query = query.eq("owner_id", params.ownerId)
        }

        const { data, error } = await query
          .in("close_result", ["won", "成交"]).order("created_at", { ascending: false }).limit(limit)

        if (error) {


          console.error("Failed to load recent deals", error)
          if (!isMounted) {
            return
          }
          setLoadError("近期成交数据加载失败")
          setDeals([])
          setIsLoading(false)
          return
        }

        const rows = (data ?? []) as any[]

        const baseDeals: RecentDealSummary[] = rows.map((row) => {


          const customerName = (row.customer_name as string | null) ?? "未命名客户"
          const companyName = (row.name as string | null) ?? customerName
          const budget = (row.budget as number | null) ?? 0
          const budgetLabel =
            budget && budget > 0
              ? new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: "CNY",
                  maximumFractionDigits: 0,
                }).format(budget)
              : "待确认"

          const sourceLabel = (row.source as string | null) ?? "未知来源"

          return {
            id: row.id as string,
            customerName,
            companyName,
            budget,
            budgetLabel,
            source: sourceLabel,
            createdAt: (row.created_at as string) ?? "",
            closedAt: null,
          }
        })

        const leadIds = baseDeals.map((deal) => deal.id)

        let enrichedDeals = baseDeals

        if (leadIds.length > 0) {
          try {
            const { data: contracts, error: contractsError } = await supabase
              .from("contracts_secure_view")
              .select("id, lead_id")
              .in("lead_id", leadIds)

            if (contractsError) {
              console.error("Failed to load contracts for recent deals", contractsError)
            } else if (contracts && contracts.length > 0) {
              const contractIdToLeadId = new Map<string, string>()
              const contractIds: string[] = []

              for (const row of contracts as any[]) {
                const contractId = row.id as string
                const leadId = row.lead_id as string
                contractIdToLeadId.set(contractId, leadId)
                contractIds.push(contractId)
              }

              if (contractIds.length > 0) {
                const { data: payments, error: paymentsError } = await supabase
                  .from("contract_payments_secure_view")
                  .select("contract_id, paid_at")
                  .in("contract_id", contractIds)
                  .order("paid_at", { ascending: true })

                if (paymentsError) {
                  console.error("Failed to load payments for recent deals", paymentsError)
                } else if (payments && payments.length > 0) {
                  const firstPaidAtByLeadId = new Map<string, string>()

                  for (const row of payments as any[]) {
                    const contractId = row.contract_id as string
                    const paidAt = row.paid_at as string | null
                    const leadId = contractIdToLeadId.get(contractId)
                    if (!leadId || !paidAt) continue
                    if (!firstPaidAtByLeadId.has(leadId)) {
                      firstPaidAtByLeadId.set(leadId, paidAt)
                    }
                  }

                  enrichedDeals = baseDeals.map((deal) => ({
                    ...deal,
                    closedAt: firstPaidAtByLeadId.get(deal.id) ?? null,
                  }))
                }
              }
            }
          } catch (paymentsErr) {
            console.error("Unexpected error while loading payments for recent deals", paymentsErr)
          }
        }

        if (!isMounted) {
          return
        }

        setDeals(enrichedDeals)
        setIsLoading(false)
      } catch (error) {

        console.error("Unexpected error while loading recent deals", error)
        if (!isMounted) {
          return
        }
        setLoadError("近期成交数据加载失败")
        setDeals([])
        setIsLoading(false)
      }
    }

    void loadDeals()

    return () => {
      isMounted = false
    }
  }, [mePermissions, limit])


  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>近期成交</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-3">
              <div className="space-y-1 flex-1">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>近期成交</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError && (
          <p className="text-xs text-destructive/80 mb-2">{loadError}</p>
        )}
        {!loadError && deals.length === 0 && (
          <p className="text-xs text-muted-foreground">最近还没有成交记录，继续加油推进在谈线索吧。</p>
        )}
        {deals.map((deal) => (
          <div
            key={deal.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
          >
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{deal.companyName}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {deal.customerName} · {deal.source}
              </p>
              <p className="text-[11px] text-muted-foreground">
                创建时间：
                <span className="font-medium text-foreground">
                  {deal.createdAt
                    ? new Date(deal.createdAt).toLocaleDateString("zh-CN")
                    : "--"}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                成交时间：
                <span className="font-medium text-foreground">
                  {deal.closedAt
                    ? new Date(deal.closedAt).toLocaleDateString("zh-CN")
                    : "尚未回款"}
                </span>
              </p>

            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-sm font-semibold text-primary">{deal.budgetLabel}</span>
              <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50">
                成交
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
