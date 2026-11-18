import type { Session } from "@supabase/supabase-js"

export function getDashboardCacheKey(session: Session | null, scope: string | null): string | null {
  if (!session || scope === null) return null

  try {
    const payload = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const { session_id: sessionId, exp } = JSON.parse(atob(payload)) as { session_id?: unknown; exp?: unknown }
    if (typeof sessionId !== "string" || !sessionId || typeof exp !== "number" || exp * 1000 <= Date.now()) return null
    // Used only to isolate browser cache entries. Supabase still authorizes each network read.
    return JSON.stringify([session.user.id, sessionId, exp, scope])
  } catch {
    return null
  }
}

export function createDashboardCache<T>(ttlMs: number) {
  let entry: { key: string; value: T; expiresAt: number } | undefined

  return {
    get(key: string | null): T | undefined {
      if (!entry || entry.key !== key || entry.expiresAt <= Date.now()) {
        entry = undefined
        return undefined
      }
      return entry.value
    },
    set(key: string | null, value: T) {
      if (key !== null) entry = { key, value, expiresAt: Date.now() + ttlMs }
    },
  }
}
