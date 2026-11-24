import nextWorker from "./.open-next/worker.js"

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js"

export default {
  fetch: nextWorker.fetch,

  async scheduled(_controller, env) {
    if (env.CRM_OPERATIONS_ENABLED !== "true" || !env.CRM_OPERATIONS_JOB_TOKEN) return

    const url = new URL("/api/jobs/operations-handoffs", env.APP_PUBLIC_URL)
    const response = await env.WORKER_SELF_REFERENCE.fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CRM_OPERATIONS_JOB_TOKEN}` },
    })
    await response.body?.cancel()
    if (!response.ok) throw new Error(`CRM operations dispatch returned HTTP ${response.status}`)
  },
}
