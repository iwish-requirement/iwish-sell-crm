-- Customer product category is free text and remains nullable for legacy rows/imports.
alter table public.leads
  add column if not exists product_category text;

comment on column public.leads.product_category is
  'Customer product category entered as free text; nullable for legacy records.';

-- Sales users can see the allocation queue, while manage permission remains
-- restricted to managers/market roles seeded by earlier migrations.
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, 'allocations.read', 'allow', 'org'
from public.roles r
where r.name in ('Sales', '销售人员', '销售顾问', '销售')
   or r.role_type = 'sales_rep'
on conflict do nothing;

-- Keep the secure view column order stable and append the new field.
create or replace view public.leads_secure_view as
select
  l.id, l.team_id, l.owner_id, l.created_by, l.name, l.source, l.stage, l.status,
  l.close_result, l.close_reason, l.last_contact_at, l.created_at, l.updated_at,
  l.customer_name,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone else iwish.mask_phone(l.customer_phone) end as customer_phone,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email else iwish.mask_email(l.customer_email) end as customer_email,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address else null end as address,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget else null end as budget,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score else null end as internal_score,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason else null end as blacklist_reason,
  l.next_contact_at,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.wechat else null end as wechat,
  l.customer_grade, l.source_level1, l.source_level2, l.tags,
  l.first_contact_at, l.locked_by, l.locked_until, l.protected_until,
  coalesce((select json_agg(json_build_object('id',bc.id,'name',bc.name) order by bc.sort_order)
    from public.leads_business_categories lbc join public.business_categories bc on bc.id=lbc.category_id and bc.is_active
    where lbc.lead_id=l.id),'[]'::json) as business_categories,
  coalesce((select json_agg(json_build_object('id',bt.id,'name',bt.name,'category_id',bt.category_id) order by bt.sort_order)
    from public.leads_business_types lbt join public.business_types bt on bt.id=lbt.type_id and bt.is_active
    where lbt.lead_id=l.id),'[]'::json) as business_types,
  l.responsibility_type, l.dev_method_key, l.referral_customer_name, l.referral_type_key,
  l.activity_name, l.source_department_key, l.source_locked_at, l.website,
  l.allocation_status, l.product_category
from public.leads l
where coalesce(l.is_deleted,false)=false
  and iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.read')
  and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read');

-- Add a protected setter so all existing create/import RPCs can persist the
-- optional field without changing their established signatures.
create or replace function iwish.rpc_lead_set_product_category(p_lead_id uuid, p_product_category text)
returns void language plpgsql security definer set search_path=public,iwish as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_lead public.leads;
  v_value text := nullif(trim(p_product_category), '');
begin
  if not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:leads.update';
  end if;
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update')
     and v_lead.owner_id <> v_actor and v_lead.created_by <> v_actor then
    raise exception 'ERR_OUT_OF_SCOPE:leads.update';
  end if;
  v_before := to_jsonb(v_lead.*);
  update public.leads set product_category = v_value where id = p_lead_id;
  perform iwish.audit(v_actor, 'update_lead_product_category', 'lead', p_lead_id::text,
    v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), null);
end $$;

create or replace function public.rpc_lead_set_product_category(p_lead_id uuid, p_product_category text)
returns void language sql security definer set search_path=public,iwish as $$
  select iwish.rpc_lead_set_product_category(p_lead_id, p_product_category);
$$;
grant execute on function public.rpc_lead_set_product_category(uuid, text) to authenticated, service_role;

-- Existing callers continue to call rpc_lead_create; when the new field is
-- supplied, persist it through the protected setter. Missing values remain
-- nullable so historical templates/data continue to import successfully.
create or replace function public.rpc_lead_create(payload jsonb)
returns uuid language plpgsql security definer set search_path=public,iwish as $$
declare
  v_id uuid;
begin
  v_id := iwish.rpc_lead_create(payload);
  if payload ? 'product_category' then
    perform iwish.rpc_lead_set_product_category(v_id, payload->>'product_category');
  end if;
  return v_id;
end $$;
grant execute on function public.rpc_lead_create(jsonb) to authenticated, service_role;

create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void language plpgsql security definer set search_path=public,iwish as $$
begin
  perform iwish.rpc_lead_update(p_lead_id, patch, p_reason);
  if patch ? 'product_category' then
    perform iwish.rpc_lead_set_product_category(p_lead_id, patch->>'product_category');
  end if;
end $$;
grant execute on function public.rpc_lead_update(uuid, jsonb, text) to authenticated, service_role;

-- Append product_category to the allocation list RPC for named-field clients.
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
  influencer_marketing_ids uuid[], influencer_marketing_names text[], allocation_source text,
  sync_status text, external_assignment_id text, sync_version integer, last_synced_at timestamptz,
  sync_error text, idempotency_key uuid, product_category text
)
language plpgsql security definer set search_path = public, iwish
as $$
begin
  if not iwish.has_permission(auth.uid(),'allocations.read') then raise exception 'ERR_NO_PERMISSION:allocations.read'; end if;
  return query
  select a.id, l.id, l.name, l.customer_name, l.website, l.source, l.budget,
    coalesce(c.signed_at,l.updated_at), coalesce(l.allocation_status,'pending'),
    coalesce((select jsonb_agg(jsonb_build_object('id',bc.id,'name',bc.name) order by bc.sort_order)
      from public.leads_business_categories lbc join public.business_categories bc on bc.id=lbc.category_id and bc.is_active
      where lbc.lead_id=l.id),'[]'::jsonb),
    sales.full_name, a.department_team_id, t.name, a.project_manager_id, pm.full_name,
    a.google_optimizer_id, gop.full_name, a.meta_optimizer_id, mop.full_name,
    a.criteo_optimizer_id, cop.full_name, a.bing_optimizer_id, bop.full_name,
    a.edm_optimizer_id, eop.full_name, a.influencer_marketing_id, iop.full_name,
    a.note, a.detail_link, a.assigned_at, coalesce(a.platforms,'{}'::text[]),
    coalesce(a.google_optimizer_ids, case when a.google_optimizer_id is null then '{}'::uuid[] else array[a.google_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id=any(coalesce(a.google_optimizer_ids, case when a.google_optimizer_id is null then '{}'::uuid[] else array[a.google_optimizer_id] end))),'{}'::text[]),
    coalesce(a.meta_optimizer_ids, case when a.meta_optimizer_id is null then '{}'::uuid[] else array[a.meta_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id=any(coalesce(a.meta_optimizer_ids, case when a.meta_optimizer_id is null then '{}'::uuid[] else array[a.meta_optimizer_id] end))),'{}'::text[]),
    coalesce(a.criteo_optimizer_ids, case when a.criteo_optimizer_id is null then '{}'::uuid[] else array[a.criteo_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id=any(coalesce(a.criteo_optimizer_ids, case when a.criteo_optimizer_id is null then '{}'::uuid[] else array[a.criteo_optimizer_id] end))),'{}'::text[]),
    coalesce(a.bing_optimizer_ids, case when a.bing_optimizer_id is null then '{}'::uuid[] else array[a.bing_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id=any(coalesce(a.bing_optimizer_ids, case when a.bing_optimizer_id is null then '{}'::uuid[] else array[a.bing_optimizer_id] end))),'{}'::text[]),
    coalesce(a.edm_optimizer_ids, case when a.edm_optimizer_id is null then '{}'::uuid[] else array[a.edm_optimizer_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id=any(coalesce(a.edm_optimizer_ids, case when a.edm_optimizer_id is null then '{}'::uuid[] else array[a.edm_optimizer_id] end))),'{}'::text[]),
    coalesce(a.influencer_marketing_ids, case when a.influencer_marketing_id is null then '{}'::uuid[] else array[a.influencer_marketing_id] end),
    coalesce((select array_agg(p.full_name order by p.full_name) from public.profiles p where p.id=any(coalesce(a.influencer_marketing_ids, case when a.influencer_marketing_id is null then '{}'::uuid[] else array[a.influencer_marketing_id] end))),'{}'::text[]),
    coalesce(a.allocation_source,'legacy'), coalesce(a.sync_status,'not_connected'), a.external_assignment_id,
    coalesce(a.sync_version,1), a.last_synced_at, a.sync_error, a.idempotency_key, l.product_category
  from public.leads l
  left join public.contracts c on c.lead_id=l.id
  left join public.lead_project_assignments a on a.lead_id=l.id
  left join public.teams t on t.id=a.department_team_id
  left join public.profiles sales on sales.id=l.owner_id
  left join public.profiles pm on pm.id=a.project_manager_id
  left join public.profiles gop on gop.id=a.google_optimizer_id
  left join public.profiles mop on mop.id=a.meta_optimizer_id
  left join public.profiles cop on cop.id=a.criteo_optimizer_id
  left join public.profiles bop on bop.id=a.bing_optimizer_id
  left join public.profiles eop on eop.id=a.edm_optimizer_id
  left join public.profiles iop on iop.id=a.influencer_marketing_id
  where coalesce(l.is_deleted,false)=false and l.status='closed' and l.close_result in ('won','成交')
    and iwish.in_scope_for_lead(auth.uid(),l,'leads.read')
  order by l.updated_at desc;
end $$;

create function public.rpc_project_allocations_list()
returns table (
  id uuid, lead_id uuid, company_name text, customer_name text, website text,
  source text, budget numeric, closed_at timestamptz, allocation_status text, categories jsonb,
  sales_owner_name text, department_team_id int, department_name text, project_manager_id uuid,
  project_manager_name text, google_optimizer_id uuid, google_optimizer_name text, meta_optimizer_id uuid,
  meta_optimizer_name text, criteo_optimizer_id uuid, criteo_optimizer_name text, bing_optimizer_id uuid,
  bing_optimizer_name text, edm_optimizer_id uuid, edm_optimizer_name text, influencer_marketing_id uuid,
  influencer_marketing_name text, note text, detail_link text, assigned_at timestamptz, platforms text[],
  google_optimizer_ids uuid[], google_optimizer_names text[], meta_optimizer_ids uuid[], meta_optimizer_names text[],
  criteo_optimizer_ids uuid[], criteo_optimizer_names text[], bing_optimizer_ids uuid[], bing_optimizer_names text[],
  edm_optimizer_ids uuid[], edm_optimizer_names text[], influencer_marketing_ids uuid[], influencer_marketing_names text[],
  allocation_source text, sync_status text, external_assignment_id text, sync_version integer,
  last_synced_at timestamptz, sync_error text, idempotency_key uuid, product_category text
) language sql security definer set search_path=public,iwish as $$ select * from iwish.rpc_project_allocations_list(); $$;
grant execute on function public.rpc_project_allocations_list() to authenticated;
