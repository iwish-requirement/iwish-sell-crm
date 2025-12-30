-- 025_lead_stage_lifecycle.sql
-- Standardize lead stage lifecycle (L1-L4 + Won) and enforce transition rules.

-- 1) Normalize existing stage values: migrate legacy "new" to "L1"
update public.leads
set stage = 'L1'
where stage = 'new';

-- 2) Enforce allowed stage values via CHECK constraint and set default to L1
alter table public.leads
  drop constraint if exists leads_stage_valid,
  alter column stage set default 'L1',
  add constraint leads_stage_valid
    check (stage in ('L1','L2','L3','L4','Won'));


-- 3) Update rpc_lead_update to enforce forward-only stage transitions and require reason on upgrade
create or replace function iwish.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_lead public.leads;
  k text;
  v_is_return_to_pool boolean := false;
  v_old_stage text;
  v_new_stage text;
  v_old_rank int;
  v_new_rank int;
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

  -- detect return-to-pool transition and enforce dedicated permission
  if patch ? 'status' then
    if patch->>'status' = 'pool' and v_lead.status <> 'pool' then
      v_is_return_to_pool := true;

      if not iwish.has_permission(v_actor, 'leads.pool.return') then
        raise exception 'ERR_NO_PERMISSION:leads.pool.return';
      end if;
    end if;
  end if;

  -- stage lifecycle validation (forward-only, require reason on upgrade, forbid changing closed leads)
  if patch ? 'stage' then
    v_old_stage := v_lead.stage;
    v_new_stage := patch->>'stage';

    -- if stage is unchanged or null, skip
    if v_new_stage is not null and v_new_stage <> v_old_stage then
      -- closed leads cannot change stage via generic update RPC
      if v_lead.status = 'closed' then
        raise exception 'ERR_INVALID_STATUS:cannot_change_stage_when_closed';
      end if;

      if v_new_stage not in ('L1','L2','L3','L4','Won') then
        raise exception 'ERR_VALIDATION:invalid_stage';
      end if;

      v_old_rank := case v_old_stage
        when 'L1' then 1
        when 'L2' then 2
        when 'L3' then 3
        when 'L4' then 4
        when 'Won' then 5
        else 0
      end;

      v_new_rank := case v_new_stage
        when 'L1' then 1
        when 'L2' then 2
        when 'L3' then 3
        when 'L4' then 4
        when 'Won' then 5
        else 0
      end;

      -- disallow downgrades
      if v_new_rank < v_old_rank then
        raise exception 'ERR_INVALID_STAGE_TRANSITION:cannot_downgrade';
      end if;

      -- require reason on upgrade
      if v_new_rank > v_old_rank then
        if p_reason is null or length(trim(p_reason)) = 0 then
          raise exception 'ERR_VALIDATION:stage_reason_required';
        end if;
      end if;
    end if;
  end if;

  v_before := to_jsonb(v_lead.*);

  -- field-level checks
  for k in select jsonb_object_keys(patch)
  loop
    if k in ('owner_id','team_id','created_by') then
      raise exception 'ERR_FIELD_FORBIDDEN:use_assign_or_transfer';
    end if;

    if k in ('customer_phone','customer_email','address','budget') then
      if not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then
        raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_sensitive';
      end if;
    end if;

    if k in ('internal_score','blacklist_reason') then
      if not iwish.has_permission(v_actor, 'leads.fields.write_internal') then
        raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_internal';
      end if;
    end if;
  end loop;

  update public.leads
  set
    name = coalesce(patch->>'name', name),
    source = coalesce(patch->>'source', source),
    stage = coalesce(patch->>'stage', stage),
    status = coalesce(patch->>'status', status),
    customer_name = coalesce(patch->>'customer_name', customer_name),
    customer_phone = coalesce(patch->>'customer_phone', customer_phone),
    customer_email = coalesce(patch->>'customer_email', customer_email),
    address = coalesce(patch->>'address', address),
    budget = coalesce((patch->>'budget')::numeric, budget),
    internal_score = coalesce((patch->>'internal_score')::int, internal_score),
    blacklist_reason = coalesce(patch->>'blacklist_reason', blacklist_reason),
    last_contact_at = coalesce((patch->>'last_contact_at')::timestamptz, last_contact_at),
    next_contact_at = coalesce((patch->>'next_contact_at')::timestamptz, next_contact_at),
    customer_grade = coalesce(patch->>'customer_grade', customer_grade),
    source_level1 = coalesce(patch->>'source_level1', source_level1),
    source_level2 = coalesce(patch->>'source_level2', source_level2),
    tags = coalesce((select array_agg(value::text) from jsonb_array_elements_text(patch->'tags')), tags)
  where id = p_lead_id;

  if v_is_return_to_pool then
    perform iwish.audit(
      v_actor,
      'return_lead_to_pool',
      'lead',
      p_lead_id::text,
      v_before,
      (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
      p_reason
    );
  else
    perform iwish.audit(
      v_actor,
      'update_lead',
      'lead',
      p_lead_id::text,
      v_before,
      (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
      p_reason
    );
  end if;
end $$;


-- 4) Ensure public wrapper for rpc_lead_update exists with the same signature
create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_update(p_lead_id, patch, p_reason);
$$;

grant execute on function public.rpc_lead_update(uuid, jsonb, text) to authenticated, service_role;


-- 5) Update rpc_lead_close so that successful close moves stage to Won
create or replace function iwish.rpc_lead_close(p_lead_id uuid, p_result text, p_reason text)
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
  if not iwish.has_permission(v_actor, 'leads.close') then
    raise exception 'ERR_NO_PERMISSION:leads.close';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.close') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.close';
  end if;

  if p_result not in ('won','lost') then
    raise exception 'ERR_VALIDATION:close_result_must_be_won_or_lost';
  end if;

  v_before := to_jsonb(v_lead.*);

  update public.leads
  set status = 'closed',
      close_result = p_result,
      close_reason = p_reason,
      stage = case when p_result = 'won' then 'Won' else stage end
  where id = p_lead_id;

  perform iwish.audit(v_actor, 'close_lead', 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason);
end $$;
