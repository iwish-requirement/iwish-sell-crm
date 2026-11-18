export const DASHBOARD_REQUEST_TIMEOUT_MS = 12_000

async function attemptDashboardRequest<T>(
  load: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  parentSignal.throwIfAborted()
  const timeout = new AbortController()
  const signal = AbortSignal.any([parentSignal, timeout.signal])
  const timer = setTimeout(() => {
    timeout.abort(new DOMException("Dashboard request timed out", "TimeoutError"))
  }, timeoutMs)

  // Race cancellation explicitly because auth can wait before it starts a fetch.
  let cancel!: () => void
  const canceled = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason)
    signal.addEventListener("abort", cancel, { once: true })
  })

  try {
    return await Promise.race([canceled, load(signal)])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", cancel)
  }
}

export async function loadDashboardSection<T>(
  load: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = DASHBOARD_REQUEST_TIMEOUT_MS,
): Promise<T> {
  try {
    return await attemptDashboardRequest(load, signal, timeoutMs)
  } catch {
    signal.throwIfAborted()
    return attemptDashboardRequest(load, signal, timeoutMs)
  }
}
