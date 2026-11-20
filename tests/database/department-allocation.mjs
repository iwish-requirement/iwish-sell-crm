// Run against a fresh local PGlite database initialized from the CRM migrations.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { loadAllocationFixture } from "./load-allocation-fixture.mjs"

const require = createRequire(import.meta.url)
const { PGlite } = require(process.env.CRM_PGLITE_MODULE ?? "@electric-sql/pglite")
const dataDir = process.env.CRM_ALLOCATION_PGDATA
assert.ok(!dataDir || !dataDir.includes("://"), "A disposable local PGlite data directory is required")
const db = new PGlite(dataDir)
const id = suffix => "00000000-0000-4000-8000-" + String(suffix).padStart(12, "0")
const [admin, seller, otherSeller, manager, existing, other, history, currentHistory] = [1, 2, 3, 4, 11, 12, 21, 22].map(id)
const leadFile = existing + "/" + id(90)
const historyFile = history + "/" + id(91)
const form = {
  signedOn: "2026-11-19", expectedPaymentOn: "2026-11-22", actualPayment: "未到账",
  handoffOn: "2026-11-23", serviceStartsOn: "2026-11-25", salesperson: "演示销售",
  companyName: "演示客户", contractNumber: "DEMO-1", website: "https://example.com",
  mainlandCompanyName: "内地 1#（演示）", hongKongCompanyName: "HK & Demo / 2",
  category: "家居", contactName: "演示客户联系人", contactTitle: "采购",
  phone: "12345678", email: "contact@example.com", cooperation: "fixed_quarter",
  baseFee: "12000", serviceFees: "Google 与 Meta 12000 元", needs: "建立每周复盘",
  address: "演示地址", currency: "CNY", services: { performance: ["google", "meta"] },
}
const legacyCells = [
  "2025年", "2025-11-19", form.expectedPaymentOn, form.actualPayment, form.handoffOn, form.serviceStartsOn,
  form.salesperson, "历史演示客户", null, form.website, form.category, form.contactName,
  form.contactTitle, form.phone, form.email, "固定季度服务费", form.baseFee, form.serviceFees,
  null, null, "Google", "Meta", null, null, null, null, null, null, form.needs, form.address,
  "效果营销二部", "历史演示负责人", null, null, null, null, null, null, null, null, null, null, null, null,
]
const migrations = new URL("../../supabase/", import.meta.url)
const runFile = async name => db.exec(await readFile(new URL(name, migrations), "utf8"))
const json = value => JSON.stringify(value)
const query = async (sql, args) => (await db.query(sql, args)).rows
const value = async (sql, args) => (await query(sql, args))[0].value
const knownError = (callback, code) => assert.rejects(callback, error =>
  error.code === code || String(error.message).includes(code))

async function actor(user) {
  await db.exec("reset role")
  await query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  if (user) await db.exec("set role authenticated")
}

const workspace = pending => value("select public.rpc_department_allocation_workspace($1) as value", [pending])
const leadStates = () => value("select public.rpc_department_allocation_lead_states($1::uuid[]) as value", [[existing, other]])
const details = (source, row) => value("select public.rpc_department_allocation_details($1,$2) as value", [source, row])
const assignment = (source, row, submittedAt, revision, selections) =>
  value("select public.rpc_department_allocation_save($1,$2,$3,$4,$5) as value", [source, row, submittedAt, revision, json(selections)])
const companyFields = { mainlandCompanyName: form.mainlandCompanyName, hongKongCompanyName: form.hongKongCompanyName, currency: "USD" }
const leadSubmit = (version, confirm, data = form, files = [{ path: leadFile, name: "交接说明.txt" }]) => value(
  "select to_jsonb(public.rpc_deal_contract_submission_save($1,$2,$3,$4,$5)) as value",
  [existing, json(data), json(files), version, confirm],
)
const historySubmit = (version, files, services, changes = companyFields) => value(
  "select to_jsonb(public.rpc_department_allocation_history_confirm($1,$2,$3,$4,$5)) as value",
  [history, json(changes), json(files), version, json(services)],
)

try {
  await loadAllocationFixture(db, async name => {
    if (!name.endsWith("_historical_deal_contract_numbers.sql")) return
    await db.exec("insert into public.deal_history_batches(id,source_sha,expected_count) values ('older',repeat('c',64),3)")
    const samples = [
      ["2024年", null, "原表合同编号"],
      ["2026年", "2025/12/31", "2026 年的原编号"],
      [null, "2023/6/1", null],
    ]
    for (const [offset, [year, signedOn, number]] of samples.entries()) {
      const raw = Array(44).fill(null)
      raw[0] = year
      raw[1] = signedOn
      raw[8] = number
      await query("insert into public.deal_history_records(batch_id,source_row,raw_values,source_types) values ('older',$1,$2,$3)",
        [offset + 3, json(raw), json(Array(44).fill(null))])
    }
    await query("insert into crm_allocation.history_submissions(history_id,data,attachments,finance,submitted_at,submitted_by) " +
      "select id,'{\"contractNumber\":\"原表合同编号\",\"companyName\":\"已确认演示客户\"}','[]','{}','2026-11-19T00:00:00Z',$1 " +
      "from public.deal_history_records where batch_id='older' and source_row=3", [seller])
  })
  const backfill = await query("select generated_contract_number, raw_values->>8 as original_number from public.deal_history_records where batch_id='older' order by source_row")
  assert.match(backfill[0].generated_contract_number, /^HIS-2024-[A-F0-9]{12}$/)
  assert.equal(backfill[0].original_number, "原表合同编号")
  assert.deepEqual(backfill[1], { generated_contract_number: null, original_number: "2026 年的原编号" })
  assert.match(backfill[2].generated_contract_number, /^HIS-2023-[A-F0-9]{12}$/)
  const existingHistory = await value("select jsonb_build_object('data',data,'submitted_at',submitted_at) as value from crm_allocation.history_submissions")
  assert.deepEqual(existingHistory, {
    data: { contractNumber: backfill[0].generated_contract_number, companyName: "已确认演示客户" },
    submitted_at: "2026-11-19T00:00:00+00:00",
  })
  await db.exec("insert into public.teams(id,name) values (8101,'演示一组'),(8102,'演示二组')")
  for (const [user, role, team] of [[admin, "Admin", 8101], [seller, "Sales", 8101], [otherSeller, "Sales", 8102], [manager, "Manager", 8101]]) {
    await query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)", [
      user, user + "@example.com", json({ full_name: role, phone: user.slice(-8) }),
    ])
    await query("update public.profiles set status='active',team_id=$2,role_id=(select id from public.roles where name=$3) where id=$1",
      [user, team, role])
  }
  for (const [row, owner, team] of [[existing, seller, 8101], [other, otherSeller, 8102]]) {
    await query("insert into public.leads(id,team_id,owner_id,created_by,name,stage,status,close_result,follow_up_stage) " +
      "values ($1,$2,$3,$3,'演示成交','Won','closed','won','won')", [row, team, owner])
  }
  const dep = Object.fromEntries((await query("select feishu_department_id,id from public.ops_departments"))
    .map(row => [row.feishu_department_id, row.id]))
  await query("insert into public.ops_members(id,feishu_user_id,full_name) values ($1,'test-pm','原项目负责人')", [id(99)])
  await query("insert into public.lead_project_assignments(lead_id,department_id,project_manager_id,assigned_at) values ($1,$2,$3,now())", [
    existing, dep["test-ad2"], id(99),
  ])
  await query("update public.leads set allocation_status='assigned' where id=$1", [existing])
  await query("insert into storage.objects(bucket_id,name,owner_id) values ('deal-contract-materials',$1,$2),('deal-history-materials',$3,$2)", [
    leadFile, seller, historyFile,
  ])
  await db.exec("insert into public.deal_history_batches(id,source_sha,expected_count,published_at) values ('test',repeat('b',64),2,now())")
  for (const [record, sourceRow, raw] of [[history, 3, legacyCells], [currentHistory, 4, [null, "2026-01-01", ...legacyCells.slice(2)]]]) {
    await query("insert into public.deal_history_records(id,batch_id,source_row,owner_id,raw_values,source_types) " +
      "values ($1,'test',$2,$3,$4,$5)", [record, sourceRow, seller, json(raw), json(raw.map(() => null))])
  }

  await actor(seller)
  assert.equal(await value("select public.rpc_department_allocation_release() as value"), null)
  await knownError(() => leadSubmit(0,true,{ ...form, mainlandCompanyName:" " }), "deal_contract_required")
  await knownError(() => leadSubmit(0,true,{ ...form, hongKongCompanyName:"" }), "deal_contract_required")
  await knownError(() => leadSubmit(0,false,{ ...form, currency:"HKD" }), "deal_contract_currency")
  await knownError(() => leadSubmit(0,true,{ ...form, currency:"" }), "deal_contract_required")
  await knownError(() => leadSubmit(0, true, form, []), "deal_contract_required")
  await knownError(() => leadSubmit(0, true, { ...form, attachmentStatus:"skip" }, []), "deal_contract_attachment_status")
  assert.equal((await leadSubmit(0, false, { ...form, attachmentStatus:"none" }, [])).draft.attachmentStatus, "none")
  await knownError(() => leadSubmit(1, true, { ...form, attachmentStatus:"" }, []), "deal_contract_required")
  const noFileLead = await leadSubmit(1, true, form, [])
  assert.equal(noFileLead.submitted.attachmentStatus, "none")
  assert.deepEqual(noFileLead.submitted_attachments, [])
  await actor(null)
  const originalAssignment = await value("select to_jsonb(a) as value from public.lead_project_assignments a where a.lead_id=$1", [existing])
  await runFile("releases/crm_department_allocation_phase_one.sql")
  await actor(admin)
  const releaseTime = await value("select public.rpc_department_allocation_release() as value")
  assert.ok(releaseTime)
  await knownError(() => workspace(null), "42501")
  assert.equal((await workspace(false)).rows.length, 0)
  assert.deepEqual((await workspace(true)).rows.map(row => row.id).sort(), [existing, other].sort())

  await actor(seller)
  await knownError(() => details("lead", other), "42501")
  assert.deepEqual(await leadStates(), { [existing]: "needs_contract" })
  assert.deepEqual((await workspace(true)).rows.map(row => row.id), [existing])
  await leadSubmit(2, false)
  assert.equal((await workspace(false)).rows.length, 0)
  assert.equal((await leadSubmit(3, true)).submitted.attachmentStatus, undefined)
  assert.deepEqual(await leadStates(), { [existing]: "ready" })
  assert.equal((await workspace(true)).rows.length, 0)
  const own = (await workspace(false)).rows[0]
  const selections = { "performance/google": [dep["test-ad2"], dep["test-ad3"]], "performance/meta": [dep["test-ad3"]] }
  await knownError(() => assignment("lead", existing, own.submitted_at, 0, selections), "42501")
  const generatedNumber = await value("select generated_contract_number as value from public.deal_history_records where id=$1", [history])
  assert.match(generatedNumber, /^HIS-2025-[A-F0-9]{12}$/)
  assert.deepEqual((await query("select id from public.rpc_deal_history_list()")).map(row => row.id), [currentHistory])
  await knownError(() => query("select public.rpc_deal_history_save($1,'{\"I\":\"手动编号\"}'::jsonb,'[]'::jsonb,0)", [history]),
    "deal_history_generated_number")
  await knownError(() => historySubmit(0, [], form.services), "department_allocation_history_required")
  await knownError(() => historySubmit(0, [], form.services, { ...companyFields, attachmentStatus:"skip" }), "deal_history_attachment_status")
  const files = [{ path: historyFile, name: "历史交接说明.txt" }]
  await knownError(() => historySubmit(0, files, form.services, { ...companyFields, hongKongCompanyName:"" }),
    "department_allocation_history_required")
  await knownError(() => historySubmit(0, files, form.services, { ...companyFields, currency:"HKD" }),
    "deal_history_currency")
  const noFileHistory = await historySubmit(0, [], form.services, { ...companyFields, attachmentStatus:"none" })
  assert.equal(noFileHistory.fields.attachmentStatus, "none")
  const noFileDetails = await details("history", history)
  assert.equal(noFileDetails.data.attachmentStatus, "none")
  assert.deepEqual(noFileDetails.attachments, [])
  const historyWithFile = await historySubmit(1, files, form.services)
  assert.equal(historyWithFile.fields.attachmentStatus, undefined)
  const submittedHistory = (await details("history", history)).data
  assert.equal(submittedHistory.contractNumber, generatedNumber)
  assert.equal(submittedHistory.companyName, companyFields.mainlandCompanyName)
  assert.equal(submittedHistory.hongKongCompanyName, companyFields.hongKongCompanyName)
  assert.equal(submittedHistory.currency, "USD")
  assert.equal(submittedHistory.attachmentStatus, undefined)
  assert.equal(await value("select generated_contract_number as value from public.deal_history_records where id=$1", [history]), generatedNumber)

  await actor(manager)
  assert.equal((await workspace(true)).rows.length, 0)
  assert.equal((await workspace(false)).rows.length, 2)
  await knownError(() => details("lead", other), "42501")
  await actor(admin)
  assert.equal((await workspace(true)).rows.length, 1)
  const queue = await workspace(false)
  const submittedLead = (await details("lead", existing)).data
  assert.equal(submittedLead.mainlandCompanyName, form.mainlandCompanyName)
  assert.equal(submittedLead.hongKongCompanyName, form.hongKongCompanyName)
  assert.equal(submittedLead.companyName, form.mainlandCompanyName)
  assert.equal(submittedLead.currency, "CNY")
  assert.deepEqual(queue.departments.filter(item => item.category === "performance").map(item => item.name).sort(),
    ["效果营销二部", "效果营销三部", "效果营销四部"].sort())
  await knownError(() => assignment("lead", existing, own.submitted_at, 0, { "performance/google": selections["performance/google"] }),
    "department_allocation_services")
  await knownError(() => assignment("lead", existing, own.submitted_at, 0, { ...selections, "performance/meta": [dep["test-brand"]] }),
    "department_allocation_department")
  const first = await assignment("lead", existing, own.submitted_at, 0, selections)
  assert.equal(first.handoffs.length, 2)
  const shared = first.handoffs.find(item => item.departmentId === dep["test-ad3"])
  assert.deepEqual(shared.services, ["performance/google", "performance/meta"])
  await knownError(() => assignment("lead", existing, own.submitted_at, 0, selections), "40001")
  const next = await assignment("lead", existing, own.submitted_at, 1, { ...selections, "performance/meta": [dep["test-ad4"]] })
  assert.equal(next.handoffs.find(item => item.departmentId === dep["test-ad3"]).id, shared.id)
  const historyRow = queue.rows.find(row => row.source === "history")
  assert.equal((await assignment("history", history, historyRow.submitted_at, 0, selections)).handoffs.length, 2)
  await knownError(() => assignment("lead", other, own.submitted_at, 0, selections), "40001")

  await actor(seller)
  assert.equal((await details("lead", existing)).handoffs.length, 3)
  assert.deepEqual(await leadStates(), { [existing]: "assigned" })
  assert.equal((await details("history", history)).handoffs.length, 2)
  await knownError(() => query("select public.rpc_deal_contract_submission_confirm_finance($1,$2)", [existing, json({ legalName: "演示签署主体" })]), "42501")
  await knownError(() => query("select * from crm_allocation.handoffs"), "42501")
  await actor(otherSeller)
  assert.equal((await workspace(false)).rows.length, 0)
  await knownError(() => details("history", history), "42501")
  await db.exec("reset role; set role anon")
  await knownError(() => workspace(false), "42501")

  await actor(null)
  await db.exec("insert into public.role_permissions(role_id,permission_key,effect,scope_type) " +
    "select id,'contracts.finance.confirm','allow','org' from public.roles where name='Admin' on conflict do nothing")
  await actor(admin)
  await query("select public.rpc_deal_contract_submission_confirm_finance($1,$2)", [existing, json({
    legalName: "演示签署主体", receivedOn: "2026-11-22", receivedAmount: "12000", currency: "CNY",
  })])
  assert.deepEqual(await leadStates(), { [existing]: "assigned", [other]: "needs_contract" })
  assert.equal((await details("lead", existing)).finance.receivedAmount, "12000")
  await actor(null)
  assert.deepEqual(await value("select raw_values as value from public.deal_history_records where id=$1", [history]), legacyCells)
  assert.deepEqual(await value("select to_jsonb(a) as value from public.lead_project_assignments a where a.lead_id=$1", [existing]), originalAssignment)
  await knownError(() => query("update public.lead_project_assignments set assigned_at=clock_timestamp() where lead_id=$1", [existing]),
    "legacy_allocation_closed")
  await runFile("rollbacks/crm_department_allocation_phase_one.sql")
  await actor(admin)
  assert.equal(await value("select public.rpc_department_allocation_release() as value"), null)
  assert.equal(await details("lead", existing), null)
  assert.equal((await query("select lead_id from public.rpc_project_allocations_list()")).length, 2)
  await knownError(() => workspace(false), "42501")
  await actor(null)
  assert.equal(await value("select count(*)::int as value from crm_allocation.assignments"), 2)
  await runFile("releases/crm_department_allocation_phase_one.sql")
  await actor(admin)
  assert.deepEqual(await value("select public.rpc_department_allocation_release() as value"), releaseTime)
  assert.equal((await details("lead", existing)).handoffs.length, 3)
  console.log("Passed CRM allocation permissions, all-current-customer reconfirmation, historical records, grouped handoffs and database rollback.")
} finally {
  await db.close()
}
