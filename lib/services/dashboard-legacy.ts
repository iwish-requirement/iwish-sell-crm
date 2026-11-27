import { fetchCurrentUserProfile } from "@/lib/auth/profile"
import { getDashboardCacheKey } from "@/lib/services/dashboard-cache"
import {
  addDays,
  FOLLOW_UP_STAGE_FLOW,
  getDateRange,
  getFollowUpStageLabel,
  startOfLocalDay,
  toDateKey,
  type DailyActivityUserRow as MemberRow,
  type DashboardActivityFilterParams,
  type DashboardActivitySnapshot,
  type DashboardAlert,
  type DashboardCursor,
  type DashboardCustomerDetailRow,
  type DashboardTrendPoint,
  type FollowUpFunnelBand,
  type RoleDashboardActivity,
  type TeamActivityRow,
  DETAIL_PAGE_SIZE,
} from "@/lib/services/dashboard"

type DashboardFilterParams = Pick<DashboardActivityFilterParams, "startDate" | "endDate" | "allTime"> & {
  ownerId?: string
  teamId?: number
}
type DailyActivityUserRow = MemberRow & { additionalTeamIds: number[] }
type LegacyDashboardActivity = RoleDashboardActivity & {
  users: DailyActivityUserRow[]
  customerDetails: DashboardCustomerDetailRow[]
}

// Transitional reader while the aggregate RPC is being rolled out to the database.
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { createDashboardCache } from "@/lib/services/dashboard-cache"
import type { LeadSecureRow } from "@/lib/services/leads"
import { crmDate, fetchCrmNextActions } from "@/lib/services/crm-visits"

function isTerminalFollowUpStage(value: string | null | undefined): boolean {
  const key = (value ?? "").trim()
  return key === "won" || key === "payment_received"
}

function readExcludedIds(
  teamExclusionRow: any,
  profileExclusionRow: any,
): { excludedTeamIds: Set<number>; excludedProfileIds: Set<string> } {
  const excludedTeamIds = new Set<number>(
    teamExclusionRow &&
      teamExclusionRow.value &&
      Array.isArray((teamExclusionRow.value as any).team_ids)
      ? ((teamExclusionRow.value as any).team_ids as any[]).filter((v: any) => typeof v === "number")
      : [],
  )

  const excludedProfileIds = new Set<string>(
    profileExclusionRow &&
      profileExclusionRow.value &&
      Array.isArray((profileExclusionRow.value as any).profile_ids)
      ? ((profileExclusionRow.value as any).profile_ids as any[]).filter((v: any) => typeof v === "string")
      : [],
  )

  return { excludedTeamIds, excludedProfileIds }
}

function isQualifiedLead(
  lead: Pick<LeadSecureRow, "stage" | "follow_up_stage" | "customer_grade" | "customer_attribute">,
): boolean {
  if ((lead.customer_attribute ?? "") === "invalid") return false
  const grade = (lead.customer_grade ?? "").trim().toUpperCase()
  const stage = (lead.follow_up_stage ?? "").trim() || (lead.stage ?? "").trim()
  return (stage !== "" && stage !== "uncontacted" && stage !== "L1") || ["S", "A", "B"].includes(grade)
}

function isWonLead(lead: Pick<LeadSecureRow, "stage" | "status" | "close_result">): boolean {
  const stage = (lead.stage ?? "").trim()
  const closeResult = (lead.close_result ?? "").trim()
  return (
    stage === "Won" ||
    (lead.status === "closed" && (closeResult === "won" || closeResult === "成交"))
  )
}

function getLeadOwnerKey(lead: Pick<LeadSecureRow, "owner_id" | "created_by">): string | null {
  return lead.owner_id ?? lead.created_by ?? null
}

const SETTINGS_KEYS = ["analytics.excluded_teams", "analytics.excluded_profiles", "gm_dashboard.excluded_teams"]
const referenceCache = createDashboardCache<DashboardReferenceData>(60_000)

type DashboardReferenceData = {
  settingsRows: { key: string; value: unknown }[]
  quotas: { profile_id: string; quota: number }[]
  membershipRows: { profile_id: string; team_id: number }[]
  profileRows: { id: string; full_name: string | null; avatar_url: string | null; team_id: number | null }[]
  teamRows: { id: number; name: string | null; is_active: boolean }[]
}

async function fetchDashboardReferenceData(
  params: DashboardFilterParams,
  signal: AbortSignal,
  cacheKey: string | null,
): Promise<DashboardReferenceData> {
  const cached = referenceCache.get(cacheKey)
  if (cached) return cached

  const supabase = getBrowserSupabaseClient()
  let profilesQuery = supabase
    .from("profiles_public_view")
    .select("id, full_name, avatar_url, team_id, status")
    .eq("status", "active")
    .limit(500)
  if (params.teamId !== undefined) profilesQuery = profilesQuery.eq("team_id", params.teamId)
  if (params.ownerId) profilesQuery = profilesQuery.eq("id", params.ownerId)

  const [
    { data: settingsRows, error: settingsError },
    { data: quotas, error: quotaError },
    { data: membershipRows, error: membershipError },
    { data: profileRows, error: profilesError },
    { data: teamRows, error: teamsError },
  ] = await Promise.all([
    supabase.from("settings").select("key, value").in("key", SETTINGS_KEYS).abortSignal(signal),
    supabase.rpc("rpc_crm_dashboard_quotas").abortSignal(signal),
    supabase.from("profile_team_memberships").select("profile_id, team_id").abortSignal(signal),
    profilesQuery.abortSignal(signal),
    supabase.from("teams").select("id, name, is_active").abortSignal(signal),
  ])
  signal.throwIfAborted()

  const result = {
    settingsRows: settingsRows ?? [],
    quotas: quotas ?? [],
    membershipRows: membershipRows ?? [],
    profileRows: profileRows ?? [],
    teamRows: teamRows ?? [],
  }
  const errors = [settingsError, quotaError, membershipError, profilesError, teamsError].filter(Boolean)
  if (errors.length > 0) {
    console.error("Failed to load some role dashboard reference data", errors)
  } else {
    referenceCache.set(cacheKey, result)
  }
  return result
}

async function fetchDashboardLeads(
  params: DashboardFilterParams,
  signal: AbortSignal,
) {
  let query = getBrowserSupabaseClient()
    .from("leads_secure_view")
    .select(
      "id, team_id, owner_id, created_by, name, customer_name, stage, follow_up_stage, customer_attribute, status, close_result, last_contact_at, created_at, updated_at, customer_grade",
    )
    .neq("status", "pool")
    .limit(5000)
  if (params.teamId !== undefined) query = query.eq("team_id", params.teamId)
  if (params.ownerId) query = query.eq("owner_id", params.ownerId)

  const { data, error } = await query.abortSignal(signal)
  signal.throwIfAborted()
  if (error) throw error
  return (data ?? []) as LeadSecureRow[]
}

async function fetchLegacyRoleDashboardActivity(
  params: DashboardFilterParams,
  signal: AbortSignal,
  cacheKey: string | null,
): Promise<LegacyDashboardActivity> {
  const supabase = getBrowserSupabaseClient()
  const today = crmDate()
  const todayStart = new Date(today + "T00:00:00+08:00")
  const { rangeStart, rangeEnd, trendStart, dateLabel: autoLabel } = getDateRange(params)
  const dateLabel = params.allTime ? "全部" : autoLabel
  const [{ settingsRows, quotas, membershipRows, profileRows, teamRows }, leadRows] = await Promise.all([
    fetchDashboardReferenceData(params, signal, cacheKey),
    fetchDashboardLeads(params, signal),
  ])
  signal.throwIfAborted()

  const teamExclusionRow = settingsRows.find(({ key }) => key === "analytics.excluded_teams")
  const profileExclusionRow = settingsRows.find(({ key }) => key === "analytics.excluded_profiles")
  const gmExclusionRow = settingsRows.find(({ key }) => key === "gm_dashboard.excluded_teams")
  const { excludedTeamIds, excludedProfileIds } = readExcludedIds(teamExclusionRow, profileExclusionRow)

  // 总经理仪表盘专属排除团队：与通用排除一并隐藏（线索、部门行、成员）
  const gmExcludedTeamIds = new Set<number>(
    gmExclusionRow &&
      (gmExclusionRow as any).value &&
      Array.isArray(((gmExclusionRow as any).value as any).team_ids)
      ? (((gmExclusionRow as any).value as any).team_ids as any[]).filter((v: any) => typeof v === "number")
      : [],
  )
  const hiddenTeamIds = new Set<number>([...excludedTeamIds, ...gmExcludedTeamIds])

  // 多团队归属：成员以主团队计入统计，附加团队仅在成员明细中可见
  const membershipsByProfile = new Map<string, number[]>()
  for (const row of (membershipRows ?? []) as any[]) {
    const profileId = row.profile_id as string
    const teamId = Number(row.team_id)
    if (!profileId || !Number.isFinite(teamId)) continue
    const list = membershipsByProfile.get(profileId) ?? []
    list.push(teamId)
    membershipsByProfile.set(profileId, list)
  }

  const quotaLimit = 60
  const quotaByProfile = new Map(quotas.map(({ profile_id, quota }) => [profile_id, quota]))

  const teamNameById = new Map<number, string>()
  for (const row of teamRows) {
    if (row.is_active === false) continue
    // 通用排除与总经理仪表盘排除的团队均不出现
    if (hiddenTeamIds.has(row.id as number)) continue
    teamNameById.set(row.id as number, (row.name as string) ?? `团队 ${row.id}`)
  }

  const leads = leadRows.filter((lead) => {
    const teamId = lead.team_id ?? null
    const ownerId = lead.owner_id ?? null
    if (teamId != null && hiddenTeamIds.has(teamId)) return false
    if (ownerId && excludedProfileIds.has(ownerId)) return false
    return true
  })

  const usersById = new Map<string, DailyActivityUserRow>()
  for (const row of profileRows) {
    const id = row.id as string
    const teamId = (row.team_id as number | null) ?? null
    if (excludedProfileIds.has(id)) continue
    if (teamId != null && hiddenTeamIds.has(teamId)) continue
    usersById.set(id, {
      id,
      name: (row.full_name as string | null) || id.slice(0, 8),
      avatarUrl: (row.avatar_url as string | null) ?? null,
      teamId,
      activeLeads: 0,
      stageCounts: {} as Record<string, number>,
      // 附加团队（成员以主团队计入统计，附加团队明细中仅作查看）
      additionalTeamIds: (membershipsByProfile.get(id) ?? []).filter(
        (tid) => tid !== teamId && !hiddenTeamIds.has(tid),
      ),
      newLeads: 0,
      contactActions: 0,
      visits: 0,
      followUps: 0,
      qualifiedLeads: 0,
      wonLeads: 0,
      overdueLeads: 0,
      quotaLimit: quotaByProfile.get(id) ?? quotaLimit,
    })
  }

  // 归属人不是在职成员的线索（如已离职/停用账号）不生成成员行；
  // 其线索量仍计入部门与漏斗统计，账号停用后由迁移统一退回公海池。

  const trendMap = new Map<string, DashboardTrendPoint>()
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(trendStart, i)
    const key = toDateKey(day)
    trendMap.set(key, { date: key.slice(5), newLeads: 0, contactActions: 0, visits: 0, won: 0 })
  }

  let periodNewLeads = 0
  let qualifiedLeads = 0
  let wonLeads = 0
  let periodWon = 0
  let overdueLeads = 0
  let pendingInRange = 0
  let newlyAssigned = 0
  const stageCounts = new Map<string, number>()
  const teamStockById = new Map<
    number,
    { activeLeads: number; wonLeads: number; paymentReceived: number; stageCounts: Record<string, number> }
  >()
  const teamNewLeadsById = new Map<number, number>()
  const customerDetailsById = new Map<string, DashboardCustomerDetailRow>()

  const leadIds = leads.map((lead) => lead.id).filter(Boolean)
  const nextActions = await fetchCrmNextActions(leads.filter((lead) => lead.status === "open").map((lead) => lead.id), signal)
  const leadById = new Map<string, LeadSecureRow>()
  for (const lead of leads) {
    leadById.set(lead.id, lead)
  }

  const addCustomerDetail = (lead: LeadSecureRow): DashboardCustomerDetailRow | null => {
    const ownerKey = getLeadOwnerKey(lead)
    const next = nextActions.get(lead.id)?.next_contact_at ?? null
    const nextContactAt = next ? new Date(next) : null
    const status = lead.status ?? "open"
    const ownerName = ownerKey ? usersById.get(ownerKey)?.name ?? ownerKey.slice(0, 8) : "未分配"
    const existing = customerDetailsById.get(lead.id)
    if (existing) return existing

    const detail: DashboardCustomerDetailRow = {
      id: lead.id,
      companyName: lead.name || "未命名线索",
      contactName: (lead as any).customer_name || "-",
      ownerId: ownerKey,
      ownerName,
      stage: getFollowUpStageLabel(lead.follow_up_stage ?? lead.stage),
      status: lead.status || "-",
      grade: lead.customer_grade ?? null,
      createdAt: lead.created_at ?? null,
      lastContactAt: lead.last_contact_at ?? null,
      nextContactAt: next,
      contactActions: 0,
      visits: 0,
      followUps: 0,
      isQualified: isQualifiedLead(lead),
      isWon: isWonLead(lead),
      isOverdue: status === "open" && nextContactAt !== null && nextContactAt < todayStart,
    }
    customerDetailsById.set(lead.id, detail)
    return detail
  }

  for (const lead of leads) {
    const ownerKey = getLeadOwnerKey(lead)
    const user = ownerKey ? usersById.get(ownerKey) : null
    const createdAt = lead.created_at ? new Date(lead.created_at) : null
    const updatedAt = lead.updated_at ? new Date(lead.updated_at) : null
    const next = nextActions.get(lead.id)?.next_contact_at ?? null
    const nextContactAt = next ? new Date(next) : null
    const status = lead.status ?? "open"
    const followUpStage = (lead.follow_up_stage ?? "").trim()
    const isInvalid = (lead.customer_attribute ?? "") === "invalid"
    const terminal = isTerminalFollowUpStage(followUpStage)
    const teamKey = lead.team_id ?? null

    if (createdAt && createdAt >= rangeStart && createdAt < rangeEnd) {
      periodNewLeads += 1
      user && (user.newLeads += 1)
      if (teamKey != null) {
        teamNewLeadsById.set(teamKey, (teamNewLeadsById.get(teamKey) ?? 0) + 1)
      }
    }

    if (createdAt && createdAt >= trendStart && createdAt < rangeEnd) {
      const point = trendMap.get(toDateKey(startOfLocalDay(createdAt)))
      if (point) point.newLeads += 1
    }

    if (updatedAt && updatedAt >= rangeStart && updatedAt < rangeEnd) {
      newlyAssigned += 1
    }

    if (isQualifiedLead(lead)) {
      qualifiedLeads += 1
      user && (user.qualifiedLeads += 1)
    }

    if (isWonLead(lead)) {
      wonLeads += 1
      user && (user.wonLeads += 1)
    }

    // 阶段分布按所选时段内新增的线索统计（当前所处阶段）；
    // 全部时间（或覆盖全部时间的范围）时即为全量快照。
    // 同时按负责人累计成员级阶段分布，供部门成员明细与部门对比对齐展示
    if (!isInvalid && createdAt && createdAt >= rangeStart && createdAt < rangeEnd) {
      const stageKey = followUpStage || "uncontacted"
      stageCounts.set(stageKey, (stageCounts.get(stageKey) ?? 0) + 1)
      if (user) {
        user.stageCounts[stageKey] = (user.stageCounts[stageKey] ?? 0) + 1
      }
    }

    if (teamKey != null) {
      const stock =
        teamStockById.get(teamKey) ??
        { activeLeads: 0, wonLeads: 0, paymentReceived: 0, stageCounts: {} as Record<string, number> }
      if (!isInvalid && !terminal && status === "open") stock.activeLeads += 1
      if (isWonLead(lead)) stock.wonLeads += 1
      if (followUpStage === "payment_received") stock.paymentReceived += 1
      if (!isInvalid && createdAt && createdAt >= rangeStart && createdAt < rangeEnd) {
        const stageKey = followUpStage || "uncontacted"
        stock.stageCounts[stageKey] = (stock.stageCounts[stageKey] ?? 0) + 1
      }
      teamStockById.set(teamKey, stock)
    }

    if (status === "open" && !isInvalid && !terminal) {
      user && (user.activeLeads += 1)
      const isDueInRange = nextContactAt && nextContactAt >= rangeStart && nextContactAt < rangeEnd
      const isNextContactOverdue = nextContactAt && nextContactAt < todayStart

      if (isDueInRange) pendingInRange += 1
      if (isNextContactOverdue) {
        overdueLeads += 1
        user && (user.overdueLeads += 1)
      }
    }

    const shouldShowDetail =
      (createdAt && createdAt >= rangeStart && createdAt < rangeEnd) ||
      (nextContactAt && nextContactAt >= rangeStart && nextContactAt < rangeEnd)

    if (shouldShowDetail) {
      addCustomerDetail(lead)
    }
  }

  if (leadIds.length > 0) {
    // 趋势点固定取最近 7~31 天；时段统计需要覆盖完整所选范围，
    // 因此拉取起点取两者中更早的一个
    const notesSince = trendStart < rangeStart ? trendStart : rangeStart
    const { data: notesRows, error: notesError } = await supabase
      .from("lead_notes")
      .select("author_id, lead_id, note_type, created_at, is_deleted")
      .in("lead_id", leadIds)
      .gte("created_at", notesSince.toISOString())
      .lte("created_at", rangeEnd.toISOString())
      .limit(5000)
      .abortSignal(signal)

    signal.throwIfAborted()
    if (notesError) {
      console.error("Failed to load role dashboard notes", notesError)
    } else {
      for (const note of (notesRows ?? []) as any[]) {
        if (note.is_deleted) continue
        const authorId = (note.author_id as string | null) ?? null
        const noteType = ((note.note_type as string | null) ?? "note").trim()
        const createdAt = note.created_at ? new Date(note.created_at as string) : null
        if (!createdAt) continue

        const isInRange = createdAt >= rangeStart && createdAt < rangeEnd
        const point = trendMap.get(toDateKey(startOfLocalDay(createdAt)))
        const user = authorId ? usersById.get(authorId) : null
        const isContact = noteType === "call" || noteType === "wechat"
        const isVisit = noteType === "visit"
        const isWonNote = noteType === "won"
        const noteLeadId = (note.lead_id as string | null) ?? null
        const leadForNote = noteLeadId ? leadById.get(noteLeadId) : null
        const detail = isInRange && leadForNote ? addCustomerDetail(leadForNote) : null

        if (isWonNote && point) point.won += 1
        if (isWonNote && isInRange) periodWon += 1

        if (isContact) {
          if (point) point.contactActions += 1
          if (isInRange) {
            user && (user.contactActions += 1)
            if (detail) detail.contactActions += 1
          }
        }
        if (isVisit) {
          if (point) point.visits += 1
          if (isInRange) {
            user && (user.visits += 1)
            if (detail) detail.visits += 1
          }
        }
        if (isInRange) {
          if (user) user.followUps += 1
          if (detail) detail.followUps += 1
        }
      }
    }
  }

  const users = Array.from(usersById.values()).sort((a, b) => {
    if (b.overdueLeads !== a.overdueLeads) return b.overdueLeads - a.overdueLeads
    return b.newLeads + b.contactActions + b.visits - (a.newLeads + a.contactActions + a.visits)
  })

  const totals = users.reduce(
    (acc, user) => {
      acc.contactActions += user.contactActions
      acc.visits += user.visits
      acc.followUps += user.followUps
      return acc
    },
    {
      newLeads: periodNewLeads,
      contactActions: 0,
      visits: 0,
      followUps: 0,
      qualifiedLeads,
      wonLeads,
      wonInRange: periodWon,
      overdueLeads,
      pendingToday: pendingInRange,
      newlyAssigned,
    },
  )

  const alerts: DashboardAlert[] = []
  const noNewLeadUsers = users.filter((user) => user.newLeads === 0)
  const noContactUsers = users.filter((user) => user.contactActions === 0)
  const noVisitUsers = users.filter((user) => user.visits === 0)
  const highOverdueUsers = users.filter((user) => user.overdueLeads > 0).slice(0, 3)

  if (overdueLeads > 0) {
    alerts.push({
      id: "overdue-leads",
      type: "danger",
      title: `${overdueLeads} 条线索逾期未跟进`,
      description: "建议优先处理高等级和已约定下次跟进时间的线索。",
    })
  }
  if (noNewLeadUsers.length > 0) {
    alerts.push({
      id: "no-new-leads",
      type: "warning",
      title: `${noNewLeadUsers.length} 人今日暂无新增线索`,
      description: noNewLeadUsers.slice(0, 4).map((user) => user.name).join("、"),
    })
  }
  if (noContactUsers.length > 0) {
    alerts.push({
      id: "no-contact-actions",
      type: "warning",
      title: `${noContactUsers.length} 人今日暂无建联行动`,
      description: noContactUsers.slice(0, 4).map((user) => user.name).join("、"),
    })
  }
  if (noVisitUsers.length > 0) {
    alerts.push({
      id: "no-visits",
      type: "info",
      title: `${noVisitUsers.length} 人今日暂无拜访记录`,
      description: "拜访包含线下拜访和需要记录为拜访的深度客户沟通。",
    })
  }
  for (const user of highOverdueUsers) {
    alerts.push({
      id: `user-overdue-${user.id}`,
      type: "danger",
      title: `${user.name} 有 ${user.overdueLeads} 条逾期线索`,
      description: "可进入线索页按负责人和风险状态进一步处理。",
    })
  }

  const teamIds = new Set<number>([...teamNameById.keys(), ...teamStockById.keys()])
  const teams: TeamActivityRow[] = Array.from(teamIds)
    .map((teamId) => {
      const members = users.filter((user) => user.teamId === teamId)
      const stock =
        teamStockById.get(teamId) ??
        { activeLeads: 0, wonLeads: 0, paymentReceived: 0, stageCounts: {} as Record<string, number> }
      const capacity = members.reduce((sum, member) => sum + (member.quotaLimit ?? quotaLimit), 0) || quotaLimit
      return {
        teamId,
        teamName: teamNameById.get(teamId) ?? `团队 ${teamId}`,
        memberCount: members.length,
        activeLeads: stock.activeLeads,
        newLeads: teamNewLeadsById.get(teamId) ?? 0,
        contactActions: members.reduce((sum, user) => sum + user.contactActions, 0),
        visits: members.reduce((sum, user) => sum + user.visits, 0),
        followUps: members.reduce((sum, user) => sum + user.followUps, 0),
        wonLeads: stock.wonLeads,
        paymentReceived: stock.paymentReceived,
        overdueLeads: members.reduce((sum, user) => sum + user.overdueLeads, 0),
        stageCounts: stock.stageCounts,
        quotaCapacity: capacity,
        quotaUsage: stock.activeLeads / capacity,
      }
    })
    .sort((a, b) => b.wonLeads - a.wonLeads || b.activeLeads - a.activeLeads)

  const stageFunnel: FollowUpFunnelBand[] = FOLLOW_UP_STAGE_FLOW.map((stage) => ({
    stageId: stage.id,
    label: stage.label,
    count: stageCounts.get(stage.id) ?? 0,
  }))

  return {
    dateLabel,
    totals,
    users,
    teams,
    trends: Array.from(trendMap.values()),
    alerts: alerts.slice(0, 6),
    customerDetails: Array.from(customerDetailsById.values())
      .sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
        const aTime = a.lastContactAt ?? a.createdAt ?? ""
        const bTime = b.lastContactAt ?? b.createdAt ?? ""
        return bTime.localeCompare(aTime)
      })
      .slice(0, 50),
    stageFunnel,
    quotaLimit,
  }
}

function legacyPage<Row extends { id: string }>(rows: Row[], after: DashboardCursor | null) {
  const cursorIndex = after ? rows.findIndex((row) => row.id === after.id) : -1
  const start = cursorIndex + 1
  const page = rows.slice(start, start + DETAIL_PAGE_SIZE)
  const last = page.at(-1)
  return {
    rows: page,
    nextCursor: last && start + page.length < rows.length ? { id: last.id, legacy: true as const } : null,
  }
}

export async function fetchLegacyDashboardSnapshot(
  params: DashboardActivityFilterParams,
  signal: AbortSignal,
): Promise<DashboardActivitySnapshot> {
  const client = getBrowserSupabaseClient()
  const { data, error } = await client.auth.getSession()
  signal.throwIfAborted()
  const session = data.session
  if (!session || error) throw error ?? new Error("Dashboard session unavailable")

  const filters: DashboardFilterParams = { ...params }
  if (params.scope === "self") filters.ownerId = session.user.id
  if (params.scope === "team") {
    const profile = await fetchCurrentUserProfile(client)
    signal.throwIfAborted()
    if (!profile || profile.id !== session.user.id) throw new Error("Dashboard team scope unavailable")
    if (profile.teamId != null) filters.teamId = profile.teamId
  }

  const key = params.scope === "custom" ? null : getDashboardCacheKey(session,
    JSON.stringify([params.scope, filters.ownerId, filters.teamId]),
  )
  const { users, customerDetails, ...activity } = await fetchLegacyRoleDashboardActivity(filters, signal, key)
  const rangeEnd = getDateRange(params).rangeEnd.getTime()
  const visibleTeams = new Set(activity.teams.map((team) => team.teamId))

  return {
    activity,
    async loadMembers(filter, after, pageSignal) {
      pageSignal.throwIfAborted()
      const rows = users.flatMap(({ additionalTeamIds, ...user }) => {
        if (filter.unassigned && (visibleTeams.has(user.teamId) || additionalTeamIds.some((id) => visibleTeams.has(id)))) {
          return []
        }
        const departmentId = filter.departmentId
        if (departmentId !== undefined && (!visibleTeams.has(departmentId) ||
          (user.teamId !== departmentId && !additionalTeamIds.includes(departmentId)))) {
          return []
        }
        return [{ ...user, isAdditional: departmentId !== undefined && user.teamId !== departmentId }]
      })
      return legacyPage(rows, after)
    },
    async loadCustomers(todoOnly, after, pageSignal) {
      pageSignal.throwIfAborted()
      const rows = todoOnly
        ? customerDetails.filter((row) => row.isOverdue ||
            (row.nextContactAt && new Date(row.nextContactAt).getTime() < rangeEnd))
        : customerDetails
      return legacyPage(rows, after)
    },
  }
}
