import nextWorker from "./.open-next/worker.js"

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js"

async function callScheduledJob(env, path, token) {
  const url = new URL(path, env.APP_PUBLIC_URL)
  const response = await env.WORKER_SELF_REFERENCE.fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
}

export default {
  fetch: nextWorker.fetch,

  async scheduled(controller, env) {
    const jobs = []
    if (env.CRM_OPERATIONS_ENABLED === "true" && env.CRM_OPERATIONS_JOB_TOKEN) {
      jobs.push(callScheduledJob(env, "/api/jobs/operations-handoffs", env.CRM_OPERATIONS_JOB_TOKEN))
    }
    if (env.CRM_PROTECTION_JOB_TOKEN && new Date(controller.scheduledTime).getUTCMinutes() === 0) {
      jobs.push(callScheduledJob(env, "/api/jobs/crm-protection", env.CRM_PROTECTION_JOB_TOKEN))
    }
    const results = await Promise.allSettled(jobs)
    const failed = results.filter((result) => result.status === "rejected")
    if (failed.length) throw new AggregateError(failed.map((result) => result.reason), "CRM scheduled job failed")
  },
}
