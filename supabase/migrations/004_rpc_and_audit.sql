-- audit helper
create or replace function iwish.audit(actor uuid, action text, target_type text, target_id text, before jsonb, after jsonb, reason text)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  insert into public.audit_logs(actor_id, action, target_type, target_id, before, after, reason)
  values (actor, action, target_type, target_id, before, after, reason);
$$;

-- rpc_auth_approve
create or replace function iwish.rpc_auth_approve(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'auth.approve') then
    raise exception 'ERR_NO_PERMISSION:auth.approve';
  end if;

  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;

  update public.profiles
  set status = 'active',
      team_id = p_team_id,
      role_id = p_role_id,
      approved_at = now(),
      approved_by = v_actor,
      rejection_reason = null,
      rejected_at = null,
      rejected_by = null
  where id = p_user_id and status = 'pending';

  if not found then
    raise exception 'ERR_INVALID_STATUS:only_pending_can_approve';
  end if;

  perform iwish.audit(v_actor, 'approve_user', 'profile', p_user_id::text, v_before, (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id), null);
end $$;

-- rpc_auth_reject
create or replace function iwish.rpc_auth_reject(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'auth.reject') then
    raise exception 'ERR_NO_PERMISSION:auth.reject';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'ERR_VALIDATION:rejection_reason_required';
  end if;

  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;

  update public.profiles
  set status = 'rejected',
      rejected_at = now(),
      rejected_by = v_actor,
      rejection_reason = p_reason
  where id = p_user_id and status = 'pending';

  if not found then
    raise exception 'ERR_INVALID_STATUS:only_pending_can_reject';
  end if;

  perform iwish.audit(v_actor, 'reject_user', 'profile', p_user_id::text, v_before, (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id), p_reason);
end $$;

-- rpc_auth_disable
create or replace function iwish.rpc_auth_disable(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'auth.disable') then
    raise exception 'ERR_NO_PERMISSION:auth.disable';
  end if;

  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;

  update public.profiles
  set status = 'disabled',
      disabled_at = now(),
      disabled_by = v_actor,
      disable_reason = p_reason
  where id = p_user_id and status = 'active';

  if not found then
    raise exception 'ERR_INVALID_STATUS:only_active_can_disable';
  end if;

  perform iwish.audit(v_actor, 'disable_user', 'profile', p_user_id::text, v_before, (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id), p_reason);
end $$;

-- rpc_auth_restore
create or replace function iwish.rpc_auth_restore(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'auth.restore') then
    raise exception 'ERR_NO_PERMISSION:auth.restore';
  end if;

  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;

  update public.profiles
  set status = 'active',
      team_id = coalesce(p_team_id, team_id),
      role_id = coalesce(p_role_id, role_id),
      disabled_at = null,
      disabled_by = null,
      disable_reason = null
  where id = p_user_id and status = 'disabled';

  if not found then
    raise exception 'ERR_INVALID_STATUS:only_disabled_can_restore';
  end if;

  perform iwish.audit(v_actor, 'restore_user', 'profile', p_user_id::text, v_before, (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id), null);
end $$;

-- rpc_lead_create
create or replace function iwish.rpc_lead_create(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_team_id int := (payload->>'team_id')::int;
  v_owner uuid := (payload->>'owner_id')::uuid;
begin
  if not iwish.has_permission(v_actor, 'leads.create') then
    raise exception 'ERR_NO_PERMISSION:leads.create';
  end if;

  -- simple scope rule: if leads.create scope is self/team, enforce same team
  if (iwish.get_effective_scope(v_actor, 'leads.create')->>'scope_type') in ('self','team') then
    if v_team_id <> (select team_id from public.profiles where id = v_actor) then
      raise exception 'ERR_OUT_OF_SCOPE:team_mismatch_on_create';
    end if;
  end if;

  -- sensitive fields write permission
  if (payload ? 'customer_phone' or payload ? 'customer_email' or payload ? 'address' or payload ? 'budget') then
    if not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then
      raise exception 'ERR_FIELD_FORBIDDEN:write_sensitive_required';
    end if;
  end if;

  insert into public.leads(
    team_id, owner_id, created_by,
    name, source, stage, status,
    customer_name, customer_phone, customer_email, address, budget,
    internal_score, blacklist_reason, last_contact_at
  ) values (
    v_team_id,
    v_owner,
    v_actor,
    payload->>'name',
    payload->>'source',
    coalesce(payload->>'stage','new'),
    coalesce(payload->>'status','open'),
    payload->>'customer_name',
    payload->>'customer_phone',
    payload->>'customer_email',
    payload->>'address',
    (payload->>'budget')::numeric,
    (payload->>'internal_score')::int,
    payload->>'blacklist_reason',
    (payload->>'last_contact_at')::timestamptz
  )
  returning id into v_id;

  perform iwish.audit(v_actor, 'create_lead', 'lead', v_id::text, null, (select to_jsonb(l.*) from public.leads l where l.id = v_id), null);
  return v_id;
end $$;

-- rpc_lead_update
create or replace function iwish.rpc_lead_update(p_lead_id uuid, patch jsonb)
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
    last_contact_at = coalesce((patch->>'last_contact_at')::timestamptz, last_contact_at)
  where id = p_lead_id;

  perform iwish.audit(v_actor, 'update_lead', 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), null);
end $$;

-- rpc_lead_assign
create or replace function iwish.rpc_lead_assign(p_lead_id uuid, p_new_owner uuid)
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

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.assign') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.assign';
  end if;

  v_before := to_jsonb(v_lead.*);

  update public.leads set owner_id = p_new_owner where id = p_lead_id;

  perform iwish.audit(v_actor, 'assign_lead', 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), null);
end $$;

-- rpc_lead_transfer
create or replace function iwish.rpc_lead_transfer(p_lead_id uuid, p_new_team_id int, p_new_owner uuid)
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

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.transfer') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.transfer';
  end if;

  v_before := to_jsonb(v_lead.*);

  update public.leads
  set team_id = p_new_team_id,
      owner_id = p_new_owner
  where id = p_lead_id;

  perform iwish.audit(v_actor, 'transfer_lead', 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), null);
end $$;

-- rpc_lead_close
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
      close_reason = p_reason
  where id = p_lead_id;

  perform iwish.audit(v_actor, 'close_lead', 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason);
end $$;

-- rpc_permissions_preview
create or replace function iwish.rpc_permissions_preview(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then
    raise exception 'ERR_NO_PERMISSION:profiles.manage';
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'role_id', (select role_id from public.profiles where id = p_user_id),
    'permissions', (
      select jsonb_agg(
        jsonb_build_object(
          'key', p.key,
          'allowed', iwish.has_permission(p_user_id, p.key),
          'scope', iwish.get_effective_scope(p_user_id, p.key)
        )
      )
      from public.permissions p
      where p.is_enabled = true
    )
  );
end $$;
