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

async function loadImportContext(req: NextRequest) {
  const supabase = createRouteHandlerClient(req)
  const [{ data: mePerms, error: permsError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.rpc("rpc_me_permissions"),
    supabase.rpc("rpc_me_profile"),
  ])

  if (permsError) {
    console.error("rpc_me_permissions failed before leads import-run", permsError)
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
    console.error("Failed to load team members for leads import-run", membersResult.error)
  }
  if (businessTypeResult.error) {
    console.error("Failed to load default business type for leads import-run", businessTypeResult.error)
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
      console.error("Failed to load duplicate phones in leads import-run", error)
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

function summarizeRowErrors(rows: CompanyResourceImportRow[]) {
  return rows
    .filter((row) => row.errors.length > 0)
    .map((row) => ({
      rowIndex: row.rowIndex,
      message: row.errors[0],
    }))
}

export async function POST(req: NextRequest) {
  let jobId: string | null = null

  try {
    const formData = await req.formData()
    const file = formData.get("file")
    const assignmentModeValue = String(formData.get("assignmentMode") ?? "uniform_owner")
    const assignmentMode: CompanyResourceAssignmentMode =
      assignmentModeValue === "file_owner" ? "file_owner" : "uniform_owner"
    const uniformOwnerIdRaw = String(formData.get("uniformOwnerId") ?? "").trim()
    const uniformOwnerId = uniformOwnerIdRaw || null
    const jobIdValue = String(formData.get("jobId") ?? "").trim()
    jobId = jobIdValue || null

    if (!jobId) {
      return NextResponse.json({ ok: false, error: "missing_job_id", detail: "请先完成预检查后再开始导入" }, { status: 400 })
    }

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "missing_file", detail: "请选择需要导入的文件" }, { status: 400 })
    }

    const context = await loadImportContext(req)
    if (context.error) {
      return context.error
    }

    const parsed = await parseSpreadsheetFile(file as Blob & { name?: string })
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

    const analysis = analyzeCompanyResourceRows({
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

    if (analysis.errorCount > 0) {
      const rowErrors = summarizeRowErrors(analysis.rows)
      await context.supabase.rpc("rpc_leads_import_mark_complete", {
        p_job_id: jobId,
        p_status: "failed",
        p_total_count: parsed.totalCount,
        p_success_count: 0,
        p_duplicate_count: analysis.duplicateCount,
        p_error_message: "预检查未通过，请先处理所有异常行",
      })

      return NextResponse.json(
        {
          ok: false,
          error: "preview_not_clean",
          detail: "预检查未通过，请先处理所有异常行后再导入",
          jobId,
          totalCount: parsed.totalCount,
          importedCount: 0,
          failedCount: analysis.errorCount,
          duplicateCount: analysis.duplicateCount,
          rowErrors,
        },
        { status: 400 },
      )
    }

    const payloadRows = buildPayloadRows(analysis.rows)
    if (payloadRows.length === 0) {
      await context.supabase.rpc("rpc_leads_import_mark_complete", {
        p_job_id: jobId,
        p_status: "failed",
        p_total_count: parsed.totalCount,
        p_success_count: 0,
        p_duplicate_count: 0,
        p_error_message: "没有可导入的线索数据",
      })

      return NextResponse.json(
        { ok: false, error: "empty_payloads", detail: "没有可导入的线索数据", rowErrors: [] },
        { status: 400 },
      )
    }

    const { data, error } = await context.supabase.rpc("rpc_leads_import_kanban", {
      p_job_id: jobId,
      p_rows: payloadRows,
      p_auto_complete: false,
    })

    if (error) {
      console.error("rpc_leads_import_kanban failed", error)
      await context.supabase.rpc("rpc_leads_import_mark_complete", {
        p_job_id: jobId,
        p_status: "failed",
        p_total_count: parsed.totalCount,
        p_success_count: 0,
        p_duplicate_count: 0,
        p_error_message: error.message ?? "执行看板导入失败",
      })

      return NextResponse.json(
        { ok: false, error: "import_failed", detail: mapLeadImportErrorMessage(error.message ?? "执行看板导入失败") },
        { status: 400 },
      )
    }

    const importedCount = Number((data as any)?.importedCount ?? 0)
    const failedCount = Number((data as any)?.failedCount ?? 0)
    const rowErrors = Array.isArray((data as any)?.rowErrors)
      ? ((data as any).rowErrors as any[]).map((item) => ({
          rowIndex: Number(item?.rowIndex ?? 0),
          message: mapLeadImportErrorMessage(String(item?.message ?? "导入失败")),
        }))
      : []

    if (rowErrors.length > 0 || importedCount !== payloadRows.length || failedCount > 0) {
      const detail = rowErrors[0]?.message ?? "导入失败，请根据返回的行级错误修正后重试"

      await context.supabase.rpc("rpc_leads_import_mark_complete", {
        p_job_id: jobId,
        p_status: "failed",
        p_total_count: parsed.totalCount,
        p_success_count: 0,
        p_duplicate_count: 0,
        p_error_message: detail,
      })

      return NextResponse.json(
        {
          ok: false,
          error: "strict_import_failed",
          detail,
          jobId,
          totalCount: parsed.totalCount,
          importedCount: 0,
          failedCount: rowErrors.length || failedCount || 1,
          duplicateCount: 0,
          rowErrors,
        },
        { status: 400 },
      )
    }

    await context.supabase.rpc("rpc_leads_import_mark_complete", {
      p_job_id: jobId,
      p_status: "completed",
      p_total_count: parsed.totalCount,
      p_success_count: importedCount,
      p_duplicate_count: 0,
      p_error_message: null,
    })

    return NextResponse.json({
      ok: true,
      jobId,
      totalCount: parsed.totalCount,
      importedCount,
      failedCount: 0,
      duplicateCount: 0,
      rowErrors: [],
    })
  } catch (err: any) {
    console.error("/api/leads/import-run POST failed", err)

    if (jobId) {
      try {
        const supabase = createRouteHandlerClient(req)
        await supabase.rpc("rpc_leads_import_mark_complete", {
          p_job_id: jobId,
          p_status: "failed",
          p_total_count: null,
          p_success_count: 0,
          p_duplicate_count: 0,
          p_error_message: String(err?.message ?? "执行看板导入时出错"),
        })
      } catch (markErr) {
        console.error("rpc_leads_import_mark_complete failed after leads import-run error", markErr)
      }
    }

    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
