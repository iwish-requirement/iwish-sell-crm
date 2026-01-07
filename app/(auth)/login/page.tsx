"use client"

import type React from "react"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email || !password) {
      setErrorMessage("请输入邮箱和密码")
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const supabase = getBrowserSupabaseClient()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setErrorMessage(error.message || "登录失败，请检查邮箱和密码")
        return
      }

      // 登录成功后，记录登录审计到后端（不会影响正常跳转）
      try {
        await supabase.rpc("rpc_auth_login_audit", {
          p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        })
      } catch (auditError) {
        console.error("Failed to record auth login audit", auditError)
      }

      const redirectTo = searchParams.get("redirectTo")
      let targetPath = "/dashboard"

      if (redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
        targetPath = redirectTo
      }

      router.push(targetPath)
    } catch (error) {
      setErrorMessage("登录过程中发生错误，请稍后重试")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="border-0 shadow-xl p-0">
      <CardHeader className="text-center pb-1 pt-6">
        <div className="mx-auto mb-3">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
            <span className="text-2xl font-bold text-primary-foreground">I</span>
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Iwish</h1>
        <p className="text-sm text-muted-foreground mt-1">销售线索管理系统</p>
      </CardHeader>
      <CardContent className="pt-4 pb-6 px-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              placeholder="请输入邮箱地址"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {errorMessage && (
            <p className="text-sm text-destructive mt-1" role="alert">
              {errorMessage}
            </p>
          )}

          <Button type="submit" className="w-full mt-6" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                登录中...
              </>
            ) : (
              "登 录"
            )}
          </Button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <Link href="/register" className="text-sm text-primary hover:underline">
            创建账户
          </Link>
          <span className="text-muted-foreground mx-2">|</span>
          <Link
            href="/auth/forgot-password"
            className="text-sm text-muted-foreground hover:text-primary hover:underline"
          >
            忘记密码?
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  )
}
