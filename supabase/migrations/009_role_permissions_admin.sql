-- 009_role_permissions_admin.sql
-- RPC for managing role_permissions matrix with audit logging

create or replace function iwish.rpc_role_permissions_set_matrix(
  p_role_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
  v_permission_key text;
  v_effect perm_effect;
  v_scope scope_type;
  v_scope_rule jsonb;
begin
  if not iwish.has_permission(v_actor, 'role_permissions.manage') then
    raise exception 'ERR_NO_PERMISSION:role_permissions.manage';
  end if;

  -- capture previous state for this role
  select coalesce(jsonb_agg(to_jsonb(rp.*)), '[]'::jsonb)
  into v_before
  from public.role_permissions rp
  where rp.role_id = p_role_id;

  -- apply matrix changes: each item controls a single permission key for this role
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_permission_key := nullif(trim(v_item->>'permission_key'), '');

    if v_permission_key is null then
      continue;
    end if;

    -- if effect is null/empty, delete existing row (Unset)
    if coalesce(nullif(trim(v_item->>'effect'), ''), 'unset') = 'unset' then
      delete from public.role_permissions
      where role_id = p_role_id
        and permission_key = v_permission_key;
      continue;
    end if;

    v_effect := (v_item->>'effect')::perm_effect;
    v_scope := coalesce((v_item->>'scope_type')::scope_type, 'self');
    v_scope_rule := v_item->'scope_rule';

    insert into public.role_permissions(role_id, permission_key, effect, scope_type, scope_rule)
    values (p_role_id, v_permission_key, v_effect, v_scope, v_scope_rule)
    on conflict (role_id, permission_key) do update
      set effect = excluded.effect,
          scope_type = excluded.scope_type,
          scope_rule = excluded.scope_rule;
  end loop;

  -- capture new state
  select coalesce(jsonb_agg(to_jsonb(rp.*)), '[]'::jsonb)
  into v_after
  from public.role_permissions rp
  where rp.role_id = p_role_id;

  perform iwish.audit(
    v_actor,
    'update_role_permissions',
    'role',
    p_role_id::text,
    v_before,
    v_after,
    null
  );
end $$;

-- public wrapper for RPC so it is exposed via /rest/v1/rpc
create or replace function public.rpc_role_permissions_set_matrix(
  p_role_id uuid,
  p_items jsonb
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_role_permissions_set_matrix(p_role_id, p_items);
$$;

grant execute on function public.rpc_role_permissions_set_matrix(uuid, jsonb) to authenticated, service_role;

-- optional: ensure permission key for leads.pool.return exists for mapping "退回公海" 开关
insert into public.permissions(key, resource, action, name, description, is_system, is_enabled)
values
  ('leads.pool.return','leads','pool.return','Return Lead To Pool','Return leads back to public pool',true,true)
on conflict (key) do nothing;
