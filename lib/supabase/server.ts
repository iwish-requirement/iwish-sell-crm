import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"

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

// Cloudflare Pages / Edge 环境下，next/headers 的 cookies() 兼容性不稳定。
// 这里改为基于 NextRequest.cookies 读取登录态 cookie，避免出现 “xxx.get is not a function”。
export function createRouteHandlerClient(req: NextRequest): SupabaseClient {
  return createServerClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value
      },
      // 本接口只需要读取 cookie 来获取当前用户；不需要写回 cookie
      set(_name: string, _value: string, _options: any) {},
      remove(_name: string, _options: any) {},
    },
  })
}
