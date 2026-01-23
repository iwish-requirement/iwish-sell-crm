import { createClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"

function resolveSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ""
  if (!url) {
    throw new Error("Supabase URL is not configured. Please set NEXT_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL.")
  }
  return url
}

function resolveSupabaseServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (!key) {
    throw new Error("Supabase service role key is not configured. Please set SUPABASE_SERVICE_ROLE_KEY.")
  }
  return key
}

export function createAdminSupabaseClient(): SupabaseClient {
  return createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
