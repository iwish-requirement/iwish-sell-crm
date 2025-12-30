"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Clock, LogOut, Mail } from "lucide-react"

export default function PendingApprovalPage() {
  return (
    <Card className="border-0 shadow-xl text-center">
      <CardContent className="pt-12 pb-10 px-8">
        {/* Illustration */}
        <div className="mx-auto mb-8 w-32 h-32 bg-gradient-to-br from-amber-100 to-orange-100 rounded-full flex items-center justify-center">
          <div className="w-20 h-20 bg-gradient-to-br from-amber-200 to-orange-200 rounded-full flex items-center justify-center">
            <Clock className="w-10 h-10 text-amber-600" strokeWidth={1.5} />
          </div>
        </div>

        {/* Status Text */}
        <h1 className="text-2xl font-semibold text-foreground mb-2">审核中</h1>
        <p className="text-muted-foreground mb-6 max-w-xs mx-auto leading-relaxed">
          您的账户已创建成功，请等待管理员审核激活。审核通过后您将收到通知。
        </p>

        {/* Info Box */}
        <div className="bg-slate-50 rounded-lg p-4 mb-8">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Mail className="w-4 h-4" />
            <span>如有紧急需求，请联系系统管理员</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Button variant="outline" asChild>
            <Link href="/login">
              <LogOut className="w-4 h-4 mr-2" />
              返回登录
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
