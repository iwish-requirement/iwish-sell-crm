import { NextRequest, NextResponse } from "next/server"

import { createRouteHandlerClient } from "@/lib/supabase/server"


export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient(req)

    const contentType = req.headers.get("content-type") || ""

    let fileName = "import_file"
    let fileSize: number | null = null

    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as any
      if (body && typeof body === "object") {
        if (typeof body.fileName === "string" && body.fileName.trim().length > 0) {
          fileName = body.fileName.trim()
        }
        if (typeof body.fileSize === "number" && Number.isFinite(body.fileSize)) {
          fileSize = body.fileSize
        }
      }
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData()
      const file = formData.get("file")
      if (file instanceof Blob) {
        fileName = ((file as any).name as string | undefined) || fileName
        fileSize = file.size ?? null
      }
    }

    const { data: jobId, error: jobError } = await supabase.rpc("rpc_leads_import_request", {
      p_source: "public_pool",
      p_file_name: fileName,
      p_file_size: fileSize,
      p_options: {},
    })

    if (jobError || !jobId) {
      console.error("rpc_leads_import_request failed in import-preview", jobError)
      return NextResponse.json(
        {
          ok: false,
          error: "create_job_failed",
          detail: jobError?.message ?? "无法创建导入任务",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      jobId,
      fileName,
      fileSize,
    })
  } catch (err: any) {
    console.error("/api/public-pool/import-preview POST failed", err)
    return NextResponse.json(
      { ok: false, error: "unexpected", detail: String(err?.message ?? "") },
      { status: 500 },
    )
  }
}
