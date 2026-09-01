import { NextRequest, NextResponse } from "next/server"

import { createRouteHandlerClient } from "@/lib/supabase/server"


function normalizeCell(value: unknown): string {
  if (value == null) return ""
  return String(value).trim()
}

function normalizeCategoryKey(value: unknown): string {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/[\s\-_—–/\\|,:：;；，。·•（）()【】\[\]<>《》'"`]/g, "")
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || ""

    let jobId: string | null = null
    let file: Blob | null = null
    let aiMapping: any | null = null

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData()
      const jobIdValue = formData.get("jobId")
      const fileValue = formData.get("file")
      const aiMappingValue = formData.get("aiMapping")
      jobId = typeof jobIdValue === "string" ? jobIdValue : null
      file = fileValue instanceof Blob ? fileValue : null

      if (typeof aiMappingValue === "string") {
        try {
          aiMapping = JSON.parse(aiMappingValue)
        } catch (e) {
          console.error("Failed to parse aiMapping from import-run formData", e)
        }
      }
    } else {
      const body = (await req.json().catch(() => null)) as any
      jobId = typeof body?.jobId === "string" ? body.jobId : null
      if (body?.aiMapping) {
        aiMapping = body.aiMapping
      }
    }


    if (!jobId) {
      return NextResponse.json({ ok: false, error: "missing_job_id" }, { status: 400 })
    }

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_file",
          detail: "导入执行阶段需要携带原始文件，请重试导入流程",
        },
        { status: 400 },
      )
    }

    const fileName = (file as any).name ?? "import_file"
    const ext = fileName.toLowerCase().split(".").pop() ?? ""

    if (!["csv", "xlsx", "xls"].includes(ext)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_type", detail: "仅支持 .csv / .xlsx / .xls" },
        { status: 400 },
      )
    }

    const supabase = createRouteHandlerClient(req)

    let rows: string[][] = []

    if (ext === "csv") {
      const text = await file.text()
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (lines.length <= 1) {
        return NextResponse.json(
          { ok: false, error: "empty_file", detail: "导入文件为空或只有表头" },
          { status: 400 },
        )
      }

      rows = lines.slice(1).map((line) => line.split(",").map((c) => c.trim()))
    } else {
      const XLSX = await import("xlsx")
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const sheetData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 }) as any[][]

      rows = (sheetData ?? [])
        .slice(1)
        .map((row) => (row ?? []).map((cell) => normalizeCell(cell)))
        .filter((row) => row.some((cell: string) => cell.length > 0))
    }

    const { data: mePerms, error: permsError } = await supabase.rpc("rpc_me_permissions")
    if (permsError) {
      console.error("rpc_me_permissions failed before import-run", permsError)
    } else {
      const canImportLeads = Boolean((mePerms as any)?.canImportLeads)
      if (!canImportLeads) {
        return NextResponse.json(
          {
            ok: false,
            error: "no_permission",
            detail: "当前账号未开通线索导入权限，请联系管理员配置权限后重试",
          },
          { status: 403 },
        )
      }
    }

    const { data: profile, error: profileError } = await supabase.rpc("rpc_me_profile")

    if (profileError || !profile) {
      console.error("rpc_me_profile failed in import-run", profileError)
      return NextResponse.json(
        { ok: false, error: "profile_error", detail: "无法获取当前用户信息" },
        { status: 400 },
      )
    }

    if (profile.team_id == null) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_team",
          detail: "当前账号未加入任何团队，无法导入公海线索",
        },
        { status: 400 },
      )
    }

    // Legacy public-pool templates do not carry taxonomy columns. Use the first
    // active type as a compatibility default so imports continue to work while
    // new manual leads must explicitly choose their品类。
    const { data: defaultType } = await supabase
      .from("business_types")
      .select("id, category_id")
      .eq("is_active", true)
      .order("sort_order")
      .limit(1)
      .maybeSingle()
    const { data: categoryRows } = await supabase
      .from("business_categories")
      .select("id,name")
      .eq("is_active", true)
    const categoryByName = new Map(
      (categoryRows ?? [])
        .map((row: any) => [normalizeCategoryKey(row.name), Number(row.id)] as const)
        .filter(([name, id]) => Boolean(name) && Number.isFinite(id)),
    )

    let importedCount = 0
    let failedCount = 0
    let dbDuplicateCount = 0

    const existingPhoneCache = new Map<string, boolean>()

    const IMPORT_PRIMARY_SOURCE_FOR_POOL = "company_resource" as const

    const IMPORT_SECONDARY_LABEL_TO_KEY: Record<string, string> = {
      抖音: "douyin",
      "视频号（公司号）": "wechat_company",
      "视频号（IP号）": "wechat_ip_1",
      "视频号（IP号2）": "wechat_ip_2",
      小红书: "xiaohongshu",
      公众号: "official_account",
      社群: "community",
      官网表单: "website_form",
      官网加微信: "website_wechat",
      一号位战略课: "strategy_course",
      流量系列课: "traffic_course",
      品牌系列课: "brand_course",
      SEO系列课: "seo_course",
      展会: "expo",
      公开课分享会: "public_workshop",
      其他活动: "other_event",
      直播间线索: "livestream_lead",
    }

    const IMPORT_FALLBACK_SECONDARY_KEY = "other_event" as const

    let rowIndex = 0
    for (const row of rows) {
      rowIndex += 1

      // 每处理一定数量的行让出一次事件循环，避免在本地开发环境中长时间阻塞 dev server
      if (rowIndex % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      if (row.length < 1) {
        failedCount += 1
        continue
      }

      let company: string
      let website: string
      let contact: string
      let phone: string
      let wechat: string
      let sourceLabel: string
      let budgetStr: string
      let categoryLabel = ""

      if (aiMapping && typeof aiMapping === "object" && aiMapping.columnMapping) {
        const cm = aiMapping.columnMapping as any
        const pick = (key: keyof typeof cm): string => {
          const idxRaw = cm[key]
          if (typeof idxRaw !== "number" || !Number.isFinite(idxRaw)) return ""
          const idx = Math.floor(idxRaw)
          if (idx < 0 || idx >= row.length) return ""
          return normalizeCell(row[idx])
        }

        company = pick("company")
        website = pick("website")
        contact = pick("contact")
        phone = pick("phone")
        wechat = pick("wechat")
        sourceLabel = pick("sourceLabel")
        budgetStr = pick("budget")
        categoryLabel = pick("category")
      } else {
        // 回退到模板列顺序
        const safeCols = [...row]
        while (safeCols.length < 7) safeCols.push("")
        company = normalizeCell(safeCols[0])
        website = normalizeCell(safeCols[1])
        contact = normalizeCell(safeCols[2])
        phone = normalizeCell(safeCols[3])
        wechat = normalizeCell(safeCols[4])
        sourceLabel = normalizeCell(safeCols[5])
        budgetStr = normalizeCell(safeCols[6])
        categoryLabel = normalizeCell(safeCols[7])
      }


      const hasIdentity = Boolean((company || website).trim())
      const hasContact = Boolean((phone || wechat).trim())
      const hasSource = Boolean(sourceLabel.trim())

      if (!hasIdentity || !hasContact || !hasSource) {
        failedCount += 1
        continue
      }

      const normalizedPhone = phone.replace(/[^0-9+]/g, "")
      if (normalizedPhone) {
        let exists = existingPhoneCache.get(normalizedPhone)
        if (exists === undefined) {
          const { data: existing, error: existingError } = await supabase
            .from("leads_secure_view")
            .select("id, customer_phone")
            .eq("customer_phone", normalizedPhone)
            .limit(1)
            .maybeSingle()

          exists = !existingError && !!existing
          existingPhoneCache.set(normalizedPhone, exists)
        }

        if (exists) {
          dbDuplicateCount += 1
          continue
        }
      }

      const budget = budgetStr ? Number(budgetStr.replace(/[^0-9.]/g, "")) : null

      const primarySource = IMPORT_PRIMARY_SOURCE_FOR_POOL
      let secondarySourceKey = IMPORT_SECONDARY_LABEL_TO_KEY[sourceLabel] ?? ""
      if (!secondarySourceKey) {
        secondarySourceKey = IMPORT_FALLBACK_SECONDARY_KEY
      }

      const payload: any = {
        team_id: profile.team_id,
        owner_id: profile.id,
        name: company || website || "未命名线索",
        website: website || null,
        source: sourceLabel || "公司分配资源",
        stage: "L1",
        status: "pool",
        customer_name: contact || "未填写联系人",
        customer_phone: phone || null,
        wechat: wechat || null,
        responsibility_type: primarySource,
        source_level1: primarySource,
        source_level2: secondarySourceKey,
        business_type_ids: defaultType?.id ? [defaultType.id] : [],
        business_category_ids: (() => {
          const categoryId = categoryByName.get(normalizeCategoryKey(categoryLabel))
          return categoryId != null ? [categoryId] : (defaultType?.category_id ? [defaultType.category_id] : [])
        })(),
      }

      if (budget !== null && !Number.isNaN(budget)) {
        payload.budget = budget
      }

      const { error: createError } = await supabase.rpc("rpc_lead_create", {
        payload,
      })

      if (createError) {
        console.error("rpc_lead_create failed in import-run", createError)
        failedCount += 1
      } else {
        importedCount += 1
      }
    }


    const totalDuplicates = dbDuplicateCount
    const totalCount = importedCount + failedCount + totalDuplicates

    try {
      await supabase.rpc("rpc_leads_import_mark_complete", {
        p_job_id: jobId,
        p_status: "completed",
        p_total_count: totalCount,
        p_success_count: importedCount,
        p_duplicate_count: totalDuplicates,
        p_error_message: null,
      })
    } catch (markErr) {
      console.error("rpc_leads_import_mark_complete failed in import-run", markErr)
    }

    return NextResponse.json({
      ok: true,
      jobId,
      totalCount,
      importedCount,
      failedCount,
      duplicateCount: totalDuplicates,
    })
  } catch (err: any) {
    console.error("/api/public-pool/import-run POST failed", err)
    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
