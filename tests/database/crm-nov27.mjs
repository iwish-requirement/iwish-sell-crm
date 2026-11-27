import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { loadAllocationFixture } from "./load-allocation-fixture.mjs"

const require = createRequire(import.meta.url)
const { PGlite } = require(process.env.CRM_PGLITE_MODULE ?? "@electric-sql/pglite")
const db = new PGlite()
const id = (key) => "00000000-0000-4000-8000-" + String(key).padStart(12, "0")
const [admin, owner, companion, outsider, lead, historic, won, fullLead, overflow, visitA, visitB, foreignLead] =
  [1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18].map(id)
const rows = async (sql, args) => (await db.query(sql, args)).rows
const value = async (sql, args) => (await rows(sql, args))[0]?.value
const rejects = (sql, args, code) => assert.rejects(() => rows(sql, args), (error) => error.message.includes(code))
const json = JSON.stringify
const team = 8101

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
    if (!filename.endsWith("_crm_first_release.sql")) return
    await db.exec(
      "update public.settings set value=value || " +
      "'{\"warning_hours\":1,\"danger_hours\":1,\"public_pool_days\":2,\"lead_protection_days\":2,\"quota_limit\":99," +
      "\"prevent_previous_owner_reclaim\":true,\"test_other_key\":true}'::jsonb where key='pipeline.business_rules'"
    )
    await db.exec("insert into public.teams(id,name) values (8101,'测试团队'), (8102,'独立团队')")
    for (const [user, role, assignedTeam] of [[admin, "SuperAdmin", team], [owner, "Sales", team], [companion, "Sales", team], [outsider, "Sales", 8102]]) {
      await rows("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
        user, user + "@example.com", json({ full_name: "演示 " + user.slice(-2), phone: user.slice(-8) }),
      ])
      await rows("update public.profiles set status='active',team_id=$2,role_id=(select id from public.roles where name=$3) where id=$1",
        [user, assignedTeam, role])
    }
    await db.exec("alter table public.leads disable trigger trg_lead_pipeline_defaults")
    await insertLead(historic, owner, team, "历史客户", "online_communication", "2026-11-01T04:00:00Z")
    await rows("update public.leads set locked_until='2026-11-02T04:00:00Z' where id=$1", [historic])
    await rows("update public.leads set next_contact_at='2026-11-02T04:00:00Z' where id=$1", [historic])
    await rows("insert into public.lead_notes(lead_id,author_id,content,note_type) values($1,$2,'原线下拜访内容','visit')", [historic,owner])
    await db.exec("alter table public.leads enable trigger trg_lead_pipeline_defaults")
  })
  assert.deepEqual(await rows("select follow_up_stage,crm_protection_review_required,locked_until from public.leads where id=$1",[historic]), [{
    follow_up_stage: "online_communication", crm_protection_review_required: true, locked_until: new Date("2026-11-02T04:00:00Z"),
  }])
  assert.equal(await value("select count(*)::integer as value from public.lead_notes where lead_id=$1 and note_type='visit'",[historic]),1)
  assert.deepEqual(await value("select value from public.settings where key='pipeline.business_rules'"),
    { prevent_previous_owner_reclaim: true, test_other_key: true })
  assert.equal(await value("select is_enabled as value from public.permissions where key='leads.quota.override'"),false)

  const day = await value("select iwish.crm_today()::text as value")
  const tomorrow = await value("select (iwish.crm_today()+1)::text as value")
  await insertLead(lead, owner, team, "演示客户", "uncontacted", day+"T00:00:00Z")
  await insertLead(foreignLead, outsider, 8102, "外部团队客户", "uncontacted", day+"T00:00:00Z")
  await rows("insert into public.user_permissions(user_id,permission_key,effect,scope_type) values " +
    "($1,'reports.read','allow','self'),($1,'reports.export','allow','self')",[outsider])
  await actor(outsider)
  assert.ok(await value("select public.rpc_leads_export_request('analytics_source-volume','xlsx','{}') as value"))
  await rejects("select public.rpc_leads_export_request('public_pool','xlsx','{}')",[],"ERR_NO_PERMISSION:leads.export")
  await rejects("select public.rpc_leads_export_request(null,'xlsx','{}')",[],"ERR_NO_PERMISSION:leads.export")
  await actor(admin)
  assert.equal((await value("select public.rpc_crm_protection_admin() as value")).preventPreviousOwnerReclaim,true)
  assert.equal((await value("select public.rpc_crm_protection_admin(p_prevent_previous_owner_reclaim=>false) as value")).enabled,false)
  assert.equal((await value("select public.rpc_crm_protection_admin() as value")).preventPreviousOwnerReclaim,false)
  await rejects("select public.rpc_crm_protection_configure($1,'key_intent')",[lead],"ERR_CRM_PROTECTION_CLASS")
  await actor(null)
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
  const report = () => value("select public.rpc_crm_operating_dashboard($1,$2,'month') as value", [day,tomorrow])
  await actor(owner)
  await rejects("select public.rpc_crm_protection_admin(p_prevent_previous_owner_reclaim=>true)",[],"ERR_NO_PERMISSION")
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
  const nextActions = (keys) => rows(
    "select lead_id,(next_contact_at at time zone 'Asia/Shanghai')::date::text as day from public.rpc_crm_dashboard_next_actions($1)",
    [keys])
  assert.deepEqual(await nextActions([lead,historic]),[{lead_id:lead,day:tomorrow}])
  assert.equal((await events()).find((event) => event.next_stage==="offline_visit").visit_id,visitA)
  const filePath = [lead,visitB,id(19)].join("/")
  await rows("insert into storage.objects(bucket_id,name,owner_id) values ('crm-visit-materials',$1,$2)",[filePath,owner])
  await save(visitB,{...data,nextContactOn:day,meetingUrl:"https://example.com/second",files:[{path:filePath,name:"会议文档.pdf",kind:"meeting"}]})
  const result = await value("select public.rpc_crm_lead_workflow($1) as value",[lead])
  assert.equal(result.firstVisitSatisfied,true)
  assert.equal(result.protectionClass,"key_intent")
  assert.equal(result.expiresOn, await value("select ($1::date+45)::text as value",[day]))
  assert.equal(result.visits.length,2)
  assert.equal((await report()).people[0].own,1)
  await actor(companion)
  assert.equal((await report()).people[0].accompanied,1)
  assert.equal((await value("select public.rpc_crm_visit_details($1,$2,$3) as value",[day,tomorrow,companion])).length,1)
  await actor(outsider)
  assert.deepEqual(await nextActions([lead]),[])
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
  const dashboard = await value("select public.rpc_sales_dashboard('overview',$1::date::timestamp at time zone 'Asia/Shanghai'," +
    "$2::date::timestamp at time zone 'Asia/Shanghai',$1::date::timestamp at time zone 'Asia/Shanghai','Asia/Shanghai') as value",[day,tomorrow])
  assert.equal(dashboard.totals.visits,1)
  assert.equal(dashboard.totals.pendingToday,1)
  assert.equal(dashboard.totals.overdueLeads,0)
  assert.equal(await value("select follow_up_stage as value from public.leads where id=$1",[lead]),"offline_visit")
  await rows("select public.rpc_crm_visit_invalidate($1,'重复内容')",[visitA])
  assert.equal((await report()).teamVisits,1)
  await rows("select public.rpc_crm_visit_invalidate($1,'会议无效')",[visitB])
  assert.deepEqual(await nextActions([lead]),[])
  assert.equal((await report()).teamVisits,0)
  assert.equal((await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).expiresOn,originalDeadline)

  await actor(owner)
  await save(id(40),{...data,method:"onsite"})
  await rejects("select public.rpc_lead_advance_with_action($1,'contract_review','尝试跳过阶段')",[lead],"ERR_CRM_STAGE_ACTION_REQUIRED")
  await rows("select public.rpc_lead_advance_with_action($1,'proposal_quotation','确认开始报价')",[lead])
  assert.ok((await events()).find((event) => event.next_stage==="proposal_quotation").note_id)
  await save(id(41),{...data,method:"onsite",type:"repeat_2"})
  assert.equal(await value("select follow_up_stage as value from public.leads_secure_view where id=$1",[lead]),"proposal_quotation")
  const keyDeadline = await value("select ($1::date+45)::text as value",[day])
  assert.equal((await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).expiresOn,keyDeadline)
  await rows("select public.rpc_crm_protection_request($1,'nurture',0,'暂缓推进')",[lead])
  const transferRequest = (await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).requests[0]
  await actor(admin)
  await rows("select public.rpc_crm_protection_review($1,true)",[transferRequest.id])
  await actor(owner)
  await rows("insert into public.lead_notes(lead_id,author_id,content,note_type) values($1,$2,'发送资料','wechat')",[lead,owner])
  assert.equal((await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).expiresOn,originalDeadline)
  await rows("insert into public.lead_notes(lead_id,author_id,content,note_type,crm_substantive_kind) " +
    "values($1,$2,'客户希望下一季度重开合作讨论','wechat','feedback')",[lead,owner])
  const nurtureDeadline = await value("select ($1::date+90)::text as value",[day])
  assert.equal((await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).expiresOn,nurtureDeadline)
  await assert.rejects(() => rows("select public.rpc_crm_protection_request($1,'extension',31,'客户预算核定')",[lead]))
  await rows("select public.rpc_crm_protection_request($1,'extension',30,'客户预算核定')",[lead])
  const extension = (await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).requests
    .find((request) => request.kind==="extension")
  await rejects("select public.rpc_crm_protection_review($1,true)",[extension.id],"ERR_NO_PERMISSION:crm_protection.review")
  await actor(admin)
  await rows("select public.rpc_crm_protection_review($1,true)",[extension.id])
  assert.equal((await value("select public.rpc_crm_lead_workflow($1) as value",[lead])).expiresOn,
    await value("select ($1::date+30)::text as value",[nurtureDeadline]))
  await rows("select public.rpc_crm_save_visit_goal($1,$2,5,15,60,'2')",[owner,day])
  assert.equal((await report()).people.find((p) => p.id===owner).goal,5)
  await rows("select public.rpc_crm_save_lead_quota($1,1)",[companion])
  await actor(null)
  await insertLead(fullLead,companion,team,"占用唯一名额","uncontacted",day+"T00:00:00Z")
  await insertLead(overflow,companion,team,"满额转待分配","uncontacted",day+"T00:00:00Z")
  assert.equal(await value("select crm_pending_assignment as value from public.leads where id=$1",[overflow]),true)
  const category = await value("insert into public.business_categories(name) values ('配额校验') returning id as value")
  const business = await value("insert into public.business_types(name,category_id) values ('配额校验服务',$1) returning id as value",[category])
  await actor(admin)
  const imported = await value("select public.rpc_leads_import_kanban(null,$1,false) as value", [json([{
    rowIndex: 1, payload: { name: "批量导入待分配", owner_id: companion, team_id: team, status: "open",
      responsibility_type: "sales_self", dev_method_key: "outbound", business_type_ids: [business] },
  }])])
  assert.deepEqual(imported,{ok:true,importedCount:1,pendingAssignmentCount:1,failedCount:0,rowErrors:[]})
  assert.equal(await value("select status as value from public.public_pool_secure_view where name='批量导入待分配' and crm_pending_assignment"),"pool")
  await actor(admin)
  await rejects("select public.rpc_lead_assign($1,$2,'验证满额')",[overflow,companion],"ERR_QUOTA_EXCEEDED")
  await actor(null)
  await db.exec("insert into public.role_permissions(role_id,permission_key,effect,scope_type) " +
    "select id,'leads.claim','allow','self' from public.roles where name='Sales' on conflict do nothing")
  await actor(companion)
  await rejects("select public.rpc_lead_claim_from_pool($1,'尝试认领')",[overflow],"ERR_CRM_PENDING_ASSIGNMENT")

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
  assert.equal((await report()).firstOrders,1)
  assert.deepEqual((await report()).receipts,[{ currency:"CNY",amount:1250 }])
  await rows("select public.rpc_deal_contract_submission_confirm_finance($1,$2)",[won,json({ grossProfit:"-25.50",currency:"USD" })])
  assert.deepEqual((await report()).profits,[{ currency:"USD",amount:-25.5,orders:1,confirmed:1 }])
  assert.deepEqual((await report()).receipts,[{ currency:"CNY",amount:1250 }])
  await actor(null)
  const noticeLead = id(81)
  await rows("insert into public.leads(id,team_id,owner_id,created_by,name,stage,follow_up_stage,ownership_started_at) " +
    "values ($1,$2,$3,$3,'到期提醒客户','L1','uncontacted',($4::date-8)::timestamp at time zone 'Asia/Shanghai')", [noticeLead,team,owner,day])
  await actor(null,"service_role")
  const job = await value("select public.rpc_crm_run_protection() as value")
  assert.equal(job.dropped_count,0)
  assert.equal(job.notices,1)
  assert.equal((await value("select public.rpc_crm_run_protection() as value")).notices,0)
  await actor(owner)
  const notice = (await value("select public.rpc_crm_protection_notices() as value"))[0]
  assert.equal(notice.offset_days,7)
  assert.equal(notice.lead_id,noticeLead)
  await rows("select public.rpc_crm_protection_notice_read($1)",[notice.id])
  assert.ok((await value("select public.rpc_crm_protection_notices() as value"))[0].read_at)
  for (const offset of [3,0]) {
    await actor(null)
    await db.exec("create or replace function iwish.crm_today() returns date language sql stable set search_path = '' as $$ " +
      "select (now() at time zone 'Asia/Shanghai')::date + " + (7-offset) + " $$")
    await actor(null,"service_role")
    const repeated = await value("select public.rpc_crm_run_protection() as value")
    assert.ok(repeated.notices >= 1)
    assert.equal((await value("select public.rpc_crm_run_protection() as value")).notices,0)
    await actor(owner)
    assert.ok((await value("select public.rpc_crm_protection_notices() as value")).some((n) => n.lead_id===noticeLead && n.offset_days===offset))
  }
  await actor(null)
  const releaseLead = id(80)
  await rows("insert into public.leads(id,team_id,owner_id,created_by,name,stage,follow_up_stage,ownership_started_at) " +
    "values ($1,$2,$3,$3,'过期演示客户','L1','uncontacted','2026-10-01T00:00:00Z')", [releaseLead,team,owner])
  await actor(admin)
  await rows("select public.rpc_crm_protection_admin(true)")
  await actor(null,"service_role")
  assert.equal((await value("select public.rpc_auto_return_leads_to_pool() as value")).dropped_count,0)
  await actor(null)
  await db.exec("create or replace function iwish.crm_today() returns date language sql stable set search_path = '' as $$ select date '2026-12-17' $$")
  await actor(admin)
  await rows("select public.rpc_crm_protection_admin(true)")
  await actor(null,"service_role")
  assert.equal((await value("select public.rpc_crm_run_protection() as value")).dropped_count,1)
  assert.equal((await value("select public.rpc_crm_run_protection() as value")).dropped_count,0)
  await actor(null)
  assert.equal(await value("select status as value from public.leads where id=$1",[historic]),"open")
  assert.equal(await value("select status as value from public.leads where id=$1",[releaseLead]),"pool")
  await actor(admin)
  await rows("select public.rpc_crm_protection_admin(false)")
  await rows("select public.rpc_crm_restore_release($1,'验证异常恢复')",[releaseLead])
  const restored = await value("select public.rpc_crm_lead_workflow($1) as value",[releaseLead])
  assert.equal(restored.reviewRequired,true)
  assert.equal(restored.owner.id,owner)

  await actor(null)
  const signatureLead = id(90)
  await insertLead(signatureLead, owner, team, "待签约演示客户", "contract_review", day+"T00:00:00Z")
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
  const afterTestClock = "2026-12-18"
  await assert.rejects(() => saveContract(signatureLead,{...contract,signedOn:afterTestClock},draft.version,true),/ERR_CRM_CONTRACT_SIGNED_DATE/)
  assert.equal(await stageOf(signatureLead),"contract_review")
  const submitted = await saveContract(signatureLead,contract,draft.version,true)
  assert.equal(submitted.submitted.contractNumber,contract.contractNumber)
  assert.equal(await stageOf(signatureLead),"won")
  assert.equal(await value("select status as value from public.leads_secure_view where id=$1",[signatureLead]),"closed")
  assert.ok((await rows("select * from public.rpc_crm_lead_stage_events($1)",[signatureLead]))
    .some((event) => event.next_stage==="won" && event.note_id))
  const addOn = await value("select public.rpc_deal_addon_create($1) as value",[signatureLead])
  assert.equal(await stageOf(addOn),"contract_review")
  const addonDraftVersion = await value("select version as value from public.deal_contract_submissions where lead_id=$1",[addOn])
  await saveContract(addOn,{...contract,contractNumber:"CRM-ADDON-02"},addonDraftVersion,true)
  assert.equal(await stageOf(addOn),"won")
  assert.equal(await stageOf(signatureLead),"won")
  console.log("Passed visits, quota, protection, linked contract signing, add-on confirmation and finance promotion.")
} catch (error) {
  console.error(error.stack, error.where ?? '', error.query?.slice(0,250) ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
