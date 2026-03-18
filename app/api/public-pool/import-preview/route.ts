import { NextRequest, NextResponse } from "next/server"

import { createRouteHandlerClient } from "@/lib/supabase/server"

export const runtime = "edge"

function normalizeCell(value: unknown): string {
  if (value == null) return ""
  const s = String(value).trim()
  return s
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file")

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 })
    }

    const fileName = (file as any).name ?? "import_file"
    const fileSize = file.size ?? null
    const ext = fileName.toLowerCase().split(".").pop() ?? ""

    if (!["csv", "xlsx", "xls"].includes(ext)) {
      return NextResponse.json(
        {
          ok: false,
          error: "unsupported_type",
          detail: "当前仅支持 .csv / .xlsx / .xls 导入，请使用导入模板文件",
        },
        { status: 400 },
      )
    }

    const supabase = createRouteHandlerClient(req)

    const { data: jobId, error: jobError } = await supabase.rpc("rpc_leads_import_request", {
      p_source: "public_pool",
      p_file_name: fileName,
      p_file_size: fileSize,
      p_options: {},
    })

    if (jobError || !jobId) {
      console.error("rpc_leads_import_request failed", jobError)
      return NextResponse.json(
        {
          ok: false,
          error: "create_job_failed",
          detail: jobError?.message ?? "无法创建导入任务",
        },
        { status: 400 },
      )
    }

    let headerRow: string[] | null = null
    let dataRows: string[][] = []

    if (ext === "csv") {
      const text = await file.text()
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (lines.length <= 1) {
        return NextResponse.json(
          {
            ok: false,
            error: "empty_file",
            detail: "导入文件为空或只有表头，请检查模板内容",
          },
          { status: 400 },
        )
      }

      headerRow = (lines[0] ?? "")
        .split(",")
        .map((c) => c.trim())

      dataRows = lines.slice(1).map((line) => line.split(",").map((c) => c.trim()))
    } else {
      const XLSX = await import("xlsx")
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const sheetData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 }) as any[][]

      const rows = (sheetData ?? [])
        .map((row) => (row ?? []).map((cell) => normalizeCell(cell)))
        .filter((row) => row.some((cell: string) => cell.length > 0))

      if (rows.length <= 1) {
        return NextResponse.json(
          {
            ok: false,
            error: "empty_file",
            detail: "导入文件为空或只有表头，请检查模板内容",
          },
          { status: 400 },
        )
      }

      headerRow = (rows[0] ?? []).map((cell) => normalizeCell(cell))
      dataRows = rows.slice(1)
    }

    const totalCount = dataRows.length

    // 为了保证预检查在大文件场景下也能较快返回，这里只采样前 300 行用于统计
    const sampleForStats = dataRows.slice(0, 300)

    // 调用 AI 接口，根据表头和示例行推断列到标准字段的映射
    let aiMapping: any | null = null
    try {
      if (headerRow && dataRows.length > 0) {
        const aiRes = await fetch("/api/ai/import-mapping", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            headers: headerRow,
            sampleRows: sampleForStats,
          }),
        })

        if (aiRes.ok) {
          const aiJson = (await aiRes.json().catch(() => null)) as any
          if (aiJson?.ok && aiJson?.columnMapping) {
            aiMapping = {
              columnMapping: aiJson.columnMapping,
            }
          }
        } else {
          const text = await aiRes.text().catch(() => "")
          console.error("/api/ai/import-mapping returned non-200", aiRes.status, text)
        }
      }
    } catch (aiErr) {
      console.error("Failed to call /api/ai/import-mapping in import-preview", aiErr)
    }

    let estimatedDuplicateCount = 0
    let invalidBasicInfoCount = 0
    const seenPhones = new Set<string>()

    // 统计部分仍按模板列顺序做粗略估算（公司/网址/联系人/电话/微信/来源）
    for (const row of sampleForStats) {
      if (row.length < 7) continue
      const company = normalizeCell(row[0])
      const website = normalizeCell(row[1])
      const contact = normalizeCell(row[2])
      const phoneRaw = normalizeCell(row[3])
      const wechatRaw = normalizeCell(row[4])
      const sourceLabel = normalizeCell(row[5])

      const hasIdentity = Boolean((company || website).trim())
      const hasContact = Boolean((phoneRaw || wechatRaw).trim())
      const hasSource = Boolean(sourceLabel.trim())

      if (!hasIdentity || !hasContact || !hasSource) {
        invalidBasicInfoCount += 1
        continue
      }

      const normalizedPhone = phoneRaw.replace(/[^0-9+]/g, "")
      if (normalizedPhone) {
        if (seenPhones.has(normalizedPhone)) {
          estimatedDuplicateCount += 1
          continue
        }
        seenPhones.add(normalizedPhone)
      }
    }

    const buildPreviewRow = (row: string[]): string[] => {
      const cols = [...row]
      while (cols.length < 7) cols.push("")

      if (aiMapping && typeof aiMapping === "object" && aiMapping.columnMapping) {
        const cm = aiMapping.columnMapping as any
        const pick = (key: keyof typeof cm): string => {
          const idxRaw = cm[key]
          if (typeof idxRaw !== "number" || !Number.isFinite(idxRaw)) return ""
          const idx = Math.floor(idxRaw)
          if (idx < 0 || idx >= cols.length) return ""
          return normalizeCell(cols[idx])
        }

        return [
          pick("company"),
          pick("website"),
          pick("contact"),
          pick("phone"),
          pick("wechat"),
          pick("sourceLabel"),
          pick("budget"),
        ]
      }

      return cols.slice(0, 7).map((c) => normalizeCell(c))
    }

    const previewRows = dataRows.slice(0, 50).map((row) => buildPreviewRow(row))

    return NextResponse.json({
      ok: true,
      jobId,
      fileName,
      fileSize,
      totalCount,
      estimatedDuplicateCount,
      invalidBasicInfoCount,
      previewRows,
      aiMapping,
    })

  } catch (err: any) {
    console.error("/api/public-pool/import-preview POST failed", err)
    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
