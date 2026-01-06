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
import { CalendarIcon, Download, ChevronRight, Trophy, TrendingUp, TrendingDown } from "lucide-react"
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
import { ChartSkeleton, TableSkeleton } from "@/components/skeleton-loaders"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import type { LeadSecureRow } from "@/lib/services/leads"
import { MePermissionsContext } from "@/components/app-root"
import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import type { UserProfile } from "@/lib/auth/profile"
import { toast } from "sonner"
import { mapRpcError } from "@/lib/rpc-error-mapper"


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
  const [poolLeadsCount, setPoolLeadsCount] = useState<number | null>(null)
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null)
  const [contractExpiringSoon, setContractExpiringSoon] = useState(0)
  const [contractExpiredRecently, setContractExpiredRecently] = useState(0)
  const [contractNewAmount, setContractNewAmount] = useState(0)
  const [contractRenewalAmount, setContractRenewalAmount] = useState(0)
  const mePermissions = useContext(MePermissionsContext)

  const leadScopeType = mePermissions?.leadScopeType ?? "self"
  const canExportReports = Boolean(mePermissions?.canViewReports)

  useEffect(() => {
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
  }, [])

  useEffect(() => {
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

      const [
        { data, error },
        { data: teamExclusionRow, error: teamExclusionError },
        { data: profileExclusionRow, error: profileExclusionError },
        { data: contractRows, error: contractsError },
      ] = await Promise.all([
        supabase
          .from("leads_secure_view")
          .select("id, team_id, owner_id, created_by, source, stage, status, close_result, budget, created_at"),
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
        supabase
          .from("contracts_secure_view")
          .select("id, lead_id, end_date, is_renewal, amount, signed_at"),
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
              const currentRevenue =
                revenueBySource.get(sourceKey) ?? { newAmount: 0, renewalAmount: 0 }

              if (isRenewal) {
                renewalAmount += amount
                currentRevenue.renewalAmount += amount
              } else {
                newAmount += amount
                currentRevenue.newAmount += amount
              }

              revenueBySource.set(sourceKey, currentRevenue)
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
        setTeamData([])
        setIsLoading(false)
        return
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

      const ownerStats = new Map<string, { leads: number; won: number; value: number }>()
      for (const lead of filteredLeads) {
        const ownerId = lead.owner_id ?? "unassigned"
        const current = ownerStats.get(ownerId) ?? { leads: 0, won: 0, value: 0 }

        current.leads += 1

        const logicalStage = getLogicalStage(lead)
        if (logicalStage === "Won") {
          current.won += 1
          if (typeof lead.budget === "number") {
            current.value += lead.budget
          }
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
        const stats = ownerStats.get(profile.id) ?? { leads: 0, won: 0, value: 0 }
        const totalLeads = stats.leads
        const winRate = totalLeads === 0 ? 0 : stats.won / totalLeads
        const avgDealValue = stats.won === 0 ? 0 : stats.value / stats.won
        const trend: "up" | "down" = winRate >= 0.3 ? "up" : "down"
        const interactions = interactionsByUserId.get(profile.id) ?? 0

        nextTeamData.push({
          id: profile.id,
          name: profile.full_name || profile.id.slice(0, 8),
          avatar: profile.avatar_url ?? null,
          leads: stats.leads,
          interactions,
          won: stats.won,
          value: stats.value,
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
        const avgDealValue =
          unassignedStats.won === 0 ? 0 : unassignedStats.value / unassignedStats.won
        const trend: "up" | "down" = winRate >= 0.3 ? "up" : "down"

        nextTeamData.push({
          id: "unassigned",
          name: "未分配",
          avatar: null,
          leads: unassignedStats.leads,
          interactions: 0,
          won: unassignedStats.won,
          value: unassignedStats.value,
          winRate,
          avgDealValue,
          trend,
        })
      }

      nextTeamData.sort((a, b) => b.value - a.value || b.won - a.won || b.leads - a.leads)

      setFunnelData(nextFunnelData)
      setSourceVolumeData(nextSourceVolume)
      setSourceConversionData(nextSourceConversion)
      setSourceRoiData(nextSourceRoi)
      setTeamData(nextTeamData)

      setIsLoading(false)
    }

    void fetchAnalytics()
  }, [dateRange, selectedTeam, leadScopeType, currentProfile])

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
    if (!canExportReports) {
      toast.error("没有导出权限", {
        description: "当前账号未开通报表导出权限，请联系系统管理员。",
      })
      return
    }

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
        const friendly = mapRpcError(error, {
          title: "导出失败",
          description: "提交导出请求时出错，请稍后重试",
        })
        toast.error(friendly.title, { description: friendly.description })
        return
      }
    } catch (err) {
      const friendly = mapRpcError(err as any, {
        title: "导出失败",
        description: "导出过程中发生异常，请稍后重试",
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="outline" className="w-[280px] bg-transparent" disabled>
            <CalendarIcon className="mr-2 h-4 w-4" />
            加载中...
          </Button>
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
      {/* Filters Row - responsive */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full sm:w-[280px] justify-start text-left font-normal bg-transparent"
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
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
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="选择团队" />
            </SelectTrigger>
            <SelectContent>
              {effectiveTeams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 合同与续费概览 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">未来 30 天到期合同</CardTitle>
            <CardDescription>在当前筛选时间范围内，服务将在未来 30 天内到期的合同数量。</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-destructive">{contractExpiringSoon}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">已到期合同</CardTitle>
            <CardDescription>在当前筛选时间范围内，已到期但仍在统计范围内的合同。</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{contractExpiredRecently}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">新签 vs 续费金额</CardTitle>
            <CardDescription>当前筛选时间内的合同签约金额拆分。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>首单合同金额</span>
                <span className="font-semibold text-foreground">
                  {new Intl.NumberFormat("zh-CN", {
                    style: "currency",
                    currency: "CNY",
                    maximumFractionDigits: 0,
                  }).format(contractNewAmount || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>续费合同金额</span>
                <span className="font-semibold text-emerald-600">
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
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-2">
          <div>
            <CardTitle className="text-base font-semibold">销售漏斗转化分析</CardTitle>
            <CardDescription>从原始线索到成交的各阶段转化情况</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadCSV("funnel")}>下载 CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 10, right: 80, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                <XAxis type="number" />
                <YAxis dataKey="stage" type="category" width={80} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`${value} 条`, "线索数量"]}
                  labelFormatter={(label) => funnelData.find((d) => d.stage === label)?.fullName || label}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Conversion rate indicators - responsive */}
          <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
            {funnelData.map((item, index) => (
              <div key={item.stage} className="flex items-center">
                <div className="text-center px-2 sm:px-3 py-1.5 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">{item.stage}</div>
                  <div className="text-sm font-semibold">{item.count.toLocaleString()}</div>
                </div>
                {index < funnelData.length - 1 && (
                  <div className="flex items-center mx-1">
                    <ChevronRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
                    <Badge variant="secondary" className="text-xs">
                      {getConversionRate(index)}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
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
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-2">
            <div>
              <CardTitle className="text-base font-semibold">线索来源分布</CardTitle>
              <CardDescription>各渠道线索数量占比</CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadCSV("source-volume")}>下载 CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourceVolumeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {sourceVolumeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${value} 条`, "线索数量"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Bar Chart: Conversion Rate by Source */}
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-2">
            <div>
              <CardTitle className="text-base font-semibold">渠道转化率对比</CardTitle>
              <CardDescription>各来源渠道的转化效率</CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadCSV("source-conversion")}>下载 CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceConversionData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="source" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(value) => `${value}%`} domain={[0, 25]} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === "rate") return [`${value}%`, "转化率"]
                      return [value, name]
                    }}
                  />
                  <Bar dataKey="rate" fill="#10b981" radius={[4, 4, 0, 0]} barSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Source ROI Table */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-2">
          <div>
            <CardTitle className="text-base font-semibold">来源 ROI 指标</CardTitle>
            <CardDescription>按来源贯通线索→成交→合同金额（首单 + 续费）。</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadCSV("source-roi")}>
                下载 CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>来源渠道</TableHead>
                <TableHead className="text-right">线索数</TableHead>
                <TableHead className="text-right">成交数</TableHead>
                <TableHead className="text-right">成交率</TableHead>
                <TableHead className="text-right">首单金额</TableHead>
                <TableHead className="text-right">续费金额</TableHead>
                <TableHead className="text-right">总金额</TableHead>
                <TableHead className="text-right">单线索金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceRoiData.map((row) => (
                <TableRow key={row.source}>
                  <TableCell>{row.source}</TableCell>
                  <TableCell className="text-right">{row.leads}</TableCell>
                  <TableCell className="text-right">{row.won}</TableCell>
                  <TableCell className="text-right">
                    {row.leads === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <span className="font-semibold">{row.winRate.toFixed(1)}%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {new Intl.NumberFormat("zh-CN", {
                      style: "currency",
                      currency: "CNY",
                      maximumFractionDigits: 0,
                    }).format(row.newAmount || 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    {new Intl.NumberFormat("zh-CN", {
                      style: "currency",
                      currency: "CNY",
                      maximumFractionDigits: 0,
                    }).format(row.renewalAmount || 0)}
                  </TableCell>
                  <TableCell className="text-right">
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
                      <span>
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

      {/* Chart 3: Team Activity Leaderboard */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-2">
          <div>
            <CardTitle className="text-base font-semibold">团队业绩排行榜</CardTitle>
            <CardDescription>销售人员线索跟进及成交情况</CardDescription>
            {poolLeadsCount !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                当前公海池线索：
                <span className="font-medium text-amber-600">{poolLeadsCount}</span>
                条（不计入下方图表与排行榜统计）
              </p>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadCSV("team-leaderboard")}>下载 CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">排名</TableHead>
                <TableHead>销售代表</TableHead>
                <TableHead className="text-right">线索数</TableHead>
                <TableHead className="text-right">跟进数</TableHead>
                <TableHead className="text-right">成交数</TableHead>
                <TableHead className="text-right">成交率</TableHead>
                <TableHead className="text-right">客单价</TableHead>
                <TableHead className="text-right">成交金额</TableHead>
                <TableHead className="text-right w-[80px]">趋势</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamData.map((rep, index) => (
                <TableRow key={rep.id}>
                  <TableCell>
                    {index < 3 ? (
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0
                            ? "bg-amber-100 text-amber-700"
                            : index === 1
                              ? "bg-slate-100 text-slate-600"
                              : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {index === 0 && <Trophy className="w-3.5 h-3.5" />}
                        {index === 1 && "2"}
                        {index === 2 && "3"}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">{index + 1}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        {rep.avatar && <AvatarImage src={rep.avatar} alt={rep.name} />}
                        <AvatarFallback>{rep.name?.trim()?.[0] ?? "?"}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{rep.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{rep.leads}</TableCell>
                  <TableCell className="text-right">
                    <span className="text-muted-foreground">{rep.interactions}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="font-semibold">
                      {rep.won}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {rep.leads === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <span className="font-semibold">{(rep.winRate * 100).toFixed(1)}%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {rep.won === 0 ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <span className="font-medium">¥{(rep.avgDealValue / 10000).toFixed(1)}万</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-emerald-600">
                    ¥{(rep.value / 10000).toFixed(1)}万
                  </TableCell>
                  <TableCell className="text-right">
                    {rep.trend === "up" ? (
                      <TrendingUp className="h-4 w-4 text-emerald-500 ml-auto" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-500 ml-auto" />
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
