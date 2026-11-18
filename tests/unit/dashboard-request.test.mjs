import assert from "node:assert/strict"
import test from "node:test"
import { loadDashboardSection } from "../../lib/services/dashboard-request.ts"

test("a stalled dashboard section does not delay another section", async () => {
  const { signal } = new AbortController()
  let attempts = 0
  const stalled = loadDashboardSection(() => {
    attempts++
    return new Promise(() => {})
  }, signal, 50)
  const rejected = assert.rejects(stalled, { name: "TimeoutError" })

  assert.equal(await loadDashboardSection(async () => 1200, signal), 1200)
  assert.equal(attempts, 1)
  await rejected
  assert.equal(attempts, 2)
})

test("a timed-out attempt is canceled before the section is retried", async () => {
  const { signal } = new AbortController()
  let firstSignal
  const result = await loadDashboardSection((attemptSignal) => {
    if (!firstSignal) {
      firstSignal = attemptSignal
      return new Promise(() => {})
    }
    assert.equal(firstSignal.aborted, true)
    assert.equal(attemptSignal.aborted, false)
    return Promise.resolve("ready")
  }, signal, 25)

  assert.equal(result, "ready")
})

test("leaving the dashboard cancels its request without retrying", async () => {
  const controller = new AbortController()
  let attempts = 0
  const result = loadDashboardSection((attemptSignal) => {
    attempts++
    assert.equal(attemptSignal.aborted, false)
    return new Promise(() => {})
  }, controller.signal)

  controller.abort()
  await assert.rejects(result, { name: "AbortError" })
  assert.equal(attempts, 1)
})

test("a failed request can succeed on the automatic retry", async () => {
  const { signal } = new AbortController()
  let attempts = 0
  const result = await loadDashboardSection(async () => {
    if (++attempts === 1) throw new TypeError("Failed to fetch")
    return "ready"
  }, signal)

  assert.equal(result, "ready")
  assert.equal(attempts, 2)
})
