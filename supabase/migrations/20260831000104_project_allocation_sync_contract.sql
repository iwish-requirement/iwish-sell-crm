-- Keep CRM allocation fully usable today while reserving a safe integration seam
-- for the optimizer application and IWish Auth project context.

alter table public.lead_project_assignments
  add column if not exists allocation_source text not null default 'crm_manual',
  add column if not exists sync_status text not null default 'not_connected',
  add column if not exists external_assignment_id text,
  add column if not exists sync_version integer not null default 1,
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_error text,
  add column if not exists idempotency_key uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lead_project_assignments_allocation_source_valid'
      and conrelid = 'public.lead_project_assignments'::regclass
  ) then
    alter table public.lead_project_assignments
      add constraint lead_project_assignments_allocation_source_valid
      check (allocation_source in ('crm_manual', 'optimizer_sync', 'legacy'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lead_project_assignments_sync_status_valid'
      and conrelid = 'public.lead_project_assignments'::regclass
  ) then
    alter table public.lead_project_assignments
      add constraint lead_project_assignments_sync_status_valid
      check (sync_status in ('not_connected', 'pending', 'submitted', 'accepted', 'rejected', 'synced', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lead_project_assignments_sync_version_valid'
      and conrelid = 'public.lead_project_assignments'::regclass
  ) then
    alter table public.lead_project_assignments
      add constraint lead_project_assignments_sync_version_valid
      check (sync_version >= 1);
  end if;
end $$;

create unique index if not exists lead_project_assignments_idempotency_key_uidx
  on public.lead_project_assignments(idempotency_key);

comment on column public.lead_project_assignments.sync_status is
  'Optimizer-system handoff state. not_connected keeps CRM independent until the downstream app is available.';
comment on column public.lead_project_assignments.external_assignment_id is
  'Opaque assignment ID returned by the optimizer system; never used as a CRM authorization key.';
comment on column public.lead_project_assignments.idempotency_key is
  'Stable key for a future cross-system handoff; generated locally so retries are safe.';

-- Rebuild the read RPC with the integration fields appended to preserve the
-- existing column order for old clients.
drop function if exists public.rpc_project_allocations_list();
drop function if exists iwish.rpc_project_allocations_list();

create function iwish.rpc_project_allocations_list()
returns table (
  id uuid, lead_id uuid, company_name text, customer_name text, website text,
  source text, budget numeric, closed_at timestamptz, allocation_status text,
  categories jsonb, sales_owner_name text, department_team_id int, department_name text,
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
  sync_version integer, last_synced_at timestamptz, sync_error text, idempotency_key uuid
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
    coalesce((select jsonb_agg(jsonb_build_object('id',bc.id,'name',bc.name) order by bc.sort_order)
      from public.leads_business_categories lbc join public.business_categories bc on bc.id=lbc.category_id and bc.is_active
      where lbc.lead_id=l.id),'[]'::jsonb),
    sales.full_name, a.department_team_id, t.name,
    a.project_manager_id, pm.full_name, a.google_optimizer_id, gop.full_name,
    a.meta_optimizer_id, mop.full_name, a.criteo_optimizer_id, cop.full_name,
    a.bing_optimizer_id, bop.full_name, a.edm_optimizer_id, eop.full_name,
    a.influencer_marketing_id, iop.full_name, a.note, a.detail_link, a.assigned_at,
    coalesce(a.platforms, '{}'::text[]),
    coalesce(a.google_optimizer_ids, case when a.google_optimizer_id is null then '{}'::uuid[] else array[a.google_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id = any(coalesce(a.google_optimizer_ids, case when a.google_optimizer_id is null then '{}'::uuid[] else array[a.google_optimizer_id] end))), '{}'::text[]),
    coalesce(a.meta_optimizer_ids, case when a.meta_optimizer_id is null then '{}'::uuid[] else array[a.meta_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id = any(coalesce(a.meta_optimizer_ids, case when a.meta_optimizer_id is null then '{}'::uuid[] else array[a.meta_optimizer_id] end))), '{}'::text[]),
    coalesce(a.criteo_optimizer_ids, case when a.criteo_optimizer_id is null then '{}'::uuid[] else array[a.criteo_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id = any(coalesce(a.criteo_optimizer_ids, case when a.criteo_optimizer_id is null then '{}'::uuid[] else array[a.criteo_optimizer_id] end))), '{}'::text[]),
    coalesce(a.bing_optimizer_ids, case when a.bing_optimizer_id is null then '{}'::uuid[] else array[a.bing_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id = any(coalesce(a.bing_optimizer_ids, case when a.bing_optimizer_id is null then '{}'::uuid[] else array[a.bing_optimizer_id] end))), '{}'::text[]),
    coalesce(a.edm_optimizer_ids, case when a.edm_optimizer_id is null then '{}'::uuid[] else array[a.edm_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id = any(coalesce(a.edm_optimizer_ids, case when a.edm_optimizer_id is null then '{}'::uuid[] else array[a.edm_optimizer_id] end))), '{}'::text[]),
    coalesce(a.influencer_marketing_ids, case when a.influencer_marketing_id is null then '{}'::uuid[] else array[a.influencer_marketing_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id = any(coalesce(a.influencer_marketing_ids, case when a.influencer_marketing_id is null then '{}'::uuid[] else array[a.influencer_marketing_id] end))), '{}'::text[]),
    coalesce(a.allocation_source, 'legacy'), coalesce(a.sync_status, 'not_connected'),
    a.external_assignment_id, coalesce(a.sync_version, 1), a.last_synced_at, a.sync_error, a.idempotency_key
  from public.leads l
  left join public.contracts c on c.lead_id=l.id
  left join public.lead_project_assignments a on a.lead_id=l.id
  left join public.teams t on t.id=a.department_team_id
  left join public.profiles sales on sales.id=l.owner_id
  left join public.profiles pm on pm.id=a.project_manager_id
  left join public.profiles goP on goP.id=a.google_optimizer_id
  left join public.profiles moP on moP.id=a.meta_optimizer_id
  left join public.profiles coP on coP.id=a.criteo_optimizer_id
  left join public.profiles boP on boP.id=a.bing_optimizer_id
  left join public.profiles eoP on eoP.id=a.edm_optimizer_id
  left join public.profiles ioP on ioP.id=a.influencer_marketing_id
  where coalesce(l.is_deleted,false)=false
    and l.status='closed' and l.close_result in ('won','成交')
    and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
  order by l.updated_at desc;
end $$;

create function public.rpc_project_allocations_list()
returns table (
  id uuid, lead_id uuid, company_name text, customer_name text, website text,
  source text, budget numeric, closed_at timestamptz, allocation_status text,
  categories jsonb, sales_owner_name text, department_team_id int, department_name text,
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
  sync_version integer, last_synced_at timestamptz, sync_error text, idempotency_key uuid
)
language sql security definer set search_path=public,iwish
as $$ select * from iwish.rpc_project_allocations_list(); $$;
grant execute on function public.rpc_project_allocations_list() to authenticated;

-- Keep existing clients and the new UI on the same protected mutation path.
create or replace function iwish.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_platforms text[] default '{}', p_google_optimizer_ids uuid[] default '{}', p_meta_optimizer_ids uuid[] default '{}',
  p_criteo_optimizer_ids uuid[] default '{}', p_bing_optimizer_ids uuid[] default '{}', p_edm_optimizer_ids uuid[] default '{}',
  p_influencer_marketing_ids uuid[] default '{}', p_note text default null, p_detail_link text default null
) returns void language plpgsql security definer set search_path=public,iwish as $$
declare v_actor uuid:=auth.uid(); v_lead public.leads; v_before jsonb;
  v_platforms text[] := coalesce(array(select distinct trim(x) from unnest(coalesce(p_platforms,'{}')) x where trim(x) <> ''), '{}');
  v_google uuid[] := coalesce(p_google_optimizer_ids,'{}'); v_meta uuid[] := coalesce(p_meta_optimizer_ids,'{}');
  v_criteo uuid[] := coalesce(p_criteo_optimizer_ids,'{}'); v_bing uuid[] := coalesce(p_bing_optimizer_ids,'{}');
  v_edm uuid[] := coalesce(p_edm_optimizer_ids,'{}'); v_influencer uuid[] := coalesce(p_influencer_marketing_ids,'{}');
begin
  if not iwish.has_permission(v_actor,'allocations.manage') then raise exception 'ERR_NO_PERMISSION:allocations.manage'; end if;
  select * into v_lead from public.leads where id=p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'allocations.manage') then raise exception 'ERR_OUT_OF_SCOPE:allocations.manage'; end if;
  if v_lead.status <> 'closed' or v_lead.close_result not in ('won','成交') then raise exception 'ERR_VALIDATION:allocation_requires_won_deal'; end if;
  if p_department_team_id is null or p_project_manager_id is null then raise exception 'ERR_VALIDATION:allocation_required_fields'; end if;
  if not exists (select 1 from public.teams where id=p_department_team_id and is_active) then raise exception 'ERR_VALIDATION:invalid_project_team'; end if;
  if not exists (select 1 from public.profiles where id=p_project_manager_id and status='active') then raise exception 'ERR_VALIDATION:invalid_project_manager'; end if;
  if exists (select 1 from public.profiles where id = any(v_google || v_meta || v_criteo || v_bing || v_edm || v_influencer) and status <> 'active')
     or exists (select 1 from unnest(v_google || v_meta || v_criteo || v_bing || v_edm || v_influencer) x(id) left join public.profiles p on p.id=x.id where p.id is null)
  then raise exception 'ERR_VALIDATION:invalid_optimizer'; end if;
  v_before := (select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id);
  insert into public.lead_project_assignments(lead_id,department_team_id,project_manager_id,platforms,google_optimizer_ids,meta_optimizer_ids,criteo_optimizer_ids,bing_optimizer_ids,edm_optimizer_ids,influencer_marketing_ids,google_optimizer_id,meta_optimizer_id,criteo_optimizer_id,bing_optimizer_id,edm_optimizer_id,influencer_marketing_id,note,detail_link,assigned_by,assigned_at,allocation_source,sync_status,sync_version,idempotency_key)
  values(p_lead_id,p_department_team_id,p_project_manager_id,v_platforms,v_google,v_meta,v_criteo,v_bing,v_edm,v_influencer,v_google[1],v_meta[1],v_criteo[1],v_bing[1],v_edm[1],v_influencer[1],nullif(trim(p_note),''),nullif(trim(p_detail_link),''),v_actor,now(),'crm_manual','not_connected',1,gen_random_uuid())
  on conflict(lead_id) do update set department_team_id=excluded.department_team_id,project_manager_id=excluded.project_manager_id,platforms=excluded.platforms,google_optimizer_ids=excluded.google_optimizer_ids,meta_optimizer_ids=excluded.meta_optimizer_ids,criteo_optimizer_ids=excluded.criteo_optimizer_ids,bing_optimizer_ids=excluded.bing_optimizer_ids,edm_optimizer_ids=excluded.edm_optimizer_ids,influencer_marketing_ids=excluded.influencer_marketing_ids,google_optimizer_id=excluded.google_optimizer_id,meta_optimizer_id=excluded.meta_optimizer_id,criteo_optimizer_id=excluded.criteo_optimizer_id,bing_optimizer_id=excluded.bing_optimizer_id,edm_optimizer_id=excluded.edm_optimizer_id,influencer_marketing_id=excluded.influencer_marketing_id,note=excluded.note,detail_link=excluded.detail_link,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at,allocation_source='crm_manual',sync_status=case when public.lead_project_assignments.sync_status='not_connected' then 'not_connected' else 'pending' end,external_assignment_id=null,last_synced_at=null,sync_error=null,sync_version=public.lead_project_assignments.sync_version+1;
  update public.leads set allocation_status='assigned' where id=p_lead_id;
  perform iwish.audit(v_actor,'assign_project_group','lead',p_lead_id::text,v_before,(select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id),null);
end $$;

create or replace function public.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_platforms text[] default '{}', p_google_optimizer_ids uuid[] default '{}', p_meta_optimizer_ids uuid[] default '{}',
  p_criteo_optimizer_ids uuid[] default '{}', p_bing_optimizer_ids uuid[] default '{}', p_edm_optimizer_ids uuid[] default '{}',
  p_influencer_marketing_ids uuid[] default '{}', p_note text default null, p_detail_link text default null
) returns void language sql security definer set search_path=public,iwish
as $$ select iwish.rpc_project_allocation_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12); $$;
grant execute on function public.rpc_project_allocation_upsert(uuid,int,uuid,text[],uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],text,text) to authenticated;
