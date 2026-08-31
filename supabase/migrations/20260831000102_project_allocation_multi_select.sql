-- Allow multiple delivery platforms and multiple optimizers per platform.
-- Keep the original singular columns for backward-compatible reads.

alter table public.lead_project_assignments
  add column if not exists platforms text[] not null default '{}',
  add column if not exists google_optimizer_ids uuid[] not null default '{}',
  add column if not exists meta_optimizer_ids uuid[] not null default '{}',
  add column if not exists criteo_optimizer_ids uuid[] not null default '{}',
  add column if not exists bing_optimizer_ids uuid[] not null default '{}',
  add column if not exists edm_optimizer_ids uuid[] not null default '{}',
  add column if not exists influencer_marketing_ids uuid[] not null default '{}';

update public.lead_project_assignments
set google_optimizer_ids = case when google_optimizer_id is null then '{}'::uuid[] else array[google_optimizer_id] end,
    meta_optimizer_ids = case when meta_optimizer_id is null then '{}'::uuid[] else array[meta_optimizer_id] end,
    criteo_optimizer_ids = case when criteo_optimizer_id is null then '{}'::uuid[] else array[criteo_optimizer_id] end,
    bing_optimizer_ids = case when bing_optimizer_id is null then '{}'::uuid[] else array[bing_optimizer_id] end,
    edm_optimizer_ids = case when edm_optimizer_id is null then '{}'::uuid[] else array[edm_optimizer_id] end,
    influencer_marketing_ids = case when influencer_marketing_id is null then '{}'::uuid[] else array[influencer_marketing_id] end
where cardinality(google_optimizer_ids) = 0
   or cardinality(meta_optimizer_ids) = 0
   or cardinality(criteo_optimizer_ids) = 0
   or cardinality(bing_optimizer_ids) = 0
   or cardinality(edm_optimizer_ids) = 0
   or cardinality(influencer_marketing_ids) = 0;

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
  influencer_marketing_ids uuid[], influencer_marketing_names text[]
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
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id = any(coalesce(a.influencer_marketing_ids, case when a.influencer_marketing_id is null then '{}'::uuid[] else array[a.influencer_marketing_id] end))), '{}'::text[])
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
  influencer_marketing_ids uuid[], influencer_marketing_names text[]
)
language sql security definer set search_path=public,iwish
as $$ select * from iwish.rpc_project_allocations_list(); $$;
grant execute on function public.rpc_project_allocations_list() to authenticated;

create function iwish.rpc_project_allocation_upsert(
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
  if v_lead.status <> 'closed' or v_lead.close_result not in ('won','成交') then raise exception 'ERR_VALIDATION:allocation_requires_won_deal'; end if;
  if p_department_team_id is null or p_project_manager_id is null then raise exception 'ERR_VALIDATION:allocation_required_fields'; end if;
  if not exists (select 1 from public.teams where id=p_department_team_id and is_active) then raise exception 'ERR_VALIDATION:invalid_project_team'; end if;
  if not exists (select 1 from public.profiles where id=p_project_manager_id and status='active') then raise exception 'ERR_VALIDATION:invalid_project_manager'; end if;
  if exists (select 1 from public.profiles where id = any(v_google || v_meta || v_criteo || v_bing || v_edm || v_influencer) and status <> 'active')
     or exists (select 1 from unnest(v_google || v_meta || v_criteo || v_bing || v_edm || v_influencer) x(id) left join public.profiles p on p.id=x.id where p.id is null)
  then raise exception 'ERR_VALIDATION:invalid_optimizer'; end if;
  v_before := (select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id);
  insert into public.lead_project_assignments(lead_id,department_team_id,project_manager_id,platforms,google_optimizer_ids,meta_optimizer_ids,criteo_optimizer_ids,bing_optimizer_ids,edm_optimizer_ids,influencer_marketing_ids,google_optimizer_id,meta_optimizer_id,criteo_optimizer_id,bing_optimizer_id,edm_optimizer_id,influencer_marketing_id,note,detail_link,assigned_by,assigned_at)
  values(p_lead_id,p_department_team_id,p_project_manager_id,v_platforms,v_google,v_meta,v_criteo,v_bing,v_edm,v_influencer,v_google[1],v_meta[1],v_criteo[1],v_bing[1],v_edm[1],v_influencer[1],nullif(trim(p_note),''),nullif(trim(p_detail_link),''),v_actor,now())
  on conflict(lead_id) do update set department_team_id=excluded.department_team_id,project_manager_id=excluded.project_manager_id,platforms=excluded.platforms,google_optimizer_ids=excluded.google_optimizer_ids,meta_optimizer_ids=excluded.meta_optimizer_ids,criteo_optimizer_ids=excluded.criteo_optimizer_ids,bing_optimizer_ids=excluded.bing_optimizer_ids,edm_optimizer_ids=excluded.edm_optimizer_ids,influencer_marketing_ids=excluded.influencer_marketing_ids,google_optimizer_id=excluded.google_optimizer_id,meta_optimizer_id=excluded.meta_optimizer_id,criteo_optimizer_id=excluded.criteo_optimizer_id,bing_optimizer_id=excluded.bing_optimizer_id,edm_optimizer_id=excluded.edm_optimizer_id,influencer_marketing_id=excluded.influencer_marketing_id,note=excluded.note,detail_link=excluded.detail_link,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
  update public.leads set allocation_status='assigned' where id=p_lead_id;
  perform iwish.audit(v_actor,'assign_project_group','lead',p_lead_id::text,v_before,(select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id),null);
end $$;

create function public.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_platforms text[] default '{}', p_google_optimizer_ids uuid[] default '{}', p_meta_optimizer_ids uuid[] default '{}',
  p_criteo_optimizer_ids uuid[] default '{}', p_bing_optimizer_ids uuid[] default '{}', p_edm_optimizer_ids uuid[] default '{}',
  p_influencer_marketing_ids uuid[] default '{}', p_note text default null, p_detail_link text default null
) returns void language sql security definer set search_path=public,iwish
as $$ select iwish.rpc_project_allocation_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12); $$;
grant execute on function public.rpc_project_allocation_upsert(uuid,int,uuid,text[],uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],text,text) to authenticated;
