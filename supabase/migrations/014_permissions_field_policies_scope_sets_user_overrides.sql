-- 014_permissions_field_policies_scope_sets_user_overrides.sql
-- RPCs and audit logging for field_policies, custom_scope_sets and user_permissions

set search_path = public, iwish;

-- rpc_field_policies_set: manage field-level policies per resource
create or replace function iwish.rpc_field_policies_set(
  p_resource text,
  p_items    jsonb
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor        uuid := auth.uid();
  v_before       jsonb;
  v_after        jsonb;
  v_item         jsonb;
  v_field        text;
  v_read_key     text;
  v_write_key    text;
  v_mask_strategy text;
  v_enabled      boolean;
begin
  if not iwish.has_permission(v_actor, 'field_policies.manage') then
    raise exception 'ERR_NO_PERMISSION:field_policies.manage';
  end if;

  -- snapshot before
  select coalesce(jsonb_agg(to_jsonb(fp.*)), '[]'::jsonb)
  into v_before
  from public.field_policies fp
  where fp.resource = p_resource;

  -- apply items
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_field := nullif(trim(v_item->>'field'), '');
    if v_field is null then
      continue;
    end if;

    v_enabled := coalesce((v_item->>'enabled')::boolean, true);

    -- delete when explicitly disabled
    if not v_enabled then
      delete from public.field_policies
      where resource = p_resource
        and field = v_field;
      continue;
    end if;

    v_read_key := nullif(trim(v_item->>'read_permission_key'), '');
    v_write_key := nullif(trim(v_item->>'write_permission_key'), '');
    v_mask_strategy := coalesce(nullif(trim(v_item->>'mask_strategy'), ''), 'null');

    insert into public.field_policies(resource, field, read_permission_key, write_permission_key, mask_strategy)
    values (p_resource, v_field, v_read_key, v_write_key, v_mask_strategy)
    on conflict (resource, field) do update
      set read_permission_key = excluded.read_permission_key,
          write_permission_key = excluded.write_permission_key,
          mask_strategy        = excluded.mask_strategy;
  end loop;

  -- snapshot after
  select coalesce(jsonb_agg(to_jsonb(fp.*)), '[]'::jsonb)
  into v_after
  from public.field_policies fp
  where fp.resource = p_resource;

  perform iwish.audit(
    v_actor,
    'update_field_policies',
    'field_policies',
    p_resource,
    v_before,
    v_after,
    null
  );
end $$;

create or replace function public.rpc_field_policies_set(
  p_resource text,
  p_items    jsonb
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_field_policies_set(p_resource, p_items);
$$;

grant execute on function public.rpc_field_policies_set(text, jsonb) to authenticated, service_role;


-- rpc_scope_sets_set: manage custom scope sets per resource
create or replace function iwish.rpc_scope_sets_set(
  p_resource text,
  p_items    jsonb
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor      uuid := auth.uid();
  v_before     jsonb;
  v_after      jsonb;
  v_item       jsonb;
  v_id         uuid;
  v_name       text;
  v_definition jsonb;
  v_deleted    boolean;
begin
  if not iwish.has_permission(v_actor, 'scopes.manage') then
    raise exception 'ERR_NO_PERMISSION:scopes.manage';
  end if;

  -- snapshot before
  select coalesce(jsonb_agg(to_jsonb(cs.*)), '[]'::jsonb)
  into v_before
  from public.custom_scope_sets cs
  where cs.resource = p_resource;

  -- apply items
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_id := nullif(v_item->>'id', '')::uuid;
    v_name := nullif(trim(v_item->>'name'), '');
    v_definition := v_item->'definition';
    v_deleted := coalesce((v_item->>'deleted')::boolean, false);

    if v_deleted then
      if v_id is not null then
        delete from public.custom_scope_sets
        where id = v_id
          and resource = p_resource;
      end if;
      continue;
    end if;

    if v_name is null or v_definition is null then
      continue;
    end if;

    if v_id is null then
      insert into public.custom_scope_sets(name, resource, definition, created_by)
      values (v_name, p_resource, v_definition, v_actor);
    else
      update public.custom_scope_sets
      set name       = v_name,
          definition = v_definition
      where id = v_id
        and resource = p_resource;
    end if;
  end loop;

  -- snapshot after
  select coalesce(jsonb_agg(to_jsonb(cs.*)), '[]'::jsonb)
  into v_after
  from public.custom_scope_sets cs
  where cs.resource = p_resource;

  perform iwish.audit(
    v_actor,
    'update_scope_sets',
    'scope_sets',
    p_resource,
    v_before,
    v_after,
    null
  );
end $$;

create or replace function public.rpc_scope_sets_set(
  p_resource text,
  p_items    jsonb
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_scope_sets_set(p_resource, p_items);
$$;

grant execute on function public.rpc_scope_sets_set(text, jsonb) to authenticated, service_role;


-- rpc_user_permissions_set: manage user-level allow/deny overrides
create or replace function iwish.rpc_user_permissions_set(
  p_user_id uuid,
  p_items   jsonb
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor        uuid := auth.uid();
  v_before       jsonb;
  v_after        jsonb;
  v_item         jsonb;
  v_perm_key     text;
  v_effect_text  text;
  v_effect       perm_effect;
  v_expires_at   timestamptz;
  v_reason       text;
begin
  if not iwish.has_permission(v_actor, 'user_permissions.manage') then
    raise exception 'ERR_NO_PERMISSION:user_permissions.manage';
  end if;

  -- snapshot before
  select coalesce(jsonb_agg(to_jsonb(up.*)), '[]'::jsonb)
  into v_before
  from public.user_permissions up
  where up.user_id = p_user_id;

  -- apply items
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_perm_key := nullif(trim(v_item->>'permission_key'), '');
    if v_perm_key is null then
      continue;
    end if;

    v_effect_text := coalesce(nullif(trim(v_item->>'effect'), ''), 'unset');

    if v_effect_text = 'unset' then
      delete from public.user_permissions up
      where up.user_id = p_user_id
        and up.permission_key = v_perm_key;
      continue;
    end if;

    v_effect := v_effect_text::perm_effect;
    v_expires_at := nullif(v_item->>'expires_at', '')::timestamptz;
    v_reason := nullif(trim(v_item->>'reason'), '');

    -- replace any existing overrides for this permission
    delete from public.user_permissions up
    where up.user_id = p_user_id
      and up.permission_key = v_perm_key;

    insert into public.user_permissions(
      user_id,
      permission_key,
      effect,
      scope_type,
      scope_rule,
      expires_at,
      reason
    ) values (
      p_user_id,
      v_perm_key,
      v_effect,
      null,
      null,
      v_expires_at,
      v_reason
    );
  end loop;

  -- snapshot after
  select coalesce(jsonb_agg(to_jsonb(up.*)), '[]'::jsonb)
  into v_after
  from public.user_permissions up
  where up.user_id = p_user_id;

  perform iwish.audit(
    v_actor,
    'update_user_permissions',
    'profile',
    p_user_id::text,
    v_before,
    v_after,
    null
  );
end $$;

create or replace function public.rpc_user_permissions_set(
  p_user_id uuid,
  p_items   jsonb
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_user_permissions_set(p_user_id, p_items);
$$;

grant execute on function public.rpc_user_permissions_set(uuid, jsonb) to authenticated, service_role;
