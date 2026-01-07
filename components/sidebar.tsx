"use client"

import React, { useContext, useState } from "react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, Users, Globe, Settings, Sparkles, BarChart3, Menu, DollarSign, RefreshCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { MePermissionsContext } from "@/components/app-root"


type NavItemId = "dashboard" | "leads" | "pool" | "deals" | "renewals" | "analytics" | "settings" | "audit"

const navItems: { id: NavItemId; label: string; icon: typeof LayoutDashboard; href: string }[] = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard, href: "/dashboard" },
  { id: "leads", label: "我的线索", icon: Users, href: "/leads" },
  { id: "pool", label: "公海池", icon: Globe, href: "/pool" },
  { id: "deals", label: "成交中心", icon: DollarSign, href: "/deals" },
  { id: "renewals", label: "续费中心", icon: RefreshCcw, href: "/renewals" },
  { id: "analytics", label: "数据分析", icon: BarChart3, href: "/reports" },
  { id: "audit", label: "审计中心", icon: Sparkles, href: "/audit" },
  { id: "settings", label: "系统设置", icon: Settings, href: "/settings" },
]

function getActiveViewFromPathname(pathname: string): NavItemId {
  if (pathname.startsWith("/leads")) {
    return "leads"
  }

  if (pathname.startsWith("/settings")) {
    return "settings"
  }

  if (pathname.startsWith("/deals")) {
    return "deals"
  }

  if (pathname.startsWith("/renewals")) {
    return "renewals"
  }

  if (pathname.startsWith("/reports")) {
    return "analytics"
  }

  if (pathname.startsWith("/pool")) {
    return "pool"
  }

  if (pathname.startsWith("/audit")) {
    return "audit"
  }

  return "dashboard"
}

interface SidebarContentProps {
  activeView: NavItemId
  onNavigate: (viewId: NavItemId) => void
  onItemClick?: () => void
}

function SidebarContent({ activeView, onNavigate, onItemClick }: SidebarContentProps) {
  const mePermissions = useContext(MePermissionsContext)
  
  const canViewPublicPool = mePermissions?.canViewPublicPool ?? false
  const canViewAnalytics = mePermissions?.canViewReports ?? false
  const canViewAudit = mePermissions?.canViewAudit ?? false
  const canViewSettings = mePermissions?.canViewSettings ?? false
  const canViewDealsAndRenewals = mePermissions?.canReadContracts ?? false
  const isPermissionsLoading = mePermissions === null

  const visibleNavItems = navItems.filter((item) => {
    if (item.id === "pool") return canViewPublicPool
    if (item.id === "analytics") return canViewAnalytics
    if (item.id === "audit") return canViewAudit
    if (item.id === "settings") return canViewSettings
    if (item.id === "deals") return canViewDealsAndRenewals
    if (item.id === "renewals") return canViewDealsAndRenewals
    return true
  })


  return (

    <>
      <div className="p-6 border-b border-border">
        <div className="w-full">
          <Image
            src="/logo.png"
            alt="Iwish CRM"
            width={160}
            height={40}
            className="w-full h-auto rounded-lg object-contain"
            loading="eager"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">销售线索管理系统</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {isPermissionsLoading
          ? navItems.map((item) => (
              <div
                key={item.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg"
              >
                <Skeleton className="w-5 h-5 rounded-md" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))
          : visibleNavItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id)
                  onItemClick?.()
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  activeView === item.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
      </nav>

      <div className="p-4 border-t border-border">
        <p className="text-xs text-muted-foreground">© 2025 Iwish CRM</p>
      </div>
    </>
  )
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname() ?? "/"
  const router = useRouter()
  const activeView = getActiveViewFromPathname(pathname)

  const handleNavigate = (viewId: NavItemId) => {
    const target = navItems.find((item) => item.id === viewId)
    if (!target) return

    router.push(target.href)
  }

  return (
    <>
      <aside className="hidden md:flex w-64 border-r border-border bg-card flex-col">
        <SidebarContent activeView={activeView} onNavigate={handleNavigate} />
      </aside>

      <div className="md:hidden fixed top-4 left-4 z-50">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              suppressHydrationWarning
              variant="outline"
              size="icon"
              className="bg-card"
            >
              <Menu className="w-5 h-5" />
              <span className="sr-only">打开菜单</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            {/* Radix 要求 DialogContent 内必须有 Title，这里用隐藏标题满足无障碍要求 */}
            <SheetHeader className="sr-only">
              <SheetTitle>导航菜单</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col h-full">
              <SidebarContent
                activeView={activeView}
                onNavigate={(viewId) => {
                  handleNavigate(viewId)
                  setMobileOpen(false)
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
