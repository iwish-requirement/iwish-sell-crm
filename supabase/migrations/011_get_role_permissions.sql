-- 011_get_role_permissions.sql
-- RPC for reading role_permissions matrix as JSON

create or replace function iwish.rpc_get_role_permissions(
  p_role_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not iwish.has_permission(v_actor, 'role_permissions.manage') then
    raise exception 'ERR_NO_PERMISSION:role_permissions.manage';
  end if;

  return jsonb_build_object(
    'role_id', p_role_id,
    'permissions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'permission_key', rp.permission_key,
          'effect', rp.effect,
          'scope_type', rp.scope_type,
          'scope_rule', rp.scope_rule
        )
      ), '[]'::jsonb)
      from public.role_permissions rp
      where rp.role_id = p_role_id
    )
  );
end $$;

create or replace function public.rpc_get_role_permissions(
  p_role_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_get_role_permissions(p_role_id);
$$;

grant execute on function public.rpc_get_role_permissions(uuid) to authenticated, service_role;
