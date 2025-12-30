"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!email) {
      setErrorMessage("请输入邮箱地址")
      return
    }

    setIsLoading(true)
    setMessage(null)
    setErrorMessage(null)

    try {
      const supabase = getBrowserSupabaseClient()
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      const redirectTo = `${origin}/auth/reset-password`

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      })

      if (error) {
        setErrorMessage(error.message || "发送重置邮件失败，请稍后重试")
        return
      }

      setMessage("如果该邮箱已注册，我们已向其发送重置密码邮件，请检查邮箱。")
    } catch (error) {
      setErrorMessage("发送重置邮件过程中发生错误，请稍后重试")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="border-0 shadow-xl">
      <CardHeader className="text-center pb-2 pt-8">
        <div className="mx-auto mb-4">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
            <span className="text-2xl font-bold text-primary-foreground">I</span>
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">重置密码</h1>
        <p className="text-sm text-muted-foreground mt-1">请输入注册邮箱，我们会发送重置密码邮件</p>
      </CardHeader>
      <CardContent className="pt-6 pb-8 px-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              placeholder="请输入注册邮箱地址"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          )}

          {message && !errorMessage && (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          )}

          <Button type="submit" className="w-full mt-6" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                发送中...
              </>
            ) : (
              "发送重置邮件"
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full mt-2"
            onClick={() => router.push("/auth/login")}
          >
            返回登录
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
