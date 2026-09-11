-- Lead pipeline dimensions, sales quota enforcement, and zero-follow-up pool return.

alter table public.leads
  add column if not exists customer_attribute text not null default 'followable',
  add column if not exists follow_up_stage text not null default 'uncontacted',
  add column if not exists ownership_started_at timestamptz;

alter table public.leads
  drop constraint if exists leads_customer_attribute_valid,
  drop constraint if exists leads_follow_up_stage_valid;

alter table public.leads
  add constraint leads_customer_attribute_valid
    check (customer_attribute in ('followable', 'potential_intent', 'invalid')),
  add constraint leads_follow_up_stage_valid
    check (follow_up_stage in (
      'uncontacted',
      'connected',
      'online_communication',
      'offline_visit',
      'proposal_quotation',
      'proposal_negotiation',
      'intent_confirmed',
      'contract_review',
      'won'
    ));

update public.leads
set follow_up_stage = case stage
  when 'L1' then 'uncontacted'
  when 'L2' then 'connected'
  when 'L3' then 'proposal_quotation'
  when 'L4' then 'proposal_negotiation'
  when 'Won' then 'won'
  else 'uncontacted'
end
where follow_up_stage = 'uncontacted';

update public.leads
set ownership_started_at = coalesce(ownership_started_at, created_at)
where owner_id is not null and ownership_started_at is null;

create index if not exists idx_leads_quota_owner_status
  on public.leads(owner_id, status, customer_attribute, follow_up_stage);

create index if not exists idx_leads_ownership_started
  on public.leads(ownership_started_at)
  where status = 'open' and owner_id is not null;

insert into public.permissions(key, resource, action, name, description, is_system, is_enabled)
values (
  'leads.quota.override',
  'leads',
  'quota.override',
  'Override Lead Quota',
  'Create, claim, or assign a valid lead after a salesperson reaches the quota',
  true,
  true
)
on conflict (key) do nothing;

insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, 'leads.quota.override', 'allow'::perm_effect, 'org'::scope_type
from public.roles r
where r.name in ('Manager', 'Admin', 'SuperAdmin')
on conflict (role_id, permission_key) do nothing;

insert into public.settings(key, value)
values (
  'pipeline.business_rules',
  jsonb_build_object('lead_protection_days', 120, 'quota_limit', 60)
)
on conflict (key) do update
set value = public.settings.value || jsonb_build_object(
  'lead_protection_days', coalesce(public.settings.value->'lead_protection_days', '120'::jsonb),
  'quota_limit', coalesce(public.settings.value->'quota_limit', '60'::jsonb)
);

create or replace function iwish.lead_quota_limit()
returns integer
language plpgsql
stable
security definer
set search_path = public, iwish
as $$
declare
  v_settings jsonb;
  v_limit integer := 60;
begin
  select value into v_settings
  from public.settings
  where key = 'pipeline.business_rules';

  if v_settings ? 'quota_limit' then
    v_limit := coalesce((v_settings->>'quota_limit')::integer, v_limit);
  end if;

  return greatest(v_limit, 0);
end;
$$;

create or replace function iwish.enforce_lead_quota(p_owner_id uuid, p_lead_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := iwish.lead_quota_limit();
  v_count integer;
begin
  if p_owner_id is null or v_limit <= 0 then
    return;
  end if;

  if v_actor is null or iwish.has_permission(v_actor, 'leads.quota.override') then
    return;
  end if;

  select count(*)
  into v_count
  from public.leads l
  where l.owner_id = p_owner_id
    and l.id is distinct from p_lead_id
    and l.status = 'open'
    and l.customer_attribute <> 'invalid'
    and l.follow_up_stage <> 'won'
    and not (l.status = 'closed' or l.close_result in ('won', '成交'));

  if v_count >= v_limit then
    raise exception 'ERR_QUOTA_EXCEEDED:lead_quota_limit:%', v_limit;
  end if;
end;
$$;

create or replace function iwish.trg_lead_pipeline_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, iwish
as $$
begin
  if new.owner_id is not null and new.ownership_started_at is null then
    new.ownership_started_at := now();
  end if;

  if tg_op = 'UPDATE' and (
    new.owner_id is distinct from old.owner_id
    or (old.status = 'pool' and new.status = 'open')
  ) then
    new.ownership_started_at := now();
  end if;

  if new.status = 'open'
    and new.owner_id is not null
    and new.customer_attribute <> 'invalid'
    and new.follow_up_stage <> 'won'
  then
    perform iwish.enforce_lead_quota(new.owner_id, case when tg_op = 'UPDATE' then new.id else null end);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lead_pipeline_defaults on public.leads;
create trigger trg_lead_pipeline_defaults
before insert or update of owner_id, status, customer_attribute, follow_up_stage
on public.leads
for each row execute function iwish.trg_lead_pipeline_defaults();

create or replace function iwish.rpc_lead_pipeline_update(
  p_lead_id uuid,
  p_customer_attribute text default null,
  p_follow_up_stage text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_before jsonb;
  v_next_attribute text;
  v_next_stage text;
begin
  if not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:leads.update';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.update';
  end if;
  if v_lead.status = 'closed' and p_follow_up_stage is not null then
    raise exception 'ERR_INVALID_STATUS:cannot_change_stage_when_closed';
  end if;

  v_next_attribute := coalesce(nullif(trim(p_customer_attribute), ''), v_lead.customer_attribute);
  v_next_stage := coalesce(nullif(trim(p_follow_up_stage), ''), v_lead.follow_up_stage);

  if v_next_attribute not in ('followable', 'potential_intent', 'invalid') then
    raise exception 'ERR_VALIDATION:invalid_customer_attribute';
  end if;
  if v_next_stage not in (
    'uncontacted', 'connected', 'online_communication', 'offline_visit',
    'proposal_quotation', 'proposal_negotiation', 'intent_confirmed',
    'contract_review', 'won'
  ) then
    raise exception 'ERR_VALIDATION:invalid_follow_up_stage';
  end if;

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set customer_attribute = v_next_attribute,
      follow_up_stage = v_next_stage,
      stage = case
        when v_next_stage = 'won' then 'Won'
        when v_next_stage in ('contract_review') then 'L4'
        when v_next_stage in ('proposal_quotation', 'proposal_negotiation', 'intent_confirmed') then 'L3'
        when v_next_stage in ('connected', 'online_communication', 'offline_visit') then 'L2'
        else 'L1'
      end
  where id = p_lead_id;

  perform iwish.audit(
    v_actor,
    'update_lead_pipeline',
    'lead',
    p_lead_id::text,
    v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
    p_reason
  );
end;
$$;

create or replace function public.rpc_lead_pipeline_update(
  p_lead_id uuid,
  p_customer_attribute text default null,
  p_follow_up_stage text default null,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_pipeline_update($1, $2, $3, $4);
$$;

grant execute on function public.rpc_lead_pipeline_update(uuid, text, text, text)
to authenticated, service_role;

create or replace function iwish.rpc_auto_return_leads_to_pool()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_settings jsonb;
  v_protection_days integer := 120;
  v_cutoff timestamptz;
  v_now timestamptz := now();
  v_dropped_count integer := 0;
  rec public.leads;
begin
  select value into v_settings
  from public.settings
  where key = 'pipeline.business_rules';

  v_protection_days := coalesce(
    (v_settings->>'lead_protection_days')::integer,
    (v_settings->>'public_pool_days')::integer,
    120
  );
  if v_protection_days <= 0 then
    return jsonb_build_object('dropped_count', 0, 'lead_protection_days', v_protection_days, 'skipped', true);
  end if;

  v_cutoff := v_now - make_interval(days => v_protection_days);

  for rec in
    select l.*
    from public.leads l
    where l.status = 'open'
      and l.owner_id is not null
      and coalesce(l.ownership_started_at, l.created_at) <= v_cutoff
      and not exists (
        select 1
        from public.lead_notes n
        where n.lead_id = l.id
          and n.is_deleted = false
          and length(trim(n.content)) > 0
      )
  loop
    update public.leads
    set status = 'pool'
    where id = rec.id and status = 'open';

    if found then
      perform iwish.audit(
        coalesce(rec.owner_id, rec.created_by),
        'return_lead_to_pool',
        'lead',
        rec.id::text,
        to_jsonb(rec.*),
        (select to_jsonb(l.*) from public.leads l where l.id = rec.id),
        format('首次归属超过 %s 天且没有任何跟进记录', v_protection_days)
      );
      v_dropped_count := v_dropped_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'dropped_count', v_dropped_count,
    'lead_protection_days', v_protection_days,
    'cutoff_at', v_cutoff
  );
end;
$$;

create or replace function public.rpc_auto_return_leads_to_pool()
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_auto_return_leads_to_pool();
$$;

grant execute on function public.rpc_auto_return_leads_to_pool() to authenticated, service_role;

create or replace function iwish.rpc_me_permissions()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_scope jsonb;
  v_create_scope jsonb;
begin
  if v_actor is null then return '{}'::jsonb; end if;
  begin v_scope := iwish.get_effective_scope(v_actor, 'leads.read'); exception when others then v_scope := '{"scope_type":"self"}'::jsonb; end;
  begin v_create_scope := iwish.get_effective_scope(v_actor, 'leads.create'); exception when others then v_create_scope := '{"scope_type":"self"}'::jsonb; end;
  return jsonb_build_object(
    'canAssignLeads', iwish.has_permission(v_actor, 'leads.assign'),
    'canClaimLeads', iwish.has_permission(v_actor, 'leads.claim'),
    'canOverrideLeadQuota', iwish.has_permission(v_actor, 'leads.quota.override'),
    'canReturnToPool', iwish.has_permission(v_actor, 'leads.pool.return'),
    'canDeleteLeads', iwish.has_permission(v_actor, 'leads.delete'),
    'canTransferLeads', iwish.has_permission(v_actor, 'leads.transfer'),
    'canViewAudit', iwish.has_permission(v_actor, 'audit.read'),
    'canViewReports', iwish.has_permission(v_actor, 'reports.read'),
    'canViewSettings', iwish.has_permission(v_actor, 'settings.security.manage') or iwish.has_permission(v_actor, 'settings.pipeline.manage') or iwish.has_permission(v_actor, 'settings.ui.manage') or iwish.has_permission(v_actor, 'settings.integrations.manage'),
    'canViewPublicPool', iwish.has_permission(v_actor, 'leads.pool.return'),
    'canImportLeads', iwish.has_permission(v_actor, 'leads.import'),
    'canReadContracts', iwish.has_permission(v_actor, 'contracts.read'),
    'canManageContracts', iwish.has_permission(v_actor, 'contracts.manage'),
    'canReadAllocations', iwish.has_permission(v_actor, 'allocations.read'),
    'canManageAllocations', iwish.has_permission(v_actor, 'allocations.manage'),
    'leadScopeType', coalesce(v_scope->>'scope_type', 'self'),
    'leadCreateScopeType', coalesce(v_create_scope->>'scope_type', 'self')
  );
end;
$$;

revoke all on function iwish.rpc_me_permissions() from public;
grant execute on function iwish.rpc_me_permissions() to authenticated;
drop function if exists public.rpc_me_permissions();
create or replace function public.rpc_me_permissions()
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$ select iwish.rpc_me_permissions(); $$;
grant execute on function public.rpc_me_permissions() to authenticated;

create or replace function iwish.get_pipeline_business_rules()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_value jsonb;
  v_protection_days integer := 120;
  v_quota_limit integer := 60;
  v_warning_hours integer := 72;
  v_danger_hours integer := 168;
begin
  select value into v_value from public.settings where key = 'pipeline.business_rules';
  if v_value is not null then
    v_protection_days := coalesce((v_value->>'lead_protection_days')::integer, (v_value->>'public_pool_days')::integer, v_protection_days);
    v_quota_limit := coalesce((v_value->>'quota_limit')::integer, v_quota_limit);
    v_warning_hours := coalesce((v_value->>'warning_hours')::integer, v_warning_hours);
    v_danger_hours := coalesce((v_value->>'danger_hours')::integer, v_danger_hours);
  end if;
  return jsonb_build_object(
    'lead_protection_days', greatest(v_protection_days, 1),
    'public_pool_days', greatest(v_protection_days, 1),
    'quota_limit', greatest(v_quota_limit, 1),
    'warning_hours', greatest(v_warning_hours, 1),
    'danger_hours', greatest(v_danger_hours, 1)
  );
end;
$$;

create or replace function public.rpc_get_pipeline_business_rules()
returns jsonb language sql security definer set search_path=public,iwish as $$
  select iwish.get_pipeline_business_rules();
$$;
grant execute on function public.rpc_get_pipeline_business_rules() to authenticated, service_role;

-- Append new pipeline fields to the secure view without changing existing column order.
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
  l.allocation_status, l.product_category,
  l.customer_attribute, l.follow_up_stage, l.ownership_started_at
from public.leads l
where coalesce(l.is_deleted,false)=false
  and iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.read')
  and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read');
