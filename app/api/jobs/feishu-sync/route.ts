// 飞书通讯录同步：拉取部门+成员写入 ops_members。
// 触发方式：POST，鉴权二选一 —— x-job-token（FEISHU_SYNC_TOKEN，供外部定时任务）
// 或用户 Bearer JWT（需 allocations.manage 权限，供 CRM 页面手动同步）。
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isFeishuConfigured, listAllDepartments, listUsersByDepartment } from "@/lib/feishu/client"

function getSyncToken(): string {
  return (process.env.FEISHU_SYNC_TOKEN ?? "").trim()
}

function resolveSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "")
}

function resolveAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "")
}

async function hasManagePermissionViaUser(token: string): Promise<boolean> {
  if (!resolveSupabaseUrl() || !resolveAnonKey()) return false
  const userClient = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await userClient.rpc("rpc_feishu_sync_permission_check")
  return !error
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function POST(req: NextRequest) {
  const jobToken = (req.headers.get("x-job-token") ?? "").trim()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  const expectedToken = getSyncToken()

  let authorized = false
  if (expectedToken && jobToken && jobToken === expectedToken) {
    authorized = true
  } else if (bearer) {
    authorized = await hasManagePermissionViaUser(bearer)
  }
  if (!authorized) {
    const status = !expectedToken && !bearer ? 500 : 401
    return NextResponse.json({ ok: false, error: status === 500 ? "server_misconfigured" : "unauthorized" }, { status })
  }

  if (!isFeishuConfigured()) {
    return NextResponse.json({ ok: false, error: "feishu_not_configured" }, { status: 500 })
  }

  const admin = createAdminSupabaseClient()

  try {
    const departments = await listAllDepartments()
    const departmentNameById = new Map(departments.map((d) => [d.openDepartmentId, d.name]))

    const byOpenId = new Map<string, Awaited<ReturnType<typeof listUsersByDepartment>>[number]>()
    // find_by_department 不返回 department_ids（字段权限限制），
    // 但用户是按部门拉取的，遍历时即可记录归属。
    const departmentIdsByUser = new Map<string, Set<string>>()
    for (const departmentId of ["0", ...departments.map((d) => d.openDepartmentId)]) {
      const users = await listUsersByDepartment(departmentId)
      for (const user of users) {
        if (!byOpenId.has(user.openId)) byOpenId.set(user.openId, user)
        if (departmentId !== "0") {
          let set = departmentIdsByUser.get(user.openId)
          if (!set) {
            set = new Set()
            departmentIdsByUser.set(user.openId, set)
          }
          set.add(departmentId)
        }
      }
    }

    const now = new Date().toISOString()
    const rows = Array.from(byOpenId.values()).map((user) => {
      const departmentNameSet = new Set<string>()
      const ids = new Set<string>([...(departmentIdsByUser.get(user.openId) ?? []), ...user.departmentIds])
      for (const id of ids) {
        const name = departmentNameById.get(id)
        if (name) departmentNameSet.add(name)
      }
      return {
        feishu_user_id: user.openId,
        feishu_union_id: user.unionId,
        full_name: user.name,
        email: user.email,
        mobile: user.mobile,
        job_title: user.jobTitle,
        city: user.city,
        employee_type: user.employeeType,
        department_names: Array.from(departmentNameSet),
        is_active: true,
        synced_at: now,
      }
    })

    for (const part of chunk(rows, 100)) {
      const { error } = await admin.from("ops_members").upsert(part, { onConflict: "feishu_user_id" })
      if (error) {
        return NextResponse.json({ ok: false, error: `upsert_failed:${error.message}` }, { status: 500 })
      }
    }

    const currentIds = rows.map((r) => r.feishu_user_id)
    let deactivated = 0
    const { data: activeRows, error: activeError } = await admin
      .from("ops_members")
      .select("feishu_user_id")
      .eq("is_active", true)
    if (activeError) {
      return NextResponse.json({ ok: false, error: `load_active_failed:${activeError.message}` }, { status: 500 })
    }
    const currentSet = new Set(currentIds)
    const missing = (activeRows ?? []).map((r) => r.feishu_user_id).filter((id) => !currentSet.has(id))
    for (const part of chunk(missing, 200)) {
      const { error } = await admin.from("ops_members").update({ is_active: false }).in("feishu_user_id", part)
      if (error) {
        return NextResponse.json({ ok: false, error: `deactivate_failed:${error.message}` }, { status: 500 })
      }
      deactivated += part.length
    }

    return NextResponse.json({ ok: true, departments: departments.length, members: rows.length, deactivated })
  } catch (err: any) {
    console.error("/api/jobs/feishu-sync failed", err)
    return NextResponse.json({ ok: false, error: "unexpected", detail: String(err?.message ?? err) }, { status: 500 })
  }
}
