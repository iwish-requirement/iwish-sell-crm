-- 030_leads_update_self_scope_override.sql
-- Allow actors to always update their own leads (owner/created_by), even if team scope no longer matches.
-- This fixes the case where a user changes team but still needs to edit leads they personally own.

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

  -- scope check: prefer generic in_scope_for_lead, but always allow
  -- actors to update leads they own or created, even if team changed.
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    if v_lead.owner_id <> v_actor and v_lead.created_by <> v_actor then
      raise exception 'ERR_OUT_OF_SCOPE:leads.update';
    end if;
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

-- keep public wrapper signature unchanged
create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_update(p_lead_id, patch, p_reason);
$$;

grant execute on function public.rpc_lead_update(uuid, jsonb, text) to authenticated, service_role;
