\# Iwish 销售与线索管理系统 PRD（工程可直接开干版｜Cloudflare + Supabase）



> 文档目标：不仅描述“做什么”，还给出\*\*数据库 DDL、RLS 策略模板、Security Definer 函数、RPC 设计与参数约定、前端路由与中间件实现要点、初始化种子数据\*\*，使工程团队可直接按本文落地实现。

> 核心原则：\*\*准入审批制 + 账号全生命周期 + 可配置颗粒级权限（资源-动作-范围-字段）+ 后端强制（RLS/RPC/视图）+ 全量审计\*\*。



---



\## 1. 项目背景



\### 1.1 业务背景



销售团队的线索来源多样（广告、活动、渠道、表单、转介绍等），常见问题包括：



\* 线索分散在表格/聊天工具/个人记录中，缺乏统一视图与阶段推进；

\* 重复跟进、撞单、归属不清，影响协作效率与转化；

\* 人员调岗/离职频繁，交接效率低且存在数据泄露风险；

\* 无系统化审计能力：谁何时改了归属、导出了数据、修改了敏感信息难以追溯；

\* 权限边界粗放，无法按组织、角色、范围、字段进行精细控制。



\### 1.2 建设目标



\* 建立统一 CRM 轻量线索系统，形成线索全流程闭环；

\* 实现\*\*注册审批制\*\*与账号全生命周期管理；

\* 实现\*\*可配置颗粒级权限\*\*（动作级 + 范围级 + 字段级），且由后端强制执行；

\* 支持 Cloudflare 边缘部署与基础安全防护；

\* 建立审计体系，覆盖敏感操作与关键业务动作。



---



\## 2. 项目目标与成功指标



\### 2.1 Must Have（上线必备）



1\. 线索：列表/详情、创建/编辑、分配/转移、跟进记录、关闭/丢单、筛选搜索。

2\. 组织：Teams（部门）、Roles（角色）、Profiles（用户档案）。

3\. 准入：注册审批、登录拦截（pending/disabled/rejected）、找回密码。

4\. 权限：权限点字典、角色权限矩阵、用户覆盖权限（临时授权/deny 收权）、自定义范围（Scope Sets）、字段策略（Field Policies）。

5\. 安全：RLS 强制行级隔离；敏感字段通过安全视图脱敏；写操作关键路径通过 RPC 做字段级校验。

6\. 审计：审批/禁用/恢复、权限变更、分配/转移、导出、设置变更、敏感字段更新等全量日志。



\### 2.2 Success Metrics（建议）



\* 系统线索覆盖率 ≥ 90%

\* 重复线索率下降 ≥ 30%

\* 跟进及时率（N 天内至少一次跟进）提升 ≥ 20%

\* 离职交接处理时长 ≤ 1 天

\* 审计覆盖率 = 100%



---



\## 3. 技术栈与部署架构



\### 3.1 技术栈



\* 前端：Next.js（支持 Edge Runtime）、React、TypeScript

\* UI：Tailwind CSS（可选 shadcn/ui 等组件库）

\* 认证与数据库：Supabase（Auth + Postgres + RLS + Functions/RPC）

\* 部署：Cloudflare Pages（前端）+（可选）Cloudflare Workers（边缘 API/网关）

\* 存储（可选）：Supabase Storage 或 Cloudflare R2（头像/附件）

\* 监控（建议）：Sentry（前端/边缘错误），PostHog/GA（行为分析）

\* CI/CD：GitHub Actions（可选）



\### 3.2 架构原则



\* \*\*准入拦截\*\*：Next.js Middleware 控制路由准入与体验（pending/disabled/rejected）。

\* \*\*数据安全强制\*\*：所有业务表开启 RLS，未授权无法通过 API 绕过前端获取数据。

\* \*\*字段级控制\*\*：读取走安全视图（脱敏）；写入关键字段走 RPC 校验，避免列级权限缺口。

\* \*\*权限配置实时生效\*\*：权限点/范围/字段策略可配置，变更无需发版。



---



\## 4. 业务对象与术语



\* Profile：用户档案（与 auth.users 一一对应）

\* Team：部门

\* Role：角色

\* Permission：权限点（资源-动作）

\* Scope：数据范围（self/team/org/custom）

\* Field Policy：字段级策略（读/写权限、脱敏）

\* Lead：线索

\* Lead Note：跟进记录

\* Audit Log：审计日志

\* User Override：用户覆盖权限（allow/deny 可过期）



---



\## 5. 账号生命周期与准入（注册审批制）



\### 5.1 用户状态（profiles.status）



\* `pending`：待审核，仅能访问 onboarding 页面与本人状态

\* `active`：启用，进入系统（按权限）

\* `disabled`：禁用，登录后强制退出，禁止访问业务数据

\* `rejected`：驳回，登录后提示驳回原因，禁止访问业务数据



\### 5.2 状态机流转



\* pending → active：管理员审批通过并分配 team + role（必填）

\* pending → rejected：管理员驳回并填写 reason（必填）

\* active → disabled：管理员禁用并填写原因（建议必填）

\* disabled → active：管理员恢复（可选；如 team/role 缺失需重新分配）

\* rejected → pending：重新提交（可选，默认不启用；如启用需额外页面与日志）



---



\## 6. 权限体系（可配置颗粒级）



\### 6.1 模型概述



采用 \*\*RBAC + Scope（ABAC）+ Field Policy\*\*：



\* RBAC：角色绑定权限点（Permission Key）

\* Scope：每个权限点配置作用范围（self/team/org/custom）

\* Field Policy：字段读写与脱敏由策略与权限点驱动

\* User Overrides：单用户临时 allow/deny（可设过期）



\### 6.2 权限 key 命名规范



\* `{resource}.{action}`，例：`leads.read`、`auth.approve`、`settings.security.manage`

\* 权限 key 一旦上线尽量不改名



\### 6.3 Scope（范围）定义



\* `self`：本人负责/本人创建/被共享

\* `team`：本部门

\* `org`：全组织

\* `custom`：自定义集合（Scope Set）



\### 6.4 权限计算优先级（必须）



1\. user\_permissions deny（未过期）

2\. user\_permissions allow（未过期）

3\. role\_permissions deny

4\. role\_permissions allow

5\. 默认 deny



---



\## 7. 功能模块与页面



\### 7.1 公共/认证页面



\* `/auth/login`

\* `/auth/register`

\* `/auth/forgot-password`

\* `/auth/reset-password`



\### 7.2 Onboarding（准入拦截）



\* `/onboarding/pending`

\* `/onboarding/disabled`

\* `/onboarding/rejected`



\### 7.3 业务页面



\* `/dashboard`

\* `/leads`（列表）

\* `/leads/:id`（详情）

\* `/settings`（入口）

\* `/settings/organization`（teams/roles/permissions）

\* `/settings/organization/pending`（待审核列表）

\* `/settings/security`（安全策略）

\* `/audit`（审计）

\* `/reports`（报表）



---



\## 8. 线索业务流程



\### 8.1 Leads 列表



\* 分页、搜索、筛选（负责人/阶段/来源/时间范围/团队等）

\* 列表字段建议：name、stage、owner、team、updated\_at、last\_contact\_at



\### 8.2 Leads 详情



\* 基础信息、阶段、负责人、跟进时间线、（可选）附件

\* 操作：编辑、记录跟进、分配/转移（按权限）、关闭/丢单（按权限）



\### 8.3 分配与转移



\* Assign（同范围内变更负责人）：需要 `leads.assign`

\* Transfer（跨团队/跨归属更高权限动作）：需要 `leads.transfer`

\* 所有分配/转移写审计



\### 8.4 关闭/丢单



\* 需要 `leads.close`

\* 记录结果（won/lost）与原因（reason），写审计



---



\## 9. 数据库设计（DDL｜可直接执行）



> 说明：你可能已有 `leads/roles/teams/settings`。为了“工程可直接开干”，本文提供\*\*推荐基线结构\*\*。若你现有结构不同，请在落地时按本节“语义字段”做映射（至少保证：lead 可关联 owner/team、可判断 scope、可记录阶段与更新时间）。



\### 9.1 建议 Schema 与扩展



建议把安全函数与视图放在独立 schema：`iwish`（便于管理）。



```sql

create schema if not exists iwish;

```



---



\### 9.2 profiles（用户档案）



> 与 `auth.users` 一一对应。注册后由 trigger 自动插入，初始 `pending`。



```sql

-- 需要启用 uuid 扩展（Supabase 通常已启用）

-- create extension if not exists "uuid-ossp";



do $$ begin

&nbsp; if not exists (select 1 from pg\_type where typname = 'profile\_status') then

&nbsp;   create type profile\_status as enum ('pending','active','disabled','rejected');

&nbsp; end if;

end $$;



create table if not exists public.profiles (

&nbsp; id uuid primary key references auth.users(id) on delete cascade,

&nbsp; email text unique,

&nbsp; full\_name text not null,

&nbsp; phone text not null,

&nbsp; avatar\_url text,

&nbsp; status profile\_status not null default 'pending',

&nbsp; role\_id uuid null,      -- references public.roles(id)（若 roles 为 uuid）

&nbsp; team\_id int null,       -- references public.teams(id)

&nbsp; created\_at timestamptz not null default now(),

&nbsp; updated\_at timestamptz not null default now(),



&nbsp; approved\_at timestamptz,

&nbsp; approved\_by uuid references auth.users(id),

&nbsp; rejected\_at timestamptz,

&nbsp; rejected\_by uuid references auth.users(id),

&nbsp; rejection\_reason text,

&nbsp; disabled\_at timestamptz,

&nbsp; disabled\_by uuid references auth.users(id),

&nbsp; disable\_reason text

);



-- active 必须分配 role/team（如果你希望严格）

alter table public.profiles

&nbsp; add constraint profiles\_active\_requires\_role\_team

&nbsp; check (

&nbsp;   status <> 'active'

&nbsp;   or (role\_id is not null and team\_id is not null)

&nbsp; );

```



更新时间触发器（可选但建议）：



```sql

create or replace function iwish.set\_updated\_at()

returns trigger

language plpgsql

as $$

begin

&nbsp; new.updated\_at = now();

&nbsp; return new;

end $$;



drop trigger if exists trg\_profiles\_updated\_at on public.profiles;

create trigger trg\_profiles\_updated\_at

before update on public.profiles

for each row execute function iwish.set\_updated\_at();

```



---



\### 9.3 teams（部门）与 roles（角色）推荐基线（如你已存在可跳过）



```sql

create table if not exists public.teams (

&nbsp; id serial primary key,

&nbsp; name text not null unique,

&nbsp; is\_active boolean not null default true,

&nbsp; created\_at timestamptz not null default now()

);



create table if not exists public.roles (

&nbsp; id uuid primary key default gen\_random\_uuid(),

&nbsp; name text not null unique,

&nbsp; description text,

&nbsp; is\_system boolean not null default false,

&nbsp; is\_active boolean not null default true,

&nbsp; created\_at timestamptz not null default now()

);



alter table public.profiles

&nbsp; add constraint profiles\_team\_fk foreign key (team\_id) references public.teams(id) on delete set null;



alter table public.profiles

&nbsp; add constraint profiles\_role\_fk foreign key (role\_id) references public.roles(id) on delete set null;

```



---



\### 9.4 leads（线索）推荐基线（如你已存在请按语义映射）



> 最小字段集：`id, team\_id, owner\_id, created\_by, stage/status, updated\_at, last\_contact\_at`。



```sql

create table if not exists public.leads (

&nbsp; id uuid primary key default gen\_random\_uuid(),

&nbsp; team\_id int not null references public.teams(id) on delete restrict,

&nbsp; owner\_id uuid not null references public.profiles(id) on delete restrict,

&nbsp; created\_by uuid not null references public.profiles(id) on delete restrict,



&nbsp; name text not null,

&nbsp; source text,

&nbsp; stage text not null default 'new', -- pipeline stage

&nbsp; status text not null default 'open', -- open/closed

&nbsp; close\_result text, -- won/lost

&nbsp; close\_reason text,



&nbsp; customer\_name text,

&nbsp; customer\_phone text,

&nbsp; customer\_email text,

&nbsp; address text,

&nbsp; budget numeric,



&nbsp; internal\_score int,

&nbsp; blacklist\_reason text,



&nbsp; last\_contact\_at timestamptz,

&nbsp; created\_at timestamptz not null default now(),

&nbsp; updated\_at timestamptz not null default now()

);



drop trigger if exists trg\_leads\_updated\_at on public.leads;

create trigger trg\_leads\_updated\_at

before update on public.leads

for each row execute function iwish.set\_updated\_at();



create index if not exists idx\_leads\_team on public.leads(team\_id);

create index if not exists idx\_leads\_owner on public.leads(owner\_id);

create index if not exists idx\_leads\_updated on public.leads(updated\_at desc);

```



---



\### 9.5 lead\_notes（跟进记录）推荐基线（可选但建议）



```sql

create table if not exists public.lead\_notes (

&nbsp; id uuid primary key default gen\_random\_uuid(),

&nbsp; lead\_id uuid not null references public.leads(id) on delete cascade,

&nbsp; author\_id uuid not null references public.profiles(id) on delete restrict,

&nbsp; content text not null,

&nbsp; note\_type text default 'note', -- call/email/meeting/note

&nbsp; created\_at timestamptz not null default now(),

&nbsp; updated\_at timestamptz not null default now(),

&nbsp; is\_deleted boolean not null default false

);



drop trigger if exists trg\_lead\_notes\_updated\_at on public.lead\_notes;

create trigger trg\_lead\_notes\_updated\_at

before update on public.lead\_notes

for each row execute function iwish.set\_updated\_at();



create index if not exists idx\_notes\_lead on public.lead\_notes(lead\_id, created\_at desc);

create index if not exists idx\_notes\_author on public.lead\_notes(author\_id, created\_at desc);

```



---



\### 9.6 lead\_shares（共享协作｜可选但建议预留）



```sql

create table if not exists public.lead\_shares (

&nbsp; id uuid primary key default gen\_random\_uuid(),

&nbsp; lead\_id uuid not null references public.leads(id) on delete cascade,

&nbsp; shared\_to uuid not null references public.profiles(id) on delete cascade,

&nbsp; shared\_by uuid not null references public.profiles(id) on delete restrict,

&nbsp; created\_at timestamptz not null default now(),

&nbsp; unique (lead\_id, shared\_to)

);



create index if not exists idx\_lead\_shares\_to on public.lead\_shares(shared\_to);

```



---



\### 9.7 权限系统：permissions / role\_permissions / user\_permissions



```sql

create table if not exists public.permissions (

&nbsp; key text primary key,

&nbsp; resource text not null,

&nbsp; action text not null,

&nbsp; name text not null,

&nbsp; description text,

&nbsp; is\_system boolean not null default true,

&nbsp; is\_enabled boolean not null default true,

&nbsp; created\_at timestamptz not null default now()

);



do $$ begin

&nbsp; if not exists (select 1 from pg\_type where typname = 'perm\_effect') then

&nbsp;   create type perm\_effect as enum ('allow','deny');

&nbsp; end if;

&nbsp; if not exists (select 1 from pg\_type where typname = 'scope\_type') then

&nbsp;   create type scope\_type as enum ('self','team','org','custom');

&nbsp; end if;

end $$;



create table if not exists public.role\_permissions (

&nbsp; role\_id uuid not null references public.roles(id) on delete cascade,

&nbsp; permission\_key text not null references public.permissions(key) on delete cascade,

&nbsp; effect perm\_effect not null,

&nbsp; scope\_type scope\_type not null default 'self',

&nbsp; scope\_rule jsonb,

&nbsp; created\_at timestamptz not null default now(),

&nbsp; primary key (role\_id, permission\_key)

);



create table if not exists public.user\_permissions (

&nbsp; user\_id uuid not null references public.profiles(id) on delete cascade,

&nbsp; permission\_key text not null references public.permissions(key) on delete cascade,

&nbsp; effect perm\_effect not null,

&nbsp; scope\_type scope\_type,

&nbsp; scope\_rule jsonb,

&nbsp; expires\_at timestamptz,

&nbsp; reason text,

&nbsp; created\_at timestamptz not null default now(),

&nbsp; primary key (user\_id, permission\_key, effect, created\_at)

);



create index if not exists idx\_user\_permissions\_user on public.user\_permissions(user\_id);

create index if not exists idx\_user\_permissions\_expires on public.user\_permissions(expires\_at);

```



---



\### 9.8 自定义范围：custom\_scope\_sets



```sql

create table if not exists public.custom\_scope\_sets (

&nbsp; id uuid primary key default gen\_random\_uuid(),

&nbsp; name text not null,

&nbsp; resource text not null, -- 'leads'

&nbsp; definition jsonb not null, -- {team\_ids:\[], user\_ids:\[], rules:{...}}

&nbsp; created\_by uuid not null references public.profiles(id) on delete restrict,

&nbsp; created\_at timestamptz not null default now()

);



create index if not exists idx\_scope\_sets\_resource on public.custom\_scope\_sets(resource);

```



---



\### 9.9 字段策略：field\_policies



```sql

create table if not exists public.field\_policies (

&nbsp; resource text not null,

&nbsp; field text not null,

&nbsp; read\_permission\_key text references public.permissions(key) on delete set null,

&nbsp; write\_permission\_key text references public.permissions(key) on delete set null,

&nbsp; mask\_strategy text not null default 'null', -- null/phone\_mask/email\_mask/partial

&nbsp; created\_at timestamptz not null default now(),

&nbsp; primary key (resource, field)

);

```



---



\### 9.10 审计：audit\_logs



```sql

create table if not exists public.audit\_logs (

&nbsp; id uuid primary key default gen\_random\_uuid(),

&nbsp; actor\_id uuid not null references public.profiles(id) on delete restrict,

&nbsp; action text not null,

&nbsp; target\_type text not null,

&nbsp; target\_id text not null,

&nbsp; before jsonb,

&nbsp; after jsonb,

&nbsp; reason text,

&nbsp; created\_at timestamptz not null default now()

);



create index if not exists idx\_audit\_actor\_time on public.audit\_logs(actor\_id, created\_at desc);

create index if not exists idx\_audit\_target on public.audit\_logs(target\_type, target\_id);

```



---



\## 10. 注册触发器（Auth → profiles 自动插入）



> 目标：用户完成 Supabase Auth 注册后自动写入 profiles，默认 pending。

> 注意：Supabase 中 `auth.users` 的元数据获取方式可以从 `raw\_user\_meta\_data` 读取（你注册时传入 full\_name/phone）。



```sql

create or replace function iwish.handle\_new\_user()

returns trigger

language plpgsql

security definer

set search\_path = public, auth, iwish

as $$

declare

&nbsp; v\_full\_name text;

&nbsp; v\_phone text;

begin

&nbsp; v\_full\_name := coalesce(new.raw\_user\_meta\_data->>'full\_name', '');

&nbsp; v\_phone := coalesce(new.raw\_user\_meta\_data->>'phone', '');



&nbsp; insert into public.profiles (id, email, full\_name, phone, status)

&nbsp; values (new.id, new.email, nullif(v\_full\_name,''), nullif(v\_phone,''), 'pending')

&nbsp; on conflict (id) do nothing;



&nbsp; return new;

end $$;



drop trigger if exists on\_auth\_user\_created on auth.users;

create trigger on\_auth\_user\_created

after insert on auth.users

for each row execute function iwish.handle\_new\_user();

```



> 前端注册时必须把 `full\_name/phone` 写到 user metadata（否则这里拿不到）。若你不想依赖 metadata，也可在注册后调用 RPC 写 profiles。



---



\## 11. 安全函数（权限计算、scope、脱敏）与实现约定



> 关键要求：这些函数建议 `SECURITY DEFINER`，且固定 `search\_path`，避免注入。

> 同时所有业务函数应先校验 `profiles.status='active'`（除 onboarding）。



\### 11.1 is\_active\_user



```sql

create or replace function iwish.is\_active\_user(uid uuid)

returns boolean

language sql

stable

as $$

&nbsp; select exists (

&nbsp;   select 1 from public.profiles p

&nbsp;   where p.id = uid and p.status = 'active'

&nbsp; );

$$;

```



\### 11.2 has\_permission（按优先级计算 allow/deny）



```sql

create or replace function iwish.has\_permission(uid uuid, perm\_key text)

returns boolean

language plpgsql

stable

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_role\_id uuid;

&nbsp; v\_now timestamptz := now();

begin

&nbsp; -- 必须 active

&nbsp; if not iwish.is\_active\_user(uid) then

&nbsp;   return false;

&nbsp; end if;



&nbsp; -- 权限点是否启用

&nbsp; if not exists (select 1 from public.permissions where key = perm\_key and is\_enabled = true) then

&nbsp;   return false;

&nbsp; end if;



&nbsp; -- user deny（未过期）

&nbsp; if exists (

&nbsp;   select 1 from public.user\_permissions up

&nbsp;   where up.user\_id = uid

&nbsp;     and up.permission\_key = perm\_key

&nbsp;     and up.effect = 'deny'

&nbsp;     and (up.expires\_at is null or up.expires\_at > v\_now)

&nbsp; ) then

&nbsp;   return false;

&nbsp; end if;



&nbsp; -- user allow（未过期）

&nbsp; if exists (

&nbsp;   select 1 from public.user\_permissions up

&nbsp;   where up.user\_id = uid

&nbsp;     and up.permission\_key = perm\_key

&nbsp;     and up.effect = 'allow'

&nbsp;     and (up.expires\_at is null or up.expires\_at > v\_now)

&nbsp; ) then

&nbsp;   return true;

&nbsp; end if;



&nbsp; select role\_id into v\_role\_id from public.profiles where id = uid;



&nbsp; -- role deny

&nbsp; if exists (

&nbsp;   select 1 from public.role\_permissions rp

&nbsp;   where rp.role\_id = v\_role\_id

&nbsp;     and rp.permission\_key = perm\_key

&nbsp;     and rp.effect = 'deny'

&nbsp; ) then

&nbsp;   return false;

&nbsp; end if;



&nbsp; -- role allow

&nbsp; if exists (

&nbsp;   select 1 from public.role\_permissions rp

&nbsp;   where rp.role\_id = v\_role\_id

&nbsp;     and rp.permission\_key = perm\_key

&nbsp;     and rp.effect = 'allow'

&nbsp; ) then

&nbsp;   return true;

&nbsp; end if;



&nbsp; return false;

end $$;

```



\### 11.3 get\_effective\_scope（返回 scope\_type + scope\_rule）



返回 JSONB：`{"scope\_type":"team","scope\_rule":null}`



```sql

create or replace function iwish.get\_effective\_scope(uid uuid, perm\_key text)

returns jsonb

language plpgsql

stable

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_now timestamptz := now();

&nbsp; v\_role\_id uuid;

&nbsp; v\_scope\_type scope\_type;

&nbsp; v\_scope\_rule jsonb;

begin

&nbsp; if not iwish.has\_permission(uid, perm\_key) then

&nbsp;   return null;

&nbsp; end if;



&nbsp; -- user allow 优先（未过期）

&nbsp; select up.scope\_type, up.scope\_rule

&nbsp;   into v\_scope\_type, v\_scope\_rule

&nbsp; from public.user\_permissions up

&nbsp; where up.user\_id = uid

&nbsp;   and up.permission\_key = perm\_key

&nbsp;   and up.effect = 'allow'

&nbsp;   and (up.expires\_at is null or up.expires\_at > v\_now)

&nbsp; order by up.created\_at desc

&nbsp; limit 1;



&nbsp; if v\_scope\_type is not null then

&nbsp;   return jsonb\_build\_object('scope\_type', v\_scope\_type::text, 'scope\_rule', v\_scope\_rule);

&nbsp; end if;



&nbsp; select role\_id into v\_role\_id from public.profiles where id = uid;



&nbsp; -- role allow

&nbsp; select rp.scope\_type, rp.scope\_rule

&nbsp;   into v\_scope\_type, v\_scope\_rule

&nbsp; from public.role\_permissions rp

&nbsp; where rp.role\_id = v\_role\_id

&nbsp;   and rp.permission\_key = perm\_key

&nbsp;   and rp.effect = 'allow'

&nbsp; limit 1;



&nbsp; if v\_scope\_type is null then

&nbsp;   -- role allow 没有 scope 配置时，默认 self

&nbsp;   return jsonb\_build\_object('scope\_type', 'self', 'scope\_rule', null);

&nbsp; end if;



&nbsp; return jsonb\_build\_object('scope\_type', v\_scope\_type::text, 'scope\_rule', v\_scope\_rule);

end $$;

```



\### 11.4 eval\_custom\_scope（Scope Set 评估）



Scope Set definition 建议至少支持：



\* `team\_ids: \[1,2]`

\* `user\_ids: \["uuid", ...]`

\* `rules: { source\_in: \[...], stage\_in: \[...]}`

&nbsp; 你可按现有 leads 字段扩展规则。



```sql

create or replace function iwish.eval\_custom\_scope(uid uuid, lead\_row public.leads, scope\_rule jsonb)

returns boolean

language plpgsql

stable

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_scope\_set\_id uuid;

&nbsp; v\_def jsonb;

&nbsp; v\_team\_ids int\[];

&nbsp; v\_user\_ids uuid\[];

begin

&nbsp; v\_scope\_set\_id := (scope\_rule->>'scope\_set\_id')::uuid;

&nbsp; if v\_scope\_set\_id is null then

&nbsp;   return false;

&nbsp; end if;



&nbsp; select definition into v\_def

&nbsp; from public.custom\_scope\_sets

&nbsp; where id = v\_scope\_set\_id and resource = 'leads';



&nbsp; if v\_def is null then

&nbsp;   return false;

&nbsp; end if;



&nbsp; -- team\_ids

&nbsp; if (v\_def ? 'team\_ids') then

&nbsp;   select array\_agg(value::int) into v\_team\_ids

&nbsp;   from jsonb\_array\_elements\_text(v\_def->'team\_ids');

&nbsp;   if v\_team\_ids is not null and lead\_row.team\_id = any(v\_team\_ids) then

&nbsp;     return true;

&nbsp;   end if;

&nbsp; end if;



&nbsp; -- user\_ids（匹配 owner）

&nbsp; if (v\_def ? 'user\_ids') then

&nbsp;   select array\_agg(value::uuid) into v\_user\_ids

&nbsp;   from jsonb\_array\_elements\_text(v\_def->'user\_ids');

&nbsp;   if v\_user\_ids is not null and lead\_row.owner\_id = any(v\_user\_ids) then

&nbsp;     return true;

&nbsp;   end if;

&nbsp; end if;



&nbsp; -- rules（示例：source\_in / stage\_in）

&nbsp; if (v\_def ? 'rules') then

&nbsp;   if (v\_def->'rules' ? 'source\_in') then

&nbsp;     if lead\_row.source is not null and lead\_row.source = any (

&nbsp;       select array\_agg(value::text) from jsonb\_array\_elements\_text(v\_def->'rules'->'source\_in')

&nbsp;     ) then

&nbsp;       return true;

&nbsp;     end if;

&nbsp;   end if;



&nbsp;   if (v\_def->'rules' ? 'stage\_in') then

&nbsp;     if lead\_row.stage = any (

&nbsp;       select array\_agg(value::text) from jsonb\_array\_elements\_text(v\_def->'rules'->'stage\_in')

&nbsp;     ) then

&nbsp;       return true;

&nbsp;     end if;

&nbsp;   end if;

&nbsp; end if;



&nbsp; return false;

end $$;

```



\### 11.5 in\_scope\_for\_lead（行级 scope 判定）



```sql

create or replace function iwish.in\_scope\_for\_lead(uid uuid, lead\_row public.leads, perm\_key text)

returns boolean

language plpgsql

stable

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_scope jsonb;

&nbsp; v\_scope\_type text;

&nbsp; v\_scope\_rule jsonb;

&nbsp; v\_user\_team int;

begin

&nbsp; if not iwish.has\_permission(uid, perm\_key) then

&nbsp;   return false;

&nbsp; end if;



&nbsp; v\_scope := iwish.get\_effective\_scope(uid, perm\_key);

&nbsp; if v\_scope is null then

&nbsp;   return false;

&nbsp; end if;



&nbsp; v\_scope\_type := v\_scope->>'scope\_type';

&nbsp; v\_scope\_rule := v\_scope->'scope\_rule';



&nbsp; if v\_scope\_type = 'org' then

&nbsp;   return true;

&nbsp; end if;



&nbsp; if v\_scope\_type = 'self' then

&nbsp;   if lead\_row.owner\_id = uid or lead\_row.created\_by = uid then

&nbsp;     return true;

&nbsp;   end if;



&nbsp;   if exists (

&nbsp;     select 1 from public.lead\_shares ls

&nbsp;     where ls.lead\_id = lead\_row.id and ls.shared\_to = uid

&nbsp;   ) then

&nbsp;     return true;

&nbsp;   end if;



&nbsp;   return false;

&nbsp; end if;



&nbsp; if v\_scope\_type = 'team' then

&nbsp;   select team\_id into v\_user\_team from public.profiles where id = uid;

&nbsp;   return lead\_row.team\_id = v\_user\_team;

&nbsp; end if;



&nbsp; if v\_scope\_type = 'custom' then

&nbsp;   return iwish.eval\_custom\_scope(uid, lead\_row, v\_scope\_rule);

&nbsp; end if;



&nbsp; return false;

end $$;

```



---



\## 12. 字段级控制（脱敏视图 + 写入 RPC 校验）



\### 12.1 脱敏辅助函数



```sql

create or replace function iwish.mask\_phone(v text)

returns text language sql immutable as $$

&nbsp; select case

&nbsp;   when v is null or length(v) < 4 then null

&nbsp;   else concat(left(v, 3), '\*\*\*\*', right(v, 2))

&nbsp; end;

$$;



create or replace function iwish.mask\_email(v text)

returns text language sql immutable as $$

&nbsp; select case

&nbsp;   when v is null or position('@' in v) = 0 then null

&nbsp;   else concat(left(v, 2), '\*\*\*', substring(v from position('@' in v)))

&nbsp; end;

$$;

```



\### 12.2 profiles\_public\_view（公开资料视图）



```sql

create or replace view public.profiles\_public\_view as

select

&nbsp; id,

&nbsp; full\_name,

&nbsp; avatar\_url,

&nbsp; team\_id,

&nbsp; role\_id,

&nbsp; status

from public.profiles;

```



\### 12.3 leads\_secure\_view（线索脱敏视图）



> 约定：前端\*\*只查询 view\*\*（而不是基础表），避免敏感字段直接暴露。



```sql

create or replace view public.leads\_secure\_view as

select

&nbsp; l.id,

&nbsp; l.team\_id,

&nbsp; l.owner\_id,

&nbsp; l.created\_by,

&nbsp; l.name,

&nbsp; l.source,

&nbsp; l.stage,

&nbsp; l.status,

&nbsp; l.close\_result,

&nbsp; l.close\_reason,

&nbsp; l.last\_contact\_at,

&nbsp; l.created\_at,

&nbsp; l.updated\_at,



&nbsp; -- 非敏感字段直接给

&nbsp; l.customer\_name,



&nbsp; -- 敏感字段：需要 leads.fields.read\_sensitive

&nbsp; case

&nbsp;   when iwish.has\_permission(auth.uid(), 'leads.fields.read\_sensitive') then l.customer\_phone

&nbsp;   else iwish.mask\_phone(l.customer\_phone)

&nbsp; end as customer\_phone,



&nbsp; case

&nbsp;   when iwish.has\_permission(auth.uid(), 'leads.fields.read\_sensitive') then l.customer\_email

&nbsp;   else iwish.mask\_email(l.customer\_email)

&nbsp; end as customer\_email,



&nbsp; case

&nbsp;   when iwish.has\_permission(auth.uid(), 'leads.fields.read\_sensitive') then l.address

&nbsp;   else null

&nbsp; end as address,



&nbsp; case

&nbsp;   when iwish.has\_permission(auth.uid(), 'leads.fields.read\_sensitive') then l.budget

&nbsp;   else null

&nbsp; end as budget,



&nbsp; -- 内部字段：需要 leads.fields.read\_internal

&nbsp; case

&nbsp;   when iwish.has\_permission(auth.uid(), 'leads.fields.read\_internal') then l.internal\_score

&nbsp;   else null

&nbsp; end as internal\_score,



&nbsp; case

&nbsp;   when iwish.has\_permission(auth.uid(), 'leads.fields.read\_internal') then l.blacklist\_reason

&nbsp;   else null

&nbsp; end as blacklist\_reason



from public.leads l;

```



> 字段策略若要完全由 `field\_policies` 动态驱动，可将 view 替换为 RPC 输出或生成式视图（工程复杂度更高）。以上为“可直接开干”的稳妥实现：敏感字段归类到少量 key。



---



\## 13. RLS 策略（可直接执行模板）



> 原则：对基础表开启 RLS 并严控；对视图一般不启 RLS（视图引用基础表时仍会受基础表 RLS 影响）。

> 推荐：客户端查询走 `leads\_secure\_view`，但基础表 `leads` 的 RLS 仍必须正确。



\### 13.1 profiles RLS



```sql

alter table public.profiles enable row level security;



-- 允许本人读取自己的 profile（包含 pending）

drop policy if exists profiles\_select\_self on public.profiles;

create policy profiles\_select\_self

on public.profiles

for select

using (id = auth.uid());



-- 允许具备 profiles.manage 的用户读取全部（管理员用）

drop policy if exists profiles\_select\_admin on public.profiles;

create policy profiles\_select\_admin

on public.profiles

for select

using (iwish.has\_permission(auth.uid(), 'profiles.manage'));



-- 允许管理员更新 profiles（审批/分配/禁用）

drop policy if exists profiles\_update\_admin on public.profiles;

create policy profiles\_update\_admin

on public.profiles

for update

using (iwish.has\_permission(auth.uid(), 'profiles.manage'))

with check (iwish.has\_permission(auth.uid(), 'profiles.manage'));

```



> phone 等私密字段的“公开读取”不通过 profiles 表实现，统一走 `profiles\_public\_view` + 单独权限控制（见下方策略）。



\### 13.2 profiles\_public\_view 访问控制（用 RLS 控制底表读取）



由于 view 仍受 profiles RLS 影响，上面已经允许 “本人读自己” + “管理员读全部”。

如果需要 \*\*active 用户读全员公开资料\*\*（用于下拉框选人），建议在 profiles 表增加一条只允许读取公开字段的策略是不现实的（列级无法控制）。因此采用\*\*替代方案\*\*：



\* 方案（推荐）：创建 `profiles\_public` \*\*表\*\*（仅存公开字段），由 trigger 同步；对该表开放 active 用户读取。

\* 若你坚持 view：只能放开 profiles 的 select 全员读，会让 phone 等字段也可被 select 到（即便前端不用，也不安全）。



下面给出推荐方案：\*\*profiles\_public 表 + trigger 同步\*\*。



```sql

create table if not exists public.profiles\_public (

&nbsp; id uuid primary key references public.profiles(id) on delete cascade,

&nbsp; full\_name text not null,

&nbsp; avatar\_url text,

&nbsp; team\_id int,

&nbsp; role\_id uuid,

&nbsp; status profile\_status not null,

&nbsp; updated\_at timestamptz not null default now()

);



create or replace function iwish.sync\_profiles\_public()

returns trigger

language plpgsql

as $$

begin

&nbsp; insert into public.profiles\_public(id, full\_name, avatar\_url, team\_id, role\_id, status, updated\_at)

&nbsp; values (new.id, new.full\_name, new.avatar\_url, new.team\_id, new.role\_id, new.status, now())

&nbsp; on conflict (id) do update set

&nbsp;   full\_name = excluded.full\_name,

&nbsp;   avatar\_url = excluded.avatar\_url,

&nbsp;   team\_id = excluded.team\_id,

&nbsp;   role\_id = excluded.role\_id,

&nbsp;   status = excluded.status,

&nbsp;   updated\_at = now();

&nbsp; return new;

end $$;



drop trigger if exists trg\_sync\_profiles\_public on public.profiles;

create trigger trg\_sync\_profiles\_public

after insert or update on public.profiles

for each row execute function iwish.sync\_profiles\_public();



alter table public.profiles\_public enable row level security;



drop policy if exists profiles\_public\_select\_active on public.profiles\_public;

create policy profiles\_public\_select\_active

on public.profiles\_public

for select

using (iwish.is\_active\_user(auth.uid()));

```



\### 13.3 leads RLS



```sql

alter table public.leads enable row level security;



-- SELECT：active + leads.read + scope

drop policy if exists leads\_select\_scope on public.leads;

create policy leads\_select\_scope

on public.leads

for select

using (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and iwish.has\_permission(auth.uid(), 'leads.read')

&nbsp; and iwish.in\_scope\_for\_lead(auth.uid(), leads, 'leads.read')

);



-- UPDATE：active + leads.update + scope

drop policy if exists leads\_update\_scope on public.leads;

create policy leads\_update\_scope

on public.leads

for update

using (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and iwish.has\_permission(auth.uid(), 'leads.update')

&nbsp; and iwish.in\_scope\_for\_lead(auth.uid(), leads, 'leads.update')

)

with check (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and iwish.has\_permission(auth.uid(), 'leads.update')

&nbsp; and iwish.in\_scope\_for\_lead(auth.uid(), leads, 'leads.update')

);



-- DELETE：active + leads.delete + scope

drop policy if exists leads\_delete\_scope on public.leads;

create policy leads\_delete\_scope

on public.leads

for delete

using (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and iwish.has\_permission(auth.uid(), 'leads.delete')

&nbsp; and iwish.in\_scope\_for\_lead(auth.uid(), leads, 'leads.delete')

);



-- INSERT：建议走 RPC；这里给一个最小策略（可选）

drop policy if exists leads\_insert\_basic on public.leads;

create policy leads\_insert\_basic

on public.leads

for insert

with check (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and iwish.has\_permission(auth.uid(), 'leads.create')

&nbsp; and created\_by = auth.uid()

);

```



\### 13.4 lead\_notes RLS（如启用）



```sql

alter table public.lead\_notes enable row level security;



-- 读：需要 lead\_notes.read + 对 lead 的 leads.read scope

drop policy if exists notes\_select\_scope on public.lead\_notes;

create policy notes\_select\_scope

on public.lead\_notes

for select

using (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and iwish.has\_permission(auth.uid(), 'lead\_notes.read')

&nbsp; and exists (

&nbsp;   select 1 from public.leads l

&nbsp;   where l.id = lead\_notes.lead\_id

&nbsp;     and iwish.has\_permission(auth.uid(), 'leads.read')

&nbsp;     and iwish.in\_scope\_for\_lead(auth.uid(), l, 'leads.read')

&nbsp; )

);



-- 写：需要 lead\_notes.create + 对 lead scope

drop policy if exists notes\_insert\_scope on public.lead\_notes;

create policy notes\_insert\_scope

on public.lead\_notes

for insert

with check (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and iwish.has\_permission(auth.uid(), 'lead\_notes.create')

&nbsp; and author\_id = auth.uid()

&nbsp; and exists (

&nbsp;   select 1 from public.leads l

&nbsp;   where l.id = lead\_notes.lead\_id

&nbsp;     and iwish.in\_scope\_for\_lead(auth.uid(), l, 'leads.update')

&nbsp; )

);



-- 改/删：建议仅作者或管理员（profiles.manage）

drop policy if exists notes\_update\_author on public.lead\_notes;

create policy notes\_update\_author

on public.lead\_notes

for update

using (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and (author\_id = auth.uid() or iwish.has\_permission(auth.uid(),'profiles.manage'))

)

with check (

&nbsp; iwish.is\_active\_user(auth.uid())

&nbsp; and (author\_id = auth.uid() or iwish.has\_permission(auth.uid(),'profiles.manage'))

);

```



\### 13.5 权限系统表 RLS（仅 Super Admin）



```sql

-- permissions

alter table public.permissions enable row level security;

drop policy if exists perm\_select\_admin on public.permissions;

create policy perm\_select\_admin on public.permissions

for select using (iwish.has\_permission(auth.uid(),'permissions.read'));



drop policy if exists perm\_manage\_super on public.permissions;

create policy perm\_manage\_super on public.permissions

for all using (iwish.has\_permission(auth.uid(),'permissions.manage'))

with check (iwish.has\_permission(auth.uid(),'permissions.manage'));



-- role\_permissions / user\_permissions / field\_policies / custom\_scope\_sets

alter table public.role\_permissions enable row level security;

alter table public.user\_permissions enable row level security;

alter table public.field\_policies enable row level security;

alter table public.custom\_scope\_sets enable row level security;



create policy role\_perm\_manage on public.role\_permissions

for all using (iwish.has\_permission(auth.uid(),'role\_permissions.manage'))

with check (iwish.has\_permission(auth.uid(),'role\_permissions.manage'));



create policy user\_perm\_manage on public.user\_permissions

for all using (iwish.has\_permission(auth.uid(),'user\_permissions.manage'))

with check (iwish.has\_permission(auth.uid(),'user\_permissions.manage'));



create policy field\_policies\_manage on public.field\_policies

for all using (iwish.has\_permission(auth.uid(),'field\_policies.manage'))

with check (iwish.has\_permission(auth.uid(),'field\_policies.manage'));



create policy scopes\_manage on public.custom\_scope\_sets

for all using (iwish.has\_permission(auth.uid(),'scopes.manage'))

with check (iwish.has\_permission(auth.uid(),'scopes.manage'));



-- audit\_logs

alter table public.audit\_logs enable row level security;

create policy audit\_read on public.audit\_logs

for select using (iwish.has\_permission(auth.uid(),'audit.read'));

```



---



\## 14. RPC（Postgres Functions）设计（字段级写入 + 业务动作 + 审计）



> 约定：

>

> \* 所有 RPC：先校验 active，再校验 permission + scope；失败抛出错误。

> \* 写操作必须写 audit\_logs。

> \* 字段级写入：根据字段分类（敏感/内部/普通）或 field\_policies 配置进行逐字段校验。

> \* 错误码建议用 `raise exception using errcode = 'P0001', message = 'ERR\_xxx:...'`，前端按 message 前缀解析。



\### 14.1 通用：写审计函数



```sql

create or replace function iwish.audit(actor uuid, action text, target\_type text, target\_id text, before jsonb, after jsonb, reason text)

returns void

language sql

security definer

set search\_path = public, iwish

as $$

&nbsp; insert into public.audit\_logs(actor\_id, action, target\_type, target\_id, before, after, reason)

&nbsp; values (actor, action, target\_type, target\_id, before, after, reason);

$$;

```



\### 14.2 RPC：审批与账号生命周期



\#### 14.2.1 rpc\_auth\_approve



```sql

create or replace function iwish.rpc\_auth\_approve(p\_user\_id uuid, p\_team\_id int, p\_role\_id uuid)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_before jsonb;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'auth.approve') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:auth.approve';

&nbsp; end if;



&nbsp; select to\_jsonb(p.\*) into v\_before from public.profiles p where p.id = p\_user\_id;



&nbsp; update public.profiles

&nbsp; set status = 'active',

&nbsp;     team\_id = p\_team\_id,

&nbsp;     role\_id = p\_role\_id,

&nbsp;     approved\_at = now(),

&nbsp;     approved\_by = v\_actor,

&nbsp;     rejection\_reason = null,

&nbsp;     rejected\_at = null,

&nbsp;     rejected\_by = null

&nbsp; where id = p\_user\_id and status = 'pending';



&nbsp; if not found then

&nbsp;   raise exception 'ERR\_INVALID\_STATUS:only\_pending\_can\_approve';

&nbsp; end if;



&nbsp; perform iwish.audit(v\_actor, 'approve\_user', 'profile', p\_user\_id::text, v\_before, (select to\_jsonb(p.\*) from public.profiles p where p.id = p\_user\_id), null);

end $$;

```



\#### 14.2.2 rpc\_auth\_reject / disable / restore（同理）



```sql

create or replace function iwish.rpc\_auth\_reject(p\_user\_id uuid, p\_reason text)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_before jsonb;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'auth.reject') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:auth.reject';

&nbsp; end if;



&nbsp; if p\_reason is null or length(trim(p\_reason)) = 0 then

&nbsp;   raise exception 'ERR\_VALIDATION:rejection\_reason\_required';

&nbsp; end if;



&nbsp; select to\_jsonb(p.\*) into v\_before from public.profiles p where p.id = p\_user\_id;



&nbsp; update public.profiles

&nbsp; set status = 'rejected',

&nbsp;     rejected\_at = now(),

&nbsp;     rejected\_by = v\_actor,

&nbsp;     rejection\_reason = p\_reason

&nbsp; where id = p\_user\_id and status = 'pending';



&nbsp; if not found then

&nbsp;   raise exception 'ERR\_INVALID\_STATUS:only\_pending\_can\_reject';

&nbsp; end if;



&nbsp; perform iwish.audit(v\_actor, 'reject\_user', 'profile', p\_user\_id::text, v\_before, (select to\_jsonb(p.\*) from public.profiles p where p.id = p\_user\_id), p\_reason);

end $$;



create or replace function iwish.rpc\_auth\_disable(p\_user\_id uuid, p\_reason text)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_before jsonb;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'auth.disable') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:auth.disable';

&nbsp; end if;



&nbsp; select to\_jsonb(p.\*) into v\_before from public.profiles p where p.id = p\_user\_id;



&nbsp; update public.profiles

&nbsp; set status = 'disabled',

&nbsp;     disabled\_at = now(),

&nbsp;     disabled\_by = v\_actor,

&nbsp;     disable\_reason = p\_reason

&nbsp; where id = p\_user\_id and status = 'active';



&nbsp; if not found then

&nbsp;   raise exception 'ERR\_INVALID\_STATUS:only\_active\_can\_disable';

&nbsp; end if;



&nbsp; perform iwish.audit(v\_actor, 'disable\_user', 'profile', p\_user\_id::text, v\_before, (select to\_jsonb(p.\*) from public.profiles p where p.id = p\_user\_id), p\_reason);

end $$;



create or replace function iwish.rpc\_auth\_restore(p\_user\_id uuid, p\_team\_id int, p\_role\_id uuid)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_before jsonb;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'auth.restore') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:auth.restore';

&nbsp; end if;



&nbsp; select to\_jsonb(p.\*) into v\_before from public.profiles p where p.id = p\_user\_id;



&nbsp; update public.profiles

&nbsp; set status = 'active',

&nbsp;     team\_id = coalesce(p\_team\_id, team\_id),

&nbsp;     role\_id = coalesce(p\_role\_id, role\_id),

&nbsp;     disabled\_at = null,

&nbsp;     disabled\_by = null,

&nbsp;     disable\_reason = null

&nbsp; where id = p\_user\_id and status = 'disabled';



&nbsp; if not found then

&nbsp;   raise exception 'ERR\_INVALID\_STATUS:only\_disabled\_can\_restore';

&nbsp; end if;



&nbsp; perform iwish.audit(v\_actor, 'restore\_user', 'profile', p\_user\_id::text, v\_before, (select to\_jsonb(p.\*) from public.profiles p where p.id = p\_user\_id), null);

end $$;

```



---



\### 14.3 RPC：Leads（创建/更新/分配/转移/关闭/导出）



\#### 14.3.1 字段分类（用于字段级写权限）



\* 普通字段：name/source/stage/status/last\_contact\_at/customer\_name 等（由 `leads.update` 控制）

\* 敏感字段：customer\_phone/customer\_email/address/budget（需 `leads.fields.write\_sensitive`）

\* 内部字段：internal\_score/blacklist\_reason（需 `leads.fields.write\_internal`）

\* 归属字段：owner\_id/team\_id（需 assign/transfer）



> 你也可以用 `field\_policies` 完全动态控制写权限，但工程复杂度更高；本 PRD 提供“可直接落地”的分类方案。



\#### 14.3.2 rpc\_lead\_create(payload jsonb) -> uuid



payload 示例（前端）：



```json

{

&nbsp; "team\_id": 1,

&nbsp; "owner\_id": "uuid-of-owner",

&nbsp; "name": "ACME - Inquiry",

&nbsp; "source": "facebook",

&nbsp; "stage": "new",

&nbsp; "customer\_name": "Tom",

&nbsp; "customer\_phone": "123456789",

&nbsp; "customer\_email": "a@b.com",

&nbsp; "budget": 1000

}

```



```sql

create or replace function iwish.rpc\_lead\_create(payload jsonb)

returns uuid

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_id uuid;

&nbsp; v\_team\_id int := (payload->>'team\_id')::int;

&nbsp; v\_owner uuid := (payload->>'owner\_id')::uuid;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'leads.create') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:leads.create';

&nbsp; end if;



&nbsp; -- scope 校验：创建时通常要求 owner 与 team 在允许范围内

&nbsp; -- 简化规则：如果 leads.create 的 scope=self，则 owner 必须是自己；team 必须是自己 team

&nbsp; -- 如果 scope=team，则 owner 必须在自己 team；team 必须是自己 team

&nbsp; -- 如果 scope=org/custom 则放宽

&nbsp; -- 为可直接开工，这里采用：创建 lead 的 team\_id 必须等于操作者 team（除非 org 权限）

&nbsp; if (iwish.get\_effective\_scope(v\_actor, 'leads.create')->>'scope\_type') in ('self','team') then

&nbsp;   if v\_team\_id <> (select team\_id from public.profiles where id = v\_actor) then

&nbsp;     raise exception 'ERR\_OUT\_OF\_SCOPE:team\_mismatch\_on\_create';

&nbsp;   end if;

&nbsp; end if;



&nbsp; -- 敏感字段写权限

&nbsp; if (payload ? 'customer\_phone' or payload ? 'customer\_email' or payload ? 'address' or payload ? 'budget') then

&nbsp;   if not iwish.has\_permission(v\_actor, 'leads.fields.write\_sensitive') then

&nbsp;     raise exception 'ERR\_FIELD\_FORBIDDEN:write\_sensitive\_required';

&nbsp;   end if;

&nbsp; end if;



&nbsp; insert into public.leads(

&nbsp;   team\_id, owner\_id, created\_by,

&nbsp;   name, source, stage, status,

&nbsp;   customer\_name, customer\_phone, customer\_email, address, budget,

&nbsp;   internal\_score, blacklist\_reason, last\_contact\_at

&nbsp; ) values (

&nbsp;   v\_team\_id,

&nbsp;   v\_owner,

&nbsp;   v\_actor,

&nbsp;   payload->>'name',

&nbsp;   payload->>'source',

&nbsp;   coalesce(payload->>'stage','new'),

&nbsp;   coalesce(payload->>'status','open'),

&nbsp;   payload->>'customer\_name',

&nbsp;   payload->>'customer\_phone',

&nbsp;   payload->>'customer\_email',

&nbsp;   payload->>'address',

&nbsp;   (payload->>'budget')::numeric,

&nbsp;   (payload->>'internal\_score')::int,

&nbsp;   payload->>'blacklist\_reason',

&nbsp;   (payload->>'last\_contact\_at')::timestamptz

&nbsp; )

&nbsp; returning id into v\_id;



&nbsp; perform iwish.audit(v\_actor, 'create\_lead', 'lead', v\_id::text, null, (select to\_jsonb(l.\*) from public.leads l where l.id = v\_id), null);

&nbsp; return v\_id;

end $$;

```



\#### 14.3.3 rpc\_lead\_update(lead\_id, patch jsonb) -> void（逐字段校验）



patch 示例：



```json

{

&nbsp; "stage": "qualified",

&nbsp; "customer\_phone": "xxxxx",

&nbsp; "internal\_score": 80

}

```



```sql

create or replace function iwish.rpc\_lead\_update(p\_lead\_id uuid, patch jsonb)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_before jsonb;

&nbsp; v\_lead public.leads;

&nbsp; k text;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'leads.update') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:leads.update';

&nbsp; end if;



&nbsp; select \* into v\_lead from public.leads where id = p\_lead\_id;

&nbsp; if v\_lead.id is null then

&nbsp;   raise exception 'ERR\_NOT\_FOUND:lead';

&nbsp; end if;



&nbsp; if not iwish.in\_scope\_for\_lead(v\_actor, v\_lead, 'leads.update') then

&nbsp;   raise exception 'ERR\_OUT\_OF\_SCOPE:leads.update';

&nbsp; end if;



&nbsp; v\_before := to\_jsonb(v\_lead.\*);



&nbsp; -- 字段级写校验（逐字段）

&nbsp; for k in select jsonb\_object\_keys(patch)

&nbsp; loop

&nbsp;   -- 归属字段禁止走 update（必须走 assign/transfer RPC）

&nbsp;   if k in ('owner\_id','team\_id','created\_by') then

&nbsp;     raise exception 'ERR\_FIELD\_FORBIDDEN:use\_assign\_or\_transfer';

&nbsp;   end if;



&nbsp;   if k in ('customer\_phone','customer\_email','address','budget') then

&nbsp;     if not iwish.has\_permission(v\_actor, 'leads.fields.write\_sensitive') then

&nbsp;       raise exception 'ERR\_FIELD\_FORBIDDEN:leads.fields.write\_sensitive';

&nbsp;     end if;

&nbsp;   end if;



&nbsp;   if k in ('internal\_score','blacklist\_reason') then

&nbsp;     if not iwish.has\_permission(v\_actor, 'leads.fields.write\_internal') then

&nbsp;       raise exception 'ERR\_FIELD\_FORBIDDEN:leads.fields.write\_internal';

&nbsp;     end if;

&nbsp;   end if;

&nbsp; end loop;



&nbsp; -- 执行更新（列出允许被 patch 的字段集合）

&nbsp; update public.leads

&nbsp; set

&nbsp;   name = coalesce(patch->>'name', name),

&nbsp;   source = coalesce(patch->>'source', source),

&nbsp;   stage = coalesce(patch->>'stage', stage),

&nbsp;   status = coalesce(patch->>'status', status),

&nbsp;   customer\_name = coalesce(patch->>'customer\_name', customer\_name),



&nbsp;   customer\_phone = coalesce(patch->>'customer\_phone', customer\_phone),

&nbsp;   customer\_email = coalesce(patch->>'customer\_email', customer\_email),

&nbsp;   address = coalesce(patch->>'address', address),

&nbsp;   budget = coalesce((patch->>'budget')::numeric, budget),



&nbsp;   internal\_score = coalesce((patch->>'internal\_score')::int, internal\_score),

&nbsp;   blacklist\_reason = coalesce(patch->>'blacklist\_reason', blacklist\_reason),



&nbsp;   last\_contact\_at = coalesce((patch->>'last\_contact\_at')::timestamptz, last\_contact\_at)

&nbsp; where id = p\_lead\_id;



&nbsp; perform iwish.audit(v\_actor, 'update\_lead', 'lead', p\_lead\_id::text, v\_before, (select to\_jsonb(l.\*) from public.leads l where l.id = p\_lead\_id), null);

end $$;

```



\#### 14.3.4 rpc\_lead\_assign / rpc\_lead\_transfer



```sql

create or replace function iwish.rpc\_lead\_assign(p\_lead\_id uuid, p\_new\_owner uuid)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_lead public.leads;

&nbsp; v\_before jsonb;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'leads.assign') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:leads.assign';

&nbsp; end if;



&nbsp; select \* into v\_lead from public.leads where id = p\_lead\_id;

&nbsp; if v\_lead.id is null then raise exception 'ERR\_NOT\_FOUND:lead'; end if;



&nbsp; -- assign 通常要求在 leads.assign 的 scope 内

&nbsp; if not iwish.in\_scope\_for\_lead(v\_actor, v\_lead, 'leads.assign') then

&nbsp;   raise exception 'ERR\_OUT\_OF\_SCOPE:leads.assign';

&nbsp; end if;



&nbsp; v\_before := to\_jsonb(v\_lead.\*);



&nbsp; update public.leads set owner\_id = p\_new\_owner where id = p\_lead\_id;



&nbsp; perform iwish.audit(v\_actor, 'assign\_lead', 'lead', p\_lead\_id::text, v\_before, (select to\_jsonb(l.\*) from public.leads l where l.id = p\_lead\_id), null);

end $$;



create or replace function iwish.rpc\_lead\_transfer(p\_lead\_id uuid, p\_new\_team\_id int, p\_new\_owner uuid)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_lead public.leads;

&nbsp; v\_before jsonb;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'leads.transfer') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:leads.transfer';

&nbsp; end if;



&nbsp; select \* into v\_lead from public.leads where id = p\_lead\_id;

&nbsp; if v\_lead.id is null then raise exception 'ERR\_NOT\_FOUND:lead'; end if;



&nbsp; if not iwish.in\_scope\_for\_lead(v\_actor, v\_lead, 'leads.transfer') then

&nbsp;   raise exception 'ERR\_OUT\_OF\_SCOPE:leads.transfer';

&nbsp; end if;



&nbsp; v\_before := to\_jsonb(v\_lead.\*);



&nbsp; update public.leads

&nbsp; set team\_id = p\_new\_team\_id,

&nbsp;     owner\_id = p\_new\_owner

&nbsp; where id = p\_lead\_id;



&nbsp; perform iwish.audit(v\_actor, 'transfer\_lead', 'lead', p\_lead\_id::text, v\_before, (select to\_jsonb(l.\*) from public.leads l where l.id = p\_lead\_id), null);

end $$;

```



\#### 14.3.5 rpc\_lead\_close



```sql

create or replace function iwish.rpc\_lead\_close(p\_lead\_id uuid, p\_result text, p\_reason text)

returns void

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

&nbsp; v\_lead public.leads;

&nbsp; v\_before jsonb;

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'leads.close') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:leads.close';

&nbsp; end if;



&nbsp; select \* into v\_lead from public.leads where id = p\_lead\_id;

&nbsp; if v\_lead.id is null then raise exception 'ERR\_NOT\_FOUND:lead'; end if;



&nbsp; if not iwish.in\_scope\_for\_lead(v\_actor, v\_lead, 'leads.close') then

&nbsp;   raise exception 'ERR\_OUT\_OF\_SCOPE:leads.close';

&nbsp; end if;



&nbsp; if p\_result not in ('won','lost') then

&nbsp;   raise exception 'ERR\_VALIDATION:close\_result\_must\_be\_won\_or\_lost';

&nbsp; end if;



&nbsp; v\_before := to\_jsonb(v\_lead.\*);



&nbsp; update public.leads

&nbsp; set status = 'closed',

&nbsp;     close\_result = p\_result,

&nbsp;     close\_reason = p\_reason

&nbsp; where id = p\_lead\_id;



&nbsp; perform iwish.audit(v\_actor, 'close\_lead', 'lead', p\_lead\_id::text, v\_before, (select to\_jsonb(l.\*) from public.leads l where l.id = p\_lead\_id), p\_reason);

end $$;

```



\#### 14.3.6 rpc\_permissions\_preview（有效权限预览）



```sql

create or replace function iwish.rpc\_permissions\_preview(p\_user\_id uuid)

returns jsonb

language plpgsql

security definer

set search\_path = public, iwish

as $$

declare

&nbsp; v\_actor uuid := auth.uid();

begin

&nbsp; if not iwish.has\_permission(v\_actor, 'profiles.manage') then

&nbsp;   raise exception 'ERR\_NO\_PERMISSION:profiles.manage';

&nbsp; end if;



&nbsp; return jsonb\_build\_object(

&nbsp;   'user\_id', p\_user\_id,

&nbsp;   'role\_id', (select role\_id from public.profiles where id = p\_user\_id),

&nbsp;   'permissions', (

&nbsp;     select jsonb\_agg(

&nbsp;       jsonb\_build\_object(

&nbsp;         'key', p.key,

&nbsp;         'allowed', iwish.has\_permission(p\_user\_id, p.key),

&nbsp;         'scope', iwish.get\_effective\_scope(p\_user\_id, p.key)

&nbsp;       )

&nbsp;     )

&nbsp;     from public.permissions p

&nbsp;     where p.is\_enabled = true

&nbsp;   )

&nbsp; );

end $$;

```



---



\## 15. 权限点目录与初始化种子数据（可直接执行）



\### 15.1 权限点清单（最小可用集合）



> 可按需扩展，但建议先按以下落地。



\*\*Leads\*\*



\* `leads.read`, `leads.create`, `leads.update`, `leads.delete`

\* `leads.assign`, `leads.transfer`, `leads.close`

\* `leads.export`, `leads.import`

\* `leads.bulk\_update`, `leads.bulk\_assign`, `leads.bulk\_transfer`

\* `leads.fields.read\_sensitive`, `leads.fields.write\_sensitive`

\* `leads.fields.read\_internal`, `leads.fields.write\_internal`



\*\*Notes\*\*



\* `lead\_notes.read`, `lead\_notes.create`, `lead\_notes.update`, `lead\_notes.delete`



\*\*Auth/Profiles/Org\*\*



\* `auth.approve`, `auth.reject`, `auth.disable`, `auth.restore`

\* `profiles.manage`, `profiles.read`, `profiles.read\_private`

\* `teams.manage`, `teams.read`

\* `roles.manage`, `roles.read`



\*\*Permission System\*\*



\* `permissions.read`, `permissions.manage`

\* `role\_permissions.manage`, `user\_permissions.manage`

\* `field\_policies.manage`, `scopes.manage`



\*\*Settings / Reports / Audit\*\*



\* `settings.read`

\* `settings.pipeline.manage`, `settings.security.manage`, `settings.ui.manage`, `settings.integrations.manage`

\* `reports.read`, `reports.export`

\* `audit.read`



\### 15.2 插入 permissions（示例 SQL）



```sql

-- 简化插入：你可把下面 values 按实际清单补齐

insert into public.permissions(key, resource, action, name, description, is\_system, is\_enabled)

values

('leads.read','leads','read','Read Leads','View leads in allowed scope',true,true),

('leads.create','leads','create','Create Lead','Create leads',true,true),

('leads.update','leads','update','Update Lead','Update leads in allowed scope',true,true),

('leads.assign','leads','assign','Assign Lead','Assign owner within scope',true,true),

('leads.transfer','leads','transfer','Transfer Lead','Transfer across teams/owners',true,true),

('leads.close','leads','close','Close Lead','Close as won/lost',true,true),

('leads.fields.read\_sensitive','leads','fields.read\_sensitive','Read Sensitive Fields','Read phone/email/budget',true,true),

('leads.fields.write\_sensitive','leads','fields.write\_sensitive','Write Sensitive Fields','Write phone/email/budget',true,true),

('auth.approve','auth','approve','Approve User','Approve pending user',true,true),

('profiles.manage','profiles','manage','Manage Users','Manage profiles and assignments',true,true),

('role\_permissions.manage','roles','permissions.manage','Manage Role Permissions','Edit role permission matrix',true,true),

('user\_permissions.manage','profiles','user\_permissions.manage','Manage User Overrides','Grant/deny user permissions',true,true),

('audit.read','audit','read','Read Audit Logs','View audit logs',true,true)

on conflict (key) do nothing;

```



\### 15.3 默认角色与 role\_permissions 种子（建议）



> 角色：Sales / Manager / Admin / Super Admin



```sql

insert into public.roles(name, description, is\_system, is\_active)

values

('Sales','Sales representative',true,true),

('Manager','Team manager',true,true),

('Admin','System admin',true,true),

('SuperAdmin','Super administrator',true,true)

on conflict (name) do nothing;



-- 获取 role\_id（示例：用子查询）

-- Sales

insert into public.role\_permissions(role\_id, permission\_key, effect, scope\_type)

select r.id, p.key, 'allow', 'self'

from public.roles r

join public.permissions p on p.key in ('leads.read','leads.create','leads.update','leads.close','lead\_notes.read','lead\_notes.create')

where r.name='Sales'

on conflict do nothing;



-- Manager（team）

insert into public.role\_permissions(role\_id, permission\_key, effect, scope\_type)

select r.id, p.key, 'allow', 'team'

from public.roles r

join public.permissions p on p.key in ('leads.read','leads.update','leads.close','leads.assign','lead\_notes.read','lead\_notes.create','reports.read')

where r.name='Manager'

on conflict do nothing;



-- Admin（org）

insert into public.role\_permissions(role\_id, permission\_key, effect, scope\_type)

select r.id, p.key, 'allow', 'org'

from public.roles r

join public.permissions p on p.key in ('leads.read','leads.create','leads.update','leads.assign','leads.transfer','leads.close','leads.export','auth.approve','auth.reject','auth.disable','auth.restore','profiles.manage','teams.manage','audit.read')

where r.name='Admin'

on conflict do nothing;



-- SuperAdmin（org + 权限系统）

insert into public.role\_permissions(role\_id, permission\_key, effect, scope\_type)

select r.id, p.key, 'allow', 'org'

from public.roles r

join public.permissions p on p.key in ('permissions.manage','role\_permissions.manage','user\_permissions.manage','field\_policies.manage','scopes.manage','settings.security.manage','settings.integrations.manage')

where r.name='SuperAdmin'

on conflict do nothing;

```



---



\## 16. 字段策略初始化（field\_policies 种子）



```sql

insert into public.field\_policies(resource, field, read\_permission\_key, write\_permission\_key, mask\_strategy)

values

('leads','customer\_phone','leads.fields.read\_sensitive','leads.fields.write\_sensitive','phone\_mask'),

('leads','customer\_email','leads.fields.read\_sensitive','leads.fields.write\_sensitive','email\_mask'),

('leads','address','leads.fields.read\_sensitive','leads.fields.write\_sensitive','null'),

('leads','budget','leads.fields.read\_sensitive','leads.fields.write\_sensitive','null'),

('leads','internal\_score','leads.fields.read\_internal','leads.fields.write\_internal','null'),

('leads','blacklist\_reason','leads.fields.read\_internal','leads.fields.write\_internal','null')

on conflict (resource, field) do nothing;

```



---



\## 17. Next.js Middleware（准入拦截）实现要点



\### 17.1 行为规范



\* 仅对非 `/auth/\*` 与 `/onboarding/\*` 路由执行拦截

\* 未登录：重定向 `/auth/login`

\* 已登录：读取 profiles.status



&nbsp; \* pending → `/onboarding/pending`

&nbsp; \* disabled → 清 session → `/onboarding/disabled`

&nbsp; \* rejected → `/onboarding/rejected`

&nbsp; \* active → 放行



\### 17.2 伪代码（工程实现参考）



> 说明：在 Edge Middleware 中直接查询数据库可能有性能成本。可使用 Supabase SSR 包在 middleware 获取 session，并调用一个轻量接口读取 status（例如 `/api/me/status`），或短 TTL 缓存。以下为概念级伪代码：



```ts

// middleware.ts（示意）

import { NextResponse } from "next/server";



const PUBLIC\_PATHS = \["/auth", "/onboarding", "/\_next", "/favicon.ico"];



export async function middleware(req) {

&nbsp; const { pathname } = req.nextUrl;

&nbsp; if (PUBLIC\_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();



&nbsp; // 1) 判断 session（用 supabase SSR）

&nbsp; const session = await getSession(req);

&nbsp; if (!session) return NextResponse.redirect(new URL("/auth/login", req.url));



&nbsp; // 2) 获取 profile status（请求 profiles 表或调用 /api/me/status）

&nbsp; const status = await getProfileStatus(session.user.id);

&nbsp; if (status === "pending") return NextResponse.redirect(new URL("/onboarding/pending", req.url));

&nbsp; if (status === "disabled") {

&nbsp;   await signOut(session);

&nbsp;   return NextResponse.redirect(new URL("/onboarding/disabled", req.url));

&nbsp; }

&nbsp; if (status === "rejected") return NextResponse.redirect(new URL("/onboarding/rejected", req.url));



&nbsp; return NextResponse.next();

}

```



---



\## 18. 管理后台（必须具备的配置能力）



\### 18.1 待审核列表（Pending Requests）



\* 数据来源：profiles where status='pending'

\* 操作：Approve（必选 team+role）、Reject（必填 reason）



\### 18.2 角色权限矩阵（Role Permissions）



\* 行：permissions.key

\* 列：Allow / Deny / Unset

\* Scope：self/team/org/custom

\* Custom：绑定 scope\_set（下拉选择）或配置 rule（JSON）



\### 18.3 用户覆盖权限（User Overrides）



\* 支持 allow/deny

\* 支持 expires\_at

\* 必填 reason

\* 提供“有效权限预览”（调用 `rpc\_permissions\_preview`）



\### 18.4 字段策略管理（Field Policies）



\* 配置字段读写权限 key 与脱敏策略

\* 变更实时生效（不需要发版）



\### 18.5 审计日志（Audit）



\* 可按 actor/action/target/time 筛选

\* 导出（可选，需权限）



---



\## 19. 验收标准（Acceptance Criteria）



\### 19.1 准入



\* 新用户注册后 profiles 自动插入，status=pending

\* pending 用户无法读取 leads/teams/settings 等业务数据（直连 API 也失败）

\* 管理员 approve 后，用户 status=active 且 role/team 生效

\* disabled/rejected 登录后被重定向 onboarding 页面且无法读业务数据



\### 19.2 权限（动作级 + 范围级）



\* 将某角色 `leads.read` scope 从 team 改为 self，权限立即生效，用户只能看到自身 lead

\* 禁用 `leads.export` 后导出 RPC 被拒绝（后端拒绝）



\### 19.3 字段级



\* 未授予 `leads.fields.read\_sensitive`：在 `leads\_secure\_view` 中电话/邮箱脱敏，预算为空

\* 未授予 `leads.fields.write\_sensitive`：通过 `rpc\_lead\_update` 修改电话/预算被拒绝，但改 stage 成功



\### 19.4 审计



\* approve/reject/disable/restore、assign/transfer、update（含敏感字段）、close 必须写 audit\_logs



---



\## 20. 风险与对策



\* RLS/函数性能：避免在 RLS 内写复杂 join；尽量在 leads 表保留 team\_id；必要时加索引与缓存。

\* 权限系统复杂：提供权限预览、强制审计、减少 key 频繁变更、优先用 scope sets。

\* 字段级控制：必须通过 secure view + RPC 写校验，前端隐藏不算安全。



---



\## 21. 里程碑（建议）



\* M1：Auth + profiles 生命周期 + Pending 审批 + 基础 leads RLS

\* M2：Leads 列表/详情/创建/更新 + Notes + 审计

\* M3：权限系统（permissions/role/user/scope/field policies）+ 配置后台

\* M4：导出/批量/报表 + Cloudflare 安全增强 + 性能优化



---



\## 22. 交付物清单（工程侧）



\* Supabase SQL：DDL（表/类型/索引）、触发器、函数、RLS policies、视图、RPC

\* Next.js：路由与 Middleware、Auth 页面、Onboarding 页面、Leads 页面、Settings/Organization 页面

\* 管理后台：权限矩阵、用户覆盖权限、字段策略、scope sets、审计日志

\* 测试用例：准入、RLS、权限范围、字段级读写、审计覆盖



---



> 以上即为“完整可直接开干”的 PRD。工程团队可按顺序执行：DDL → Trigger/Functions → RLS → Views → RPC → 前端 Middleware/页面 → 管理后台配置 → 验收用例。



