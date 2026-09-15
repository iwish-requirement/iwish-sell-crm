-- Security and integrity hardening discovered during the September 2026 audit.

-- The previous view was a raw projection over every payment row.  Run it as
-- the caller and apply the same contract -> lead scope used elsewhere.
create or replace view public.contract_payments_secure_view
with (security_invoker = true) as
select
  p.id,
  p.contract_id,
  p.amount,
  p.currency,
  p.paid_at,
  p.method,
  p.note,
  p.status,
  p.created_by,
  p.created_at,
  p.updated_at
from public.contract_payments p
join public.contracts c on c.id = p.contract_id
join public.leads l on l.id = c.lead_id
where coalesce(l.is_deleted, false) = false
  and iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'contracts.read')
  and iwish.has_permission(auth.uid(), 'leads.read')
  and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read');

revoke all on public.contract_payments_secure_view from anon;
grant select on public.contract_payments_secure_view to authenticated, service_role;

-- All exposed data views must evaluate RLS and function permissions as the
-- querying role.  The predicates in these views already enforce application
-- scope; security-invoker makes the database policies an additional boundary.
alter view public.profiles_public_view set (security_invoker = true);
alter view public.leads_secure_view set (security_invoker = true);
alter view public.contracts_secure_view set (security_invoker = true);

-- Harden legacy functions that predate the explicit search_path convention.
do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name, p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'iwish')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
        where cfg like 'search_path=%'
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, iwish',
      r.schema_name, r.function_name, r.args
    );
  end loop;
end $$;

-- These procedures are internal workers.  They must never be callable by a
-- browser JWT; the renewal worker uses the service-role client.
revoke all on function public.rpc_auto_return_leads_to_pool() from public, anon, authenticated;
grant execute on function public.rpc_auto_return_leads_to_pool() to service_role;
revoke all on function iwish.rpc_auto_return_leads_to_pool() from public, anon, authenticated;
grant execute on function iwish.rpc_auto_return_leads_to_pool() to service_role;
revoke all on function public.rpc_wecom_mark_notified(uuid[]) from public, anon, authenticated;
grant execute on function public.rpc_wecom_mark_notified(uuid[]) to service_role;
revoke all on function iwish.rpc_wecom_mark_notified(uuid[]) from public, anon, authenticated;
grant execute on function iwish.rpc_wecom_mark_notified(uuid[]) to service_role;

-- Serialize quota checks per owner.  The old count-then-insert check allowed
-- two concurrent requests to both observe 59 active leads and create 61.
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

  -- A missing JWT is never an implicit quota override.  Service-role jobs are
  -- the only intentional non-user caller.
  if v_actor is null and current_user <> 'service_role' then
    raise exception 'ERR_NOT_AUTHENTICATED';
  end if;
  if v_actor is not null and iwish.has_permission(v_actor, 'leads.quota.override') then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

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

-- A soft-deleted lead is immutable.  This closes the gap where organization
-- scoped RPCs could still update/assign/close a row after it left the active
-- dataset.
create or replace function iwish.prevent_deleted_lead_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, iwish
as $$
begin
  if old.is_deleted and new is distinct from old then
    raise exception 'ERR_DELETED_LEAD_IMMUTABLE';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_deleted_lead_mutation on public.leads;
create trigger trg_prevent_deleted_lead_mutation
before update on public.leads
for each row execute function iwish.prevent_deleted_lead_mutation();

-- The public wrapper previously discarded the two pipeline fields because the
-- older internal RPC predates them.  Persist them immediately after creation
-- while retaining the product-category compatibility behavior.
create or replace function public.rpc_lead_create(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_id uuid;
  v_attribute text := nullif(payload->>'customer_attribute', '');
  v_follow_stage text := nullif(payload->>'follow_up_stage', '');
begin
  if v_attribute is not null and v_attribute not in ('followable', 'potential_intent', 'invalid') then
    raise exception 'ERR_VALIDATION:invalid_customer_attribute';
  end if;
  if v_follow_stage is not null and v_follow_stage not in (
    'uncontacted','connected','online_communication','offline_visit',
    'proposal_quotation','proposal_negotiation','intent_confirmed',
    'contract_review','won'
  ) then
    raise exception 'ERR_VALIDATION:invalid_follow_up_stage';
  end if;

  v_id := iwish.rpc_lead_create(payload);

  update public.leads
  set customer_attribute = coalesce(v_attribute, customer_attribute),
      follow_up_stage = coalesce(v_follow_stage, follow_up_stage)
  where id = v_id;

  if payload ? 'product_category' then
    perform iwish.rpc_lead_set_product_category(v_id, payload->>'product_category');
  end if;
  return v_id;
end;
$$;
grant execute on function public.rpc_lead_create(jsonb) to authenticated, service_role;

-- Assignment and transfer must target an active user who belongs to the
-- requested team.  Primary-team membership remains supported for legacy rows.
create or replace function iwish.validate_lead_assignment_target(p_owner_id uuid, p_team_id int default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_profile public.profiles;
  v_team_id int;
begin
  if p_owner_id is null then
    raise exception 'ERR_VALIDATION:owner_required';
  end if;
  select * into v_profile from public.profiles where id = p_owner_id;
  if v_profile.id is null or v_profile.status <> 'active' then
    raise exception 'ERR_VALIDATION:owner_not_active';
  end if;
  v_team_id := coalesce(p_team_id, v_profile.team_id);
  if v_team_id is null then
    raise exception 'ERR_VALIDATION:team_required';
  end if;
  if not exists (select 1 from public.teams t where t.id = v_team_id and coalesce(t.is_active, true)) then
    raise exception 'ERR_VALIDATION:team_not_active';
  end if;
  if not exists (
    select 1 from public.profile_team_memberships m
    where m.profile_id = p_owner_id and m.team_id = v_team_id
  ) and v_profile.team_id is distinct from v_team_id then
    raise exception 'ERR_VALIDATION:owner_not_in_team';
  end if;
end;
$$;

create or replace function iwish.rpc_lead_assign(p_lead_id uuid, p_new_owner uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid(); v_lead public.leads; v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.assign') then raise exception 'ERR_NO_PERMISSION:leads.assign'; end if;
  select * into v_lead from public.leads where id = p_lead_id and coalesce(is_deleted,false)=false;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.assign') then raise exception 'ERR_OUT_OF_SCOPE:leads.assign'; end if;
  perform iwish.validate_lead_assignment_target(p_new_owner, v_lead.team_id);
  v_before := to_jsonb(v_lead.*);
  update public.leads set owner_id = p_new_owner where id = p_lead_id;
  perform iwish.audit(v_actor, 'assign_lead', 'lead', p_lead_id::text, v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason);
end $$;

create or replace function iwish.rpc_lead_transfer(p_lead_id uuid, p_new_team_id int, p_new_owner uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid(); v_lead public.leads; v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.transfer') then raise exception 'ERR_NO_PERMISSION:leads.transfer'; end if;
  select * into v_lead from public.leads where id = p_lead_id and coalesce(is_deleted,false)=false;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.transfer') then raise exception 'ERR_OUT_OF_SCOPE:leads.transfer'; end if;
  perform iwish.validate_lead_assignment_target(p_new_owner, p_new_team_id);
  v_before := to_jsonb(v_lead.*);
  update public.leads set team_id = p_new_team_id, owner_id = p_new_owner where id = p_lead_id;
  perform iwish.audit(v_actor, 'transfer_lead', 'lead', p_lead_id::text, v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), nullif(trim(p_reason),''));
end $$;
