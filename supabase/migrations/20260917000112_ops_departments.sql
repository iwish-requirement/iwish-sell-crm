-- Departments come from the Feishu org structure (ops_departments), replacing
-- the sales-oriented teams table in the allocation center. Project managers
-- are then picked from members belonging to the selected department subtree.

create table if not exists public.ops_departments (
  id uuid primary key default gen_random_uuid(),
  feishu_department_id text not null unique,
  name text not null,
  parent_feishu_department_id text,
  is_active boolean not null default true,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_departments_active_name_idx on public.ops_departments(is_active, name);

create trigger trg_ops_departments_updated_at
before update on public.ops_departments
for each row execute function iwish.set_updated_at();

alter table public.ops_departments enable row level security;
drop policy if exists ops_departments_select on public.ops_departments;
create policy ops_departments_select on public.ops_departments
for select using (iwish.is_active_user(auth.uid()));
-- Writes happen only through the service role (directory sync).

alter table public.ops_members add column if not exists department_ids text[] not null default '{}';

-- The assignment queue is empty, so the department foreign key can switch
-- freely from teams (int) to ops_departments (uuid).
alter table public.lead_project_assignments
  drop column if exists department_team_id,
  add column if not exists department_id uuid not null references public.ops_departments(id) on delete restrict;

-- Drop the legacy single-optimizer overload (forwards an int team id).
drop function if exists public.rpc_project_allocation_upsert(uuid, int, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text);
drop function if exists iwish.rpc_project_allocation_upsert(uuid, int, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text);

-- Read RPC: department resolves from ops_departments.
drop function if exists public.rpc_project_allocations_list();
drop function if exists iwish.rpc_project_allocations_list();

create function iwish.rpc_project_allocations_list()
returns table (
  id uuid, lead_id uuid, company_name text, customer_name text, website text,
  source text, budget numeric, closed_at timestamptz, allocation_status text,
  categories jsonb, sales_owner_name text, department_id uuid, department_name text,
  project_manager_id uuid, project_manager_name text, google_optimizer_id uuid,
  google_optimizer_name text, meta_optimizer_id uuid, meta_optimizer_name text,
  criteo_optimizer_id uuid, criteo_optimizer_name text, bing_optimizer_id uuid,
  bing_optimizer_name text, edm_optimizer_id uuid, edm_optimizer_name text,
  influencer_marketing_id uuid, influencer_marketing_name text, note text, detail_link text,
  assigned_at timestamptz, platforms text[], google_optimizer_ids uuid[], google_optimizer_names text[],
  meta_optimizer_ids uuid[], meta_optimizer_names text[], criteo_optimizer_ids uuid[], criteo_optimizer_names text[],
  bing_optimizer_ids uuid[], bing_optimizer_names text[], edm_optimizer_ids uuid[], edm_optimizer_names text[],
  influencer_marketing_ids uuid[], influencer_marketing_names text[],
  allocation_source text, sync_status text, external_assignment_id text,
  sync_version integer, last_synced_at timestamptz, sync_error text, idempotency_key uuid,
  confirmed_at timestamptz
)
language plpgsql security definer set search_path = public, iwish
as $$
begin
  if not iwish.has_permission(auth.uid(), 'allocations.read') then
    raise exception 'ERR_NO_PERMISSION:allocations.read';
  end if;
  return query
  select a.id, l.id, l.name, l.customer_name, l.website, l.source, l.budget,
    coalesce(c.signed_at,l.updated_at), coalesce(l.allocation_status,'pending'),
    coalesce((select jsonb_agg(json_build_object('id',bc.id,'name',bc.name) order by bc.sort_order)
      from public.leads_business_categories lbc join public.business_categories bc on bc.id=lbc.category_id and bc.is_active
      where lbc.lead_id=l.id),'[]'::jsonb),
    sales.full_name, a.department_id, d.name,
    a.project_manager_id, pm.full_name, a.google_optimizer_id, gop.full_name,
    a.meta_optimizer_id, mop.full_name, a.criteo_optimizer_id, cop.full_name,
    a.bing_optimizer_id, bop.full_name, a.edm_optimizer_id, eop.full_name,
    a.influencer_marketing_id, iop.full_name, a.note, a.detail_link, a.assigned_at,
    coalesce(a.platforms, '{}'::text[]),
    coalesce(a.google_optimizer_ids, case when a.google_optimizer_id is null then '{}'::uuid[] else array[a.google_optimizer_id] end),
    coalesce((select array_agg(om.full_name order by om.full_name) from public.ops_members om where om.id = any(coalesce(a.google_optimizer_ids, case when a.google_optimizer_id is null then '{}'::uuid[] else array[a.google_optimizer_id] end))), '{}'::text[]),
    coalesce(a.meta_optimizer_ids, case when a.meta_optimizer_id is null then '{}'::uuid[] else array[a.meta_optimizer_id] end),
    coalesce((select array_agg(om.full_name order by om.full_name) from public.ops_members om where om.id = any(coalesce(a.meta_optimizer_ids, case when a.meta_optimizer_id is null then '{}'::uuid[] else array[a.meta_optimizer_id] end))), '{}'::text[]),
    coalesce(a.criteo_optimizer_ids, case when a.criteo_optimizer_id is null then '{}'::uuid[] else array[a.criteo_optimizer_id] end),
    coalesce((select array_agg(om.full_name order by om.full_name) from public.ops_members om where om.id = any(coalesce(a.criteo_optimizer_ids, case when a.criteo_optimizer_id is null then '{}'::uuid[] else array[a.criteo_optimizer_id] end))), '{}'::text[]),
    coalesce(a.bing_optimizer_ids, case when a.bing_optimizer_id is null then '{}'::uuid[] else array[a.bing_optimizer_id] end),
    coalesce((select array_agg(om.full_name order by om.full_name) from public.ops_members om where om.id = any(coalesce(a.bing_optimizer_ids, case when a.bing_optimizer_id is null then '{}'::uuid[] else array[a.bing_optimizer_id] end))), '{}'::text[]),
    coalesce(a.edm_optimizer_ids, case when a.edm_optimizer_id is null then '{}'::uuid[] else array[a.edm_optimizer_id] end),
    coalesce((select array_agg(om.full_name order by om.full_name) from public.ops_members om where om.id = any(coalesce(a.edm_optimizer_ids, case when a.edm_optimizer_id is null then '{}'::uuid[] else array[a.edm_optimizer_id] end))), '{}'::text[]),
    coalesce(a.influencer_marketing_ids, case when a.influencer_marketing_id is null then '{}'::uuid[] else array[a.influencer_marketing_id] end),
    coalesce((select array_agg(om.full_name order by om.full_name) from public.ops_members om where om.id = any(coalesce(a.influencer_marketing_ids, case when a.influencer_marketing_id is null then '{}'::uuid[] else array[a.influencer_marketing_id] end))), '{}'::text[]),
    coalesce(a.allocation_source, 'legacy'), coalesce(a.sync_status, 'not_connected'),
    a.external_assignment_id, coalesce(a.sync_version, 1), a.last_synced_at, a.sync_error, a.idempotency_key,
    a.confirmed_at
  from public.leads l
  left join public.contracts c on c.lead_id=l.id
  left join public.lead_project_assignments a on a.lead_id=l.id
  left join public.ops_departments d on d.id=a.department_id
  left join public.profiles sales on sales.id=l.owner_id
  left join public.ops_members pm on pm.id=a.project_manager_id
  left join public.ops_members gop on gop.id=a.google_optimizer_id
  left join public.ops_members mop on mop.id=a.meta_optimizer_id
  left join public.ops_members cop on cop.id=a.criteo_optimizer_id
  left join public.ops_members bop on bop.id=a.bing_optimizer_id
  left join public.ops_members eop on eop.id=a.edm_optimizer_id
  left join public.ops_members iop on iop.id=a.influencer_marketing_id
  where coalesce(l.is_deleted,false)=false
    and l.status='closed' and l.close_result in ('won','成交')
    and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
  order by l.updated_at desc;
end $$;

create function public.rpc_project_allocations_list()
returns table (
  id uuid, lead_id uuid, company_name text, customer_name text, website text,
  source text, budget numeric, closed_at timestamptz, allocation_status text,
  categories jsonb, sales_owner_name text, department_id uuid, department_name text,
  project_manager_id uuid, project_manager_name text, google_optimizer_id uuid,
  google_optimizer_name text, meta_optimizer_id uuid, meta_optimizer_name text,
  criteo_optimizer_id uuid, criteo_optimizer_name text, bing_optimizer_id uuid,
  bing_optimizer_name text, edm_optimizer_id uuid, edm_optimizer_name text,
  influencer_marketing_id uuid, influencer_marketing_name text, note text, detail_link text,
  assigned_at timestamptz, platforms text[], google_optimizer_ids uuid[], google_optimizer_names text[],
  meta_optimizer_ids uuid[], meta_optimizer_names text[], criteo_optimizer_ids uuid[], criteo_optimizer_names text[],
  bing_optimizer_ids uuid[], bing_optimizer_names text[], edm_optimizer_ids uuid[], edm_optimizer_names text[],
  influencer_marketing_ids uuid[], influencer_marketing_names text[],
  allocation_source text, sync_status text, external_assignment_id text,
  sync_version integer, last_synced_at timestamptz, sync_error text, idempotency_key uuid,
  confirmed_at timestamptz
)
language sql security definer set search_path=public,iwish
as $$ select * from iwish.rpc_project_allocations_list(); $$;
grant execute on function public.rpc_project_allocations_list() to authenticated;

-- Upsert: department must be an active Feishu department.
create or replace function iwish.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_id uuid, p_project_manager_id uuid,
  p_platforms text[] default '{}', p_google_optimizer_ids uuid[] default '{}', p_meta_optimizer_ids uuid[] default '{}',
  p_criteo_optimizer_ids uuid[] default '{}', p_bing_optimizer_ids uuid[] default '{}', p_edm_optimizer_ids uuid[] default '{}',
  p_influencer_marketing_ids uuid[] default '{}', p_note text default null, p_detail_link text default null,
  p_preserve_team boolean default false
) returns void language plpgsql security definer set search_path=public,iwish as $$
declare v_actor uuid:=auth.uid(); v_lead public.leads; v_before jsonb;
  v_existing public.lead_project_assignments;
  v_platforms text[] := coalesce(array(select distinct trim(x) from unnest(coalesce(p_platforms,'{}')) x where trim(x) <> ''), '{}');
  v_google uuid[] := coalesce(p_google_optimizer_ids,'{}'); v_meta uuid[] := coalesce(p_meta_optimizer_ids,'{}');
  v_criteo uuid[] := coalesce(p_criteo_optimizer_ids,'{}'); v_bing uuid[] := coalesce(p_bing_optimizer_ids,'{}');
  v_edm uuid[] := coalesce(p_edm_optimizer_ids,'{}'); v_influencer uuid[] := coalesce(p_influencer_marketing_ids,'{}');
  v_all uuid[];
begin
  if not iwish.has_permission(v_actor,'allocations.manage') then raise exception 'ERR_NO_PERMISSION:allocations.manage'; end if;
  select * into v_lead from public.leads where id=p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'allocations.manage') then raise exception 'ERR_OUT_OF_SCOPE:allocations.manage'; end if;
  if v_lead.status <> 'closed' or v_lead.close_result not in ('won','成交') then raise exception 'ERR_VALIDATION:allocation_requires_won_deal'; end if;
  if p_department_id is null or p_project_manager_id is null then raise exception 'ERR_VALIDATION:allocation_required_fields'; end if;
  if not exists (select 1 from public.ops_departments where id=p_department_id and is_active) then raise exception 'ERR_VALIDATION:invalid_project_team'; end if;
  if not exists (select 1 from public.ops_members where id=p_project_manager_id and is_active) then raise exception 'ERR_VALIDATION:invalid_project_manager'; end if;

  if p_preserve_team then
    select * into v_existing from public.lead_project_assignments a where a.lead_id=p_lead_id;
    if v_existing.id is not null then
      v_google := coalesce(v_existing.google_optimizer_ids, v_google);
      v_meta := coalesce(v_existing.meta_optimizer_ids, v_meta);
      v_criteo := coalesce(v_existing.criteo_optimizer_ids, v_criteo);
      v_bing := coalesce(v_existing.bing_optimizer_ids, v_bing);
      v_edm := coalesce(v_existing.edm_optimizer_ids, v_edm);
      v_influencer := coalesce(v_existing.influencer_marketing_ids, v_influencer);
    end if;
  end if;

  v_all := v_google || v_meta || v_criteo || v_bing || v_edm || v_influencer;
  if exists (select 1 from public.ops_members where id = any(v_all) and not is_active)
     or exists (select 1 from unnest(v_all) x(id) left join public.ops_members om on om.id=x.id where om.id is null)
  then raise exception 'ERR_VALIDATION:invalid_optimizer'; end if;

  v_before := (select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id);
  insert into public.lead_project_assignments(lead_id,department_id,project_manager_id,platforms,google_optimizer_ids,meta_optimizer_ids,criteo_optimizer_ids,bing_optimizer_ids,edm_optimizer_ids,influencer_marketing_ids,google_optimizer_id,meta_optimizer_id,criteo_optimizer_id,bing_optimizer_id,edm_optimizer_id,influencer_marketing_id,note,detail_link,assigned_by,assigned_at,allocation_source,sync_status,sync_version,idempotency_key,confirmed_at,confirmed_by)
  values(p_lead_id,p_department_id,p_project_manager_id,v_platforms,v_google,v_meta,v_criteo,v_bing,v_edm,v_influencer,v_google[1],v_meta[1],v_criteo[1],v_bing[1],v_edm[1],v_influencer[1],nullif(trim(p_note),''),nullif(trim(p_detail_link),''),v_actor,now(),'crm_manual','not_connected',1,gen_random_uuid(),null,null)
  on conflict(lead_id) do update set
    department_id=excluded.department_id,
    project_manager_id=excluded.project_manager_id,
    platforms=excluded.platforms,
    google_optimizer_ids=excluded.google_optimizer_ids,meta_optimizer_ids=excluded.meta_optimizer_ids,
    criteo_optimizer_ids=excluded.criteo_optimizer_ids,bing_optimizer_ids=excluded.bing_optimizer_ids,
    edm_optimizer_ids=excluded.edm_optimizer_ids,influencer_marketing_ids=excluded.influencer_marketing_ids,
    google_optimizer_id=excluded.google_optimizer_id,meta_optimizer_id=excluded.meta_optimizer_id,
    criteo_optimizer_id=excluded.criteo_optimizer_id,bing_optimizer_id=excluded.bing_optimizer_id,
    edm_optimizer_id=excluded.edm_optimizer_id,influencer_marketing_id=excluded.influencer_marketing_id,
    note=excluded.note,detail_link=excluded.detail_link,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at,
    allocation_source='crm_manual',
    sync_status=case when public.lead_project_assignments.sync_status='not_connected' then 'not_connected' else 'pending' end,
    external_assignment_id=null,last_synced_at=null,sync_error=null,
    sync_version=public.lead_project_assignments.sync_version+1,
    confirmed_at=case
      when p_preserve_team
        and public.lead_project_assignments.project_manager_id = excluded.project_manager_id
        and public.lead_project_assignments.department_id = excluded.department_id
      then public.lead_project_assignments.confirmed_at else null end,
    confirmed_by=case
      when p_preserve_team
        and public.lead_project_assignments.project_manager_id = excluded.project_manager_id
        and public.lead_project_assignments.department_id = excluded.department_id
      then public.lead_project_assignments.confirmed_by else null end;
  update public.leads set allocation_status='assigned' where id=p_lead_id;
  perform iwish.audit(v_actor,'assign_project_group','lead',p_lead_id::text,v_before,(select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id),null);
end $$;

create or replace function public.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_id uuid, p_project_manager_id uuid,
  p_platforms text[] default '{}', p_google_optimizer_ids uuid[] default '{}', p_meta_optimizer_ids uuid[] default '{}',
  p_criteo_optimizer_ids uuid[] default '{}', p_bing_optimizer_ids uuid[] default '{}', p_edm_optimizer_ids uuid[] default '{}',
  p_influencer_marketing_ids uuid[] default '{}', p_note text default null, p_detail_link text default null,
  p_preserve_team boolean default false
) returns void language sql security definer set search_path=public,iwish
as $$ select iwish.rpc_project_allocation_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13); $$;
grant execute on function public.rpc_project_allocation_upsert(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],text,text,boolean) to authenticated;

-- Notify payload: department from ops_departments.
create or replace function public.rpc_allocation_notify_payload(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = public, iwish as $$
declare
  v_actor uuid := auth.uid();
  v_assign public.lead_project_assignments;
  v_lead public.leads;
  v_dept public.ops_departments;
  v_pm public.ops_members;
begin
  if not iwish.has_permission(v_actor, 'allocations.manage') then
    raise exception 'ERR_NO_PERMISSION:allocations.manage';
  end if;
  select * into v_assign from public.lead_project_assignments where lead_id = p_lead_id;
  if v_assign.id is null then raise exception 'ERR_NOT_FOUND:assignment'; end if;
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  select * into v_dept from public.ops_departments where id = v_assign.department_id;
  select * into v_pm from public.ops_members where id = v_assign.project_manager_id;
  return jsonb_build_object(
    'assignment_id', v_assign.id,
    'lead_id', p_lead_id,
    'company_name', v_lead.name,
    'customer_name', v_lead.customer_name,
    'website', v_lead.website,
    'department_name', v_dept.name,
    'platforms', coalesce(v_assign.platforms, '{}'::text[]),
    'note', v_assign.note,
    'detail_link', v_assign.detail_link,
    'pm_open_id', v_pm.feishu_user_id,
    'pm_name', v_pm.full_name,
    'confirmed_at', v_assign.confirmed_at
  );
end $$;
grant execute on function public.rpc_allocation_notify_payload(uuid) to authenticated;
