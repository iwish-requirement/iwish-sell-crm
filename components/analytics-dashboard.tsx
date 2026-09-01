"use client"

import { useState, useEffect, useContext, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { CalendarIcon, Download, ChevronRight, Trophy, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react"
import { format, subDays } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { useIsMobile } from "@/hooks/use-mobile"
import { ChartSkeleton, TableSkeleton } from "@/components/skeleton-loaders"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import type { LeadSecureRow } from "@/lib/services/leads"
import { MePermissionsContext } from "@/components/app-root"
import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import type { UserProfile } from "@/lib/auth/profile"
import { toast } from "sonner"



type FunnelItem = {
  stage: string
  count: number
  fullName: string
}

type SourceVolumeItem = {
  name: string
  value: number
  color: string
}

type SourceConversionItem = {
  source: string
  leads: number
  converted: number
  rate: number
}

type SourceRoiItem = {
  source: string
  leads: number
  won: number
  winRate: number
  newAmount: number
  renewalAmount: number
  totalAmount: number
  revenuePerLead: number
}

type ProductCategoryItem = {
  id: string
  name: string
  leads: number
}

 type TeamLeaderboardRow = {
  id: string
  name: string
  avatar?: string | null
  leads: number
  interactions: number
  won: number
  value: number
  winRate: number
  avgDealValue: number
  trend: "up" | "down"
}


type TeamOption = {
  id: string
  name: string
}

const ALL_TEAMS_OPTION: TeamOption = {
  id: "all",
  name: "全部团队",
}

export function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  })
  const [selectedTeam, setSelectedTeam] = useState(ALL_TEAMS_OPTION.id)

  const [teams, setTeams] = useState<TeamOption[]>([ALL_TEAMS_OPTION])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [funnelData, setFunnelData] = useState<FunnelItem[]>([])
  const [sourceVolumeData, setSourceVolumeData] = useState<SourceVolumeItem[]>([])
  const [sourceConversionData, setSourceConversionData] = useState<SourceConversionItem[]>([])
  const [sourceRoiData, setSourceRoiData] = useState<SourceRoiItem[]>([])
  const [teamData, setTeamData] = useState<TeamLeaderboardRow[]>([])
  const [productTypeData, setProductTypeData] = useState<ProductCategoryItem[]>([])
  const [poolLeadsCount, setPoolLeadsCount] = useState<number | null>(null)

  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null)
  const [contractExpiringSoon, setContractExpiringSoon] = useState(0)
  const [contractExpiredRecently, setContractExpiredRecently] = useState(0)
  const [contractNewAmount, setContractNewAmount] = useState(0)
  const [contractRenewalAmount, setContractRenewalAmount] = useState(0)
  const mePermissions = useContext(MePermissionsContext)
  const isMobile = useIsMobile()

  const leadScopeType = mePermissions?.leadScopeType ?? "self"
  const canViewReports = Boolean(mePermissions?.canViewReports)
  const isPermissionsLoading = mePermissions === null



  useEffect(() => {
    if (!canViewReports) {
      return
    }


    const supabase = getBrowserSupabaseClient()

    const fetchTeams = async () => {
      try {
        const [{ data, error }, { data: exclusionRow, error: exclusionError }] = await Promise.all([
          supabase
            .from("teams")
            .select("id, name")
            .order("name", { ascending: true }),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "analytics.excluded_teams")
            .maybeSingle(),
        ])

        if (error) {
          console.error("Failed to load teams for analytics", error)
          return
        }
        if (exclusionError && exclusionError.code !== "PGRST116") {
          console.error("Failed to load analytics excluded teams for analytics filter", exclusionError)
        }

        const excludedTeamIds = new Set<number>(
          exclusionRow && (exclusionRow as any).value &&
          Array.isArray(((exclusionRow as any).value as any).team_ids)
            ? (((exclusionRow as any).value as any).team_ids as any[]).filter(
                (v: any) => typeof v === "number",
              )
            : [],
        )

        const dynamicTeams: TeamOption[] =
          (data ?? [])
            .filter((team: any) => !excludedTeamIds.has(team.id as number))
            .map((team: any) => ({
              id: String(team.id),
              name: team.name ?? `团队 #${team.id}`,
            }))

        setTeams([ALL_TEAMS_OPTION, ...dynamicTeams])

        try {
          const profile = await fetchCurrentUserProfile(supabase)
          setCurrentProfile(profile)
        } catch (profileError) {
          console.error("Failed to load current user profile for analytics", profileError)
        }
      } catch (err) {
        console.error("Failed to load teams for analytics", err)
      }
    }

    void fetchTeams()
  }, [canViewReports])

  useEffect(() => {
    if (!canViewReports) {
      setIsLoading(false)
      setError(null)
      return
    }

    const supabase = getBrowserSupabaseClient()


    const fetchAnalytics = async () => {
      setIsLoading(true)
      setError(null)

      let effectiveProfile = currentProfile

      if (!effectiveProfile) {
        try {
          effectiveProfile = await fetchCurrentUserProfile(supabase)
          setCurrentProfile(effectiveProfile)
        } catch (profileError) {
          console.error("Failed to load current user profile for analytics data", profileError)
        }
      }

      const leadsQuery = (() => {
        let query = supabase
          .from("leads_secure_view")
          .select(
            "id, team_id, owner_id, created_by, source, stage, status, close_result, budget, created_at, product_category",
          )


        if (dateRange?.from) {
          query = query.gte("created_at", dateRange.from.toISOString())
        }

        if (dateRange?.to) {
          query = query.lte("created_at", dateRange.to.toISOString())
        }

        // 保护性上限，避免在数据规模较大时一次性加载全部历史数据
        return query.limit(5000)
      })()

      const contractsQuery = (() => {
        let query = supabase
          .from("contracts_secure_view")
          .select("id, lead_id, end_date, is_renewal, amount, signed_at")

        if (dateRange?.from) {
          query = query.gte("signed_at", dateRange.from.toISOString())
        }

        if (dateRange?.to) {
          query = query.lte("signed_at", dateRange.to.toISOString())
        }

        return query.limit(5000)
      })()

      const [
        { data, error },
        { data: teamExclusionRow, error: teamExclusionError },
        { data: profileExclusionRow, error: profileExclusionError },
        { data: contractRows, error: contractsError },
      ] = await Promise.all([
        leadsQuery,
        supabase
          .from("settings")
          .select("value")
          .eq("key", "analytics.excluded_teams")
          .maybeSingle(),
        supabase
          .from("settings")
          .select("value")
          .eq("key", "analytics.excluded_profiles")
          .maybeSingle(),
        contractsQuery,
      ])


      if (error) {
        setError(error.message ?? "加载报表数据失败")
        setIsLoading(false)
        return
      }

      if (contractsError) {
        console.error("Failed to load contracts for analytics", contractsError)
      }

      if (teamExclusionError && teamExclusionError.code !== "PGRST116") {
        console.error("Failed to load analytics excluded teams for analytics data", teamExclusionError)
      }
      if (profileExclusionError && profileExclusionError.code !== "PGRST116") {
        console.error("Failed to load analytics excluded profiles for analytics data", profileExclusionError)
      }

      const excludedTeamIds = new Set<number>(
        teamExclusionRow && (teamExclusionRow as any).value &&
        Array.isArray(((teamExclusionRow as any).value as any).team_ids)
          ? (((teamExclusionRow as any).value as any).team_ids as any[]).filter(
              (v: any) => typeof v === "number",
            )
          : [],
      )

      const excludedProfileIds = new Set<string>(
        profileExclusionRow && (profileExclusionRow as any).value &&
        Array.isArray(((profileExclusionRow as any).value as any).profile_ids)
          ? (((profileExclusionRow as any).value as any).profile_ids as any[]).filter(
              (v: any) => typeof v === "string",
            )
          : [],
      )

      const leads = (data ?? []) as LeadSecureRow[]

      const nonExcludedLeads = leads.filter((lead) => {
        const teamId = (lead.team_id as number | null) ?? null
        if (teamId != null && excludedTeamIds.has(teamId)) {
          return false
        }
        const ownerId = (lead.owner_id as string | null) ?? null
        if (ownerId && excludedProfileIds.has(ownerId)) {
          return false
        }
        return true
      })

      const poolCount = nonExcludedLeads.filter((lead) => lead.status === "pool").length
      setPoolLeadsCount(poolCount)

      const now = new Date()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const end30 = new Date(startOfToday.getTime() + 30 * 24 * 60 * 60 * 1000)

      const filteredLeads = nonExcludedLeads.filter((lead) => {
        // 只统计当前仍在个人名下的正常线索：排除公海池以及任何非 open/closed 状态
        if (lead.status === "pool") {
          return false
        }
        if (lead.status !== "open" && lead.status !== "closed") {
          return false
        }

        if (leadScopeType === "self") {
          if (!effectiveProfile?.id) {
            return false
          }

          if (lead.owner_id !== effectiveProfile.id && lead.created_by !== effectiveProfile.id) {
            return false
          }
        } else if (leadScopeType === "team") {
          const teamId = effectiveProfile?.teamId
          if (teamId != null && lead.team_id !== teamId) {
            return false
          }
        }

        if (leadScopeType !== "self" && selectedTeam !== ALL_TEAMS_OPTION.id) {
          const selectedTeamId = Number(selectedTeam)
          if (!Number.isNaN(selectedTeamId) && lead.team_id !== selectedTeamId) {
            return false
          }
        }

        if (!dateRange?.from || !dateRange?.to) {
          return true
        }
        const createdAt = lead.created_at ? new Date(lead.created_at) : null
        if (!createdAt) {
          return false
        }
        return createdAt >= dateRange.from! && createdAt <= dateRange.to!
      })

      if (filteredLeads.length === 0) {
        setFunnelData([])
        setSourceVolumeData([])
        setSourceConversionData([])
        setSourceRoiData([])
        setTeamData([])
        setProductTypeData([])
        setIsLoading(false)
        return
      }

      const contracts = (contractRows ?? []) as any[]

      const leadById = new Map<string, LeadSecureRow>()
      for (const lead of filteredLeads) {
        const id = lead.id
        if (typeof id === "string") {
          leadById.set(id, lead)
        }
      }
      const revenueBySource = new Map<string, { newAmount: number; renewalAmount: number }>()
      const revenueByOwner = new Map<string, { newAmount: number; renewalAmount: number }>()

      let expiringSoon = 0
      let expiredRecently = 0
      let newAmount = 0
      let renewalAmount = 0

      if (contracts.length > 0 && dateRange?.from && dateRange?.to) {
        const allowedLeadIds = new Set(filteredLeads.map((lead) => lead.id))

        for (const row of contracts) {
          const leadId = (row.lead_id as string | null) ?? null
          if (!leadId || !allowedLeadIds.has(leadId)) {
            continue
          }

          const endDateStr = row.end_date as string | null
          const signedAtStr = row.signed_at as string | null
          const isRenewal = Boolean(row.is_renewal)
          const amount = (row.amount as number) ?? 0

          if (endDateStr) {
            const endDate = new Date(endDateStr)
            if (endDate >= dateRange.from && endDate <= dateRange.to) {
              if (endDate >= startOfToday && endDate <= end30) {
                expiringSoon += 1
              } else if (endDate < startOfToday) {
                expiredRecently += 1
              }
            }
          }

          if (signedAtStr) {
            const signedAt = new Date(signedAtStr)
            if (signedAt >= dateRange.from && signedAt <= dateRange.to) {
              const lead = leadById.get(leadId)
              const sourceKey = lead && (lead as any).source ? ((lead as any).source as string) : "其他"
              const currentRevenueBySource =
                revenueBySource.get(sourceKey) ?? { newAmount: 0, renewalAmount: 0 }
              const ownerId = lead && (lead as any).owner_id ? ((lead as any).owner_id as string) : "unassigned"
              const currentRevenueByOwner =
                revenueByOwner.get(ownerId) ?? { newAmount: 0, renewalAmount: 0 }

              if (isRenewal) {
                renewalAmount += amount
                currentRevenueBySource.renewalAmount += amount
                currentRevenueByOwner.renewalAmount += amount
              } else {
                newAmount += amount
                currentRevenueBySource.newAmount += amount
                currentRevenueByOwner.newAmount += amount
              }

              revenueBySource.set(sourceKey, currentRevenueBySource)
              revenueByOwner.set(ownerId, currentRevenueByOwner)

            }
          }
        }
      }

      setContractExpiringSoon(expiringSoon)
      setContractExpiredRecently(expiredRecently)
      setContractNewAmount(newAmount)
      setContractRenewalAmount(renewalAmount)

      if (filteredLeads.length === 0) {
        setFunnelData([])
        setSourceVolumeData([])
        setSourceConversionData([])
        setSourceRoiData([])
        setTeamData([])
        setProductTypeData([])
        setIsLoading(false)
        return
      }

      // 客户产品品类是自由文本，不能使用 business_types（例如 DTC/B2B）代替。
      // 对历史记录的空值单独计入“历史数据未填写”，保证仪表盘总数可追溯。
      const productTypeMap = new Map<string, ProductCategoryItem>()
      for (const lead of filteredLeads) {
        const productCategory = typeof lead.product_category === "string" ? lead.product_category.trim() : ""
        const key = productCategory || "__missing__"
        const current = productTypeMap.get(key) ?? {
          id: key,
          name: productCategory || "历史数据未填写",
          leads: 0,
        }
        current.leads += 1
        productTypeMap.set(key, current)
      }

      const stageOrder = ["L1", "L2", "L3", "L4", "Won"]

      const defaultStageLabelMap: Record<string, { stage: string; fullName: string }> = {
        L1: { stage: "L1 询盘", fullName: "L1 初步意向" },
        L2: { stage: "L2 意向", fullName: "L2 明确需求" },
        L3: { stage: "L3 关键意向", fullName: "L3 报价阶段" },
        L4: { stage: "L4 谈判", fullName: "L4 谈判阶段" },
        Won: { stage: "成交", fullName: "成交客户" },
      }

      let stageLabelMap: Record<string, { stage: string; fullName: string }> = {
        ...defaultStageLabelMap,
      }

      try {
        const { data: settingsRows, error: stageSettingsError } = await supabase
          .from("settings")
          .select("key, value")
          .eq("key", "dashboard.pipeline_stages")
          .limit(1)

        if (!stageSettingsError && settingsRows && settingsRows.length > 0) {
          const raw = (settingsRows[0].value as any) ?? null
          if (raw && typeof raw === "object") {
            for (const stageKey of stageOrder) {
              const cfg = (raw as any)[stageKey]
              if (cfg && typeof cfg === "object") {
                stageLabelMap[stageKey] = {
                  stage: (cfg.label as string) ?? defaultStageLabelMap[stageKey]?.stage ?? stageKey,
                  fullName:
                    (cfg.fullName as string) ??
                    defaultStageLabelMap[stageKey]?.fullName ??
                    stageKey,
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load pipeline stage labels from settings", err)
      }

      const getLogicalStage = (lead: LeadSecureRow): string => {
        const rawStage = (lead.stage ?? "").trim()
        let logicalStage = rawStage || "L1"

        if (
          lead.status === "closed" &&
          (lead.close_result === "won" ||
            lead.close_result === "成交" ||
            rawStage === "Won" ||
            rawStage === "成交")
        ) {
          logicalStage = "Won"
        }

        return logicalStage
      }

      const stageCounts = new Map<string, number>()
      for (const lead of filteredLeads) {
        const key = getLogicalStage(lead)
        stageCounts.set(key, (stageCounts.get(key) ?? 0) + 1)
      }

      const nextFunnelData: FunnelItem[] = []
      for (const stageKey of stageOrder) {
        const labelDef = stageLabelMap[stageKey]
        const count = stageCounts.get(stageKey) ?? 0
        nextFunnelData.push({
          stage: labelDef.stage,
          fullName: labelDef.fullName,
          count,
        })
      }

      const sourceCounts = new Map<string, { leads: number; converted: number }>()
      for (const lead of filteredLeads) {
        const source = lead.source ?? "其他"
        const current = sourceCounts.get(source) ?? { leads: 0, converted: 0 }
        current.leads += 1
        const logicalStage = getLogicalStage(lead)
        if (logicalStage === "Won") {
          current.converted += 1
        }
        sourceCounts.set(source, current)
      }

      const palette = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#6366f1"]
      const nextSourceVolume: SourceVolumeItem[] = []
      const nextSourceConversion: SourceConversionItem[] = []
      const nextSourceRoi: SourceRoiItem[] = []
      let colorIndex = 0

      for (const [source, value] of sourceCounts.entries()) {
        const color = palette[colorIndex % palette.length]
        colorIndex += 1
        nextSourceVolume.push({
          name: source,
          value: value.leads,
          color,
        })
        nextSourceConversion.push({
          source,
          leads: value.leads,
          converted: value.converted,
          rate: value.leads === 0 ? 0 : Number(((value.converted / value.leads) * 100).toFixed(1)),
        })

        const revenue = revenueBySource.get(source) ?? { newAmount: 0, renewalAmount: 0 }
        const totalAmount = revenue.newAmount + revenue.renewalAmount
        const won = value.converted
        const winRate = value.leads === 0 ? 0 : (won / value.leads) * 100
        const revenuePerLead = value.leads === 0 ? 0 : totalAmount / value.leads

        nextSourceRoi.push({
          source,
          leads: value.leads,
          won,
          winRate,
          newAmount: revenue.newAmount,
          renewalAmount: revenue.renewalAmount,
          totalAmount,
          revenuePerLead,
        })
      }

      nextSourceRoi.sort((a, b) => b.totalAmount - a.totalAmount || b.winRate - a.winRate)

      const ownerStats = new Map<string, { leads: number; won: number }>()
      for (const lead of filteredLeads) {
        const ownerId = lead.owner_id ?? "unassigned"
        const current = ownerStats.get(ownerId) ?? { leads: 0, won: 0 }

        current.leads += 1

        const logicalStage = getLogicalStage(lead)
        if (logicalStage === "Won") {
          current.won += 1
        }

        ownerStats.set(ownerId, current)
      }


      const leadIds = filteredLeads.map((lead) => lead.id)
      const interactionsByUserId = new Map<string, number>()

      if (leadIds.length > 0 && dateRange?.from && dateRange?.to) {
        const { data: notes, error: notesError } = await supabase
          .from("lead_notes")
          .select("author_id, lead_id, created_at, is_deleted")
          .in("lead_id", leadIds)
          .gte("created_at", dateRange.from.toISOString())
          .lte("created_at", dateRange.to.toISOString())

        if (notesError) {
          console.error("Failed to load notes for analytics leaderboard", notesError)
        } else {
          for (const note of (notes ?? []) as {
            author_id: string | null
            lead_id: string
            created_at: string
            is_deleted?: boolean | null
          }[]) {
            if (!note.author_id) continue
            if (note.is_deleted) continue
            const prev = interactionsByUserId.get(note.author_id) ?? 0
            interactionsByUserId.set(note.author_id, prev + 1)
          }
        }
      }

      // 加载参与排行榜的成员信息：按 Scope/团队筛选，并排除“技术维护/系统管理”等系统角色
      const leaderboardProfiles: {
        id: string
        full_name: string | null
        avatar_url: string | null
        team_id: number | null
        role_id: string | null
        status: string | null
      }[] = []

      try {
        const profileQuery = supabase
          .from("profiles_public_view")
          .select("id, full_name, avatar_url, team_id, role_id, status")
          .eq("status", "active")

        if (leadScopeType === "self" && effectiveProfile?.id) {
          profileQuery.eq("id", effectiveProfile.id)
        } else if (leadScopeType === "team" && effectiveProfile?.teamId != null) {
          profileQuery.eq("team_id", effectiveProfile.teamId)
        } else if (leadScopeType !== "self" && selectedTeam !== ALL_TEAMS_OPTION.id) {
          const selectedTeamId = Number(selectedTeam)
          if (!Number.isNaN(selectedTeamId)) {
            profileQuery.eq("team_id", selectedTeamId)
          }
        }

        const [
          { data: profiles, error: profilesError },
          { data: roles, error: rolesError },
          { data: exclusionRow, error: exclusionError },
        ] = await Promise.all([
          profileQuery,
          supabase.from("roles").select("id, name"),
          supabase
            .from("settings")
            .select("value")
            .eq("key", "analytics.excluded_profiles")
            .maybeSingle(),
        ])

        if (profilesError) {
          console.error("Failed to load leaderboard profiles", profilesError)
        } else if (profiles) {
          const systemRoleIds = new Set(
            (roles ?? [])
              .filter((r: any) => r.name === "技术维护" || r.name === "系统管理")
              .map((r: any) => r.id as string),
          )

          const excludedProfileIds = new Set<string>(
            exclusionRow && (exclusionRow as any).value &&
            Array.isArray(((exclusionRow as any).value as any).profile_ids)
              ? (((exclusionRow as any).value as any).profile_ids as any[]).filter(
                  (v: any) => typeof v === "string",
                )
              : [],
          )

          for (const row of profiles as any[]) {
            const roleId = (row.role_id as string | null) ?? null
            const id = row.id as string
            const teamId = (row.team_id as number | null) ?? null

            if (excludedProfileIds.has(id)) {
              // 在设置中显式排除的账号不参与业务统计
              continue
            }

            if (teamId != null && excludedTeamIds.has(teamId)) {
              // 被配置为排除统计的团队，其成员不参与业务统计
              continue
            }

            if (roleId && systemRoleIds.has(roleId)) {
              // 系统维护/管理角色不参与业务统计
              continue
            }

            leaderboardProfiles.push({
              id,
              full_name: (row.full_name as string | null) ?? null,
              avatar_url: (row.avatar_url as string | null) ?? null,
              team_id: teamId,
              role_id: roleId,
              status: (row.status as string | null) ?? null,
            })
          }
        }

        if (rolesError) {
          console.error("Failed to load roles for leaderboard", rolesError)
        }
        if (exclusionError && exclusionError.code !== "PGRST116") {
          console.error("Failed to load analytics exclusion settings for leaderboard", exclusionError)
        }
      } catch (profilesErr) {
        console.error("Failed to load leaderboard profiles/roles", profilesErr)
      }

      const nextTeamData: TeamLeaderboardRow[] = []

      // 先为每个参与统计的成员生成一行，即使没有任何线索也会显示 0
      for (const profile of leaderboardProfiles) {
        const stats = ownerStats.get(profile.id) ?? { leads: 0, won: 0 }
        const totalLeads = stats.leads
        const winRate = totalLeads === 0 ? 0 : stats.won / totalLeads
        const ownerRevenue = revenueByOwner.get(profile.id) ?? { newAmount: 0, renewalAmount: 0 }
        const totalAmount = ownerRevenue.newAmount + ownerRevenue.renewalAmount
        const avgDealValue = stats.won === 0 ? 0 : totalAmount / stats.won
        const trend: "up" | "down" = winRate >= 0.3 ? "up" : "down"
        const interactions = interactionsByUserId.get(profile.id) ?? 0

        nextTeamData.push({
          id: profile.id,
          name: profile.full_name || profile.id.slice(0, 8),
          avatar: profile.avatar_url ?? null,
          leads: stats.leads,
          interactions,
          won: stats.won,
          value: totalAmount,
          winRate,
          avgDealValue,
          trend,
        })
      }

      // 追加一行“未分配”统计（如果存在）
      const unassignedStats = ownerStats.get("unassigned")
      if (unassignedStats && unassignedStats.leads > 0) {
        const totalLeads = unassignedStats.leads
        const winRate = totalLeads === 0 ? 0 : unassignedStats.won / totalLeads
        const ownerRevenue = revenueByOwner.get("unassigned") ?? { newAmount: 0, renewalAmount: 0 }
        const totalAmount = ownerRevenue.newAmount + ownerRevenue.renewalAmount
        const avgDealValue = unassignedStats.won === 0 ? 0 : totalAmount / unassignedStats.won
        const trend: "up" | "down" = winRate >= 0.3 ? "up" : "down"

        nextTeamData.push({
          id: "unassigned",
          name: "未分配",
          avatar: null,
          leads: unassignedStats.leads,
          interactions: 0,
          won: unassignedStats.won,
          value: totalAmount,
          winRate,
          avgDealValue,
          trend,
        })
      }

      nextTeamData.sort((a, b) => b.value - a.value || b.won - a.won || b.leads - a.leads)

      const nextProductTypeData: ProductCategoryItem[] = Array.from(productTypeMap.values()).sort(
        (a, b) => b.leads - a.leads,
      )

      setFunnelData(nextFunnelData)
      setSourceVolumeData(nextSourceVolume)
      setSourceConversionData(nextSourceConversion)
      setSourceRoiData(nextSourceRoi)
      setTeamData(nextTeamData)
      setProductTypeData(nextProductTypeData)

      setIsLoading(false)

    }

    void fetchAnalytics()
  }, [dateRange, selectedTeam, leadScopeType, currentProfile, canViewReports])


  const effectiveTeams = useMemo(() => {
    if (leadScopeType === "self") {
      return []
    }

    if (leadScopeType === "team") {
      const teamId = currentProfile?.teamId
      if (!teamId) {
        return []
      }

      return teams.filter((team) => team.id === String(teamId))
    }

    return teams
  }, [leadScopeType, currentProfile, teams])

  useEffect(() => {
    if (leadScopeType === "team" && currentProfile?.teamId) {
      const teamId = String(currentProfile.teamId)
      if (selectedTeam !== teamId) {
        setSelectedTeam(teamId)
      }
    }

    if ((leadScopeType === "org" || leadScopeType === "custom") && selectedTeam === "") {
      setSelectedTeam(ALL_TEAMS_OPTION.id)
    }
  }, [leadScopeType, currentProfile, selectedTeam])

  const handleDownloadCSV = async (dataType: string) => {
    try {
      const supabase = getBrowserSupabaseClient()
      const filters: Record<string, any> = {
        dataType,
        date_from: dateRange?.from ? dateRange.from.toISOString() : null,
        date_to: dateRange?.to ? dateRange.to.toISOString() : null,
        lead_scope_type: leadScopeType,
        team_id: selectedTeam && selectedTeam !== ALL_TEAMS_OPTION.id ? selectedTeam : null,
      }

      const { error } = await supabase.rpc("rpc_leads_export_request", {
        p_source: `analytics_${dataType}`,
        p_format: "csv",
        p_filters: filters,
      })

      if (error) {
        const { mapRpcError } = await import("@/lib/rpc-error-mapper")
        const friendly = mapRpcError(error, {
          title: "导出失败",
          description:
            "提交导出请求时出错，请稍后重试。如果提示无导出权限，请联系管理员在系统设置中调整权限。",
        })
        toast.error(friendly.title, { description: friendly.description })
        return
      }
    } catch (err) {
      const { mapRpcError } = await import("@/lib/rpc-error-mapper")
      const friendly = mapRpcError(err as any, {
        title: "导出失败",
        description: "导出过程中发生异常，请稍后重试或联系管理员。",
      })
      toast.error(friendly.title, { description: friendly.description })
      return
    }

    const rows: string[][] = []


    if (dataType === "funnel") {
      rows.push(["阶段", "线索数"])
      funnelData.forEach((item) => {
        rows.push([item.fullName || item.stage, String(item.count)])
      })
    } else if (dataType === "source-volume") {
      rows.push(["来源渠道", "线索数"])
      sourceVolumeData.forEach((item) => {
        rows.push([item.name, String(item.value)])
      })
    } else if (dataType === "source-conversion") {
      rows.push(["来源渠道", "线索数", "成交数", "转化率(%)"])
      sourceConversionData.forEach((item) => {
        rows.push([
          item.source,
          String(item.leads),
          String(item.converted),
          String(item.rate),
        ])
      })
    } else if (dataType === "team-leaderboard") {
      rows.push(["销售代表", "线索数", "跟进数", "成交数", "成交率(%)", "客单价(元)", "成交金额(元)"])
      teamData.forEach((rep) => {
        rows.push([
          rep.name,
          String(rep.leads),
          String(rep.interactions),
          String(rep.won),
          rep.leads === 0 ? "0" : (rep.winRate * 100).toFixed(1),
          rep.won === 0 ? "0" : rep.avgDealValue.toFixed(0),
          rep.value.toFixed(0),
        ])
      })
    } else if (dataType === "product-type") {
      rows.push(["客户产品品类", "线索数"])
      productTypeData.forEach((item) => {
        rows.push([item.name, String(item.leads)])
      })
    } else if (dataType === "source-roi") {

      rows.push([
        "来源渠道",
        "线索数",
        "成交数",
        "成交率(%)",
        "首单金额(元)",
        "续费金额(元)",
        "总金额(元)",
        "单线索金额(元)",
      ])
      sourceRoiData.forEach((row) => {
        rows.push([
          row.source,
          String(row.leads),
          String(row.won),
          row.leads === 0 ? "0" : row.winRate.toFixed(1),
          row.newAmount.toFixed(0),
          row.renewalAmount.toFixed(0),
          row.totalAmount.toFixed(0),
          row.leads === 0 ? "0" : row.revenuePerLead.toFixed(0),
        ])
      })
    }

    if (rows.length === 0) {
      return
    }

    const csvContent = rows
      .map((cols) =>
        cols
          .map((col) => {
            const value = col ?? ""
            if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
              return `"${value.replace(/"/g, '""')}"`
            }
            return value
          })
          .join(","),
      )
      .join("\n")

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    const fileNameMap: Record<string, string> = {
      funnel: "sales-funnel.csv",
      "source-volume": "lead-source-volume.csv",
      "source-conversion": "lead-source-conversion.csv",
      "team-leaderboard": "team-leaderboard.csv",
      "product-type": "product-type-distribution.csv",
      "source-roi": "lead-source-roi.csv",
    }

    link.download = fileNameMap[dataType] ?? "analytics-export.csv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }


  // Calculate conversion rates between stages
  const getConversionRate = (fromIndex: number) => {
    if (fromIndex >= funnelData.length - 1) return null
    const from = funnelData[fromIndex]?.count ?? 0
    const to = funnelData[fromIndex + 1]?.count ?? 0

    if (from === 0) {
      if (to === 0) {
        return "0%"
      }
      return null
    }

    const rate = ((to / from) * 100).toFixed(1)
    return `${rate}%`
  }

  if (isPermissionsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">数据分析</h1>
          <div className="flex flex-wrap items-center gap-4 mt-2">
            <Button variant="outline" className="w-full sm:w-[280px] bg-transparent" disabled>
              <CalendarIcon className="mr-2 h-4 w-4" />
              加载当前账号权限中...
            </Button>
          </div>
        </div>
        <ChartSkeleton className="h-auto" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
        <TableSkeleton rows={6} />
      </div>
    )
  }

  if (!canViewReports) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">数据分析</h1>
          <p className="text-sm text-muted-foreground font-medium mt-2">
            当前账号无权访问数据分析模块，如需调整报表权限，请联系系统管理员。
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">数据分析</h1>
          <div className="flex flex-wrap items-center gap-4 mt-2">
            <Button variant="outline" className="w-full sm:w-[280px] bg-transparent" disabled>
              <CalendarIcon className="mr-2 h-4 w-4" />
              同步数据中...
            </Button>
          </div>
        </div>
        <ChartSkeleton className="h-auto" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
        <TableSkeleton rows={6} />
      </div>
    )
  }



  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="outline" className="w-[280px] bg-transparent" disabled>
            <CalendarIcon className="mr-2 h-4 w-4" />
            加载报表数据失败
          </Button>
        </div>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-foreground tracking-tight">数据分析</h1>

      {/* Filters Row - responsive */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-4 bg-muted/20 p-4 rounded-xl border border-muted/30">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full sm:w-[280px] justify-start text-left font-semibold bg-background h-10 shadow-sm"
            >
              <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "yyyy/MM/dd", { locale: zhCN })} -{" "}
                    {format(dateRange.to, "yyyy/MM/dd", { locale: zhCN })}
                  </>
                ) : (
                  format(dateRange.from, "yyyy/MM/dd", { locale: zhCN })
                )
              ) : (
                <span>选择日期范围</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        {leadScopeType !== "self" && effectiveTeams.length > 0 && (
          <Select value={selectedTeam} onValueChange={setSelectedTeam}>
            <SelectTrigger className="w-full sm:w-[180px] h-10 font-semibold bg-background shadow-sm">
              <SelectValue placeholder="选择团队" />
            </SelectTrigger>
            <SelectContent>
              {effectiveTeams.map((team) => (
                <SelectItem key={team.id} value={team.id} className="font-medium">
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 合同与续费概览 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-muted-foreground uppercase tracking-wider">未来 30 天到期合同</CardTitle>
            <CardDescription className="text-xs">服务将在未来 30 天内到期的合同数量</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold text-destructive tracking-tight">{contractExpiringSoon}</p>
          </CardContent>
        </Card>
        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-muted-foreground uppercase tracking-wider">已到期合同</CardTitle>
            <CardDescription className="text-xs">已到期但仍在当前统计范围内的合同</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold text-foreground tracking-tight">{contractExpiredRecently}</p>
          </CardContent>
        </Card>
        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-muted-foreground uppercase tracking-wider">新签 vs 续费金额</CardTitle>
            <CardDescription className="text-xs">当前筛选时间内的合同签约金额拆分</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">首单金额</span>
                <span className="text-lg font-bold text-foreground">
                  {new Intl.NumberFormat("zh-CN", {
                    style: "currency",
                    currency: "CNY",
                    maximumFractionDigits: 0,
                  }).format(contractNewAmount || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-muted/50">
                <span className="text-sm font-medium text-muted-foreground">续费金额</span>
                <span className="text-lg font-bold text-emerald-600">
                  {new Intl.NumberFormat("zh-CN", {
                    style: "currency",
                    currency: "CNY",
                    maximumFractionDigits: 0,
                  }).format(contractRenewalAmount || 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>


      {/* Chart 1: Sales Funnel with Conversion Rates */}
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2 border-b border-muted/30">
          <div>
            <CardTitle className="text-xl font-bold tracking-tight">销售漏斗转化分析</CardTitle>
            <CardDescription className="text-sm font-medium">从原始线索到成交的全流程阶段转化看板</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="font-semibold h-9">
                <Download className="h-4 w-4 mr-2" />
                导出数据
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadCSV("funnel")} className="font-medium">下载 CSV 报表</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="pt-4 sm:pt-6 px-2 sm:px-4">
          <div className="h-[320px] sm:h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 10, right: 32, left: 12, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} strokeOpacity={0.5} />
                <XAxis type="number" hide />
                <YAxis dataKey="stage" type="category" width={80} tick={{ fontSize: 13, fontWeight: 600, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`${value} 条`, "线索数量"]}
                  labelFormatter={(label) => funnelData.find((d) => d.stage === label)?.fullName || label}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Conversion rate indicators - mobile & desktop variants */}
          {/* Mobile: compact horizontal summary chips */}
          <div className="mt-4 flex gap-2 overflow-x-auto sm:hidden pb-1 -mx-2 px-2">
            {funnelData.slice(0, -1).map((item, index) => {
              const nextStage = funnelData[index + 1]
              if (!nextStage) return null
              return (
                <div key={item.stage} className="flex flex-col items-center flex-shrink-0 min-w-[88px]">
                  <span className="text-[10px] text-muted-foreground mb-1">
                    {item.stage} → {nextStage.stage}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[11px] font-bold bg-emerald-50 text-emerald-700 border-emerald-100 h-6 px-2"
                  >
                    {getConversionRate(index)}
                  </Badge>
                </div>
              )
            })}
          </div>

          {/* Desktop: detailed stage cards with conversion between each step */}
          <div className="mt-6 hidden sm:flex flex-col gap-3 items-stretch md:flex-row md:flex-wrap md:items-center md:justify-center">
            {funnelData.map((item, index) => (
              <div key={item.stage} className="flex flex-col items-center md:flex-row md:items-center">
                <div className="text-center px-4 py-2 bg-primary/5 rounded-xl border border-primary/10 shadow-sm min-w-[80px]">
                  <div className="text-[11px] font-bold text-primary/60 uppercase tracking-widest">{item.stage}</div>
                  <div className="text-base font-bold text-foreground mt-0.5">{item.count.toLocaleString()}</div>
                </div>
                {index < funnelData.length - 1 && (
                  <div className="flex flex-col items-center mt-2 md:mt-0 md:mx-2">
                    <div className="flex items-center">
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-30" />
                      <Badge
                        variant="secondary"
                        className="text-xs font-bold bg-emerald-50 text-emerald-700 border-emerald-100 h-6 px-2"
                      >
                        {getConversionRate(index)}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-30" />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground/60 mt-1 uppercase">转化</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Chart 2: Source Performance - Two charts side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart: Lead Volume by Source */}
        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2 border-b border-muted/30">
            <div>
              <CardTitle className="text-lg font-bold tracking-tight">线索来源分布</CardTitle>
              <CardDescription className="text-sm font-medium">各渠道线索新增占比分析</CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="font-semibold h-8">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadCSV("source-volume")} className="font-medium">下载 CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourceVolumeData}
                    cx={isMobile ? "48%" : "50%"}
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={isMobile ? ((props) => {
                      const { name, percent, x, y, textAnchor, fill } = props as any
                      const percentText = `${(percent * 100).toFixed(0)}%`
                      return (
                        <text x={x} y={y} textAnchor={textAnchor} fill={fill} fontSize={12}>
                          <tspan x={x} dy="-0.2em">
                            {name}
                          </tspan>
                          <tspan x={x} dy="1.2em">
                            {percentText}
                          </tspan>
                        </text>
                      )
                    }) : (({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`)}
                    labelLine={false}
                  >
                    {sourceVolumeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie
>
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`${value} 条`, "线索数量"]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Bar Chart: Conversion Rate by Source */}
        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2 border-b border-muted/30">
            <div>
              <CardTitle className="text-lg font-bold tracking-tight">渠道转化率对比</CardTitle>
              <CardDescription className="text-sm font-medium">各来源渠道的最终成交效率</CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="font-semibold h-8">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadCSV("source-conversion")} className="font-medium">下载 CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceConversionData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.5} />
                  <XAxis dataKey="source" tick={{ fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(value) => `${value}%`} domain={[0, 25]} tick={{ fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number, name: string) => {
                      if (name === "rate") return [`${value}%`, "转化率"]
                      return [value, name]
                    }}
                  />
                  <Bar dataKey="rate" fill="#10b981" radius={[6, 6, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>


      {/* Source ROI Table */}
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2 border-b border-muted/30">
          <div>
            <CardTitle className="text-lg font-bold tracking-tight">渠道 ROI 核心指标</CardTitle>
            <CardDescription className="text-sm font-medium">按来源贯通 线索→成交→营收 的全链路投产分析</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="font-semibold h-8">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                导出报表
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadCSV("source-roi")} className="font-medium">
                下载 CSV 报表
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-bold text-foreground py-3">来源渠道</TableHead>
                <TableHead className="text-right font-bold text-foreground">线索数</TableHead>
                <TableHead className="text-right font-bold text-foreground">成交数</TableHead>
                <TableHead className="text-right font-bold text-foreground">成交率</TableHead>
                <TableHead className="text-right font-bold text-foreground">首单金额</TableHead>
                <TableHead className="text-right font-bold text-foreground">续费金额</TableHead>
                <TableHead className="text-right font-bold text-foreground text-primary">总金额</TableHead>
                <TableHead className="text-right font-bold text-foreground">单线索价值</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceRoiData.map((row) => (
                <TableRow key={row.source} className="hover:bg-muted/20 transition-colors">
                  <TableCell className="font-bold text-sm">{row.source}</TableCell>
                  <TableCell className="text-right font-medium">{row.leads}</TableCell>
                  <TableCell className="text-right font-medium">{row.won}</TableCell>
                  <TableCell className="text-right">
                    {row.leads === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <span className="font-bold text-emerald-600">{row.winRate.toFixed(1)}%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {new Intl.NumberFormat("zh-CN", {
                      style: "currency",
                      currency: "CNY",
                      maximumFractionDigits: 0,
                    }).format(row.newAmount || 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {new Intl.NumberFormat("zh-CN", {
                      style: "currency",
                      currency: "CNY",
                      maximumFractionDigits: 0,
                    }).format(row.renewalAmount || 0)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-primary">
                    {new Intl.NumberFormat("zh-CN", {
                      style: "currency",
                      currency: "CNY",
                      maximumFractionDigits: 0,
                    }).format(row.totalAmount || 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.leads === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <span className="font-semibold text-foreground/80">
                        ¥{(row.revenuePerLead / 10000).toFixed(1)}万
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Customer Product Category Distribution */}
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2 border-b border-muted/30">
          <div>
            <CardTitle className="text-lg font-bold tracking-tight">客户产品品类分布</CardTitle>
            <CardDescription className="text-sm font-medium">按客户实际销售的产品品类统计线索数量</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="font-semibold h-8">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadCSV("product-type")} className="font-medium">
                下载 CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-bold text-foreground py-3">客户产品品类</TableHead>
                <TableHead className="text-right font-bold text-foreground">线索数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productTypeData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-sm text-muted-foreground py-6">
                    当前筛选条件下暂无可统计的客户产品品类数据
                  </TableCell>
                </TableRow>
              ) : (
                productTypeData.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="font-medium text-sm">{item.name}</TableCell>
                    <TableCell className="text-right font-semibold text-sm">{item.leads}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Chart 3: Team Activity Leaderboard */}

      <Card className="border-muted-foreground/10 shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2 border-b border-muted/30">
          <div>
            <CardTitle className="text-lg font-bold tracking-tight">团队业绩排行榜</CardTitle>
            <CardDescription className="text-sm font-medium">销售人员线索跟进、转化及创收表现</CardDescription>
            {poolLeadsCount !== null && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-100 text-xs font-bold">
                <AlertTriangle className="w-3.5 h-3.5" />
                公海池待分配：{poolLeadsCount} 条
              </div>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="font-semibold h-8">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                导出排行
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadCSV("team-leaderboard")} className="font-medium">下载 CSV 排行榜</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[60px] font-bold text-foreground py-3">排名</TableHead>
                <TableHead className="font-bold text-foreground">销售代表</TableHead>
                <TableHead className="text-right font-bold text-foreground">线索数</TableHead>
                <TableHead className="text-right font-bold text-foreground">跟进数</TableHead>
                <TableHead className="text-right font-bold text-foreground">成交数</TableHead>
                <TableHead className="text-right font-bold text-foreground">成交率</TableHead>
                <TableHead className="text-right font-bold text-foreground">客单价</TableHead>
                <TableHead className="text-right font-bold text-primary">成交金额</TableHead>
                <TableHead className="text-right w-[80px] font-bold text-foreground">趋势</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamData.map((rep, index) => (
                <TableRow key={rep.id} className="hover:bg-muted/20 transition-colors">
                  <TableCell>
                    {index < 3 ? (
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-sm ${
                          index === 0
                            ? "bg-amber-100 text-amber-700 ring-2 ring-amber-200"
                            : index === 1
                              ? "bg-slate-100 text-slate-600 ring-2 ring-slate-200"
                              : "bg-orange-100 text-orange-700 ring-2 ring-orange-200"
                        }`}
                      >
                        {index === 0 && <Trophy className="w-4 h-4" />}
                        {index === 1 && "2"}
                        {index === 2 && "3"}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm font-bold pl-2">{index + 1}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 border-2 border-background shadow-sm">
                        {rep.avatar && <AvatarImage src={rep.avatar} alt={rep.name} />}
                        <AvatarFallback className="font-bold text-sm bg-primary/10 text-primary">{rep.name?.trim()?.[0] ?? "?"}</AvatarFallback>
                      </Avatar>
                      <span className="font-bold text-sm text-foreground/90">{rep.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium text-sm">{rep.leads}</TableCell>
                  <TableCell className="text-right">
                    <span className="text-muted-foreground font-medium text-sm">{rep.interactions}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="font-bold bg-muted/80 h-6 px-2">
                      {rep.won}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {rep.leads === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <span className="font-bold text-sm text-foreground/80">{(rep.winRate * 100).toFixed(1)}%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {rep.won === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <span className="font-bold text-sm text-foreground/80">¥{(rep.avgDealValue / 10000).toFixed(1)}万</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-bold text-base text-emerald-600">
                    ¥{(rep.value / 10000).toFixed(1)}万
                  </TableCell>
                  <TableCell className="text-right">
                    {rep.trend === "up" ? (
                      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 ml-auto">
                        <TrendingUp className="h-4 w-4" />
                      </div>
                    ) : (
                      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-50 text-red-600 border border-red-100 ml-auto">
                        <TrendingDown className="h-4 w-4" />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}
