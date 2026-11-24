import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { setTimeout } from "node:timers/promises"
import { chromium, expect as baseExpect } from "@playwright/test"

const expect = baseExpect.configure({ timeout: 16000 })

async function waitFor(read, check, description) {
  for (let trial = 0; trial < 60; trial++) {
    const snapshot = await read()
    if (check(snapshot)) return snapshot
    await setTimeout(250)
  }
  assert.fail(description)
}

export async function verifyLocalOperations({
  origin, db, lead, untouched, company, admin, sales, other, departments, jobs, attempts, rpc, sendStaffing, verifyBackground,
}) {
  const fallback = "C:/Program Files/Google/Chrome/Application/chrome.exe"
  const executablePath = process.env.CRM_TEST_CHROMIUM_PATH ?? (existsSync(fallback) ? fallback : undefined)
  const browser = await chromium.launch({ executablePath })
  try {
    const allocation = await browser.newPage()
    const deal = await browser.newPage()
    const ops = await browser.newPage()
    const pageErrors = []
    for (const page of [allocation, deal, ops]) {
      page.on("pageerror", error => pageErrors.push(error.message))
      page.setDefaultTimeout(17000)
    }
    const readDetails = (id, actor) => rpc("rpc_department_allocation_details", { p_source: "lead", p_id: id }, actor)
    const readDeliveries = async () => (await db.query(
      "select handoff_id, state, attempts, payload, version from crm_allocation.operations_deliveries order by handoff_id",
    )).rows

    await assert.rejects(() => rpc("rpc_operations_handoffs_claim", { p_limit: 5 }, sales), error => error.code === "42501")
    await assert.rejects(() => readDetails(lead, other), error => error.code === "42501")
    const disabledEnvironment = process.env.CRM_OPERATIONS_ENABLED
    process.env.CRM_OPERATIONS_ENABLED = "false"
    const callback = origin + "/api/v1/crm/handoff-staffing"
    try {
      const off = await fetch(callback, { method:"POST" })
      assert.equal(off.status, 503)
      assert.equal((await off.json()).error, "OPS_INTEGRATION_DISABLED")
    } finally {
      process.env.CRM_OPERATIONS_ENABLED = disabledEnvironment
    }
    assert.equal((await fetch(callback, { method:"POST" })).status, 401)

    await deal.goto(origin + "/deals")
    await deal.getByRole("button", { name:"合同资料提交", exact:true }).click()
    const form = deal.getByRole("dialog", { name:"合同资料提交" })
    await expect(form.getByText("未到账", { exact:true }).first()).toBeVisible()
    await form.getByRole("button", { name:"确认提交", exact:true }).click()
    await expect(form.getByText("已确认提交", { exact:true })).toBeVisible()
    await form.getByRole("button", { name:"Close", exact:true }).click()
    await allocation.goto(origin + "/allocations")
    const row = allocation.getByRole("row").filter({ hasText:company })
    await expect(row.getByText("待分配部门", { exact:true })).toBeVisible()
    await row.getByRole("button", { name:"查看并分配" }).click()
    const dialog = allocation.getByRole("dialog", { name:"承接部门" })
    const google = dialog.getByRole("group", { name:"效果营销服务 · Google", exact:true })
    const meta = dialog.getByRole("group", { name:"效果营销服务 · Meta", exact:true })
    await google.getByRole("checkbox", { name:"效果营销二部" }).click()
    await google.getByRole("checkbox", { name:"效果营销三部" }).click()
    await meta.getByRole("checkbox", { name:"效果营销三部" }).click()
    await dialog.getByRole("button", { name:"确认分配" }).click()
    await expect(dialog).toBeHidden()
    const retrying = await waitFor(readDeliveries, rows => rows.some(item => item.state === "retrying"), "Transient delivery failure was not queued for retry")
    const waitingJob = jobs.get(retrying.find(item => item.state === "retrying").handoff_id)
    const premature = await sendStaffing(waitingJob,false)
    assert.equal(premature.status,409)
    assert.equal((await premature.json()).error,"HANDOFF_RECEIPT_PENDING")
    await allocation.getByRole("button", { name:"刷新状态" }).click()
    await expect(row.getByText("已分配部门 · 送单重试中", { exact:true })).toBeVisible()
    const received = await waitFor(readDeliveries, rows => rows.length === 2 && rows.every(item => item.state === "received"), "Operations receipts did not arrive")
    assert.deepEqual(received.map(item => item.attempts).sort(), [1,2])
    assert.equal(jobs.size, 2)
    const retried = [...attempts.values()].find(items => items.length === 2)
    assert.deepEqual(retried[0],retried[1])
    assert.equal(received[0].payload.payment,"未到账")
    assert.deepEqual(received[0].payload.finance,{})
    assert.equal(received[0].payload.source,"lead")
    assert.equal(received[0].payload.mainlandCompanyName,company + "（大陆）")
    assert.equal(received[0].payload.hongKongCompanyName,"香港演示签约公司")
    assert.equal(received[0].payload.company,company + "（大陆） / 香港演示签约公司")
    assert.equal(received[0].payload.contractCurrency,"CNY")
    assert.deepEqual(received[0].payload.attachments,[])
    assert.equal(received[0].payload.attachmentStatus,"none")
    assert.equal((await readDetails(untouched,admin)).handoffs[0].delivery,undefined)
    const shared = [...jobs.values()].find(job => job.body.services.length === 2)
    assert.equal(shared.body.department.id, departments["test-ad3"])
    assert.deepEqual(shared.body.services.map(service => service.id), ["performance/google","performance/meta"])

    await allocation.getByRole("button", { name:"刷新状态" }).click()
    await expect(row.getByText("已分配部门 · 运营已收单", { exact:true })).toBeVisible()
    await row.getByRole("button", { name:"查看并分配" }).click()
    await expect(dialog.getByText("运营工单 " + shared.workOrderId)).toBeVisible()
    await deal.bringToFront()
    await deal.getByRole("button", { name:"合同资料提交", exact:true }).click()
    await expect(form.getByText("运营工单 " + shared.workOrderId)).toBeVisible()

    await ops.goto(origin + "/operations")
    const simulatedOrder = ops.getByRole("listitem").filter({ hasText:shared.workOrderId })
    await simulatedOrder.getByRole("button", { name:"确认人员" }).click()
    await expect(ops.getByRole("status")).toHaveText("回传成功，人员版本 1")
    assert.equal((await readDetails(lead,sales)).handoffs.find(item => item.id === shared.body.id).staffing.projectLead.name, "演示项目负责人")
    await allocation.bringToFront()
    await expect(dialog.getByText("演示项目负责人", { exact:true })).toBeVisible()
    await deal.bringToFront()
    await expect(form.getByText("演示项目负责人", { exact:true })).toBeVisible()
    await expect(form.getByText("演示优化师甲", { exact:true })).toHaveCount(2)

    await ops.bringToFront()
    await simulatedOrder.getByRole("button", { name:"换人并回传" }).click()
    await expect(ops.getByRole("status")).toHaveText("回传成功，人员版本 2")
    const replay = await sendStaffing(shared, false)
    assert.deepEqual(await replay.json(), { accepted:true,version:2 })
    assert.equal((await sendStaffing(shared, true)).status,200)
    assert.equal((await sendStaffing(shared, true, true)).status,400)
    const staffingConflict = await rpc("rpc_operations_staffing_accept", {
      p_handoff_id:shared.body.id, p_department_id: shared.body.department.id,
      p_body:{ scopeVersion:shared.body.scopeVersion, version:2, workOrderId:shared.workOrderId,
        staffing:shared.body.services.map(item=>({ serviceId:item.id,members:[{ id:"different",name:"另一位演示优化师" }] })) },
    },"service_role")
    assert.equal(staffingConflict.error,"STAFFING_VERSION_CONFLICT")
    await allocation.bringToFront()
    await expect(dialog.getByText("演示接任负责人", { exact:true })).toBeVisible()
    await deal.bringToFront()
    await expect(form.getByText("演示接任负责人", { exact:true })).toBeVisible()

    await rpc("rpc_deal_contract_submission_confirm_finance",{ p_lead_id:lead,p_values:{ legalName:"演示签署主体" } },admin)
    await waitFor(readDeliveries, rows => rows.every(item => item.state === "received" && Number(item.version) === 2), "Signing entity did not reach original work orders")
    assert.deepEqual(jobs.get(shared.body.id).body.finance,{ legalName:"演示签署主体" })
    assert.equal(jobs.get(shared.body.id).body.payment,"未到账")

    await rpc("rpc_deal_contract_submission_confirm_finance",{ p_lead_id:lead,p_values:{
      receivedOn:"2026-11-20",receivedAmount:"12000",currency:"USD",
    } },admin)
    await waitFor(readDeliveries, rows => rows.every(item => item.state === "received" && Number(item.version) === 3), "Finance update did not reach original work orders")
    assert.equal(jobs.get(shared.body.id).workOrderId,shared.workOrderId)
    assert.equal(jobs.get(shared.body.id).body.finance.receivedAmount,"12000")
    assert.equal(jobs.get(shared.body.id).body.finance.currency,"USD")
    assert.equal(jobs.get(shared.body.id).body.contractCurrency,"CNY")
    assert.equal(jobs.get(shared.body.id).body.scopeVersion,shared.body.scopeVersion)
    assert.ok((await readDetails(lead,sales)).handoffs.some(item => item.staffing?.projectLead.name === "演示接任负责人"))

    await allocation.bringToFront()
    await meta.getByRole("checkbox", { name:"效果营销四部" }).click()
    await meta.getByRole("checkbox", { name:"效果营销三部" }).click()
    await dialog.getByRole("button", { name:"确认分配" }).click()
    await expect(dialog).toBeHidden()
    await waitFor(readDeliveries, rows => rows.length === 3 && rows.every(item => item.state === "received"), "Department scope update did not dispatch")
    assert.equal(jobs.get(shared.body.id).workOrderId,shared.workOrderId)
    assert.equal((await sendStaffing(shared,true)).status,409)
    assert.ok((await readDetails(lead,sales)).handoffs.every(item => !item.staffing))
    await db.exec(await readFile(new URL("../../supabase/rollbacks/crm_operations_phase_two.sql",import.meta.url),"utf8"))
    const dbOff = await sendStaffing(jobs.get(shared.body.id),false)
    assert.equal(dbOff.status,503)
    assert.equal((await dbOff.json()).error,"OPS_INTEGRATION_DISABLED")
    assert.deepEqual(await rpc("rpc_operations_handoffs_claim",{ p_limit:5 },"service_role"),[])
    verifyBackground()
    assert.deepEqual(pageErrors,[])
    console.log("PASS CRM React UI, production route handlers and local SQL: submission, scoped delivery, automatic retry, receipt, roster, versioned replacement, finance, reallocation, permissions and pause.")
  } finally {
    await browser.close()
  }
}
