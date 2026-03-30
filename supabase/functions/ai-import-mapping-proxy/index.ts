import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const DEFAULT_OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const DEFAULT_OPENROUTER_MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? Deno.env.get("SILICONFLOW_MODEL") ?? "qwen/qwen3-30b-a3b").trim()
const DEFAULT_OPENROUTER_FALLBACK_MODEL = (Deno.env.get("OPENROUTER_FALLBACK_MODEL") ?? "mistralai/mistral-small-3.2-24b-instruct").trim()
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function getUpstreamTimeoutMs(): number {
  const raw = (
    Deno.env.get("OPENROUTER_TIMEOUT_MS") ??
    Deno.env.get("OPENROUTER_EDGE_TIMEOUT_MS") ??
    Deno.env.get("SILICONFLOW_TIMEOUT_MS") ??
    ""
  ).trim()
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed)) {
    return Math.max(5000, Math.min(60000, Math.floor(parsed)))
  }
  return 55000
}

function getMaxTokens(): number {
  const raw = (Deno.env.get("OPENROUTER_MAX_TOKENS") ?? Deno.env.get("SILICONFLOW_MAX_TOKENS") ?? "").trim()
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed)) {
    return Math.max(128, Math.min(2048, Math.floor(parsed)))
  }
  return 220
}

function getOpenRouterApiUrl(): string {
  const raw = (Deno.env.get("OPENROUTER_API_URL") ?? Deno.env.get("SILICONFLOW_API_URL") ?? DEFAULT_OPENROUTER_API_URL).trim()
  return raw || DEFAULT_OPENROUTER_API_URL
}

function getOpenRouterApiKey(): string | null {
  const raw = (Deno.env.get("OPENROUTER_API_KEY") ?? Deno.env.get("SILICONFLOW_API_KEY") ?? Deno.env.get("KIE_API_KEY") ?? "").trim()
  return raw.length > 0 ? raw : null
}

function getOpenRouterSiteUrl(): string | null {
  const raw = (Deno.env.get("OPENROUTER_SITE_URL") ?? Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "").trim()
  return raw.length > 0 ? raw : null
}

function getOpenRouterAppName(): string | null {
  const raw = (Deno.env.get("OPENROUTER_APP_NAME") ?? Deno.env.get("APP_NAME") ?? "iwish-sell-crm").trim()
  return raw.length > 0 ? raw : null
}

function isProviderRestriction(status: number, detail: string): boolean {
  if (status !== 403) {
    return false
  }

  const normalized = detail.toLowerCase()
  return (
    normalized.includes("author") ||
    normalized.includes("provider") ||
    normalized.includes("banned") ||
    normalized.includes("forbidden") ||
    normalized.includes("restricted")
  )
}

async function requestOpenRouter(params: {
  upstreamUrl: string
  upstreamHeaders: Record<string, string>
  upstreamBody: string
  timeoutMs: number
}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    return await fetch(params.upstreamUrl, {
      method: "POST",
      headers: params.upstreamHeaders,
      body: params.upstreamBody,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: CORS_HEADERS,
    })
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS,
    })
  }

  try {
    const upstreamUrl = getOpenRouterApiUrl()
    const timeoutMs = getUpstreamTimeoutMs()
    const startedAt = Date.now()
    const apiKey = getOpenRouterApiKey()
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_api_key",
          detail: "OPENROUTER_API_KEY is not configured on Supabase Edge Function",
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "content-type": "application/json" },
        },
      )
    }

    const rawBody = await req.text()
    let requestPayload: Record<string, unknown>
    try {
      requestPayload = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json_body" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      })
    }

    const selectedModel =
      typeof requestPayload.model === "string" && requestPayload.model.trim()
        ? requestPayload.model.trim()
        : DEFAULT_OPENROUTER_MODEL

    if (!("max_tokens" in requestPayload)) {
      requestPayload.max_tokens = getMaxTokens()
    }

    requestPayload.model = selectedModel
    let upstreamBody = JSON.stringify(requestPayload)

    const upstreamHeaders: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    const siteUrl = getOpenRouterSiteUrl()
    const appName = getOpenRouterAppName()
    if (siteUrl) {
      upstreamHeaders["HTTP-Referer"] = siteUrl
    }
    if (appName) {
      upstreamHeaders["X-Title"] = appName
    }

    console.info("ai-import-mapping-proxy request start", {
      upstreamUrl,
      timeoutMs,
      hasModel: true,
      model: selectedModel || undefined,
      fallbackModel: DEFAULT_OPENROUTER_FALLBACK_MODEL || undefined,
    })

    let llmRes: Response
    try {
      llmRes = await requestOpenRouter({
        upstreamUrl,
        upstreamHeaders,
        upstreamBody,
        timeoutMs,
      })
    } catch (err: any) {
      const name = typeof err?.name === "string" ? err.name : ""
      if (name === "AbortError") {
        console.error("ai-import-mapping-proxy upstream timeout", { upstreamUrl, timeoutMs, elapsedMs: Date.now() - startedAt })
        return new Response(JSON.stringify({ ok: false, error: "upstream_timeout", detail: `Upstream timed out after ${timeoutMs}ms` }), {
          status: 504,
          headers: { ...CORS_HEADERS, "content-type": "application/json" },
        })
      }

      console.error("ai-import-mapping-proxy upstream fetch failed", { upstreamUrl, elapsedMs: Date.now() - startedAt, detail: String(err?.message ?? "") })
      return new Response(JSON.stringify({ ok: false, error: "upstream_fetch_failed", detail: String(err?.message ?? "") }), {
        status: 502,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      })
    }

    let rawText = await llmRes.text()
    let finalModel = selectedModel

    if (
      !llmRes.ok &&
      DEFAULT_OPENROUTER_FALLBACK_MODEL &&
      DEFAULT_OPENROUTER_FALLBACK_MODEL !== selectedModel &&
      isProviderRestriction(llmRes.status, rawText)
    ) {
      requestPayload.model = DEFAULT_OPENROUTER_FALLBACK_MODEL
      upstreamBody = JSON.stringify(requestPayload)
      finalModel = DEFAULT_OPENROUTER_FALLBACK_MODEL

      console.warn("ai-import-mapping-proxy primary model restricted; retrying fallback", {
        primaryModel: selectedModel,
        fallbackModel: DEFAULT_OPENROUTER_FALLBACK_MODEL,
        status: llmRes.status,
        detail: rawText.slice(0, 400),
      })

      try {
        llmRes = await requestOpenRouter({
          upstreamUrl,
          upstreamHeaders,
          upstreamBody,
          timeoutMs,
        })
        rawText = await llmRes.text()
      } catch (err: any) {
        const name = typeof err?.name === "string" ? err.name : ""
        if (name === "AbortError") {
          console.error("ai-import-mapping-proxy fallback upstream timeout", {
            upstreamUrl,
            timeoutMs,
            elapsedMs: Date.now() - startedAt,
          })
          return new Response(JSON.stringify({ ok: false, error: "upstream_timeout", detail: `Upstream timed out after ${timeoutMs}ms` }), {
            status: 504,
            headers: { ...CORS_HEADERS, "content-type": "application/json" },
          })
        }

        console.error("ai-import-mapping-proxy fallback upstream fetch failed", {
          upstreamUrl,
          elapsedMs: Date.now() - startedAt,
          detail: String(err?.message ?? ""),
        })
        return new Response(JSON.stringify({ ok: false, error: "upstream_fetch_failed", detail: String(err?.message ?? "") }), {
          status: 502,
          headers: { ...CORS_HEADERS, "content-type": "application/json" },
        })
      }
    }

    const headers = new Headers()
    headers.set("Access-Control-Allow-Origin", CORS_HEADERS["Access-Control-Allow-Origin"])
    headers.set("Access-Control-Allow-Headers", CORS_HEADERS["Access-Control-Allow-Headers"])
    headers.set("Access-Control-Allow-Methods", CORS_HEADERS["Access-Control-Allow-Methods"])
    headers.set("content-type", llmRes.headers.get("content-type") ?? "application/json")
    const traceId = llmRes.headers.get("x-request-id") ?? llmRes.headers.get("openrouter-generation-id")
    if (traceId) {
      headers.set("x-openrouter-trace-id", traceId)
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
      model: finalModel,
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
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      },
    )
  }
})
