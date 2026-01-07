import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import type { ProfileStatus } from '@/lib/auth/profile'
import { fetchCurrentUserProfile } from '@/lib/auth/profile'

function isPublicPath(pathname: string): boolean {
  if (
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/onboarding/') ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/pending-approval'
  ) {
    return true
  }

  // 允许 Next.js 静态资源与基础文件不经鉴权
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/public/') ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.png' ||
    pathname.startsWith('/_vercel/insights')
  ) {
    return true
  }


  return false
}

function resolveSupabaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    ''

  if (!url) {
    throw new Error(
      'Supabase URL is not configured. Please set NEXT_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL.',
    )
  }

  return url
}

function resolveSupabaseAnonKey(): string {
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    ''

  if (!anonKey) {
    throw new Error(
      'Supabase anon key is not configured. Please set NEXT_PUBLIC_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY.',
    )
  }

  return anonKey
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const response = NextResponse.next()

  const supabase = createServerClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value
      },
      set(name: string, value: string, options: any) {
        response.cookies.set({ name, value, ...options })
      },
      remove(name: string, options: any) {
        response.cookies.set({ name, value: '', ...options })
      },
    },
  })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  // 未登录：统一重定向到 /auth/login
  if (!session) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  const profile = await fetchCurrentUserProfile(supabase)

  // 没有 profile 视为 pending，强制进入 onboarding
  const status: ProfileStatus = profile?.status ?? 'pending'

  if (status === 'pending') {
    if (!pathname.startsWith('/onboarding/')) {
      return NextResponse.redirect(new URL('/onboarding/pending', request.url))
    }

    return response
  }

  if (status === 'disabled') {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/onboarding/disabled', request.url))
  }

  if (status === 'rejected') {
    if (!pathname.startsWith('/onboarding/')) {
      return NextResponse.redirect(new URL('/onboarding/rejected', request.url))
    }

    return response
  }

  // active 用户放行
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png|_vercel/insights).*)'],
}

