import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const DEFAULT_KIE_API_URL = "https://api.siliconflow.cn/v1/chat/completions"

function getKieApiUrl(): string {
  const raw = (Deno.env.get("SILICONFLOW_API_URL") ?? Deno.env.get("KIE_API_URL") ?? DEFAULT_KIE_API_URL).trim()
  return raw || DEFAULT_KIE_API_URL
}

function getKieApiKey(): string | null {
  const raw = (Deno.env.get("SILICONFLOW_API_KEY") ?? Deno.env.get("KIE_API_KEY") ?? Deno.env.get("OPENROUTER_API_KEY") ?? "").trim()
  return raw.length > 0 ? raw : null
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  try {
    const apiKey = getKieApiKey()
    if (!apiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "missing_api_key", detail: "OPENROUTER_API_KEY (或 SILICONFLOW_API_KEY/KIE_API_KEY) is not configured on Supabase Edge Function" }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      )
    }

    // 直接透传请求体到上游 LLM，保持与 OpenRouter Chat Completions 协议兼容
    const upstreamBody = await req.text()

    const llmRes = await fetch(getKieApiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: upstreamBody,
    })

    const rawText = await llmRes.text()

    const headers = new Headers()
    headers.set("content-type", llmRes.headers.get("content-type") ?? "application/json")

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
