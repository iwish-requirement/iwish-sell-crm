-- 012_profile_org_update.sql
-- Add RPC for updating profile organization (team + role) with audit

create or replace function iwish.rpc_profile_update_org(
  p_user_id uuid,
  p_team_id int,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then
    raise exception 'ERR_NO_PERMISSION:profiles.manage';
  end if;

  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;
  if v_before is null then
    raise exception 'ERR_NOT_FOUND:profile';
  end if;

  update public.profiles
  set team_id = p_team_id,
      role_id = p_role_id
  where id = p_user_id
    and status = 'active';

  if not found then
    raise exception 'ERR_INVALID_STATUS:only_active_can_change_org';
  end if;

  perform iwish.audit(
    v_actor,
    'update_profile_org',
    'profile',
    p_user_id::text,
    v_before,
    (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id),
    null
  );
end $$;

create or replace function public.rpc_profile_update_org(
  p_user_id uuid,
  p_team_id int,
  p_role_id uuid
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_profile_update_org(p_user_id, p_team_id, p_role_id);
$$;
