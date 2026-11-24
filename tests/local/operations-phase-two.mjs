import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rmdir } from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadAllocationFixture } from "../database/load-allocation-fixture.mjs"

const require = createRequire(import.meta.url)
const { PGlite } = require(process.env.CRM_PGLITE_MODULE ?? "@electric-sql/pglite")
const { build } = createRequire(require.resolve("wrangler/package.json"))("esbuild")
const postcss = require("postcss")
const tailwind = require("@tailwindcss/postcss")
const root = fileURLToPath(new URL("../../", import.meta.url))
const verify = process.argv.includes("--verify")
const db = new PGlite()
const temp = await mkdtemp(join(tmpdir(), "crm-ops-demo-"))
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const [admin, sales, other, lead, untouched, outsideScope] = [1, 2, 3, 11, 12, 13].map(uuid)
const salesName = "演示销售"
const company = "第二批验收演示客户"
const form = {
  signedOn: "2026-11-19", expectedPaymentOn: "2026-11-25", actualPayment: "未到账",
  handoffOn: "2026-11-22", serviceStartsOn: "2026-11-26", salesperson: salesName,
  companyName: company, contractNumber: "OPS-DEMO-2", website: "https://example.com",
  mainlandCompanyName: company + "（大陆）", hongKongCompanyName: "香港演示签约公司", attachmentStatus: "none",
  category: "演示品类", contactName: "演示联系人", contactTitle: "采购", phone: "2025550147",
  email: "test@example.com", address: "演示地址", cooperation: "fixed_quarter", baseFee: "0",
  serviceFees: "Google 0 元，Meta 0 元", needs: "演示部门交接与换人", currency: "CNY",
  services: { performance: ["google", "meta"] },
}
const asJson = JSON.stringify
const sql = await readFile(join(root, "supabase", "releases", "crm_department_allocation_phase_one.sql"), "utf8")
const scalar = async (executor, query, params) => (await executor.query(query, params)).rows[0]?.value
const dealerCall = (actor, fn) => db.transaction(async tx => {
  if (actor !== "service_role") {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor])
  }
  await tx.exec(actor === "service_role" ? "set local role service_role" : "set local role authenticated")
  return fn(tx)
})
const rpcArgs = {
  rpc_department_allocation_workspace: ["p_pending"],
  rpc_department_allocation_details: ["p_source", "p_id"],
  rpc_department_allocation_save: ["p_source", "p_id", "p_submitted_at", "p_revision", "p_departments"],
  rpc_deal_contract_submission_can_edit: ["p_lead_id"],
  rpc_deal_contract_allocation_result: ["p_lead_id"],
  rpc_deal_contract_submission_save: ["p_lead_id", "p_data", "p_attachments", "p_version", "p_confirm"],
  rpc_deal_contract_submission_confirm_finance: ["p_lead_id", "p_values"],
  rpc_operations_handoffs_claim: ["p_limit"],
  rpc_operations_handoff_finish: ["p_handoff_id", "p_lease", "p_work_order_id", "p_error", "p_retry"],
  rpc_operations_staffing_accept: ["p_handoff_id", "p_department_id", "p_body"],
  rpc_operations_handoff_retry: ["p_handoff_id"],
}
const browserRpc = new Set(Object.keys(rpcArgs).filter(name => !name.startsWith("rpc_operations_") && name !== "rpc_deal_contract_submission_confirm_finance"))
const scheduleToken = randomUUID()
const staffingToken = randomUUID()
const intakeToken = randomUUID()
const serviceKey = randomUUID()
const jobs = new Map()
const attempts = new Map()
let callbackRoute, dispatchRoute, css, bundle, origin, departments
let failOnce = true
let running = false
let accelerated = false
let interval
let backgroundError

async function seed() {
  await loadAllocationFixture(db)
  await db.exec("insert into public.teams(id,name) values (8121,'演示销售团队'),(8122,'演示其他团队')")
  for (const [id, name, role, team] of [[admin,"演示管理员","Admin",8121], [sales,salesName,"Sales",8121], [other,"其他演示销售","Sales",8122]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)",
      [id, `${id}@example.com`, asJson({ full_name: name, phone: id.slice(-8) })])
    await db.query("update public.profiles set status='active',team_id=$2,role_id=(select id from public.roles where name=$3) where id=$1", [id, team, role])
  }
  for (const [id, owner, team, name] of [[lead,sales,8121,company], [untouched,sales,8121,"第一批已分配演示客户"], [outsideScope,other,8122,"其他团队演示客户"]]) {
    await db.query("insert into public.leads(id,team_id,owner_id,created_by,name,stage,status,close_result) values ($1,$2,$3,$3,$4,'Won','closed','won')", [id,team,owner,name])
  }
  departments = Object.fromEntries((await db.query("select feishu_department_id,id from public.ops_departments")).rows
    .map(row => [row.feishu_department_id, row.id]))
  await db.exec(sql)
  const cutoff = await scalar(db, "select required_after as value from crm_allocation.release")
  await db.query("insert into public.deal_contract_submissions(lead_id,draft) values ($1,$2)", [lead,asJson(form)])
  await db.exec("insert into public.role_permissions(role_id,permission_key,effect,scope_type) " +
    "select id,'contracts.finance.confirm','allow','org' from public.roles where name='Admin' on conflict do nothing")
  await db.query("insert into public.deal_contract_submissions(lead_id,draft,submitted,submitted_at) values ($1,$2,$2,$3)",
    [untouched,asJson({ ...form, companyName: "第一批已分配演示客户", mainlandCompanyName:undefined, hongKongCompanyName:undefined }),cutoff])
  await dealerCall(admin, tx => tx.query("select public.rpc_department_allocation_save('lead',$1,$2,0,$3)",
    [untouched,cutoff,asJson({ "performance/google":[departments["test-ad2"]], "performance/meta":[departments["test-ad2"]] })]))
  assert.equal(await scalar(db, "select count(*)::int as value from crm_allocation.operations_deliveries"), 0)
  await db.exec("update crm_allocation.operations_release set enabled=true where singleton")

  // A historical handoff can use a Hong Kong name and an attachment, without treating the old worksheet as finance confirmation.
  await db.exec("begin")
  try {
    const history = uuid(14)
    const raw = Array(44).fill(null)
    raw[7] = "旧表演示客户"
    const historicalFile = { path: `${history}/${uuid(90)}`, name: "历史演示材料.txt" }
    await db.exec("insert into public.deal_history_batches(id,source_sha,expected_count,published_at) values ('ops-test',repeat('d',64),1,now())")
    await db.query("insert into public.deal_history_records(id,batch_id,source_row,owner_id,raw_values,source_types) " +
      "values ($1,'ops-test',20,$2,$3,$4)", [history,sales,asJson(raw),asJson(Array(44).fill(null))])
    const submittedAt = await scalar(db, "insert into crm_allocation.history_submissions(history_id,data,attachments,finance,submitted_at,submitted_by) " +
      "values ($1,$2,$3,$4,clock_timestamp(),$5) returning submitted_at as value", [
      history,asJson({ ...form, mainlandCompanyName:"暂无", currency:"USD", attachmentStatus:undefined }),
      asJson([historicalFile]),asJson({ legalName:"旧表签署主体",receivedOn:"2026-11-20",receivedAmount:"500" }),sales,
    ])
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin])
    await db.exec("set local role authenticated")
    await db.query("select public.rpc_department_allocation_save('history',$1,$2,0,$3)", [
      history,submittedAt,asJson({ "performance/google":[departments["test-ad2"]], "performance/meta":[departments["test-ad2"]] }),
    ])
    await db.exec("reset role; set constraints all immediate")
    const payload = await scalar(db, "select payload as value from crm_allocation.operations_deliveries")
    assert.equal(payload.source,"history")
    assert.equal(payload.company,form.hongKongCompanyName)
    assert.equal(payload.mainlandCompanyName,undefined)
    assert.equal(payload.contractCurrency,"USD")
    assert.deepEqual(payload.attachments,[historicalFile])
    assert.equal(payload.attachmentStatus,undefined)
    assert.deepEqual(payload.finance,{})
  } finally {
    await db.exec("rollback")
  }
}

async function setupApp() {
  const compiled = await build({
    absWorkingDir: root,
    entryPoints: {
      callback: "app/api/v1/crm/handoff-staffing/route.ts",
      dispatch: "app/api/jobs/operations-handoffs/route.ts",
    },
    platform: "node", format: "cjs", bundle: true, write: false, outdir: temp,
    external: ["next/server", "@supabase/supabase-js", "zod"],
  })
  for (const generated of compiled.outputFiles) {
    const load = new Function("require", "module", "exports", generated.text)
    const module = { exports: {} }
    load(require, module, module.exports)
    if (generated.path.endsWith("dispatch.js")) dispatchRoute = module.exports.POST
    else callbackRoute = module.exports.POST
  }

  const app = await build({
    absWorkingDir: root,
    stdin: {
      resolveDir: root, loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { Toaster } from "sonner";
        import { ServiceDepartmentAllocation } from "@/components/service-department-allocation";
        import { DealContractSubmissionDialog } from "@/components/deal-contract-submission";
        function Demo() {
          const [open, setOpen] = React.useState(false);
          const [pending, setPending] = React.useState(false);
          return location.pathname === "/allocations" ? <ServiceDepartmentAllocation cutoff="" /> : <>
            <h1 className="mb-5 text-2xl font-bold">成交中心</h1>
            <div className="mb-4 flex gap-3">
              <button className="rounded-md border px-3 py-2" onClick={() => setPending(!pending)}>待补合同资料</button>
              <button className="rounded-md bg-primary px-3 py-2 text-primary-foreground" onClick={() => setOpen(true)}>合同资料提交</button>
            </div>
            {pending && <ServiceDepartmentAllocation pending cutoff="" />}
            <DealContractSubmissionDialog leadId="${lead}" companyName="${company}" salesperson="${salesName}" open={open} onOpenChange={setOpen} />
          </>;
        }
        createRoot(document.querySelector("#app")).render(<><Demo/><Toaster/></>);
      `,
    },
    jsx: "automatic", bundle: true, write: false, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "disposable-local-fixture",
      setup(plugin) {
        plugin.onResolve({ filter: /^@\/(components\/app-root|lib\/supabase\/client)$/ }, args =>
          ({ path: args.path, namespace: "fixture" }))
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
          resolveDir: root,
          contents: args.path.endsWith("app-root")
            ? 'import { createContext } from "react"; export const MePermissionsContext = createContext({canReadContracts:true,canReadAllocations:true,canManageAllocations:true})'
            : `
              async function local(path, body) {
                return (await fetch("/demo/" + path, { method: "POST", body: JSON.stringify(body ?? {}) })).json();
              }
              export function getBrowserSupabaseClient() {
                return {
                  rpc: (name,args) => local("rpc/" + name, args),
                  from(table) {
                    const filters = {};
                    const read = () => local("table/" + table, filters);
                    const chain = {
                      select: () => chain,
                      eq: (column, value) => { filters[column] = value; return chain; },
                      single: read, maybeSingle: read,
                    };
                    return chain;
                  },
                  storage: { from: () => ({ download: async () => ({ data: new Blob(["仅用于本地验收"] ), error: null }) }) },
                };
              }
            `,
        }))
      },
    }],
  })
  bundle = app.outputFiles[0].text
  const stylesheet = join(root, "app", "globals.css")
  css = (await postcss([tailwind({ base: root, optimize: false })]).process(await readFile(stylesheet,"utf8"), { from: stylesheet })).css
}

function respond(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(asJson(data))
}

async function rpc(name, input, actor) {
  const keys = rpcArgs[name]
  assert.ok(keys)
  const values = keys.map(key => typeof input[key] === "object" && input[key] !== null ? asJson(input[key]) : input[key] ?? null)
  const parameters = keys.map((_, i) => `$${i + 1}`).join(",")
  return dealerCall(actor, tx => name === "rpc_operations_handoffs_claim"
    ? scalar(tx, `select coalesce(jsonb_agg(job),'[]'::jsonb) as value from public.${name}(${parameters}) job`, values)
    : scalar(tx, `select to_jsonb(public.${name}(${parameters})) as value`, values))
}

function receiveIntake(req, res, body) {
  if (req.headers.authorization !== `Bearer ${intakeToken}`) return respond(res, { error:"UNAUTHORIZED" }, 401)
  const prior = jobs.get(body.id)
  const workOrderId = prior?.workOrderId ?? `OPS-DEMO-${jobs.size + 1}`
  const sent = attempts.get(body.id) ?? []
  attempts.set(body.id, [...sent, body])
  if (prior?.body.version === body.version && asJson(prior.body) !== asJson(body)) return respond(res,{error:"VERSION_CONFLICT"},409)
  if (!prior || prior.body.version < body.version) jobs.set(body.id, { body, workOrderId })
  // Simulate a lost acknowledgement after the operations system has persisted the work order.
  if (failOnce) { failOnce = false; return respond(res, { error:"DEMO_TEMPORARY_FAILURE" }, 503) }
  return respond(res, { id:body.id, workOrderId })
}

async function sendStaffing(job, change, previousVersion = false) {
  const { body, workOrderId } = job
  const staff = {
    handoffId: body.id, departmentId: body.department.id, workOrderId, scopeVersion: body.scopeVersion,
    version: change ? 2 : 1, confirmedAt: change ? "2026-11-20T10:01:00+08:00" : "2026-11-20T10:00:00+08:00",
    projectLead: { id: `pm-${job.workOrderId}`, name: change ? "演示接任负责人" : "演示项目负责人" },
    staffing: body.services.map(service => ({ serviceId: service.id,
      members: [{ id: `${service.id}-01`, name: change ? "演示接任优化师" : "演示优化师甲" }] })),
  }
  if (previousVersion) staff.scopeVersion--
  return fetch(`${origin}/api/v1/crm/handoff-staffing`, {
    method: "POST", headers: { Authorization: `Bearer ${staffingToken}`, "Content-Type": "application/json" }, body: asJson(staff),
  })
}

function page(title, content) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <link rel="stylesheet" href="/app.css"><body class="bg-background text-foreground">
    <main class="mx-auto max-w-6xl space-y-5 px-5 py-8">
      <nav class="flex flex-wrap gap-4 border-b pb-4 text-sm font-medium" aria-label="本地流程">
        <a href="/deals">成交中心</a><a href="/allocations">分配中心</a><a href="/operations">模拟运营</a>
      </nav>${content}</main></body></html>`
}

const server = createServer(async (req,res) => {
  const url = new URL(req.url, "http://127.0.0.1")
  const path = url.pathname
  try {
    if (req.method === "GET") {
      if (path === "/app.js" || path === "/app.css") {
        res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css")
        return res.end(path.endsWith(".js") ? bundle : css)
      }
      res.setHeader("Content-Type","text/html; charset=utf-8")
      if (path === "/operations") {
        return res.end(page("模拟运营", `<h1 class="text-2xl font-bold">模拟运营工单</h1>
          <p class="text-muted-foreground">首次收单模拟一次回执失败，CRM 会自动重试。此页使用演示人员。</p>
          <a class="underline" href="/operations">刷新工单</a><ul id="orders" class="space-y-3"></ul>
          <script>
          async function load() {
            const list = document.querySelector('#orders');
            const orders = await (await fetch('/demo/orders', {method:'POST'})).json();
            list.replaceChildren(...orders.map(order => {
              const item = document.createElement('li');
              item.className = 'space-y-2 rounded-lg border p-4';
              const label = document.createElement('p');
              label.textContent = [order.workOrderId, order.body.department.name, ...order.body.services.map(s=>s.label)].join(' · ');
              item.append(label);
              for (const [label, change] of [['确认人员', false], ['换人并回传', true]]) {
                const button = document.createElement('button');
                button.type = 'button'; button.textContent = label;
                button.className = 'mr-2 rounded-md border px-3 py-2';
                button.disabled = !order.body.active;
                button.onclick = async () => {
                  const result = document.querySelector('#callback');
                  const response = await fetch('/demo/staffing', {method:'POST', body:JSON.stringify({id:order.body.id,change})});
                  const body = await response.json();
                  result.textContent = response.ok ? '回传成功，人员版本 ' + body.version : '回传结果 ' + body.error;
                };
                item.append(button);
              }
              return item;
            }));
          }
          load();
          </script><p id="callback" role="status"></p>`))
      }
      return res.end(page("CRM 运营接口第二批本地预览", '<div id="app"></div><script src="/app.js"></script>'))
    }

    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    if (path === "/api/v1/crm/handoff-staffing" || path === "/api/jobs/operations-handoffs") {
      const route = path.startsWith("/api/jobs") ? dispatchRoute : callbackRoute
      const result = await route(new Request(new URL(req.url, origin), { method:"POST", headers:req.headers, body:raw.length ? raw : undefined }))
      res.writeHead(result.status, Object.fromEntries(result.headers))
      return res.end(await result.text())
    }
    const body = raw.length ? JSON.parse(raw.toString()) : {}
    if (path === "/api/v1/operations/handoffs") return receiveIntake(req,res,body)
    if (path === "/demo/orders") return respond(res,[...jobs.values()])
    if (path === "/demo/staffing") {
      if (!jobs.has(body.id)) return respond(res,{ error:"NO_DEMO_ORDER" },404)
      const response = await sendStaffing(jobs.get(body.id), body.change)
      return respond(res,await response.json(),response.status)
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").at(-1)
      if (req.headers.authorization !== `Bearer ${serviceKey}` || !name.startsWith("rpc_operations_") || !Object.hasOwn(rpcArgs,name))
        return respond(res,{ code:"42501",message:"Unavailable in fixture" },403)
      const data = await rpc(name, body, "service_role")
      if (name === "rpc_operations_handoff_finish" && body.p_retry && data) {
        const wait = await scalar(db, "select extract(epoch from (due_at-now()))::int as value from crm_allocation.operations_deliveries where handoff_id=$1", [body.p_handoff_id])
        if (!accelerated) assert.ok(wait >= 55, "production retry must wait about one minute")
        accelerated = true
        await db.query("update crm_allocation.operations_deliveries set due_at=now()+interval '5 seconds' where handoff_id=$1 and state='retrying'", [body.p_handoff_id])
      }
      return respond(res,data)
    }
    if (path.startsWith("/demo/rpc/")) {
      const name = path.split("/").at(-1)
      if (!browserRpc.has(name)) return respond(res,{ data:null,error:{ code:"42501" } },403)
      const actor = path.includes("allocation_save") || path.includes("allocation_workspace") ? admin : sales
      return respond(res,{ data:await rpc(name,body,actor),error:null })
    }
    if (path.startsWith("/demo/table/")) {
      const table = path.split("/").at(-1)
      if (table === "contracts") return respond(res,{ data:null,error:null })
      if (!["deal_contract_submissions","leads_secure_view"].includes(table)) return respond(res,{ data:null,error:{ code:"42501" } },403)
      const id = table === "leads_secure_view" ? "id" : "lead_id"
      const data = await dealerCall(sales, tx => scalar(tx,`select to_jsonb(t) as value from public.${table} t where ${id}=$1`,[body[id]]))
      return respond(res,{ data,error:null })
    }
    return respond(res,{ error:"Unknown demo route" },404)
  } catch (error) {
    if (path.startsWith("/demo/rpc/")) return respond(res,{ data:null,error:{ code:error.code,message:error.message } })
    console.error(error)
    return respond(res,{ code:error.code,message:error.message },500)
  }
})

async function tick() {
  if (running) return
  running = true
  try {
    const response = await fetch(`${origin}/api/jobs/operations-handoffs`, { method:"POST", headers:{ Authorization:`Bearer ${scheduleToken}` } })
    if (!response.ok) throw new Error(`Dispatch HTTP ${response.status}`)
  } catch (error) {
    backgroundError = error
  } finally {
    running = false
  }
}

try {
  await seed()
  await setupApp()
  await new Promise((resolve,reject) => server.listen(verify ? 0 : 4185,"127.0.0.1",resolve).on("error",reject))
  origin = `http://127.0.0.1:${server.address().port}`
  process.env.NEXT_PUBLIC_SUPABASE_URL = origin
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey
  process.env.CRM_OPERATIONS_ENABLED = "true"
  process.env.CRM_OPERATIONS_BASE_URL = origin
  process.env.CRM_OPERATIONS_INTAKE_TOKEN = intakeToken
  process.env.CRM_OPERATIONS_CALLBACK_TOKEN = staffingToken
  process.env.CRM_OPERATIONS_JOB_TOKEN = scheduleToken
  interval = setInterval(() => void tick(), 1200)
  try {
    if (verify) {
      const { verifyLocalOperations } = await import("./verify-operations-phase-two.mjs")
      await verifyLocalOperations({ origin, db, lead, untouched, outsideScope, company, admin, sales, other, departments, jobs, attempts, rpc, sendStaffing, tick, verifyBackground: () => assert.ifError(backgroundError) })
    } else {
      console.log(`CRM 本地运营联调预览 ${origin}/deals`)
      await new Promise(resolve => { process.once("SIGINT",resolve); process.once("SIGTERM",resolve) })
    }
  } finally {
    clearInterval(interval)
  }
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve))
  await db.close()
  await rmdir(temp)
}
