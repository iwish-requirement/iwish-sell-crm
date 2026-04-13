import { NextRequest, NextResponse } from "next/server"

import {
  analyzeCompanyResourceRows,
  parseSpreadsheetFile,
  type CompanyResourceAssignmentMode,
  type CompanyResourceImportRow,
  type TeamImportBusinessType,
  type TeamImportMember,
} from "@/lib/lead-import/shared/company-resource-template"
import { mapLeadImportErrorMessage } from "@/lib/lead-import/shared/import-error-messages"
import { createRouteHandlerClient } from "@/lib/supabase/server"

export const runtime = "edge"

type BackendRowError = {
  rowIndex: number
  message: string
}

async function loadImportContext(req: NextRequest) {
  const supabase = createRouteHandlerClient(req)
  const [{ data: mePerms, error: permsError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.rpc("rpc_me_permissions"),
    supabase.rpc("rpc_me_profile"),
  ])

  if (permsError) {
    console.error("rpc_me_permissions failed before leads import-preview", permsError)
  }

  const [membersResult, businessTypeResult] = await Promise.all([
    supabase.from("profiles_public").select("id, full_name, team_id, status").eq("status", "active"),
    supabase
      .from("business_types")
      .select("id, name, category_id, sort_order, business_categories(name)")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])

  if (membersResult.error) {
    console.error("Failed to load team members for leads import-preview", membersResult.error)
  }
  if (businessTypeResult.error) {
    console.error("Failed to load default business type for leads import-preview", businessTypeResult.error)
  }

  const members: TeamImportMember[] = (membersResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    fullName: String(row.full_name ?? "未命名成员"),
    teamId: row.team_id != null ? Number(row.team_id) : null,
  }))

  const businessTypes: TeamImportBusinessType[] = (businessTypeResult.data ?? []).map((row: any) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    categoryId: row.category_id != null ? Number(row.category_id) : null,
    categoryName: row.business_categories?.name != null ? String(row.business_categories.name) : null,
  }))

  if (businessTypes.length === 0) {
    return {
      error: NextResponse.json(
        { ok: false, error: "missing_business_type", detail: "系统未配置可用业务类型，暂时无法导入" },
        { status: 400 },
      ),
      supabase,
      profile: null,
      members,
      businessTypes: [],
    }
  }

  return {
    error: null,
    supabase,
    profile: {
      id: profileError || !profile ? null : String((profile as any).id),
      teamId: profileError || !profile || (profile as any).team_id == null ? null : Number((profile as any).team_id),
    },
    leadCreateScopeType: ((mePerms as any)?.leadCreateScopeType as "self" | "team" | "org" | "custom" | undefined) ?? "self",
    members,
    businessTypes,
  }
}

async function loadDuplicatePhones(supabase: ReturnType<typeof createRouteHandlerClient>, phones: string[]) {
  if (phones.length === 0) {
    return new Set<string>()
  }

  const uniquePhones = Array.from(new Set(phones.filter(Boolean))).slice(0, 1000)
  const duplicateSet = new Set<string>()

  for (let index = 0; index < uniquePhones.length; index += 200) {
    const batch = uniquePhones.slice(index, index + 200)
    const { data, error } = await supabase.from("leads_secure_view").select("customer_phone").in("customer_phone", batch)

    if (error) {
      console.error("Failed to load duplicate phones in leads import-preview", error)
      continue
    }

    for (const row of data ?? []) {
      const phone = String((row as any).customer_phone ?? "").trim()
      if (phone) {
        duplicateSet.add(phone)
      }
    }
  }

  return duplicateSet
}

function buildPayloadRows(rows: CompanyResourceImportRow[]) {
  return rows
    .filter((row) => row.payload)
    .map((row) => ({
      rowIndex: row.rowIndex,
      payload: row.payload,
    }))
}

function mergeBackendRowErrors(analysis: {
  rows: CompanyResourceImportRow[]
  duplicateCount: number
  validCount: number
  errorCount: number
  missingHeaders: string[]
}, backendErrors: BackendRowError[]) {
  if (backendErrors.length === 0) {
    return analysis
  }

  const errorMap = new Map<number, string[]>()
  for (const item of backendErrors) {
    if (!errorMap.has(item.rowIndex)) {
      errorMap.set(item.rowIndex, [])
    }
    errorMap.get(item.rowIndex)!.push(item.message)
  }

  const rows = analysis.rows.map((row) => {
    const extraErrors = errorMap.get(row.rowIndex) ?? []
    if (extraErrors.length === 0) {
      return row
    }

    const mergedErrors = Array.from(new Set([...row.errors, ...extraErrors]))
    return {
      ...row,
      errors: mergedErrors,
      canImport: false,
      payload: null,
    }
  })

  const duplicateCount = rows.filter((row) => row.duplicate).length
  const validCount = rows.filter((row) => row.canImport).length
  const errorCount = rows.length - validCount

  return {
    rows,
    duplicateCount,
    validCount,
    errorCount,
    missingHeaders: analysis.missingHeaders,
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    const assignmentModeValue = String(formData.get("assignmentMode") ?? "uniform_owner")
    const assignmentMode: CompanyResourceAssignmentMode =
      assignmentModeValue === "file_owner" ? "file_owner" : "uniform_owner"
    const uniformOwnerIdRaw = String(formData.get("uniformOwnerId") ?? "").trim()
    const uniformOwnerId = uniformOwnerIdRaw || null

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "missing_file", detail: "请选择需要导入的文件" }, { status: 400 })
    }

    const context = await loadImportContext(req)
    if (context.error) {
      return context.error
    }

    const parsed = await parseSpreadsheetFile(file as Blob & { name?: string })
    const { data: jobId, error: jobError } = await context.supabase.rpc("rpc_leads_import_request", {
      p_source: "lead_kanban",
      p_file_name: parsed.fileName,
      p_file_size: file.size ?? null,
      p_options: { assignmentMode },
    })

    if (jobError || !jobId) {
      console.error("rpc_leads_import_request failed in leads import-preview", jobError)
      return NextResponse.json(
        { ok: false, error: "create_job_failed", detail: jobError?.message ?? "无法创建导入任务" },
        { status: 400 },
      )
    }

    const draftAnalysis = analyzeCompanyResourceRows({
      headers: parsed.headerRow,
      rows: parsed.dataRows,
      assignmentMode,
      uniformOwnerId,
      members: context.members,
      businessTypes: context.businessTypes,
      duplicatePhones: new Set<string>(),
      actorTeamId: context.profile.teamId,
      createScopeType: context.leadCreateScopeType,
    })

    const duplicatePhones = await loadDuplicatePhones(
      context.supabase,
      draftAnalysis.rows.map((row) => row.phone).filter(Boolean),
    )

    const localAnalysis = analyzeCompanyResourceRows({
      headers: parsed.headerRow,
      rows: parsed.dataRows,
      assignmentMode,
      uniformOwnerId,
      members: context.members,
      businessTypes: context.businessTypes,
      duplicatePhones,
      actorTeamId: context.profile.teamId,
      createScopeType: context.leadCreateScopeType,
    })

    let analysis = localAnalysis
    const payloadRows = buildPayloadRows(localAnalysis.rows)

    if (payloadRows.length > 0) {
      const { data: checkResult, error: checkError } = await context.supabase.rpc("rpc_leads_import_kanban_check", {
        p_rows: payloadRows,
      })

      if (checkError) {
        console.error("rpc_leads_import_kanban_check failed in leads import-preview", checkError)
        return NextResponse.json(
          { ok: false, error: "preview_check_failed", detail: checkError.message ?? "无法完成导入校验" },
          { status: 400 },
        )
      }

      const backendErrors = Array.isArray((checkResult as any)?.rowErrors)
        ? ((checkResult as any).rowErrors as any[]).map((item) => ({
            rowIndex: Number(item?.rowIndex ?? 0),
            message: mapLeadImportErrorMessage(String(item?.message ?? "数据库校验未通过")),
          }))
        : []

      analysis = mergeBackendRowErrors(localAnalysis, backendErrors)
    }

    return NextResponse.json({
      ok: true,
      jobId,
      fileName: parsed.fileName,
      totalCount: parsed.totalCount,
      validCount: analysis.validCount,
      duplicateCount: analysis.duplicateCount,
      errorCount: analysis.errorCount,
      missingHeaders: analysis.missingHeaders,
      rows: analysis.rows.slice(0, 80),
    })
  } catch (err: any) {
    console.error("/api/leads/import-preview POST failed", err)
    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
