"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Lock, LogIn } from "lucide-react"

export default function OnboardingDisabledPage() {
  return (
    <Card className="border-0 shadow-xl text-center">
      <CardContent className="pt-12 pb-10 px-8">
        <div className="mx-auto mb-8 w-32 h-32 bg-gradient-to-br from-slate-100 to-slate-200 rounded-full flex items-center justify-center">
          <div className="w-20 h-20 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center">
            <Lock className="w-10 h-10 text-slate-700" strokeWidth={1.5} />
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-foreground mb-2">账户已被禁用</h1>
        <p className="text-muted-foreground mb-6 max-w-xs mx-auto leading-relaxed">
          您的账户已被管理员禁用，暂时无法访问系统。如有疑问，请联系系统管理员。
        </p>

        <div className="flex flex-col gap-3">
          <Button variant="outline" asChild>
            <Link href="/auth/login">
              <LogIn className="w-4 h-4 mr-2" />
              返回登录
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
