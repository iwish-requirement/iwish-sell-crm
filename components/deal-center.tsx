"use client"

import { useContext, useEffect, useMemo, useState } from "react"
import { DealContractSubmissionDialog } from "@/components/deal-contract-submission"
import { DealHistory } from "@/components/deal-history"
import { ServiceDepartmentAllocation } from "@/components/service-department-allocation"
import { useDepartmentAllocationRelease } from "@/hooks/use-department-allocation-release"
import { loadDepartmentAllocationLeadStates, type LeadDepartmentState } from "@/lib/services/department-allocation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDealDate } from "@/lib/services/deal-date"
import { DollarSign, Search } from "lucide-react"
import { toast } from "sonner"


import { MePermissionsContext } from "@/components/app-root"

import { getBrowserSupabaseClient } from "@/lib/supabase/client"

import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import type { UserProfile } from "@/lib/auth/profile"
import type { LeadSecureRow, LeadSecureQueryParams } from "@/lib/services/leads"
import { fetchLeadsSecureView } from "@/lib/services/leads"
import type { ContractRow, ContractPaymentRow } from "@/lib/services/contracts"
import { fetchContractByLeadId, upsertContractForLead, fetchContractPayments } from "@/lib/services/contracts"




interface DealRow {
  id: string
  customerName: string
  companyName: string
  source: string
  budget: number
  budgetLabel: string
  createdAt: string
  closedAt: string | null
  closeResult: string
  awaitingSignature: boolean
  closeReason: string | null
  ownerId: string | null
  teamId: number | null
  ownerName: string | null
  allocationStatus: string | null
}

interface TeamOption {
  id: number
  name: string
}

const TIME_FILTER_OPTIONS = [


  { value: "30d", label: "最近 30 天" },
  { value: "90d", label: "最近 90 天" },
  { value: "365d", label: "最近一年" },
  { value: "all", label: "全部时间" },
] as const

function normalizeCurrency(value: string | null | undefined): string {
  const currency = (value ?? "").trim().toUpperCase()
  return /^[A-Z]{3}$/.test(currency) ? currency : "CNY"
}

export function DealCenter() {
  const permissions = useContext(MePermissionsContext)
  const { cutoff } = useDepartmentAllocationRelease()
  const [view, setView] = useState<"current" | "history" | "pending">("current")

  return (
    <div className="space-y-4">
      {permissions?.canReadContracts && (
        <nav aria-label="成交中心视图" className="flex flex-wrap gap-2">
          <Button variant={view === "current" ? "default" : "outline"} size="sm" aria-pressed={view === "current"}
            onClick={() => setView("current")}>成交明细</Button>
          <Button variant={view === "history" ? "default" : "outline"} size="sm" aria-pressed={view === "history"}
            onClick={() => setView("history")}>历史成交</Button>
          {cutoff && <Button variant={view === "pending" ? "default" : "outline"} size="sm" aria-pressed={view === "pending"}
            onClick={() => setView("pending")}>待补合同资料</Button>}
        </nav>
      )}
      {view === "history" && permissions?.canReadContracts ? <DealHistory allocationCutoff={cutoff} />
        : view === "pending" && cutoff && permissions?.canReadContracts ? <ServiceDepartmentAllocation pending cutoff={cutoff} />
          : <CurrentDealCenter allocationCutoff={cutoff} />}
    </div>
  )
}

function CurrentDealCenter({ allocationCutoff }: { allocationCutoff: string | null }) {
  const mePermissions = useContext(MePermissionsContext)
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null)
  const [timeFilter, setTimeFilter] = useState<string>("90d")
  const [departmentStates, setDepartmentStates] = useState<Record<string, LeadDepartmentState>>({})
  const [departmentRefresh, setDepartmentRefresh] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deals, setDeals] = useState<DealRow[]>([])
  useEffect(() => {
    if (!allocationCutoff || !deals.length) return
    let active = true
    loadDepartmentAllocationLeadStates(deals.map(deal => deal.id)).then(
      states => { if (active) setDepartmentStates(states) },
      () => { if (active) setDepartmentStates({}) },
    )
    return () => { active = false }
  }, [allocationCutoff, deals, departmentRefresh])
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null)
  // 追加合同：建好子线索后重新拉成交列表，选中新的那条并打开合同资料
  const [dealsRefresh, setDealsRefresh] = useState(0)
  const [addonPendingId, setAddonPendingId] = useState<string | null>(null)
  const [isCreatingAddon, setIsCreatingAddon] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isSubmissionOpen, setIsSubmissionOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState<string>("all")
  const [sortOption, setSortOption] = useState<string>("recent")
  const [viewScope, setViewScope] = useState<string>("mine")
  const [viewScopeTouched, setViewScopeTouched] = useState(false)
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([])



  const [selectedContract, setSelectedContract] = useState<ContractRow | null>(null)
  const [isContractLoading, setIsContractLoading] = useState(false)
  const [isContractDialogOpen, setIsContractDialogOpen] = useState(false)
  const [contractPayments, setContractPayments] = useState<ContractPaymentRow[]>([])
  const [isPaymentsLoading, setIsPaymentsLoading] = useState(false)

  const [contractNumberInput, setContractNumberInput] = useState("")
  const [contractTitleInput, setContractTitleInput] = useState("")
  const [contractAmountInput, setContractAmountInput] = useState("")
  const [contractCurrencyInput, setContractCurrencyInput] = useState("CNY")
  const [contractSignedAtInput, setContractSignedAtInput] = useState("")
  const [contractStartDateInput, setContractStartDateInput] = useState("")
  const [contractEndDateInput, setContractEndDateInput] = useState("")
  const [contractIsRenewalInput, setContractIsRenewalInput] = useState(false)
  const canManageContracts = mePermissions?.canManageContracts ?? false
  const canReadContracts = mePermissions?.canReadContracts ?? false
  const isPermissionsLoading = mePermissions === null



  const sourceOptions = useMemo(() => {



    const sources = new Set<string>()
    deals.forEach((deal) => {
      if (deal.source) {
        sources.add(deal.source)
      }
    })
    return Array.from(sources).sort()
  }, [deals])

  const leadScopeType = mePermissions?.leadScopeType ?? "self"

  useEffect(() => {
    if (viewScopeTouched) {
      return
    }

    if (leadScopeType === "self") {
      setViewScope("mine")
    } else {
      setViewScope("all")
    }
  }, [leadScopeType, viewScopeTouched])



  useEffect(() => {
    let isMounted = true

    async function loadDeals() {

      if (!canReadContracts) {
        setIsLoading(false)
        setLoadError("no-permission")
        setDeals([])
        return
      }

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


        const params: LeadSecureQueryParams = { status: "closed" }

        if (scopeType === "self") {
          if (profile?.id) {
            params.ownerId = profile.id
          }
        } else if (scopeType === "team") {
          if (profile?.teamId != null) {
            params.teamId = profile.teamId
          }
        }

        const [
          rows,
          { data: teamRows, error: teamsError },
          { data: exclusionRow, error: exclusionError },
        ] = await Promise.all([
          fetchLeadsSecureView(params),
          supabase.from("teams").select("id, name").order("name", { ascending: true }),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "analytics.excluded_teams")
            .maybeSingle(),
        ])

        if (teamsError) {
          console.error("Failed to load teams for deal center view scope", teamsError)
        }
        if (exclusionError && exclusionError.code !== "PGRST116") {
          console.error("Failed to load analytics excluded teams for deal center scopes", exclusionError)
        }

        if (teamRows && !teamsError && isMounted) {
          const rawTeams = teamRows as any[]

          const excludedTeamIds = new Set<number>(
            exclusionRow && (exclusionRow as any).value &&
            Array.isArray(((exclusionRow as any).value as any).team_ids)
              ? (((exclusionRow as any).value as any).team_ids as any[]).filter(
                  (v: any) => typeof v === "number",
                )
              : [],
          )

          const availableTeams: TeamOption[] = rawTeams
            .filter((team) => !excludedTeamIds.has(team.id as number))
            .map((team) => ({
              id: team.id as number,
              name: (team.name as string | null) ?? `团队 #${team.id}`,
            }))

          if (scopeType === "team") {
            const myTeamId = profile?.teamId ?? null
            setTeamOptions(
              myTeamId != null ? availableTeams.filter((team) => team.id === myTeamId) : [],
            )
          } else if (scopeType === "org" || scopeType === "custom") {
            setTeamOptions(availableTeams)
          } else {
            setTeamOptions([])
          }
        }


        if (!isMounted) {
          return
        }

        const closedWonRows = rows.filter((row) => {

          const status = (row.status ?? "").trim()
          const result = (row.close_result ?? "").trim()
          return status === "closed" && (result === "won" || result === "成交")
        })


        const mapped: DealRow[] = closedWonRows.map((row: LeadSecureRow) => {
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
          const closeResult = (row.close_result as string | null) ?? "won"
          const closeReason = (row.close_reason as string | null) ?? null

          return {
            id: row.id,
            customerName,
            companyName,
            source: sourceLabel,
            budget,
            budgetLabel,
            createdAt: row.created_at,
            closedAt: null,
            closeResult,
            awaitingSignature: row.follow_up_stage === "contract_review",
            closeReason,
            ownerId: (row.owner_id as string | null) ?? null,
            teamId: (row.team_id as number | null) ?? null,
            ownerName: null,
            allocationStatus: row.allocation_status ?? "pending",
          }
        })

        const leadIds = mapped.map((deal) => deal.id)
        let enrichedDeals = mapped

        if (leadIds.length > 0) {
          try {
            const { data: contracts, error: contractsError } = await supabase
              .from("contracts_secure_view")
              .select("id, lead_id, amount, currency")
              .in("lead_id", leadIds)

            if (contractsError) {
              console.error("Failed to load contracts for deal center", contractsError)
            } else if (contracts && contracts.length > 0) {
              const contractIdToLeadId = new Map<string, string>()
              const contractIds: string[] = []
              const amountByLeadId = new Map<string, number>()

              for (const row of contracts as any[]) {
                const contractId = row.id as string
                const leadId = row.lead_id as string
                const contractAmount = (row.amount as number | null) ?? 0

                if (contractId && leadId) {
                  contractIdToLeadId.set(contractId, leadId)
                  contractIds.push(contractId)

                  if (contractAmount > 0) {
                    amountByLeadId.set(
                      leadId,
                      (amountByLeadId.get(leadId) ?? 0) + contractAmount,
                    )
                  }
                }
              }

              let firstPaidAtByLeadId: Map<string, string> | null = null

              if (contractIds.length > 0) {
                const { data: payments, error: paymentsError } = await supabase
                  .from("contract_payments_secure_view")
                  .select("contract_id, paid_at")
                  .in("contract_id", contractIds)
                  .order("paid_at", { ascending: true })

                if (paymentsError) {
                  console.error("Failed to load payments for deal center", paymentsError)
                } else if (payments && payments.length > 0) {
                  firstPaidAtByLeadId = new Map<string, string>()

                  for (const row of payments as any[]) {
                    const contractId = row.contract_id as string
                    const paidAt = row.paid_at as string | null
                    const leadId = contractIdToLeadId.get(contractId)
                    if (!leadId || !paidAt) continue
                    if (!firstPaidAtByLeadId.has(leadId)) {
                      firstPaidAtByLeadId.set(leadId, paidAt)
                    }
                  }
                }
              }

              enrichedDeals = mapped.map((deal) => {
                const contractAmount = amountByLeadId.get(deal.id)
                const effectiveBudget = contractAmount && contractAmount > 0 ? contractAmount : deal.budget
                const effectiveBudgetLabel =
                  effectiveBudget && effectiveBudget > 0
                    ? new Intl.NumberFormat("zh-CN", {
                        style: "currency",
                        currency: "CNY",
                        maximumFractionDigits: 0,
                      }).format(effectiveBudget)
                    : deal.budgetLabel

                return {
                  ...deal,
                  budget: effectiveBudget,
                  budgetLabel: effectiveBudgetLabel,
                  closedAt: firstPaidAtByLeadId ? firstPaidAtByLeadId.get(deal.id) ?? deal.closedAt : deal.closedAt,
                }
              })
            }
          } catch (paymentsErr) {
            console.error("Unexpected error while loading payments for deal center", paymentsErr)
          }
        }


        const ownerIds = Array.from(
          new Set(
            enrichedDeals
              .map((deal) => deal.ownerId)
              .filter((id): id is string => Boolean(id)),
          ),
        )

        let dealsWithOwner = enrichedDeals

        if (ownerIds.length > 0) {
          const { data: profiles, error: profilesError } = await supabase
            .from("profiles_public")
            .select("id, full_name")
            .in("id", ownerIds)

          if (profilesError) {
            console.error("Failed to load owners for deals", profilesError)
          } else if (profiles && profiles.length > 0) {
            const nameById: Record<string, string> = {}
            for (const row of profiles as any[]) {
              const id = row.id as string
              const fullName = (row.full_name as string | null) ?? null
              if (id && fullName) {
                nameById[id] = fullName
              }
            }

            dealsWithOwner = enrichedDeals.map((deal) => ({
              ...deal,
              ownerName: deal.ownerId ? nameById[deal.ownerId] ?? null : null,
            }))
          }
        }

        dealsWithOwner.sort((a, b) => {
          const aDate = a.closedAt ?? a.createdAt
          const bDate = b.closedAt ?? b.createdAt
          return new Date(bDate).getTime() - new Date(aDate).getTime()
        })

        setDeals(dealsWithOwner)


        setIsLoading(false)
      } catch (error) {
        console.error("Failed to load deals for deal center", error)
        if (!isMounted) {
          return
        }
        setLoadError("成交数据加载失败，请稍后重试")
        setDeals([])
        setIsLoading(false)
      }
    }

    void loadDeals()

    return () => {
      isMounted = false
    }
  }, [mePermissions, currentProfile, canReadContracts, dealsRefresh])

  // 选中成交时加载合同信息

  useEffect(() => {
    let isMounted = true

    async function loadContractAndPayments() {
      if (!selectedDeal) {
        setSelectedContract(null)
        setContractPayments([])
        return
      }

      setSelectedContract(null)
      setContractPayments([])
      setIsContractLoading(true)
      setIsPaymentsLoading(false)
      let contract: ContractRow | null = null
      try {
        contract = await fetchContractByLeadId(selectedDeal.id)
      } catch (error) {
        // A missing/temporarily unavailable contract must not take down the
        // whole client route. The detail view can still show the deal data.
        console.error("Failed to load contract for selected deal", error)
      }
      if (!isMounted) return
      setSelectedContract(contract)
      setIsContractLoading(false)

      if (!contract) {
        setContractPayments([])
        return
      }

      setIsPaymentsLoading(true)
      try {
        const payments = await fetchContractPayments(contract.id)
        if (!isMounted) return
        setContractPayments(payments)
      } catch (error) {
        console.error("Failed to load contract payments", error)
        if (!isMounted) return
        setContractPayments([])
      }
      setIsPaymentsLoading(false)
    }

    void loadContractAndPayments()

    return () => {
      isMounted = false
    }
  }, [selectedDeal])

  useEffect(() => {
    if (!addonPendingId) return
    const created = deals.find(deal => deal.id === addonPendingId)
    if (!created) return
    setSelectedDeal(created)
    setAddonPendingId(null)
    setIsSubmissionOpen(true)
  }, [addonPendingId, deals])

  async function createAddonContract(parent: DealRow) {
    setIsCreatingAddon(true)
    try {
      const { data, error } = await getBrowserSupabaseClient().rpc("rpc_deal_addon_create", { p_parent_id: parent.id })
      if (error || !data) throw error ?? new Error("no id")
      toast.success("已建追加合同", { description: "请填写这份合同的编号、服务板块和金额，再分配部门。" })
      setAddonPendingId(String(data))
      setDealsRefresh(value => value + 1)
    } catch (error) {
      const message = String((error as { message?: string })?.message ?? "")
      toast.error("追加合同失败", {
        description: message.includes("ERR_NO_PERMISSION") ? "只有负责销售或有合同管理权限的人能追加合同。" : "请稍后重试。",
      })
    } finally {
      setIsCreatingAddon(false)
    }
  }



  const filteredDeals = useMemo(() => {
    let result = deals

    const profileId = currentProfile?.id ?? null

    if (viewScope === "mine" && profileId) {
      result = result.filter((deal) => deal.ownerId === profileId)
    } else if (viewScope.startsWith("team:")) {
      const rawTeamId = viewScope.slice("team:".length)
      const teamId = Number(rawTeamId)
      if (!Number.isNaN(teamId)) {
        result = result.filter((deal) => deal.teamId === teamId)
      }
    }


    if (timeFilter !== "all") {

      const now = new Date()
      let days = 90

      if (timeFilter === "30d") {
        days = 30
      } else if (timeFilter === "365d") {
        days = 365
      }

      const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

      result = result.filter((deal) => {
        const baseDateStr = deal.closedAt ?? deal.createdAt
        if (!baseDateStr) {
          return false
        }
        const baseDate = new Date(baseDateStr)
        return baseDate >= threshold
      })
    }


    if (sourceFilter !== "all") {
      result = result.filter((deal) => deal.source === sourceFilter)
    }

    if (searchQuery.trim()) {
      const keyword = searchQuery.trim().toLowerCase()
      result = result.filter((deal) => {
        return (
          deal.companyName.toLowerCase().includes(keyword) ||
          deal.customerName.toLowerCase().includes(keyword) ||
          deal.source.toLowerCase().includes(keyword)
        )
      })
    }

    if (sortOption === "amount_desc") {
      result = [...result].sort((a, b) => (b.budget || 0) - (a.budget || 0))
    } else if (sortOption === "amount_asc") {
      result = [...result].sort((a, b) => (a.budget || 0) - (b.budget || 0))
    } else {
      // recent by closedAt (if exists) or createdAt desc
      result = [...result].sort((a, b) => {
        const aDate = a.closedAt ?? a.createdAt
        const bDate = b.closedAt ?? b.createdAt
        return new Date(bDate).getTime() - new Date(aDate).getTime()
      })
    }


    return result
  }, [deals, timeFilter, sourceFilter, searchQuery, sortOption, viewScope, currentProfile])




  const stats = useMemo(() => {
    const signedDeals = filteredDeals.filter((deal) => !deal.awaitingSignature)
    const count = signedDeals.length
    const totalBudget = signedDeals.reduce((sum, deal) => sum + (deal.budget || 0), 0)

    const totalBudgetLabel =
      totalBudget && totalBudget > 0
        ? new Intl.NumberFormat("zh-CN", {
            style: "currency",
            currency: "CNY",
            maximumFractionDigits: 0,
          }).format(totalBudget)
        : "¥0"

    const avgBudget = count > 0 ? Math.round(totalBudget / count) : 0
    const avgBudgetLabel =
      avgBudget && avgBudget > 0
        ? new Intl.NumberFormat("zh-CN", {
            style: "currency",
            currency: "CNY",
            maximumFractionDigits: 0,
          }).format(avgBudget)
        : "¥0"

    return { count, totalBudget, totalBudgetLabel, avgBudget, avgBudgetLabel }
  }, [filteredDeals])

  const firstPaymentDate = useMemo(() => {
    if (selectedContract?.leadId !== selectedDeal?.id || contractPayments.length === 0) {
      return null
    }
    const sorted = [...contractPayments].filter((p) => !!p.paidAt).sort((a, b) => {
      return new Date(a.paidAt ?? "1970-01-01").getTime() - new Date(b.paidAt ?? "1970-01-01").getTime()
    })
    return sorted.length > 0 ? sorted[0].paidAt : null
  }, [contractPayments, selectedContract?.leadId, selectedDeal?.id])

  if (isPermissionsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">成交中心</h1>
        <p className="text-sm text-muted-foreground">正在加载当前账号权限，请稍候...</p>
      </div>
    )
  }

  if (!canReadContracts) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">成交中心</h1>
        <p className="text-sm text-muted-foreground">
          当前账号无权访问成交中心。如需调整合同相关权限，请联系系统管理员后重试访问。
        </p>
      </div>
    )
  }

  return (


    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">

        <div>
          <h1 className="text-2xl font-bold text-foreground">成交中心</h1>
          <p className="text-sm text-muted-foreground mt-1">
            汇总查看当前范围内的成交机会，按时间维度快速回顾成交节奏与金额。
          </p>
        </div>

        <div className="flex items-center gap-3">
          {(leadScopeType === "team" || leadScopeType === "org" || leadScopeType === "custom") && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">视角</span>
              <Select
                value={viewScope}
                onValueChange={(value) => {
                  setViewScope(value)
                  setViewScopeTouched(true)
                }}
              >
                <SelectTrigger className="h-8 w-full sm:w-[190px] text-xs">
                  <SelectValue placeholder="选择视角" className="truncate" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="mine">我的成交</SelectItem>
                  {(leadScopeType === "team" || leadScopeType === "org" || leadScopeType === "custom") &&
                    teamOptions.map((team) => (
                      <SelectItem key={team.id} value={`team:${team.id}`}>
                        {team.name}
                      </SelectItem>
                    ))}
                  {(leadScopeType === "team" || leadScopeType === "org" || leadScopeType === "custom") && (
                    <SelectItem value="all">全部可见（当前权限）</SelectItem>
                  )}
                </SelectContent>


              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">时间范围</span>
            <Select value={timeFilter} onValueChange={setTimeFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[140px] text-sm">
                <SelectValue placeholder="选择时间范围" className="truncate" />
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
      </div>


      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">成交笔数</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p className="text-2xl font-semibold text-foreground">{stats.count}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">成交金额汇总</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <p className="text-2xl font-semibold text-primary">{stats.totalBudgetLabel}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">平均客单价</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <p className="text-2xl font-semibold text-foreground">{stats.avgBudgetLabel}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base font-bold text-foreground">成交明细</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="h-9 pl-9 text-sm"
                  placeholder="搜索客户、公司或来源"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="h-9 w-full sm:w-[140px] text-sm">
                    <SelectValue placeholder="来源筛选" className="truncate" />
                  </SelectTrigger>


                  <SelectContent>
                    <SelectItem value="all">全部来源</SelectItem>
                    {sourceOptions.map((source) => (
                      <SelectItem key={source} value={source}>
                        {source}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortOption} onValueChange={setSortOption}>
                  <SelectTrigger className="h-9 w-full sm:w-[200px] text-sm">
                    <SelectValue placeholder="排序" className="truncate" />
                  </SelectTrigger>


                  <SelectContent>
                    <SelectItem value="recent">按成交时间（最近优先）</SelectItem>
                    <SelectItem value="amount_desc">按成交金额（从高到低）</SelectItem>
                    <SelectItem value="amount_asc">按成交金额（从低到高）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive/80">{loadError}</p>
          ) : filteredDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前筛选条件下暂无成交记录。</p>
          ) : (
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap text-xs font-semibold">成交日期</TableHead>
                    <TableHead className="whitespace-nowrap text-xs font-semibold">客户全称</TableHead>
                    <TableHead className="whitespace-nowrap text-xs font-semibold">来源</TableHead>
                    <TableHead className="whitespace-nowrap text-xs font-semibold">销售人员</TableHead>
                    <TableHead className="whitespace-nowrap text-right text-xs font-semibold">成交金额</TableHead>
                    <TableHead className="whitespace-nowrap text-xs font-semibold">{allocationCutoff ? "分配进度" : "项目组状态"}</TableHead>
                  </TableRow>

                </TableHeader>
                <TableBody>
                  {filteredDeals.map((deal) => (
                    <TableRow
                      key={deal.id}
                      className="text-sm cursor-pointer hover:bg-accent/40"
                      onClick={() => {
                        setSelectedDeal(deal)
                        setIsDetailOpen(true)
                      }}
                    >

                      <TableCell className="whitespace-nowrap">
                        {(deal.closedAt ?? deal.createdAt)
                          ? formatDealDate(deal.closedAt ?? deal.createdAt)
                          : "--"}
                      </TableCell>

                      <TableCell className="min-w-[180px]">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground truncate">{deal.companyName}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {deal.customerName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="outline" className="text-[11px]">
                          {deal.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {deal.ownerName ?? "未分配"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap text-primary font-bold">
                        {deal.budgetLabel}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={(allocationCutoff ? departmentStates[deal.id] : deal.allocationStatus) === "assigned" ? "default" : "secondary"}>
                          {allocationCutoff
                            ? departmentStates[deal.id] === "assigned" ? "已分配部门" : departmentStates[deal.id] === "ready"
                              ? "待分配部门" : departmentStates[deal.id] === "needs_contract" ? "待补合同资料" : "—"
                            : deal.allocationStatus === "assigned" ? "已分配项目组" : "待分配项目组"}
                        </Badge>
                      </TableCell>


                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <SheetContent className="w-full sm:w-[480px] sm:max-w-[540px] overflow-y-auto p-0">

          {selectedDeal && (
            <div className="flex flex-col h-full">
              <SheetHeader className="space-y-4 p-6 pt-12 border-b">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <DollarSign className="w-6 h-6 text-primary" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <SheetTitle className="text-left text-xl font-bold truncate">{selectedDeal.companyName}</SheetTitle>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedDeal.customerName} · {selectedDeal.source}
                      {selectedDeal.ownerName ? ` · 销售人员 ${selectedDeal.ownerName}` : ""}
                    </p>

                  </div>
                </div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">



                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">创建时间</p>
                    <p className="font-semibold text-foreground">
                      {selectedDeal.createdAt
                        ? formatDealDate(selectedDeal.createdAt)
                        : "--"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground" title="首笔回款">实际到款时间</p>
                    <p className="font-semibold text-foreground">
                      {firstPaymentDate
                        ? formatDealDate(firstPaymentDate)
                        : "尚未回款"}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">成交金额</p>
                    <p className="font-bold text-primary text-base">{selectedDeal.budgetLabel}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">来源渠道</p>
                    <Badge variant="outline" className="text-[11px]">
                      {selectedDeal.source}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">成交结果</p>
                    <p className="font-semibold text-foreground">
                      {selectedDeal.awaitingSignature ? "待签约" : selectedDeal.closeResult === "won" || selectedDeal.closeResult === "成交" ? "成交" : "关闭"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">销售人员</p>
                    <p className="font-semibold text-foreground">
                      {selectedDeal.ownerName ?? "未分配"}
                    </p>
                  </div>

                  {selectedDeal.closeReason && (
                    <div className="space-y-1 col-span-2">
                      <p className="text-xs text-muted-foreground">成交备注 / 关闭原因</p>
                      <p className="text-xs text-foreground break-words">{selectedDeal.closeReason}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button type="button" onClick={() => setIsSubmissionOpen(true)}>合同资料提交</Button>
                  <Button type="button" variant="outline" disabled={isCreatingAddon || selectedDeal.awaitingSignature} onClick={() => void createAddonContract(selectedDeal)}>
                    {isCreatingAddon ? "正在建追加合同…" : "追加合同"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">老客户再签合同（二次开发 / 加服务）可点「追加合同」，填写编号、服务板块和金额，确认签约后再分配部门。</p>



              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {selectedDeal && (
        <DealContractSubmissionDialog key={selectedDeal.id}
          leadId={selectedDeal.id} companyName={selectedDeal.companyName} salesperson={selectedDeal.ownerName}
          onConfirmed={() => {
            setSelectedDeal((current) => current ? { ...current, awaitingSignature: false } : current)
            setDealsRefresh((value) => value + 1)
            setDepartmentRefresh((value) => value + 1)
          }}
          open={isSubmissionOpen} onOpenChange={open => {
            setIsSubmissionOpen(open)
            if (!open && allocationCutoff) setDepartmentRefresh(value => value + 1)
          }}>
          <details className="border-t pt-4">
            <summary className="cursor-pointer text-sm font-semibold">已有合同与回款记录</summary>
          <div className="space-y-3 pt-4 border-t border-border/60 mt-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground uppercase tracking-wider">合同信息</p>
              {canManageContracts && selectedDeal && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => {

                    if (selectedContract) {
                      setContractNumberInput(selectedContract.contractNumber)
                      setContractTitleInput(selectedContract.title ?? "")
                      setContractAmountInput(String(selectedContract.amount ?? ""))
                      setContractCurrencyInput(selectedContract.currency || "CNY")
                      setContractSignedAtInput(
                        selectedContract.signedAt
                          ? new Date(selectedContract.signedAt).toISOString().slice(0, 10)
                          : "",
                      )
                      setContractStartDateInput(
                        selectedContract.startDate
                          ? new Date(selectedContract.startDate).toISOString().slice(0, 10)
                          : "",
                      )
                      setContractEndDateInput(
                        selectedContract.endDate
                          ? new Date(selectedContract.endDate).toISOString().slice(0, 10)
                          : "",
                      )
                      setContractIsRenewalInput(Boolean(selectedContract.isRenewal))
                    } else {
                      setContractNumberInput("")
                      setContractTitleInput("")
                      setContractAmountInput("")
                      setContractCurrencyInput("CNY")
                      setContractSignedAtInput("")
                      setContractStartDateInput("")
                      setContractEndDateInput("")
                      setContractIsRenewalInput(false)
                    }
                    setIsContractDialogOpen(true)
                  }}
                >
                  {selectedContract ? "编辑合同" : "新增合同"}
                </Button>
              )}
            </div>
            {isContractLoading ? (

              <div className="space-y-2 text-sm">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : !selectedContract ? (
              <p className="text-xs text-muted-foreground">
                当前成交尚未关联合同。可补充合同编号、签订合同时间和服务日期。
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">合同编号</p>
                  <p className="font-semibold text-foreground break-words">
                    {selectedContract.contractNumber}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">合同金额</p>
                  <p className="font-bold text-primary">
                    {new Intl.NumberFormat("zh-CN", {
                      style: "currency",
                      currency: normalizeCurrency(selectedContract.currency),
                      maximumFractionDigits: 0,
                    }).format(selectedContract.amount || 0)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">签订合同时间</p>
                  <p className="font-semibold text-foreground">
                    {selectedContract.signedAt
                      ? formatDealDate(selectedContract.signedAt)
                      : "--"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">合同服务开始计算日期</p>
                  <p className="font-semibold text-foreground">
                    {selectedContract.startDate
                      ? formatDealDate(selectedContract.startDate)
                      : "--"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">合同结束日期</p>
                  <p className="font-semibold text-foreground">
                    {selectedContract.endDate ? formatDealDate(selectedContract.endDate) : "--"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">是否续费合同</p>
                  <p className="font-semibold text-foreground">
                    {selectedContract.isRenewal ? "续费合同" : "首单合同"}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t border-border/60 mt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground uppercase tracking-wider">回款记录</p>
            </div>
            {isPaymentsLoading ? (
              <div className="space-y-2 text-sm">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : contractPayments.length === 0 ? (
              <p className="text-xs text-muted-foreground">当前合同暂无回款记录。</p>
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">确认到账日期</TableHead>
                      <TableHead className="whitespace-nowrap text-right text-xs font-semibold">确认到账金额</TableHead>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">方式</TableHead>
                      <TableHead className="whitespace-nowrap text-xs font-semibold">备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractPayments.map((payment) => (
                      <TableRow key={payment.id} className="text-xs">
                        <TableCell className="whitespace-nowrap">
                          {payment.paidAt
                            ? formatDealDate(payment.paidAt)
                            : "--"}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-foreground font-semibold">
                          {new Intl.NumberFormat("zh-CN", {
                            style: "currency",
                            currency: normalizeCurrency(payment.currency),
                            maximumFractionDigits: 0,
                          }).format(payment.amount || 0)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-muted-foreground">
                            {payment.method || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="text-muted-foreground truncate inline-block align-top max-w-full">
                            {payment.note || "-"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          </details>
        </DealContractSubmissionDialog>
      )}

      {selectedDeal && canManageContracts && (
        <Dialog open={isContractDialogOpen} onOpenChange={setIsContractDialogOpen}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>{selectedContract ? "编辑合同" : "新增合同"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="contractNumber">合同编号</Label>
                <Input
                  id="contractNumber"
                  value={contractNumberInput}
                  onChange={(e) => setContractNumberInput(e.target.value)}
                  placeholder="例如：HT-2025-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contractTitle">合同标题（可选）</Label>
                <Input
                  id="contractTitle"
                  value={contractTitleInput}
                  onChange={(e) => setContractTitleInput(e.target.value)}
                  placeholder="例如：2025 年 SaaS 年度服务合同"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="contractAmount">合同金额</Label>
                  <Input
                    id="contractAmount"
                    type="number"
                    min="0"
                    value={contractAmountInput}
                    onChange={(e) => setContractAmountInput(e.target.value)}
                    placeholder="单位：元"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contractCurrency">币种</Label>
                  <Input
                    id="contractCurrency"
                    value={contractCurrencyInput}
                    onChange={(e) => setContractCurrencyInput(e.target.value || "CNY")}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="signedAt">签订合同时间</Label>
                  <Input
                    id="signedAt"
                    type="date"
                    value={contractSignedAtInput}
                    onChange={(e) => setContractSignedAtInput(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startDate">合同服务开始计算日期</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={contractStartDateInput}
                    onChange={(e) => setContractStartDateInput(e.target.value)}
                  />
                </div>

              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="endDate">合同结束日期</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={contractEndDateInput}
                    onChange={(e) => setContractEndDateInput(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>合同类型</Label>
                  <Select
                    value={contractIsRenewalInput ? "renewal" : "new"}
                    onValueChange={(value) => setContractIsRenewalInput(value === "renewal")}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">首单合同</SelectItem>
                      <SelectItem value="renewal">续费合同</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsContractDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                onClick={async () => {
                  if (!selectedDeal) {
                    return
                  }

                  const amount = Number.parseFloat(contractAmountInput || "0")
                  if (!contractNumberInput.trim() || !contractSignedAtInput || Number.isNaN(amount) || amount <= 0) {
                    toast.error("请填写合同编号、签订合同时间和有效的合同金额")
                    return
                  }

                  if (!contractStartDateInput || !contractEndDateInput) {
                    toast.error("请填写合同服务开始计算日期和合同结束日期")
                    return
                  }

                  const startDate = new Date(contractStartDateInput)
                  const endDate = new Date(contractEndDateInput)
                  if (endDate.getTime() < startDate.getTime()) {
                    toast.error("合同结束日期不能早于合同服务开始计算日期")
                    return
                  }


                  try {
                    const signedAtIso = new Date(contractSignedAtInput).toISOString()

                    await upsertContractForLead(selectedDeal.id, {
                      contractNumber: contractNumberInput.trim(),
                      title: contractTitleInput.trim() || undefined,
                      amount,
                      currency: contractCurrencyInput || "CNY",
                      signedAt: signedAtIso,
                      startDate: contractStartDateInput || undefined,
                      endDate: contractEndDateInput || undefined,
                      isRenewal: contractIsRenewalInput,
                    })

                    const refreshed = await fetchContractByLeadId(selectedDeal.id)
                    setSelectedContract(refreshed)
                    toast.success("合同信息已保存")
                    setIsContractDialogOpen(false)
                  } catch (error) {
                    console.error("Failed to save contract", error)
                    toast.error("保存合同失败", {
                      description: "请稍后重试或联系管理员",
                    })
                  }
                }}
              >
                保存合同
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}


    </div>
  )
}

