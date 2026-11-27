import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { loadAllocationFixture } from "./load-allocation-fixture.mjs"

const require = createRequire(import.meta.url)
const { PGlite } = require(process.env.CRM_PGLITE_MODULE ?? "@electric-sql/pglite")
const db = new PGlite()
const id = (key) => "00000000-0000-4000-8000-" + String(key).padStart(12, "0")
const [admin, owner, companion, outsider, lead, historic, won, visitA, visitB, foreignLead, junior] =
  [1, 2, 3, 4, 11, 12, 13, 16, 17, 18, 28].map(id)
const rows = async (sql, args) => (await db.query(sql, args)).rows
const value = async (sql, args) => (await rows(sql, args))[0]?.value
const rejects = (sql, args, code) => assert.rejects(() => rows(sql, args), (error) => error.message.includes(code))
const json = JSON.stringify
const team = 8101
const legacyRules = ["iwish.trg_lead_pipeline_defaults()", "iwish.rpc_auto_return_leads_to_pool()", "iwish.enforce_lead_quota(uuid,uuid)"]
const ruleDefinitions = () => rows("select pg_get_functiondef(sig::regprocedure) as definition from unnest($1::text[]) as t(sig)", [legacyRules])
let rulesBefore
let historicalUpdatedAt


async function actor(user, role = "authenticated") {
  await db.exec("reset role")
  await rows("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""])
  if (user || role === "service_role") await db.exec("set role " + role)
}

async function insertLead(key, assignedTo, leadTeam, name, stage, createdAt) {
  await rows("insert into public.leads(id,team_id,owner_id,created_by,name,stage,follow_up_stage,created_at) " +
    "values ($1,$2,$3,$3,$4,'L1',$5,$6)", [key, leadTeam, assignedTo, name, stage, createdAt])
}

try {
  await loadAllocationFixture(db, async (filename) => {
    if (filename.endsWith("_crm_customer_protection_rules.sql")) {
      assert.deepEqual(await ruleDefinitions(), rulesBefore)
      historicalUpdatedAt = await value("select updated_at::text as value from public.leads where id=$1",[historic])
      return
    }
    if (!filename.endsWith("_crm_first_release.sql")) return
    rulesBefore = await ruleDefinitions()
    await db.exec("insert into public.teams(id,name) values (8101,'测试团队'), (8102,'独立团队')")
    for (const [user, role, assignedTeam] of [[admin, "SuperAdmin", team], [owner, "Sales", team], [companion, "Sales", team], [outsider, "Sales", 8102], [junior, "Sales", team]]) {
      await rows("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
        user, user + "@example.com", json({ full_name: user === junior ? "冀腾飞" : "演示 " + user.slice(-2), phone: user.slice(-8) }),
      ])
      await rows("update public.profiles set status='active',team_id=$2,role_id=(select id from public.roles where name=$3) where id=$1",
        [user, assignedTeam, role])
    }
    await db.exec("alter table public.leads disable trigger trg_lead_pipeline_defaults")
    await insertLead(historic, owner, team, "历史客户", "online_communication", "2026-11-01T04:00:00Z")
    await rows("update public.leads set locked_until='2026-11-02T04:00:00Z', protected_until='2026-12-01T04:00:00Z' where id=$1", [historic])
    await rows("insert into public.lead_notes(lead_id,author_id,content,note_type) values($1,$2,'原线下拜访内容','visit')", [historic,owner])
    await db.exec("alter table public.leads enable trigger trg_lead_pipeline_defaults")
  })
  assert.deepEqual(await rows("select monthly, quarterly, yearly, weekly_reference from iwish.crm_visit_goals where profile_id=$1 order by effective_on",[junior]), [
    { monthly: 16, quarterly: null, yearly: null, weekly_reference: null },
    { monthly: 20, quarterly: 60, yearly: 240, weekly_reference: "5" },
  ])
  assert.deepEqual(await rows("select follow_up_stage,locked_until,protected_until,crm_legacy_protected_until,crm_protection_review_required from public.leads where id=$1",[historic]), [{
    follow_up_stage: "online_communication",
    locked_until: new Date("2026-11-02T04:00:00Z"),
    protected_until: null,
    crm_legacy_protected_until: new Date("2026-12-01T04:00:00Z"),
    crm_protection_review_required: true,
  }])
  assert.equal(await value("select count(*)::integer as value from public.lead_notes where lead_id=$1 and note_type='visit'",[historic]),1)
  assert.equal(await value("select updated_at::text as value from public.leads where id=$1",[historic]),historicalUpdatedAt)
  assert.equal(await value("select tgenabled::text as value from pg_trigger where tgrelid='public.leads'::regclass and tgname='trg_leads_updated_at'"),"O")

  async function seedLead(...args) {
    await rows("select set_config('request.jwt.claim.sub',$1,false)", [admin])
    await insertLead(...args)
    await rows("select set_config('request.jwt.claim.sub','',false)")
  }

  const day = await value("select iwish.crm_today()::text as value")
  const tomorrow = await value("select (iwish.crm_today()+1)::text as value")
  await seedLead(lead, owner, team, "演示客户", "uncontacted", day+"T00:00:00Z")
  await seedLead(foreignLead, outsider, 8102, "外部团队客户", "uncontacted", day+"T00:00:00Z")
  const originalDeadline = await value("select iwish.crm_protection_deadline(l)::text as value from public.leads l where id=$1",[lead])
  const data = {
    visitDate: day, method: "video", type: "first", contactName: "测试联系人", contactTitle: "采购",
    services: ["Google广告运营"], needs: "正式讨论预算", outcome: "确认后续报价", expectedMargin: "100",
    expectedSignedOn: "待确认", nextAction: "发方案", nextContactOn: tomorrow, meetingUrl: "", missingReason: "", files: [],
  }
  const save = (key, payload, participants = [owner,companion]) => rows(
    "select public.rpc_crm_visit_save($1,$2,$3,$4::uuid[],null)",
    [lead,key,json(payload),participants],
  )
  const report = () => value("select public.rpc_crm_visit_goal_report($1,$2,'month') as value", [day,tomorrow])
  await actor(owner)
  const recordContact = (note, confirmed, content) => rows(
    "select public.rpc_crm_record_contact($1,$2,'wechat',$3,$4)", [lead,note,content,confirmed],
  )
  const events = () => rows("select * from public.rpc_crm_lead_stage_events($1)", [lead])
  const attempted = id(25)
  const confirmed = id(26)
  await rejects("select public.rpc_lead_advance_with_action($1,'connected','直接推进')",[lead],"ERR_CRM_STAGE_ACTION_REQUIRED")
  await recordContact(attempted,false,"已发消息，客户尚未回复")
  assert.equal(await value("select follow_up_stage as value from public.leads_secure_view where id=$1",[lead]),"uncontacted")
  await recordContact(confirmed,true,"客户已回复并确认联系")
  await recordContact(confirmed,true,"客户已回复并确认联系")
  await assert.rejects(() => recordContact(confirmed,false,"修改已提交建联"), /ERR_CRM_CONFLICT/)
  assert.equal(await value("select follow_up_stage as value from public.leads_secure_view where id=$1",[lead]),"connected")
  assert.equal(await value("select count(*)::integer as value from public.lead_notes where lead_id=$1",[lead]),2)
  assert.ok(await value("select last_contact_at as value from public.leads_secure_view where id=$1",[lead]))
  assert.deepEqual((await events()).map((event) => [event.previous_stage,event.next_stage,event.note_id]),
    [["uncontacted","connected",confirmed]])
  await assert.rejects(() => save(visitA,data), /ERR_CRM_VISIT_EVIDENCE/)
  await assert.rejects(() => save(visitA,{...data,meetingUrl:"https://example.com/meeting"}), /ERR_CRM_VISIT_EVIDENCE/)
  await rejects("insert into public.lead_notes(lead_id,author_id,content,note_type) values($1,$2,'新的旧备注','visit')",
    [lead,owner],"ERR_CRM_VISIT_REQUIRED")
  await save(visitA,{...data,meetingUrl:"https://example.com/meeting",missingReason:"会议没有文档"})
  assert.equal((await events()).find((event) => event.next_stage==="offline_visit").visit_id,visitA)
  const filePath = [lead,visitB,id(19)].join("/")
  await rows("insert into storage.objects(bucket_id,name,owner_id) values ('crm-visit-materials',$1,$2)",[filePath,owner])
  await save(visitB,{...data,meetingUrl:"https://example.com/second",files:[{path:filePath,name:"会议文档.pdf",kind:"meeting"}]})
  const result = await value("select public.rpc_crm_lead_workflow($1) as value",[lead])
  assert.equal(result.firstVisitSatisfied,true)
  assert.equal(result.visits.length,2)
  assert.equal((await report()).people[0].own,1)
  await actor(companion)
  assert.equal((await report()).people[0].accompanied,1)
  assert.equal((await value("select public.rpc_crm_visit_details($1,$2,$3) as value",[day,tomorrow,companion])).length,1)
  await actor(outsider)
  assert.equal((await report()).teamVisits,0)
  assert.deepEqual(await events(),[])
  await assert.rejects(() => recordContact(id(27),true,"越权记录"), /ERR_NO_PERMISSION/)
  await rejects("select public.rpc_crm_lead_workflow($1)",[lead],"ERR_NO_PERMISSION")
  assert.equal(await value("select count(*)::integer as value from storage.objects where name=$1",[filePath]),0)

  await actor(admin)
  const summaries = await report()
  assert.equal(summaries.teamVisits,1)
  assert.equal((await value('select public.rpc_crm_visit_details($1,$2) as value',[day,tomorrow])).length,1)
  assert.equal(summaries.people.find((p) => p.id===owner).total,1)
  assert.equal(summaries.people.find((p) => p.id===companion).total,1)
  const homepage = () => value("select public.rpc_sales_dashboard('overview',$1::date::timestamp at time zone 'Asia/Shanghai'," +
    "$2::date::timestamp at time zone 'Asia/Shanghai',$1::date::timestamp at time zone 'Asia/Shanghai','Asia/Shanghai') as value",[day,tomorrow])
  const visitDetails = (profile = null, teamFilter = null) =>
    value("select public.rpc_crm_visit_details($1,$2,$3,$4) as value", [day, tomorrow, profile, teamFilter])
  const dashboardEvents = () => rows("select author_id from public.rpc_crm_dashboard_visit_events($1,$2) order by author_id", [day,tomorrow])
  const setExclusions = async (key, ids) => {
    await actor(null)
    const field = key === "analytics.excluded_profiles" ? "profile_ids" : "team_ids"
    await rows("insert into public.settings(key,value) values ($1,$2) on conflict(key) do update set value=excluded.value",
      [key, json({ [field]: ids })])
    await actor(admin)
  }

  assert.equal((await homepage()).totals.visits,1)
  assert.deepEqual(await dashboardEvents(), [{author_id: owner}, {author_id: companion}])
  await setExclusions("analytics.excluded_profiles", [companion])
  assert.equal((await report()).teamVisits,1)
  assert.equal((await report()).people.some((p) => p.id === companion),false)
  assert.equal((await visitDetails())[0].seller,"演示 02")
  assert.deepEqual(await visitDetails(companion),[])
  assert.deepEqual(await dashboardEvents(),[{author_id: owner}])
  assert.equal((await homepage()).totals.visits,1)
  await actor(companion)
  assert.deepEqual((await report()).people,[])
  assert.deepEqual(await visitDetails(companion),[])
  await setExclusions("analytics.excluded_profiles",[owner])
  assert.equal((await report()).teamVisits,0)
  assert.deepEqual(await visitDetails(),[])
  assert.equal((await homepage()).totals.visits,0)
  assert.equal((await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).visits.length,2)
  await setExclusions("analytics.excluded_profiles",[])
  for (const key of ["analytics.excluded_teams", "gm_dashboard.excluded_teams"]) {
    await setExclusions(key,[team])
    assert.equal((await report()).teamVisits,0)
    assert.equal((await report()).people.some((p) => p.team_id === team),false)
    assert.deepEqual(await visitDetails(null,team),[])
    assert.deepEqual(await dashboardEvents(),[])
    assert.equal((await homepage()).totals.visits,0)
    await setExclusions(key,[])
  }
  assert.equal((await report()).teamVisits,1)
  assert.equal((await visitDetails()).length,1)
  assert.equal(await value("select follow_up_stage as value from public.leads where id=$1",[lead]),"offline_visit")
  await rows("select public.rpc_crm_visit_invalidate($1,'重复内容')",[visitA])
  assert.equal((await report()).teamVisits,1)
  await rows("select public.rpc_crm_visit_invalidate($1,'会议无效')",[visitB])
  assert.equal((await report()).teamVisits,0)
  assert.equal((await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).expiresOn,originalDeadline)

  await actor(owner)
  await save(id(40),{...data,method:"onsite"})
  await rejects("select public.rpc_lead_advance_with_action($1,'contract_review','尝试跳过阶段')",[lead],"ERR_CRM_STAGE_ACTION_REQUIRED")
  await rows("select public.rpc_lead_advance_with_action($1,'proposal_quotation','确认开始报价')",[lead])
  assert.ok((await events()).find((event) => event.next_stage==="proposal_quotation").note_id)
  await save(id(41),{...data,method:"onsite",type:"repeat_2"})
  assert.equal(await value("select follow_up_stage as value from public.leads_secure_view where id=$1",[lead]),"proposal_quotation")
  await actor(admin)
  await rows("select public.rpc_crm_save_visit_goal($1,$2,5,15,60,'2')",[owner,day])
  assert.equal((await report()).people.find((p) => p.id===owner).goal,5)
  await actor(null)
  await rows("insert into public.leads(id,team_id,owner_id,created_by,name,stage,status,close_result,follow_up_stage)" +
    " values ($1,$2,$3,$3,'已签约客户','Won','closed','won','won')",[won,team,owner])
  await rows("insert into public.deal_contract_submissions(lead_id,submitted,submitted_at,submitted_by)" +
    " values($1,$2,now(),$3)",[won,json({ signedOn: day,contractNumber:"TEST-1",services:{performance:["google","meta"]}}),owner])
  await db.exec("insert into public.role_permissions(role_id,permission_key,effect,scope_type) " +
    "select id,'contracts.finance.confirm','allow','org' from public.roles where name='SuperAdmin' on conflict do nothing")
  await actor(admin)
  await rows("select public.rpc_deal_contract_submission_confirm_finance($1,$2)",[won,json({ receivedOn:day,receivedAmount:"1250",currency:"CNY" })])
  assert.equal(await value("select follow_up_stage as value from public.leads where id=$1",[won]),"payment_received")
  await rejects("select public.rpc_deal_contract_submission_confirm_finance($1,$2)",[won,json({ receivedOn:tomorrow,receivedAmount:"1250",currency:"CNY" })],"ERR_VALIDATION:deal_contract_receipt")

  const monthlyReceipts = () => rows("select * from public.rpc_crm_dashboard_monthly_revenue()")
  assert.deepEqual(await monthlyReceipts(), [{ currency: "CNY", amount: "1250" }])
  await actor(null)
  const legacyContract = id(74)
  await rows("insert into public.contracts(id,lead_id,contract_number,amount,signed_at,created_by) values($1,$2,'TEST-1',1250,now(),$3)",[legacyContract,won,owner])
  await rows("insert into public.contract_payments(contract_id,amount,currency,paid_at,status,created_by) " +
    "values($1,1250,'CNY',now(),'confirmed',$2),($1,100,'USD',now(),'confirmed',$2),($1,888,'CNY',now(),'pending',$2)",[legacyContract,owner])
  await actor(admin)
  const visibleReceipts = [{ currency: "CNY", amount: "1250" }, { currency: "USD", amount: "100" }]
  assert.deepEqual(await monthlyReceipts(), visibleReceipts)
  await actor(outsider)
  assert.deepEqual(await monthlyReceipts(),[])
  const reportableDeals = () => value("select to_jsonb(public.rpc_crm_reportable_deals($1::uuid[])) as value", [[won]])
  const analyticsExclusions = () => value("select public.rpc_crm_analytics_exclusions() as value")
  await setExclusions("analytics.excluded_profiles",[owner])
  assert.deepEqual(await monthlyReceipts(),[])
  assert.equal((await homepage()).totals.wonLeads,0)
  assert.deepEqual((await analyticsExclusions()).profiles,[owner])
  assert.deepEqual(await reportableDeals(),[])
  await setExclusions("analytics.excluded_profiles",[])
  await setExclusions("analytics.excluded_teams",[team])
  assert.deepEqual(await monthlyReceipts(),[])
  assert.equal((await homepage()).totals.wonLeads,0)
  assert.deepEqual((await analyticsExclusions()).teams,[team])
  assert.deepEqual(await reportableDeals(),[])
  await setExclusions("analytics.excluded_teams",[])
  await setExclusions("gm_dashboard.excluded_teams",[team])
  assert.deepEqual(await monthlyReceipts(),[])
  assert.equal((await homepage()).totals.wonLeads,0)
  assert.deepEqual((await analyticsExclusions()).teams,[])
  assert.deepEqual(await reportableDeals(),[won])
  await actor(owner)
  assert.deepEqual(await monthlyReceipts(),[])
  await setExclusions("gm_dashboard.excluded_teams",[])
  assert.deepEqual(await monthlyReceipts(),visibleReceipts)
  assert.equal((await homepage()).totals.wonLeads,1)

  await actor(null)
  const signatureLead = id(90)
  await seedLead(signatureLead, owner, team, "待签约演示客户", "contract_review", day+"T00:00:00Z")
  const contract = {
    signedOn: day, expectedPaymentOn: day, handoffOn: day, serviceStartsOn: day, actualPayment: "未到账",
    salesperson: "销售负责人", mainlandCompanyName: "测试公司", hongKongCompanyName: "暂无",
    contractNumber: "CRM-SIGNED-01", website: "暂无网站", category: "测试品类", contactName: "客户",
    contactTitle: "采购", phone: "12345678", email: "customer@example.com", address: "测试地址",
    cooperation: "fixed_quarter", baseFee: "100", serviceFees: "Google 100", services: {performance:["google"]},
    needs: "确认项目目标", currency: "CNY", attachmentStatus: "none",
  }
  const saveContract = (key, data, version, confirm) => value(
    "select to_jsonb(public.rpc_deal_contract_submission_save($1,$2,'[]'::jsonb,$3,$4)) as value",
    [key,json(data),version,confirm],
  )
  const stageOf = (key) => value("select follow_up_stage as value from public.leads_secure_view where id=$1",[key])
  await actor(outsider)
  await assert.rejects(() => saveContract(signatureLead,contract,0,false),/ERR_NO_PERMISSION/)
  await actor(owner)
  await rejects("select public.rpc_lead_close_with_action($1,'won','未关联合同')",[signatureLead],"ERR_CRM_SIGNED_CONTRACT_REQUIRED")
  await rejects("select public.rpc_lead_close($1,'won','未关联合同')",[signatureLead],"ERR_CRM_SIGNED_CONTRACT_REQUIRED")
  await rejects("select public.rpc_lead_pipeline_update($1,null,'won','绕过合同')",[signatureLead],"ERR_CRM_SIGNED_CONTRACT_REQUIRED")
  const draft = await saveContract(signatureLead,contract,0,false)
  assert.equal(draft.submitted_at,null)
  assert.equal(await stageOf(signatureLead),"contract_review")
  await assert.rejects(() => saveContract(signatureLead,{...contract,signedOn:tomorrow},draft.version,true),/ERR_CRM_CONTRACT_SIGNED_DATE/)
  assert.equal(await stageOf(signatureLead),"contract_review")
  const submitted = await saveContract(signatureLead,contract,draft.version,true)
  assert.equal(submitted.submitted.contractNumber,contract.contractNumber)
  assert.equal(await stageOf(signatureLead),"won")
  assert.equal(await value("select status as value from public.leads_secure_view where id=$1",[signatureLead]),"closed")
  assert.ok((await rows("select * from public.rpc_crm_lead_stage_events($1)",[signatureLead]))
    .some((event) => event.next_stage==="won" && event.note_id))
  await actor(admin)
  assert.equal((await homepage()).totals.wonInRange,1)
  await setExclusions("analytics.excluded_profiles",[owner])
  assert.equal((await homepage()).totals.wonInRange,0)
  assert.equal((await homepage()).trends.reduce((sum,row) => sum+row.won,0),0)
  await setExclusions("analytics.excluded_profiles",[])
  await actor(owner)
  const addOn = await value("select public.rpc_deal_addon_create($1) as value",[signatureLead])
  assert.equal(await stageOf(addOn),"contract_review")
  const addonDraftVersion = await value("select version as value from public.deal_contract_submissions where lead_id=$1",[addOn])
  await saveContract(addOn,{...contract,contractNumber:"CRM-ADDON-02"},addonDraftVersion,true)
  assert.equal(await stageOf(addOn),"won")
  assert.equal(await stageOf(signatureLead),"won")
  console.log("Passed reporting exclusions, operating results, receipts and currency deduplication, permissions, visits and contract signing.")
} catch (error) {
  console.error(error.message, error.where ?? '', error.query?.slice(0,250) ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
