import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { loadAllocationFixture } from "../database/load-allocation-fixture.mjs"

const require = createRequire(import.meta.url)
const { PGlite } = require(process.env.CRM_PGLITE_MODULE ?? "@electric-sql/pglite")
const { WebSocketServer } = require("ws")
const { parse } = require("dotenv")
const root = fileURLToPath(new URL("../../", import.meta.url))
const db = new PGlite()
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0")
const actors = { admin:id(1), owner:id(2), companion:id(3), manager:id(4), finance:id(5), full:id(6) }
const team = 8231
const leads = {
  visit:id(11), historic:id(12), expiry:id(13), reminder:id(14), finance:id(15), nurture:id(16), signature:id(17),
}
const files = new Map()
const storageBuckets = new Set(["crm-visit-materials", "deal-contract-materials"])
const confirmRole = { admin:"SuperAdmin", owner:"Sales", companion:"Sales", manager:"Manager", finance:"Admin", full:"Sales" }
const names = { admin:"演示业务负责人", owner:"销售 A", companion:"销售 B", manager:"演示销售管理", finance:"演示财务", full:"满额销售" }
const port = Number(process.env.CRM_ACCEPTANCE_PORT || 4211)
const apiPort = Number(process.env.CRM_ACCEPTANCE_API_PORT || 4212)
const hostname = process.env.CRM_ACCEPTANCE_HOST ?? "127.0.0.1"
assert.ok(["127.0.0.1", "localhost"].includes(hostname))
const origin = "http://" + hostname + ":" + port
const apiOrigin = "http://" + hostname + ":" + apiPort

async function isolatedNextEnv() {
  const inherited = ["PATH", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
  const env = Object.fromEntries(inherited.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []))
  for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    const content = await readFile(new URL("../../" + file, import.meta.url)).catch((error) => {
      if (error.code !== "ENOENT") throw error
      return ""
    })
    for (const name of Object.keys(parse(content))) if (!inherited.includes(name)) env[name] = ""
  }
  return {
    ...env, NODE_ENV:"development", NEXT_TELEMETRY_DISABLED:"1", CRM_LOCAL_ACCEPTANCE:"1",
    CRM_LOCAL_ACCEPTANCE_DIST: port === 4189 ? "" : ".next/crm-acceptance-" + port,
    NEXT_PUBLIC_SUPABASE_URL:apiOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY:"local-crm-preview",
    SUPABASE_URL:apiOrigin, SUPABASE_ANON_KEY:"local-crm-preview",
  }
}
const query = async (executor, statement, params) => (await executor.query(statement, params)).rows
const value = async (executor, statement, params) => (await query(executor, statement, params))[0]?.value
const as = (actor, action) => db.transaction(async (tx) => {
  if (actor !== "service_role") {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor])
  }
  await tx.exec(actor === "service_role" ? "set local role service_role" : "set local role authenticated")
  return action(tx)
})

const browserRpc = new Set([
  "rpc_me_permissions", "rpc_get_pipeline_business_rules", "rpc_recent_activities", "rpc_sales_dashboard",
  "rpc_crm_record_contact", "rpc_crm_lead_stage_events", "rpc_lead_advance_with_action", "rpc_lead_close_with_action",
  "rpc_lead_assign", "rpc_lead_claim_from_pool", "rpc_leads_export_request", "rpc_leads_export_mark_complete",
  "rpc_deal_history_list", "rpc_deal_contract_submission_can_edit", "rpc_deal_contract_allocation_result",
  "rpc_department_allocation_lead_states", "rpc_department_allocation_details", "rpc_department_allocation_release",
  "rpc_deal_contract_submission_confirm_finance", "rpc_deal_contract_submission_save", "rpc_deal_addon_create",
  "rpc_crm_my_quota", "rpc_crm_create_lead", "rpc_crm_lead_workflow", "rpc_crm_visit_participants",
  "rpc_crm_visit_save", "rpc_crm_visit_invalidate", "rpc_crm_protection_configure", "rpc_crm_protection_request",
  "rpc_crm_protection_review", "rpc_crm_protection_notices", "rpc_crm_protection_notice_read",
  "rpc_crm_dashboard_monthly_revenue", "rpc_crm_analytics_exclusions", "rpc_crm_reportable_deals",
  "rpc_crm_operating_dashboard", "rpc_crm_operating_visit_details", "rpc_crm_visit_details", "rpc_crm_resource_details", "rpc_crm_sales_settings",
  "rpc_crm_save_visit_goal", "rpc_crm_save_lead_quota", "rpc_crm_protection_admin", "rpc_crm_restore_release",
  "rpc_crm_can_confirm_finance",
])
const browserTables = new Set([
  "profiles", "profiles_public", "teams", "settings", "business_categories", "business_types",
  "leads_secure_view", "public_pool_secure_view", "contracts", "contracts_secure_view", "contract_payments_secure_view",
  "lead_notes", "lead_view_presets", "audit_logs", "lead_import_jobs", "lead_export_jobs", "roles",
  "deal_contract_submissions", "team_memberships", "profile_team_memberships", "permissions", "role_permissions",
  "field_policies", "custom_scope_sets", "profiles_public_view",
])
const identifier = (name) => {
  assert.match(name, /^[a-z_][a-z_0-9]*$/)
  return '"' + name + '"'
}

async function rpc(actor, name, input) {
  assert.ok(browserRpc.has(name), "该接口未纳入本地验收")
  return as(actor, async (tx) => {
    const definitions = await query(tx, `
      select p.proargnames[1:p.pronargs] as names, p.pronargs-p.pronargdefaults as required, p.proretset as returns_rows
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=$1
    `, [name])
    const keys = Object.keys(input)
    const definition = definitions.find(({ names, required }) =>
      (names ?? []).slice(0, required).every((key) => keys.includes(key)) &&
      keys.every((key) => (names ?? []).includes(key)))
    assert.ok(definition, "本地验收接口参数不匹配")
    const args = keys.map((key, index) => identifier(key) + "=>$" + (index + 1))
    const params = keys.map((key) => {
      const item = input[key]
      return item && !Array.isArray(item) && typeof item === "object" ? JSON.stringify(item) : item
    })
    const call = "public." + identifier(name) + "(" + args.join(",") + ")"
    return definition.returns_rows
      ? query(tx, "select * from " + call, params)
      : value(tx, "select to_jsonb(" + call + ") as value", params)
  })
}

const comparison = { eq:"=", neq:"<>", gt:">", gte:">=", lt:"<", lte:"<=", like:"like", ilike:"ilike" }
async function readTable(actor, table, request, search) {
  assert.ok(browserTables.has(table), "该表未纳入本地验收")
  const projection = (search.get("select") || "*").split(",").map((name) => name === "*" ? "*" : identifier(name)).join(",")
  const args = []
  const param = (value) => "$" + args.push(value)
  const conditions = []
  for (const [name, filter] of search) {
    if (["select", "order", "limit", "offset"].includes(name)) continue
    const column = identifier(name)
    const dot = filter.indexOf(".")
    const op = filter.slice(0, dot)
    const value = filter.slice(dot + 1)
    if (Object.hasOwn(comparison, op)) {
      const scalar = value === "true" ? true : value === "false" ? false : value
      conditions.push(column + " " + comparison[op] + " " + param(scalar))
    }
    else if (op === "in") {
      const items = value.slice(1, -1).split(",").map((item) => param(item.replace(/^"|"$/g, "")))
      conditions.push(column + " in (" + items.join(",") + ")")
    } else if (op === "is" && ["null","true","false"].includes(value)) conditions.push(column + " is " + value)
    else if (filter === "not.is.null") conditions.push(column + " is not null")
    else throw new Error("本地验收暂不支持筛选 " + name + " " + filter)
  }
  const order = search.get("order")?.split(",").map((item) => {
    const [column, direction, nulls] = item.split(".")
    return identifier(column) + (direction === "desc" ? " desc" : " asc") +
      (nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : "")
  })
  const rows = await as(actor, (tx) => query(tx,
    "select " + projection + " from public." + identifier(table) +
    (conditions.length ? " where " + conditions.join(" and ") : "") +
    (order ? " order by " + order.join(",") : "") +
    " limit " + param(Math.min(1000, Number(search.get("limit") ?? 1000))) +
    " offset " + param(Number(search.get("offset") ?? 0)), args))
  if (request.headers.accept?.includes("vnd.pgrst.object")) {
    if (rows.length !== 1) throw Object.assign(new Error("需要返回一条记录"), { code:"PGRST116", status:406 })
    return rows[0]
  }
  return rows
}

async function seed() {
  await loadAllocationFixture(db)
  await db.query("insert into public.teams(id,name) values($1,'CRM 演示团队')",[team])
  for (const [key,actor] of Object.entries(actors)) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [actor,key+"@fixture.invalid",JSON.stringify({full_name:names[key],phone:actor.slice(-8)})])
    await db.query("update public.profiles set status='active',team_id=$2,role_id=(select id from public.roles where name=$3) where id=$1",
      [actor,team,confirmRole[key]])
  }
  await db.exec("insert into public.role_permissions(role_id,permission_key,effect,scope_type) " +
    "select id,'contracts.finance.confirm','allow','org' from public.roles where name in ('Admin','SuperAdmin') on conflict do nothing")
  await db.exec("insert into public.role_permissions(role_id,permission_key,effect,scope_type) " +
    "select id,'reports.export','allow','org' from public.roles where name='SuperAdmin' on conflict do nothing")
  const scenarios = [
    [leads.visit,"A · 首访和陪访演示客户",0], [leads.historic,"B · 历史保护期未核定",26],
    [leads.expiry,"C · 已核定的过期客户",24], [leads.reminder,"D · 7 天内到期提醒",8],
    [leads.nurture,"E · 待培育客户",0],
  ]
  for (const [lead,name,age] of scenarios) {
    await db.query("insert into public.leads(id,team_id,owner_id,created_by,name,stage,follow_up_stage,ownership_started_at)" +
      " values($1,$2,$3,$3,$4,'L2','connected',now()-make_interval(days=>$5))",[lead,team,actors.owner,name,age])
  }
  await db.query("update public.leads set stage='L1',follow_up_stage='uncontacted' where id=$1",[leads.visit])
  await db.query("insert into public.leads(id,team_id,owner_id,created_by,name,stage,follow_up_stage) " +
    "values($1,$2,$3,$3,'F · 待签约演示客户','L4','contract_review')",[leads.signature,team,actors.owner])
  await db.query("update public.leads set crm_protection_review_required=true,protected_until=null, " +
    " locked_until=now()-interval '2 days' where id=$1",[leads.historic])
  await as(actors.admin, (tx) => tx.query("select public.rpc_crm_protection_configure($1,'nurture')",[leads.nurture]))
  await db.query("insert into public.leads(id,team_id,owner_id,created_by,name,stage,follow_up_stage,status,close_result)" +
    " values($1,$2,$3,$3,'首笔到账演示合同','Won','won','closed','won')",[leads.finance,team,actors.owner])
  await db.query("insert into public.deal_contract_submissions(lead_id,submitted,submitted_at,submitted_by) values(" +
    "$1,jsonb_build_object('contractNumber','CRM-UAT-01','signedOn',iwish.crm_today()::text," +
    "'currency','CNY','services','{\"performance\":[\"google\",\"meta\"]}'::jsonb),now(),$2)",[leads.finance,actors.owner])
  await db.query("insert into public.leads(team_id,owner_id,created_by,name,stage,follow_up_stage)" +
    " select $1,$2,$2,'已占额度演示 '||seq,'L1','uncontacted' from generate_series(1,60) seq",[team,actors.full])
  await db.query("insert into iwish.crm_visit_goals(profile_id,effective_on,monthly,quarterly,yearly,weekly_reference) " +
    "values ($1,date_trunc('month',iwish.crm_today())::date,5,15,60,'2'),($2,date_trunc('month',iwish.crm_today())::date,5,15,60,'2')",
    [actors.owner,actors.companion])
  if (!await value(db,"select id as value from public.business_types where is_active limit 1")) {
    await db.exec("insert into public.business_categories(name) values('本地演练业务')")
    await db.exec("insert into public.business_types(category_id,name) select id,'本地演练服务' from public.business_categories where name='本地演练业务'")
  }
}

async function getBody(request, max = 40_000) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > max) throw new Error("演示请求过大")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function json(response, data, status=200) {
  response.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"})
  response.end(JSON.stringify(data))
}
function asset(response, type, content) {
  response.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"})
  response.end(content)
}

const expiredMessage = "已按新版条件执行回收，未核定历史线索保留原归属。"
async function exercise(actor, action) {
  if (actor !== actors.admin) throw new Error("请切换到业务负责人／管理员")
  if (action === "quota") {
    const type = await value(db,"select id as value from public.business_types where is_active order by id limit 1")
    const customer = "满额转待分配客户 " + randomUUID().slice(0,4)
    const result = await as(actor,(tx) => value(tx,"select public.rpc_crm_create_lead($1) as value",
      [JSON.stringify({name:customer,owner_id:actors.full,team_id:team,source:"验收演练",responsibility_type:"sales_self",
        dev_method_key:"other",business_type_ids:[type]})]))
    assert.ok(result.pendingAssignment)
    return {message:customer + " 已进入公共待分配"}
  }
  if (action === "release") {
    await db.exec("create or replace function iwish.crm_today() returns date language sql stable set search_path='' as $$ " +
      "select greatest((now() at time zone 'Asia/Shanghai')::date,date '2026-12-17') $$")
    try {
      await rpc(actor,"rpc_crm_protection_admin",{p_enabled:true})
      await as("service_role",(tx) => tx.query("select public.rpc_crm_run_protection()"))
      return {message:expiredMessage}
    } finally {
      await db.exec("create or replace function iwish.crm_today() returns date language sql stable set search_path='' as $$ " +
        "select (now() at time zone 'Asia/Shanghai')::date $$")
    }
  }
  if (action === "notices") {
    const result = await as("service_role",(tx) => value(tx,"select public.rpc_crm_run_protection() as value"))
    return {message:"本次新增 " + result.notices + " 条站内提醒。切换到销售 A 后可在经营看板查看。"}
  }
  throw new Error("未知演练")
}

const base64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400
const sessions = Object.entries(actors).map(([key,id]) => {
  const token = base64({alg:"HS256",typ:"JWT"}) + "." + base64({sub:id,exp:expiresAt,role:"authenticated"}) + "." + randomUUID()
  return [key, { access_token:token, refresh_token:randomUUID(), expires_at:expiresAt, expires_in:7 * 86400, token_type:"bearer",
    user:{ id, aud:"authenticated", role:"authenticated", email:key + "@fixture.invalid", app_metadata:{}, user_metadata:{ full_name:names[key] }, created_at:new Date().toISOString() } }]
})
const sessionByRole = new Map(sessions)
const sessionByToken = new Map(sessions.map(([,session]) => [session.access_token, session]))
const cookieName = "sb-" + hostname.split(".")[0] + "-auth-token"
const roleFromCookie = (request) => {
  const prefix = cookieName + "=base64-"
  const cookie = request.headers.cookie?.split("; ").find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
  if (!cookie) return null
  try { return sessionByToken.get(JSON.parse(Buffer.from(cookie,"base64url")).access_token) }
  catch { return null }
}

function launcher(response, session, message = "") {
  const roles = sessions.map(([key]) => `<li><a href="/preview/role/${key}">${names[key]}</a></li>`).join("")
  const messageBlock = message ? '<p role="status">' + message.replaceAll("&","&amp;").replaceAll("<","&lt;") + "</p>" : ""
  asset(response,"text/html; charset=utf-8", `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CRM 本地验收账号</title><style>body{font:16px system-ui;max-width:640px;margin:3rem auto;padding:0 1rem}li{margin:.75rem 0}form{display:inline-block;margin:.5rem .5rem .5rem 0}a{color:#164eaa}</style>
    <h1>CRM 本地验收账号</h1><p>选择一个演示账号，进入 CRM 原有界面。要切换身份，回到此页重新选择。</p><ul>${roles}</ul>
    <p><a href="${origin}/dashboard">进入仪表盘</a> · <a href="${origin}/leads">我的线索</a> · <a href="${origin}/pool">公海池</a> · <a href="${origin}/deals">成交中心</a> · <a href="${origin}/reports">数据分析</a></p>
    ${session?.user.id === actors.admin ? `<h2>流程演练</h2>${[["quota","生成满额待分配线索"],["notices","生成到期提醒"],["release","模拟 12 月 17 日自动流转"]].map(([id,label]) =>
      `<form method="post" action="/preview/exercise/${id}"><button>${label}</button></form>`).join("")}${messageBlock}` : ""}
  </html>`)
}

let server, next
try {
  await seed()
  server = createServer(async (request,response) => {
    if (request.headers.host !== hostname + ":" + apiPort) return json(response,{message:"仅允许本机访问"},403)
    const requestOrigin = request.headers.origin
    if (requestOrigin && requestOrigin !== origin && requestOrigin !== apiOrigin) return json(response,{message:"仅允许本地 CRM 访问"},403)
    response.setHeader("Access-Control-Allow-Origin", origin)
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] ?? "authorization,content-type")
    response.setHeader("Cache-Control", "no-store")
    if (request.method === "OPTIONS") { response.writeHead(204); return response.end() }

    const url = new URL(request.url,apiOrigin)
    const path = url.pathname
    const session = sessionByToken.get(request.headers.authorization?.replace(/^Bearer /i,""))
    const actor = session?.user.id
    try {
      if (path === "/") return launcher(response, roleFromCookie(request))
      if (path.startsWith("/preview/role/")) {
        const selected = sessionByRole.get(path.split("/").at(-1))
        if (!selected) return json(response,{message:"演示账号不存在"},404)
        response.writeHead(303,{"Set-Cookie":cookieName + "=base64-" + base64(selected) + "; Path=/; SameSite=Lax",
          Location:origin + "/dashboard"})
        return response.end()
      }
      if (path.startsWith("/preview/exercise/") && request.method === "POST") {
        const login = roleFromCookie(request)
        const result = await exercise(login?.user.id,path.split("/").at(-1))
        return launcher(response,login,result.message)
      }
      if (!actor) return json(response,{message:"请从本地验收账号页选择演示账号"},401)
      if (path === "/auth/v1/user") return json(response,session.user)
      if (path === "/auth/v1/logout") return json(response,{})
      if (path.startsWith("/rest/v1/rpc/") && request.method === "POST") {
        const raw = await getBody(request)
        return json(response,(await rpc(actor,path.split("/").at(-1),raw.length ? JSON.parse(raw.toString()) : {})) ?? null)
      }
      if (path.startsWith("/rest/v1/") && request.method === "GET") {
        return json(response,await readTable(actor,path.split("/").at(-1),request,url.searchParams))
      }
      const storagePath = "/storage/v1/object/"
      if (path.startsWith(storagePath)) {
        const relative = decodeURIComponent(path.slice(storagePath.length)).replace(/^authenticated\//,"")
        const [bucket, ...parts] = relative.split("/")
        assert.ok(storageBuckets.has(bucket), "该附件目录未纳入本地验收")
        const name = parts.join("/")
        if (!name && request.method === "DELETE") {
          const { prefixes } = JSON.parse((await getBody(request)).toString())
          const removed = await as(actor,(tx) => query(tx,"delete from storage.objects where bucket_id=$1 and name=any($2::text[]) returning name",[bucket,prefixes]))
          for (const {name} of removed) files.delete(bucket + "/" + name)
          return json(response,removed)
        }
        assert.ok(name, "附件缺少路径")
        if (request.method === "POST" || request.method === "PUT") {
          const bytes = await getBody(request,20 * 1024 * 1024)
          await as(actor,(tx) => tx.query("insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)",[bucket,name,actor]))
          files.set(relative,bytes)
          return json(response,{Key:bucket + "/" + name})
        }
        const row = await as(actor,(tx) => value(tx,"select count(*)::int as value from storage.objects where name=$1 and bucket_id=$2",[name,bucket]))
        if (row && files.has(relative)) return asset(response,"application/octet-stream",files.get(relative))
      }
      return json(response,{message:"该入口未纳入本地验收"},404)
    } catch (error) {
      console.error(request.method, path, error.message)
      return json(response,{code:error.code,message:error.message},error.status ?? 400)
    }
  })
  const sockets = new WebSocketServer({ noServer:true })
  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/realtime/v1/websocket?") || request.headers.origin !== origin) return socket.destroy()
    sockets.handleUpgrade(request,socket,head,(connection) => connection.on("message",(raw) => {
      const msg = JSON.parse(raw.toString())
      if (Array.isArray(msg)) {
        const [join,ref,topic] = msg
        connection.send(JSON.stringify([join,ref,topic,"phx_reply",{status:"ok",response:{}}]))
      } else {
        connection.send(JSON.stringify({ topic:msg.topic,event:"phx_reply",ref:msg.ref,payload:{status:"ok",response:{}} }))
      }
    }))
  })
  await new Promise((resolve,reject) => server.listen(apiPort,"127.0.0.1",resolve).on("error",reject))
  next = spawn(process.execPath,[require.resolve("next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port",String(port)], {
    cwd:root, stdio:"inherit",
    env:await isolatedNextEnv(),
  })
  console.log("CRM 本地验收账号 " + apiOrigin + "/")
  console.log("CRM 原页面 " + origin + "/dashboard")
  await new Promise((resolve,reject) => {
    next.once("error",reject)
    next.once("exit",async (code) => { if (code) reject(new Error("Next.js exited with " + code)); else resolve() })
    const stop = () => { next.kill(); for (const client of sockets.clients) client.terminate(); resolve() }
    process.once("SIGINT",stop)
    process.once("SIGTERM",stop)
  })
} finally {
  if (server?.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
  await db.close()
}
