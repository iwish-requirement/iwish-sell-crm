import { NextRequest, NextResponse } from "next/server"

import {
  COMPANY_RESOURCE_DEV_METHODS,
  COMPANY_RESOURCE_GROUPS,
  COMPANY_RESOURCE_REFERRAL_TYPES,
  COMPANY_RESOURCE_RESPONSIBILITY_TYPES,
  COMPANY_RESOURCE_SOURCE_DEPARTMENTS,
  COMPANY_RESOURCE_TEMPLATE_HEADERS,
} from "@/lib/lead-import/shared/company-resource-template"
import { createRouteHandlerClient } from "@/lib/supabase/server"


type SourceGroupSetting = {
  key: string
  label: string
  children: Array<{ key: string; label: string }>
}

type SourceDepartmentSetting = {
  key: string
  label: string
}

type GradeDefinitionSetting = {
  key: string
  label: string
}

function sanitizeSourceGroups(value: unknown): SourceGroupSetting[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).groups)) {
    return COMPANY_RESOURCE_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      children: group.children.map((child) => ({ key: child.key, label: child.label })),
    }))
  }

  const groups = (value as any).groups as any[]
  const normalized = groups
    .filter((group) => typeof group?.key === "string" && typeof group?.label === "string")
    .map((group) => ({
      key: String(group.key),
      label: String(group.label),
      children: Array.isArray(group.children)
        ? group.children
            .filter((child: any) => typeof child?.key === "string" && typeof child?.label === "string")
            .map((child: any) => ({ key: String(child.key), label: String(child.label) }))
        : [],
    }))
    .filter((group) => group.children.length > 0)

  return normalized.length > 0
    ? normalized
    : COMPANY_RESOURCE_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        children: group.children.map((child) => ({ key: child.key, label: child.label })),
      }))
}

function sanitizeSourceDepartments(value: unknown): SourceDepartmentSetting[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).departments)) {
    return COMPANY_RESOURCE_SOURCE_DEPARTMENTS.map((item) => ({ key: item.key, label: item.label }))
  }

  const departments = (value as any).departments as any[]
  const normalized = departments
    .filter((item) => typeof item?.key === "string" && typeof item?.label === "string")
    .map((item) => ({ key: String(item.key), label: String(item.label) }))

  return normalized.length > 0
    ? normalized
    : COMPANY_RESOURCE_SOURCE_DEPARTMENTS.map((item) => ({ key: item.key, label: item.label }))
}

function sanitizeGrades(value: unknown): GradeDefinitionSetting[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).grades)) {
    return [
      { key: "S", label: "S" },
      { key: "A", label: "A" },
      { key: "B", label: "B" },
      { key: "C", label: "C" },
    ]
  }

  const grades = (value as any).grades as any[]
  const normalized = grades
    .filter((item) => typeof item?.key === "string" && typeof item?.label === "string")
    .map((item) => ({ key: String(item.key), label: String(item.label) }))

  return normalized.length > 0
    ? normalized
    : [
        { key: "S", label: "S" },
        { key: "A", label: "A" },
        { key: "B", label: "B" },
        { key: "C", label: "C" },
      ]
}

function setColumnWidths(sheet: any, widths: number[]) {
  sheet["!cols"] = widths.map((wch) => ({ wch }))
}

export async function GET(req: NextRequest) {
  try {
    const XLSX = await import("xlsx")
    const supabase = createRouteHandlerClient(req)
    const [{ data: profile }, { data: mePerms }, settingsResult, businessTypesResult, membersResult] = await Promise.all([
      supabase.rpc("rpc_me_profile"),
      supabase.rpc("rpc_me_permissions"),
      supabase.from("settings").select("key, value").in("key", [
        "leads.company_resource_source_groups",
        "leads.source_departments",
        "leads.grade_definitions",
      ]),
      supabase
        .from("business_types")
        .select("id, name, category_id, sort_order, business_categories(name)")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("profiles_public")
        .select("id, full_name, team_id, status")
        .eq("status", "active")
        .order("full_name", { ascending: true }),
    ])

    if (membersResult.error) {
      console.error("Failed to load members for leads import template", membersResult.error)
    }
    if (businessTypesResult.error) {
      console.error("Failed to load business types for leads import template", businessTypesResult.error)
    }
    if (settingsResult.error) {
      console.error("Failed to load settings for leads import template", settingsResult.error)
    }

    const settingsRows = (settingsResult.data ?? []) as Array<{ key: string; value: unknown }>
    const sourceGroupsValue = settingsRows.find((row) => row.key === "leads.company_resource_source_groups")?.value
    const sourceDepartmentsValue = settingsRows.find((row) => row.key === "leads.source_departments")?.value
    const gradesValue = settingsRows.find((row) => row.key === "leads.grade_definitions")?.value

    const sourceGroups = sanitizeSourceGroups(sourceGroupsValue)
    const sourceLabels = sourceGroups.flatMap((group) => group.children.map((child) => child.label))
    const sourceDepartments = sanitizeSourceDepartments(sourceDepartmentsValue)
    const grades = sanitizeGrades(gradesValue)
    const businessTypeNames = ((businessTypesResult.data ?? []) as any[])
      .map((row) => {
        const name = String(row.name ?? "").trim()
        const categoryName = String((row.business_categories as any)?.name ?? "").trim()
        return categoryName ? `${categoryName} / ${name}` : name
      })
      .filter(Boolean)
    const businessCategoryNames = Array.from(
      new Set(
        ((businessTypesResult.data ?? []) as any[])
          .map((row) => String((row.business_categories as any)?.name ?? "").trim())
          .filter(Boolean),
      ),
    )

    const currentTeamId = (profile as any)?.team_id != null ? Number((profile as any).team_id) : null
    const createScopeType =
      ((mePerms as any)?.leadCreateScopeType as "self" | "team" | "org" | "custom" | undefined) ?? "self"
    const membersForTemplate =
      (createScopeType === "self" || createScopeType === "team") && currentTeamId != null
        ? ((membersResult.data ?? []) as any[]).filter((row) => row.team_id === currentTeamId)
        : ((membersResult.data ?? []) as any[])

    const ownerNames = membersForTemplate
      .sort((a: any, b: any) => {
        const aCurrentTeam = currentTeamId != null && a.team_id === currentTeamId ? 0 : 1
        const bCurrentTeam = currentTeamId != null && b.team_id === currentTeamId ? 0 : 1
        if (aCurrentTeam !== bCurrentTeam) return aCurrentTeam - bCurrentTeam
        return String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "zh-CN")
      })
      .map((row) => String(row.full_name ?? "").trim())
      .filter(Boolean)

    const workbook = XLSX.utils.book_new()

    const templateRows = [
      [...COMPANY_RESOURCE_TEMPLATE_HEADERS],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]
    const templateSheet = XLSX.utils.aoa_to_sheet(templateRows)
    setColumnWidths(templateSheet, [24, 28, 16, 16, 18, 18, 18, 18, 18, 22, 18, 20, 14, 24, 18, 14, 24, 16])
    templateSheet["!freeze"] = { xSplit: 0, ySplit: 1 }
    templateSheet["!autofilter"] = { ref: `A1:R1` }

    const optionMaxRows = Math.max(
      COMPANY_RESOURCE_RESPONSIBILITY_TYPES.length,
      sourceLabels.length,
      sourceDepartments.length,
      COMPANY_RESOURCE_DEV_METHODS.length,
      COMPANY_RESOURCE_REFERRAL_TYPES.length,
      businessTypeNames.length,
      businessCategoryNames.length,
      grades.length,
      ownerNames.length,
      1,
    )
    const optionRows: Array<Array<string>> = [
      ["责任归因", "二级来源", "来源责任部门", "开发方式", "转介绍类型", "业务类型", "品类", "客户级别", "负责人"],
    ]
    for (let i = 0; i < optionMaxRows; i += 1) {
      optionRows.push([
        COMPANY_RESOURCE_RESPONSIBILITY_TYPES[i]?.label ?? "",
        sourceLabels[i] ?? "",
        sourceDepartments[i]?.label ?? "",
        COMPANY_RESOURCE_DEV_METHODS[i]?.label ?? "",
        COMPANY_RESOURCE_REFERRAL_TYPES[i]?.label ?? "",
        businessTypeNames[i] ?? "",
        businessCategoryNames[i] ?? "",
        grades[i]?.key ?? "",
        ownerNames[i] ?? "",
      ])
    }
    const optionSheet = XLSX.utils.aoa_to_sheet(optionRows)
    setColumnWidths(optionSheet, [18, 24, 18, 18, 18, 28, 18, 12, 18])

    const guideRows = [
      ["字段", "说明"],
      ["公司名称", "可选。建议填写，便于识别线索。"],
      ["网址", "与公司名称二选一，至少填写一个。填写时必须是可识别的网址或域名。"],
      ["联系人", "可选。未填写时系统会使用默认联系人名称。"],
      ["电话 / 微信号", "至少填写一个。"],
      ["责任归因", "必填。请从下拉中选择：公司分配资源 / 销售自主开发 / 客户转介绍。"],
      ["二级来源", "当责任归因为“公司分配资源”时必填，选项来自系统设置。"],
      ["来源责任部门", "可选，选项来自系统设置。"],
      ["开发方式", "当责任归因为“销售自主开发”时必填。"],
      ["转介绍客户名称", "当责任归因为“客户转介绍”时必填。"],
      ["转介绍类型", "当责任归因为“客户转介绍”时必填。"],
      ["活动名称", "可选。"],
      ["预算", "可选，填写纯数字即可，例如 500000；也支持万、亿、k、m。"],
      ["业务类型", "必填。请填写“一级分类 / 业务类型”的完整名称，例如“B2B / Google广告”。"],
      ["品类", "必填。新模板请从下拉选项中选择至少一个品类；旧模板可留空，系统会根据业务类型自动推导。"],
      ["客户级别", "可选，选项来自系统设置。"],
      ["标签", "可选。多个标签请用“、”“，”或英文逗号分隔。"],
      ["负责人", "当顶部选择“按文件内负责人分配”时，本列必填；统一负责人模式下可留空。"],
      ["说明", "若当前账号的线索创建范围仅限本人或本团队，负责人建议填写当前可操作范围内成员。"],
    ]
    const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
    setColumnWidths(guideSheet, [24, 90])

    XLSX.utils.book_append_sheet(workbook, templateSheet, "线索看板导入模板")
    XLSX.utils.book_append_sheet(workbook, optionSheet, "下拉选项")
    XLSX.utils.book_append_sheet(workbook, guideSheet, "填写说明")

    const buffer = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
      compression: true,
    }) as ArrayBuffer

    const fileName = `线索看板导入模板-${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Failed to generate leads import template", error)
    return NextResponse.json(
      { ok: false, error: "template_generation_failed", detail: "生成导入模板失败，请稍后重试" },
      { status: 500 },
    )
  }
}
