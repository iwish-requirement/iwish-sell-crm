-- Project allocation center: move won deals into a project-group assignment queue.

alter table public.leads
  add column if not exists allocation_status text not null default 'not_required',
  add constraint leads_allocation_status_valid
    check (allocation_status in ('not_required','pending','assigned'));

-- Existing won deals must be visible to the new center immediately.
update public.leads
set allocation_status = 'pending'
where status = 'closed' and close_result in ('won','成交')
  and allocation_status = 'not_required';

create table if not exists public.lead_project_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  department_team_id int not null references public.teams(id) on delete restrict,
  project_manager_id uuid not null references public.profiles(id) on delete restrict,
  google_optimizer_id uuid references public.profiles(id) on delete set null,
  meta_optimizer_id uuid references public.profiles(id) on delete set null,
  criteo_optimizer_id uuid references public.profiles(id) on delete set null,
  bing_optimizer_id uuid references public.profiles(id) on delete set null,
  edm_optimizer_id uuid references public.profiles(id) on delete set null,
  influencer_marketing_id uuid references public.profiles(id) on delete set null,
  note text,
  detail_link text,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_lead_project_assignments_updated_at on public.lead_project_assignments;
create trigger trg_lead_project_assignments_updated_at
before update on public.lead_project_assignments
for each row execute function iwish.set_updated_at();

alter table public.lead_project_assignments enable row level security;
drop policy if exists lead_project_assignments_select on public.lead_project_assignments;
create policy lead_project_assignments_select on public.lead_project_assignments
for select using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'allocations.read')
);
drop policy if exists lead_project_assignments_insert on public.lead_project_assignments;
create policy lead_project_assignments_insert on public.lead_project_assignments
for insert with check (iwish.has_permission(auth.uid(), 'allocations.manage'));
drop policy if exists lead_project_assignments_update on public.lead_project_assignments;
create policy lead_project_assignments_update on public.lead_project_assignments
for update using (iwish.has_permission(auth.uid(), 'allocations.manage'))
with check (iwish.has_permission(auth.uid(), 'allocations.manage'));

insert into public.permissions(key, resource, action, name, description, is_system, is_enabled)
values
  ('allocations.read','allocations','read','Read Project Allocations','View won deals waiting for project assignment',true,true),
  ('allocations.manage','allocations','manage','Manage Project Allocations','Assign won deals to project teams and roles',true,true)
on conflict (key) do nothing;

insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'org'
from public.roles r cross join public.permissions p
where r.name in ('Manager','Admin','SuperAdmin') and p.key in ('allocations.read','allocations.manage')
on conflict do nothing;

-- Expose allocation status at the end of the secure view to preserve existing column order.
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
  l.allocation_status
from public.leads l
where coalesce(l.is_deleted, false) = false
  and iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.read')
  and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read');

-- A compact, permission-checked read API keeps assignment joins out of the client.
create or replace function iwish.rpc_project_allocations_list()
returns table (
  id uuid, lead_id uuid, company_name text, customer_name text, website text,
  source text, budget numeric, closed_at timestamptz, allocation_status text,
  categories jsonb, sales_owner_name text, department_team_id int, department_name text,
  project_manager_id uuid, project_manager_name text, google_optimizer_id uuid,
  google_optimizer_name text, meta_optimizer_id uuid, meta_optimizer_name text,
  criteo_optimizer_id uuid, criteo_optimizer_name text, bing_optimizer_id uuid,
  bing_optimizer_name text, edm_optimizer_id uuid, edm_optimizer_name text,
  influencer_marketing_id uuid, influencer_marketing_name text, note text, detail_link text,
  assigned_at timestamptz
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
    a.influencer_marketing_id, iop.full_name, a.note, a.detail_link, a.assigned_at
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

create or replace function public.rpc_project_allocations_list()
returns table (
  id uuid, lead_id uuid, company_name text, customer_name text, website text,
  source text, budget numeric, closed_at timestamptz, allocation_status text,
  categories jsonb, sales_owner_name text, department_team_id int, department_name text,
  project_manager_id uuid, project_manager_name text, google_optimizer_id uuid,
  google_optimizer_name text, meta_optimizer_id uuid, meta_optimizer_name text,
  criteo_optimizer_id uuid, criteo_optimizer_name text, bing_optimizer_id uuid,
  bing_optimizer_name text, edm_optimizer_id uuid, edm_optimizer_name text,
  influencer_marketing_id uuid, influencer_marketing_name text, note text, detail_link text,
  assigned_at timestamptz
) language sql security definer set search_path=public,iwish as $$ select * from iwish.rpc_project_allocations_list(); $$;
grant execute on function public.rpc_project_allocations_list() to authenticated;

create or replace function iwish.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_google_optimizer_id uuid default null, p_meta_optimizer_id uuid default null,
  p_criteo_optimizer_id uuid default null, p_bing_optimizer_id uuid default null,
  p_edm_optimizer_id uuid default null, p_influencer_marketing_id uuid default null,
  p_note text default null, p_detail_link text default null
) returns void language plpgsql security definer set search_path=public,iwish as $$
declare v_actor uuid := auth.uid(); v_lead public.leads; v_before jsonb;
begin
  if not iwish.has_permission(v_actor,'allocations.manage') then raise exception 'ERR_NO_PERMISSION:allocations.manage'; end if;
  select * into v_lead from public.leads where id=p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if v_lead.status <> 'closed' or v_lead.close_result not in ('won','成交') then raise exception 'ERR_VALIDATION:allocation_requires_won_deal'; end if;
  if p_department_team_id is null or p_project_manager_id is null then raise exception 'ERR_VALIDATION:allocation_required_fields'; end if;
  if not exists (select 1 from public.teams where id=p_department_team_id and is_active) then raise exception 'ERR_VALIDATION:invalid_project_team'; end if;
  if not exists (select 1 from public.profiles where id=p_project_manager_id and status='active') then raise exception 'ERR_VALIDATION:invalid_project_manager'; end if;
  v_before := (select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id);
  insert into public.lead_project_assignments(lead_id,department_team_id,project_manager_id,google_optimizer_id,meta_optimizer_id,criteo_optimizer_id,bing_optimizer_id,edm_optimizer_id,influencer_marketing_id,note,detail_link,assigned_by,assigned_at)
  values(p_lead_id,p_department_team_id,p_project_manager_id,p_google_optimizer_id,p_meta_optimizer_id,p_criteo_optimizer_id,p_bing_optimizer_id,p_edm_optimizer_id,p_influencer_marketing_id,nullif(trim(p_note),''),nullif(trim(p_detail_link),''),v_actor,now())
  on conflict(lead_id) do update set department_team_id=excluded.department_team_id,project_manager_id=excluded.project_manager_id,google_optimizer_id=excluded.google_optimizer_id,meta_optimizer_id=excluded.meta_optimizer_id,criteo_optimizer_id=excluded.criteo_optimizer_id,bing_optimizer_id=excluded.bing_optimizer_id,edm_optimizer_id=excluded.edm_optimizer_id,influencer_marketing_id=excluded.influencer_marketing_id,note=excluded.note,detail_link=excluded.detail_link,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
  update public.leads set allocation_status='assigned' where id=p_lead_id;
  perform iwish.audit(v_actor,'assign_project_group','lead',p_lead_id::text,v_before,(select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id),null);
end $$;
create or replace function public.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_google_optimizer_id uuid default null, p_meta_optimizer_id uuid default null,
  p_criteo_optimizer_id uuid default null, p_bing_optimizer_id uuid default null,
  p_edm_optimizer_id uuid default null, p_influencer_marketing_id uuid default null,
  p_note text default null, p_detail_link text default null
) returns void language sql security definer set search_path=public,iwish as $$ select iwish.rpc_project_allocation_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11); $$;
grant execute on function public.rpc_project_allocation_upsert(uuid,int,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text) to authenticated;

-- Successful close creates a pending allocation item; lost deals stay out of the queue.
create or replace function iwish.rpc_lead_close(p_lead_id uuid, p_result text, p_reason text)
returns void language plpgsql security definer set search_path=public,iwish as $$
declare v_actor uuid:=auth.uid(); v_lead public.leads; v_before jsonb;
begin
  if not iwish.has_permission(v_actor,'leads.close') then raise exception 'ERR_NO_PERMISSION:leads.close'; end if;
  select * into v_lead from public.leads where id=p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor,v_lead,'leads.close') then raise exception 'ERR_OUT_OF_SCOPE:leads.close'; end if;
  if p_result not in ('won','lost') then raise exception 'ERR_VALIDATION:close_result_must_be_won_or_lost'; end if;
  v_before:=to_jsonb(v_lead.*);
  update public.leads set status='closed',close_result=p_result,close_reason=p_reason,
    stage=case when p_result='won' then 'Won' else stage end,
    allocation_status=case when p_result='won' then 'pending' else 'not_required' end
  where id=p_lead_id;
  perform iwish.audit(v_actor,'close_lead','lead',p_lead_id::text,v_before,(select to_jsonb(l.*) from public.leads l where l.id=p_lead_id),p_reason);
end $$;
create or replace function public.rpc_lead_close(p_lead_id uuid,p_result text,p_reason text)
returns void language sql security definer set search_path=public,iwish as $$ select iwish.rpc_lead_close($1,$2,$3); $$;
grant execute on function public.rpc_lead_close(uuid,text,text) to authenticated,service_role;

create or replace function iwish.rpc_me_permissions()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_scope jsonb; v_create_scope jsonb;
begin
  if v_actor is null then return '{}'::jsonb; end if;
  begin v_scope:=iwish.get_effective_scope(v_actor,'leads.read'); exception when others then v_scope:='{"scope_type":"self"}'::jsonb; end;
  begin v_create_scope:=iwish.get_effective_scope(v_actor,'leads.create'); exception when others then v_create_scope:='{"scope_type":"self"}'::jsonb; end;
  return jsonb_build_object(
    'canAssignLeads',iwish.has_permission(v_actor,'leads.assign'),'canReturnToPool',iwish.has_permission(v_actor,'leads.pool.return'),
    'canDeleteLeads',iwish.has_permission(v_actor,'leads.delete'),'canTransferLeads',iwish.has_permission(v_actor,'leads.transfer'),
    'canViewAudit',iwish.has_permission(v_actor,'audit.read'),'canViewReports',iwish.has_permission(v_actor,'reports.read'),
    'canViewSettings',iwish.has_permission(v_actor,'settings.security.manage') or iwish.has_permission(v_actor,'settings.pipeline.manage') or iwish.has_permission(v_actor,'settings.ui.manage') or iwish.has_permission(v_actor,'settings.integrations.manage'),
    'canViewPublicPool',iwish.has_permission(v_actor,'leads.pool.return'),'canImportLeads',iwish.has_permission(v_actor,'leads.import'),
    'canReadContracts',iwish.has_permission(v_actor,'contracts.read'),'canManageContracts',iwish.has_permission(v_actor,'contracts.manage'),
    'canReadAllocations',iwish.has_permission(v_actor,'allocations.read'),'canManageAllocations',iwish.has_permission(v_actor,'allocations.manage'),
    'leadScopeType',coalesce(v_scope->>'scope_type','self'),'leadCreateScopeType',coalesce(v_create_scope->>'scope_type','self'));
end $$;
revoke all on function iwish.rpc_me_permissions() from public;
grant execute on function iwish.rpc_me_permissions() to authenticated;
drop function if exists public.rpc_me_permissions();
create or replace function public.rpc_me_permissions() returns jsonb language sql security definer as $$ select iwish.rpc_me_permissions(); $$;
grant execute on function public.rpc_me_permissions() to authenticated;
