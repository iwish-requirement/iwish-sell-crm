import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const DEFAULT_SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/chat/completions"

function getUpstreamTimeoutMs(): number {
  const raw = (Deno.env.get("SILICONFLOW_TIMEOUT_MS") ?? "").trim()
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed)) {
    return Math.max(5000, Math.min(60000, Math.floor(parsed)))
  }
  return 55000
}

function getSiliconFlowApiUrl(): string {
  const raw = (Deno.env.get("SILICONFLOW_API_URL") ?? DEFAULT_SILICONFLOW_API_URL).trim()
  return raw || DEFAULT_SILICONFLOW_API_URL
}

function getSiliconFlowApiKey(): string | null {
  const raw = (Deno.env.get("SILICONFLOW_API_KEY") ?? "").trim()
  return raw.length > 0 ? raw : null
}

function shouldSendXApiKeyHeader(): boolean {
  const raw = (Deno.env.get("SILICONFLOW_SEND_X_API_KEY") ?? "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes"
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  try {
    const upstreamUrl = getSiliconFlowApiUrl()
    const timeoutMs = getUpstreamTimeoutMs()
    const startedAt = Date.now()
    const apiKey = getSiliconFlowApiKey()
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_api_key",
          detail: "SILICONFLOW_API_KEY is not configured on Supabase Edge Function",
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      )
    }

    const upstreamBody = await req.text()

    const upstreamHeaders: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    if (shouldSendXApiKeyHeader()) {
      upstreamHeaders["X-API-Key"] = apiKey
    }

    let model = ""
    try {
      const parsed = JSON.parse(upstreamBody) as any
      if (parsed && typeof parsed === "object" && typeof parsed.model === "string") {
        model = parsed.model
      }
    } catch {
    }

    console.info("ai-import-mapping-proxy request start", {
      upstreamUrl,
      timeoutMs,
      hasModel: Boolean(model),
      model: model || undefined,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    let llmRes: Response
    try {
      llmRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders,
        body: upstreamBody,
        signal: controller.signal,
      })
    } catch (err: any) {
      const name = typeof err?.name === "string" ? err.name : ""
      if (name === "AbortError") {
        console.error("ai-import-mapping-proxy upstream timeout", { upstreamUrl, timeoutMs, elapsedMs: Date.now() - startedAt })
        return new Response(JSON.stringify({ ok: false, error: "upstream_timeout", detail: `Upstream timed out after ${timeoutMs}ms` }), {
          status: 504,
          headers: { "content-type": "application/json" },
        })
      }

      console.error("ai-import-mapping-proxy upstream fetch failed", { upstreamUrl, elapsedMs: Date.now() - startedAt, detail: String(err?.message ?? "") })
      return new Response(JSON.stringify({ ok: false, error: "upstream_fetch_failed", detail: String(err?.message ?? "") }), {
        status: 502,
        headers: { "content-type": "application/json" },
      })
    } finally {
      clearTimeout(timeoutId)
    }

    const rawText = await llmRes.text()

    const headers = new Headers()
    headers.set("content-type", llmRes.headers.get("content-type") ?? "application/json")
    const traceId = llmRes.headers.get("x-siliconcloud-trace-id")
    if (traceId) {
      headers.set("x-siliconcloud-trace-id", traceId)
    }

    if (!llmRes.ok) {
      console.error("ai-import-mapping-proxy upstream call failed", {
        status: llmRes.status,
        contentType: llmRes.headers.get("content-type"),
        bodyPreview: rawText.slice(0, 1000),
      })
      return new Response(rawText || JSON.stringify({ ok: false, error: "llm_error", status: llmRes.status }), {
        status: llmRes.status,
        headers,
      })
    }

    if (!rawText.trim()) {
      console.error("ai-import-mapping-proxy upstream returned empty body", {
        status: llmRes.status,
      })
      return new Response(JSON.stringify({ ok: false, error: "empty_llm_response" }), {
        status: 502,
        headers,
      })
    }

    console.info("ai-import-mapping-proxy request done", {
      status: llmRes.status,
      elapsedMs: Date.now() - startedAt,
      traceId: traceId || undefined,
    })

    return new Response(rawText, {
      status: llmRes.status,
      headers,
    })
  } catch (err: any) {
    console.error("ai-import-mapping-proxy unexpected error", err)
    return new Response(
      JSON.stringify({ ok: false, error: "unexpected", detail: String(err?.message ?? "") }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    )
  }
})
