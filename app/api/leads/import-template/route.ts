import ExcelJS from "exceljs"
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

export const runtime = "nodejs"

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

function columnLetter(index: number) {
  let value = ""
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    value = String.fromCharCode(65 + remainder) + value
    current = Math.floor((current - 1) / 26)
  }
  return value
}

function addListValidation(
  worksheet: ExcelJS.Worksheet,
  columnIndex: number,
  optionsSheetName: string,
  optionColumnIndex: number,
  optionCount: number,
  rowStart = 2,
  rowEnd = 500,
) {
  if (optionCount <= 0) return

  const optionColumnLetter = columnLetter(optionColumnIndex)
  const formula = `'${optionsSheetName}'!$${optionColumnLetter}$2:$${optionColumnLetter}$${optionCount + 1}`

  for (let row = rowStart; row <= rowEnd; row += 1) {
    worksheet.getCell(row, columnIndex).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorTitle: "请选择模板内置选项",
      error: "请从下拉列表中选择，或按说明页中的允许值填写。",
    }
  }
}

export async function GET(req: NextRequest) {
  try {
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

    const currentTeamId = (profile as any)?.team_id != null ? Number((profile as any).team_id) : null
    const createScopeType = ((mePerms as any)?.leadCreateScopeType as "self" | "team" | "org" | "custom" | undefined) ?? "self"
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

    const workbook = new ExcelJS.Workbook()
    workbook.creator = "OpenAI Codex"
    workbook.created = new Date()

    const templateSheet = workbook.addWorksheet("线索看板导入模板")
    const optionsSheet = workbook.addWorksheet("下拉选项")
    const guideSheet = workbook.addWorksheet("填写说明")

    templateSheet.views = [{ state: "frozen", ySplit: 1 }]
    templateSheet.addRow([...COMPANY_RESOURCE_TEMPLATE_HEADERS])
    templateSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    templateSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    }
    templateSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" }
    templateSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: COMPANY_RESOURCE_TEMPLATE_HEADERS.length },
    }

    const widths = [24, 28, 16, 16, 18, 18, 18, 18, 18, 22, 18, 20, 14, 24, 14, 24, 16]
    widths.forEach((width, index) => {
      templateSheet.getColumn(index + 1).width = width
    })

    const conditionallyRequiredHeaders = new Set([
      "网址",
      "责任归因",
      "业务类型",
      "电话",
      "微信号",
      "二级来源",
      "开发方式",
      "转介绍客户名称",
      "转介绍类型",
    ])
    for (let col = 1; col <= COMPANY_RESOURCE_TEMPLATE_HEADERS.length; col += 1) {
      const cell = templateSheet.getCell(1, col)
      if (conditionallyRequiredHeaders.has(String(cell.value))) {
        cell.note = "该列会根据导入规则参与必填校验，请参考“填写说明”工作表。"
      }
    }

    optionsSheet.addRow(["责任归因", "二级来源", "来源责任部门", "开发方式", "转介绍类型", "业务类型", "客户级别", "负责人"])
    const maxRows = Math.max(
      COMPANY_RESOURCE_RESPONSIBILITY_TYPES.length,
      sourceLabels.length,
      sourceDepartments.length,
      COMPANY_RESOURCE_DEV_METHODS.length,
      COMPANY_RESOURCE_REFERRAL_TYPES.length,
      businessTypeNames.length,
      grades.length,
      ownerNames.length,
      1,
    )

    for (let i = 0; i < maxRows; i += 1) {
      optionsSheet.addRow([
        COMPANY_RESOURCE_RESPONSIBILITY_TYPES[i]?.label ?? "",
        sourceLabels[i] ?? "",
        sourceDepartments[i]?.label ?? "",
        COMPANY_RESOURCE_DEV_METHODS[i]?.label ?? "",
        COMPANY_RESOURCE_REFERRAL_TYPES[i]?.label ?? "",
        businessTypeNames[i] ?? "",
        grades[i]?.key ?? "",
        ownerNames[i] ?? "",
      ])
    }
    optionsSheet.state = "veryHidden"

    addListValidation(templateSheet, 6, optionsSheet.name, 1, COMPANY_RESOURCE_RESPONSIBILITY_TYPES.length)
    addListValidation(templateSheet, 7, optionsSheet.name, 2, sourceLabels.length)
    addListValidation(templateSheet, 8, optionsSheet.name, 3, sourceDepartments.length)
    addListValidation(templateSheet, 9, optionsSheet.name, 4, COMPANY_RESOURCE_DEV_METHODS.length)
    addListValidation(templateSheet, 11, optionsSheet.name, 5, COMPANY_RESOURCE_REFERRAL_TYPES.length)
    addListValidation(templateSheet, 14, optionsSheet.name, 6, businessTypeNames.length)
    addListValidation(templateSheet, 15, optionsSheet.name, 7, grades.length)
    addListValidation(templateSheet, 17, optionsSheet.name, 8, ownerNames.length)

    guideSheet.columns = [{ width: 24 }, { width: 90 }]
    guideSheet.addRows([
      ["字段", "说明"],
      ["公司名称", "可选。建议填写，便于识别线索。"],
      ["网址", "与公司名称二选一，至少填写一个。填写时必须是可识别的网址或域名。"],
      ["联系人", "可选。未填写时系统会使用默认联系人名称。"],
      ["电话 / 微信号", "至少填写一个。若手机号已存在于线索看板，该行会在预检查中直接标记为不可导入。"],
      ["责任归因", "必填。请从下拉中选择：公司分配资源 / 销售自主开发 / 客户转介绍。"],
      ["二级来源", "当责任归因为“公司分配资源”时必填，选项来自系统设置。"],
      ["来源责任部门", "可选，选项来自系统设置。"],
      ["开发方式", "当责任归因为“销售自主开发”时必填。"],
      ["转介绍客户名称", "当责任归因为“客户转介绍”时必填。"],
      ["转介绍类型", "当责任归因为“客户转介绍”时必填。"],
      ["活动名称", "可选。"],
      ["预算", "可选，填写纯数字即可，例如 500000；也支持万、亿、k、m。"],
      ["业务类型", "必填。请填写“一级分类 / 业务类型”的完整名称，例如“B2B / Google广告”；支持下拉选择。"],
      ["客户级别", "可选，选项来自系统设置。"],
      ["标签", "可选。多个标签请用“、”“，”或英文逗号分隔。"],
      ["负责人", "当顶部选择“按文件内负责人分配”时，本列必填；统一负责人模式下可留空。"],
      ["说明", "若当前账号的线索创建范围仅限本人或本团队，负责人下拉会只保留本团队成员；正式导入时也会按这个范围校验。"],
    ])
    guideSheet.getRow(1).font = { bold: true }
    guideSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    }
    guideSheet.getColumn(2).alignment = { wrapText: true, vertical: "top" }

    const buffer = await workbook.xlsx.writeBuffer()
    const fileName = `线索看板导入模板-${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(Buffer.from(buffer), {
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
