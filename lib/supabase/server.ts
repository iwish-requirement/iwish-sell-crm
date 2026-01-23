import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

function resolveSupabaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""

  if (!url) {
    throw new Error(
      "Supabase URL is not configured. Please set NEXT_PUBLIC_SUPABASE_URL (recommended) or SUPABASE_URL.",
    )
  }

  return url
}

function resolveSupabaseAnonKey(): string {
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    ""

  if (!anonKey) {
    throw new Error(
      "Supabase anon key is not configured. Please set NEXT_PUBLIC_SUPABASE_ANON_KEY (recommended) or SUPABASE_ANON_KEY.",
    )
  }

  return anonKey
}


export function createRouteHandlerClient(): SupabaseClient {
  const cookieStore = cookies()
  return createServerClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set(name: string, value: string, options: any) {
        cookieStore.set({ name, value, ...options })
      },
      remove(name: string, options: any) {
        cookieStore.set({ name, value: "", ...options, maxAge: 0 })
      },
    },
  })
}
