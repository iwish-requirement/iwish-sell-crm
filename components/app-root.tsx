"use client"

import React, { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { TopBar } from "@/components/top-bar"
import { Dashboard } from "@/components/dashboard"
import { LeadKanban } from "@/components/lead-kanban"
import { SystemSettings } from "@/components/system-settings"
import { AnalyticsDashboard } from "@/components/analytics-dashboard"
import { PublicPool } from "@/components/public-pool"
import { AuditLog } from "@/components/audit-log"
import { DealCenter } from "@/components/deal-center"
import { RenewalCenter } from "@/components/renewal-center"
import { ProfileCenter } from "@/components/profile-center"

import { toast } from "sonner"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { APP_VERSION } from "@/lib/app-version"



export type AppView =
  | "dashboard"
  | "leads"
  | "pool"
  | "deals"
  | "renewals"
  | "analytics"
  | "settings"
  | "audit"
  | "profile"




export type MePermissions = {
  canAssignLeads: boolean
  canReturnToPool: boolean
  canDeleteLeads: boolean
  canTransferLeads: boolean
  canViewAudit: boolean
  canViewReports: boolean
  canViewSettings: boolean
  canViewPublicPool: boolean
  canReadContracts: boolean
  canManageContracts: boolean
  canImportLeads: boolean
  leadScopeType: "self" | "team" | "org" | "custom"
}




export const MePermissionsContext = React.createContext<MePermissions | null>(null)


function getViewFromPathname(pathname: string): AppView {
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

  if (pathname.startsWith("/profile")) {
    return "profile"
  }

  return "dashboard"
}


export function AppRoot() {
  const pathname = usePathname() ?? "/"
  const activeView = getViewFromPathname(pathname)
  const [mePermissions, setMePermissions] = useState<MePermissions | null>(null)
  const hasShownVersionToastRef = useRef(false)

  useEffect(() => {
    let isMounted = true


    async function loadPermissions() {
      try {
        const supabase = getBrowserSupabaseClient()
        const { data, error } = await supabase.rpc("rpc_me_permissions")

        if (!isMounted) return

        if (error) {
          console.error("Failed to load current user permissions", error)
          setMePermissions({
            canAssignLeads: false,
            canReturnToPool: false,
            canDeleteLeads: false,
            canTransferLeads: false,
            canViewAudit: false,
            canViewReports: false,
            canViewSettings: false,
            canViewPublicPool: false,
            canReadContracts: false,
            canManageContracts: false,
            canImportLeads: false,
            leadScopeType: "self",
          })

          return
        }

        const value = (data as any) ?? {}
        setMePermissions({
          canAssignLeads: Boolean(value.canAssignLeads),
          canReturnToPool: Boolean(value.canReturnToPool),
          canDeleteLeads: Boolean(value.canDeleteLeads),
          canTransferLeads: Boolean(value.canTransferLeads),
          canViewAudit: Boolean(value.canViewAudit),
          canViewReports: Boolean(value.canViewReports),
          canViewSettings: Boolean(value.canViewSettings),
          canViewPublicPool: Boolean(value.canViewPublicPool),
          canReadContracts: Boolean(value.canReadContracts),
          canManageContracts: Boolean(value.canManageContracts),
          canImportLeads: Boolean(value.canImportLeads),
          leadScopeType: (value.leadScopeType as MePermissions["leadScopeType"]) ?? "self",
        })

      } catch (err) {
        console.error("Unexpected error while loading current user permissions", err)
        if (!isMounted) return
        setMePermissions({
          canAssignLeads: false,
          canReturnToPool: false,
          canDeleteLeads: false,
          canTransferLeads: false,
          canViewAudit: false,
          canViewReports: false,
          canViewSettings: false,
          canViewPublicPool: false,
          canReadContracts: false,
          canManageContracts: false,
          canImportLeads: false,
          leadScopeType: "self",
        })

      }
    }

    void loadPermissions()

    return () => {
      isMounted = false
    }
  }, [])

  // 版本更新检测：用于提示“系统已发布新版本，请刷新页面”
  useEffect(() => {
    let cancelled = false

    async function checkVersion() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as { version?: string }

        if (!cancelled && !hasShownVersionToastRef.current && data.version && data.version !== APP_VERSION) {
          hasShownVersionToastRef.current = true
          toast.info("系统已发布新版本", {
            description: "请刷新页面以获得最新体验。",
            action: {
              label: "立即刷新",
              onClick: () => {
                window.location.reload()
              },
            },
          })
        }
      } catch (error) {
        // 静默失败：版本检测只是体验优化，不影响正常使用
        console.error("Failed to check app version", error)
      }
    }

    void checkVersion()
    const timer = window.setInterval(checkVersion, 5 * 60 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])


  return (
    <MePermissionsContext.Provider value={mePermissions}>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-auto p-4 md:p-6 pt-16 md:pt-6">
            {activeView === "dashboard" && <Dashboard />}
            {activeView === "leads" && <LeadKanban />}
            {activeView === "pool" && <PublicPool />}
            {activeView === "deals" && <DealCenter />}
            {activeView === "renewals" && <RenewalCenter />}
            {activeView === "analytics" && <AnalyticsDashboard />}

            {activeView === "settings" && <SystemSettings />}
            {activeView === "audit" && <AuditLog />}
            {activeView === "profile" && <ProfileCenter />}


          </main>
        </div>
      </div>
    </MePermissionsContext.Provider>
  )
}


