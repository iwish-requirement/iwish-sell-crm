-- Unify the effective-lead quota across every acquisition path.
-- The database trigger remains the final guard for direct inserts/updates;
-- RPCs also preflight so pool claims/transfers cannot race past the limit.

create or replace function iwish.lead_counts_toward_quota(
  p_owner_id uuid,
  p_status text,
  p_customer_attribute text,
  p_follow_up_stage text,
  p_close_result text,
  p_is_deleted boolean default false
)
returns boolean
language sql
immutable
as $$
  select p_owner_id is not null
    and coalesce(p_is_deleted, false) = false
    and p_status = 'open'
    and coalesce(p_customer_attribute, 'followable') <> 'invalid'
    and coalesce(p_follow_up_stage, 'uncontacted') <> 'won'
    and (p_close_result is null or p_close_result not in ('won', '成交'));
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

  -- A missing JWT is never an implicit quota override. Service-role jobs are
  -- the only intentional non-user caller.
  if v_actor is null and current_user <> 'service_role' then
    raise exception 'ERR_NOT_AUTHENTICATED';
  end if;
  if v_actor is not null and iwish.has_permission(v_actor, 'leads.quota.override') then
    return;
  end if;

  -- Serialize checks by owner so concurrent claims/assignments cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  select count(*)
    into v_count
  from public.leads l
  where l.owner_id = p_owner_id
    and l.id is distinct from p_lead_id
    and iwish.lead_counts_toward_quota(
      l.owner_id, l.status, l.customer_attribute,
      l.follow_up_stage, l.close_result, l.is_deleted
    );

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

  if iwish.lead_counts_toward_quota(
    new.owner_id, new.status, new.customer_attribute,
    new.follow_up_stage, new.close_result, new.is_deleted
  ) then
    perform iwish.enforce_lead_quota(
      new.owner_id,
      case when tg_op = 'UPDATE' then new.id else null end
    );
  end if;

  return new;
end;
$$;

create or replace function iwish.rpc_lead_claim_from_pool(
  p_lead_id uuid,
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
  v_team_id integer;
  v_previously_returned boolean := false;
  v_prevent_previous_owner_reclaim boolean := false;
  v_settings jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.claim') then
    raise exception 'ERR_NO_PERMISSION:leads.claim';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and coalesce(is_deleted, false) = false;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if v_lead.status <> 'pool' then
    raise exception 'ERR_INVALID_STATUS:only_pool_leads_can_be_claimed';
  end if;

  select value into v_settings from public.settings where key = 'pipeline.business_rules';
  v_prevent_previous_owner_reclaim := coalesce((v_settings->>'prevent_previous_owner_reclaim')::boolean, false);

  select exists (
    select 1 from public.audit_logs al
    where al.target_type = 'lead'
      and al.target_id = p_lead_id::text
      and al.action = 'return_lead_to_pool'
      and al.before->>'owner_id' = v_actor::text
  ) into v_previously_returned;
  if v_prevent_previous_owner_reclaim and v_previously_returned then
    raise exception 'ERR_INVALID_STATUS:previous_owner_cannot_claim_after_return';
  end if;

  select team_id into v_team_id from public.profiles where id = v_actor;
  if v_team_id is null then
    raise exception 'ERR_VALIDATION:claim_requires_team';
  end if;

  -- Pool claims are acquisitions and must consume the same effective-lead quota
  -- as create/import/assign/transfer. The advisory lock is held through update.
  perform iwish.enforce_lead_quota(v_actor, p_lead_id);

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set owner_id = v_actor,
      team_id = v_team_id,
      status = 'open'
  where id = p_lead_id
    and status = 'pool'
    and coalesce(is_deleted, false) = false;

  if not found then
    raise exception 'ERR_CONFLICT:lead_already_claimed';
  end if;

  perform iwish.audit(
    v_actor, 'claim_lead_from_pool', 'lead', p_lead_id::text,
    v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason
  );
end;
$$;

create or replace function iwish.rpc_lead_assign(
  p_lead_id uuid,
  p_new_owner uuid
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
begin
  if not iwish.has_permission(v_actor, 'leads.assign') then
    raise exception 'ERR_NO_PERMISSION:leads.assign';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and coalesce(is_deleted, false) = false;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.assign') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.assign';
  end if;
  perform iwish.validate_lead_assignment_target(p_new_owner, v_lead.team_id);
  perform iwish.enforce_lead_quota(p_new_owner, p_lead_id);

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set owner_id = p_new_owner
  where id = p_lead_id and coalesce(is_deleted, false) = false;

  perform iwish.audit(v_actor, 'assign_lead', 'lead', p_lead_id::text, v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), null);
end;
$$;

create or replace function iwish.rpc_lead_assign(
  p_lead_id uuid,
  p_new_owner uuid,
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
begin
  if not iwish.has_permission(v_actor, 'leads.assign') then
    raise exception 'ERR_NO_PERMISSION:leads.assign';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and coalesce(is_deleted, false) = false;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.assign') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.assign';
  end if;
  perform iwish.validate_lead_assignment_target(p_new_owner, v_lead.team_id);
  perform iwish.enforce_lead_quota(p_new_owner, p_lead_id);

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set owner_id = p_new_owner
  where id = p_lead_id and coalesce(is_deleted, false) = false;

  perform iwish.audit(v_actor, 'assign_lead', 'lead', p_lead_id::text, v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), nullif(trim(p_reason), ''));
end;
$$;

create or replace function iwish.rpc_lead_transfer(
  p_lead_id uuid,
  p_new_team_id integer,
  p_new_owner uuid,
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
begin
  if not iwish.has_permission(v_actor, 'leads.transfer') then
    raise exception 'ERR_NO_PERMISSION:leads.transfer';
  end if;
  select * into v_lead from public.leads
  where id = p_lead_id and coalesce(is_deleted, false) = false;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.transfer') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.transfer';
  end if;
  perform iwish.validate_lead_assignment_target(p_new_owner, p_new_team_id);
  perform iwish.enforce_lead_quota(p_new_owner, p_lead_id);

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set team_id = p_new_team_id, owner_id = p_new_owner
  where id = p_lead_id and coalesce(is_deleted, false) = false;
  perform iwish.audit(v_actor, 'transfer_lead', 'lead', p_lead_id::text, v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), nullif(trim(p_reason), ''));
end;
$$;

comment on function iwish.lead_counts_toward_quota(uuid,text,text,text,text,boolean)
is 'Canonical effective-lead definition used by the 60-lead quota guard.';
