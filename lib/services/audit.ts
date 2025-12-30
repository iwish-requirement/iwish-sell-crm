import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export interface AuditLogEntry {
  id: string
  actorId: string
  actorName?: string
  action: string
  targetType: string
  targetId: string
  reason: string | null
  createdAt: string
  before: unknown | null
  after: unknown | null
}

export async function fetchAuditLogs(limit = 200): Promise<AuditLogEntry[]> {
  const supabase = getBrowserSupabaseClient()

  // 首选：调用基于权限与 scope 的 recent activities RPC
  try {
    const { data, error } = await supabase.rpc("rpc_recent_activities", {
      p_limit: limit,
    })

    if (error) {
      throw error
    }

    const rows = (data ?? []) as any[]

    const normalized: AuditLogEntry[] = rows.map((row) => ({
      id: row.id as string,
      actorId: row.actor_id as string,
      actorName: ((row.actor_name as string | null) ?? undefined),
      action: row.action as string,
      targetType: row.target_type as string,
      targetId: row.target_id as string,
      reason: (row.reason as string | null) ?? null,
      createdAt: row.created_at as string,
      before: row.before ?? null,
      after: row.after ?? null,
    }))

    return normalized
  } catch (rpcError: any) {
    // 如果 RPC 不存在 / 权限配置异常，兜底回退到旧的 audit_logs 查询
    console.warn("rpc_recent_activities failed, falling back to audit_logs", {
      message: rpcError?.message,
      details: (rpcError as any)?.details,
      hint: (rpcError as any)?.hint,
      code: (rpcError as any)?.code,
    })

    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, actor_id, action, target_type, target_id, reason, created_at, before, after")
      .order("created_at", { ascending: false })
      .limit(limit)


    if (error) {
      console.error("Failed to load audit logs fallback", error)
      throw error
    }

    const rows = (data ?? []) as any[]

    const actorIds = Array.from(new Set(rows.map((row) => row.actor_id).filter(Boolean))) as string[]
    const actorNameById = new Map<string, string>()

    if (actorIds.length > 0) {
      const { data: actors, error: actorsError } = await supabase
        .from("profiles_public")
        .select("id, full_name")
        .in("id", actorIds)

      if (actorsError) {
        console.error("Failed to load audit actors in fallback", actorsError)
      } else {
        for (const actor of actors ?? []) {
          if (actor && actor.id) {
            actorNameById.set(actor.id as string, (actor.full_name as string) ?? "")
          }
        }
      }
    }

    const normalized: AuditLogEntry[] = rows.map((row) => ({
      id: row.id as string,
      actorId: row.actor_id as string,
      actorName: actorNameById.get(row.actor_id as string),
      action: row.action as string,
      targetType: row.target_type as string,
      targetId: row.target_id as string,
      reason: (row.reason as string | null) ?? null,
      createdAt: row.created_at as string,
      before: row.before ?? null,
      after: row.after ?? null,
    }))

    return normalized
  }
}


