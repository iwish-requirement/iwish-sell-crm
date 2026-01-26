"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"


import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type WecomBindStatus = "bound" | "unbound" | "failed" | null

type WecomProfileState = {
  wecomUserId: string | null
  bindStatus: WecomBindStatus
  boundAt: string | null
}


function formatDateTime(value: string | null): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN")
}

function getStatusLabel(status: WecomBindStatus): { label: string; variant: "secondary" | "outline" | "destructive" } {
  if (status === "bound") return { label: "已绑定", variant: "secondary" }
  if (status === "failed") return { label: "绑定失败", variant: "destructive" }
  return { label: "未绑定", variant: "outline" }
}

export function ProfileCenter() {
  const router = useRouter()

  const [isLoading, setIsLoading] = useState(true)
  const [profile, setProfile] = useState<WecomProfileState | null>(null)
  const [isStartingBind, setIsStartingBind] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const ok = params.get("wecomBind")
    const err = params.get("wecomBindError")

    if (!ok && !err) return

    if (ok === "success") {
      toast.success("企微绑定成功")
    } else if (err) {
      toast.error("企微绑定失败", { description: err })
    }

    // 清理 query，避免刷新重复提示
    router.replace("/profile")
  }, [router])


  useEffect(() => {
    let isMounted = true

    async function loadWecomState() {
      try {
        setIsLoading(true)
        const supabase = getBrowserSupabaseClient()

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError || !user) {
          if (!isMounted) return
          setProfile(null)
          return
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("wecom_user_id, wecom_bind_status, wecom_bound_at")
          .eq("id", user.id)
          .maybeSingle()

        if (error) {
          console.error("Failed to load wecom bind state", error)
          if (!isMounted) return
          setProfile(null)
          return
        }

        if (!isMounted) return

        setProfile({
          wecomUserId: (data as any)?.wecom_user_id ?? null,
          bindStatus: ((data as any)?.wecom_bind_status as WecomBindStatus) ?? null,
          boundAt: (data as any)?.wecom_bound_at ?? null,
        })
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    void loadWecomState()

    return () => {
      isMounted = false
    }
  }, [])

  const handleStartBind = async () => {
    try {
      setIsStartingBind(true)

      const res = await fetch("/api/wecom/bind/start")
      const json = (await res.json().catch(() => null)) as any

      const url = json && typeof json.url === "string" ? json.url.trim() : ""

      if (!res.ok || !url) {
        const message = String(json?.error ?? json?.detail ?? "网关返回异常")
        throw new Error(message)
      }

      window.location.href = url
    } catch (err: any) {
      const message = String(err?.message ?? "")
      toast.error("发起企微绑定失败", { description: message || "请稍后重试" })
    } finally {
      setIsStartingBind(false)
    }
  }


  const statusInfo = getStatusLabel(profile?.bindStatus ?? null)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">个人资料</h1>
        <p className="text-sm text-muted-foreground mt-1">管理你的个人信息与企微绑定状态。</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base font-bold text-foreground">企业微信绑定</CardTitle>
          {isLoading ? <Skeleton className="h-6 w-14" /> : <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>}
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-9 w-28" />
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  <span className="font-medium text-foreground">企微 UserId：</span>
                  <span className="ml-1">{profile?.wecomUserId ? profile.wecomUserId : "-"}</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">绑定时间：</span>
                  <span className="ml-1">{formatDateTime(profile?.boundAt ?? null)}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={handleStartBind}
                  disabled={isStartingBind}
                  className="w-full sm:w-auto"
                >
                  {profile?.bindStatus === "bound" ? "重新绑定" : "扫码绑定"}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                扫码后网关会回调本系统完成落库；若你此前已登录，回跳后可直接使用，无需再次登录。
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
