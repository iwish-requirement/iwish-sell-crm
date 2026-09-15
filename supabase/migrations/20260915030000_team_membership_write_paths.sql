-- Complete the multi-team write paths used by the organization UI.

create or replace function public.rpc_profile_transfer_team(
  p_user_id uuid, p_from_team_id int, p_to_team_id int, p_role_id uuid default null
)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid(); v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then raise exception 'ERR_NO_PERMISSION:profiles.manage'; end if;
  if not exists (select 1 from public.teams where id = p_to_team_id and is_active) then raise exception 'ERR_NOT_FOUND:team'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then raise exception 'ERR_INVALID_STATUS:only_active_can_change_org'; end if;
  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;
  delete from public.profile_team_memberships where profile_id = p_user_id and team_id = p_from_team_id;
  insert into public.profile_team_memberships(profile_id, team_id, created_by)
    values (p_user_id, p_to_team_id, v_actor) on conflict do nothing;
  update public.profiles set team_id = p_to_team_id, role_id = coalesce(p_role_id, role_id) where id = p_user_id;
  update public.leads set team_id = p_to_team_id where owner_id = p_user_id and team_id = p_from_team_id;
  perform iwish.audit(v_actor, 'member_transfer_team', 'profile', p_user_id::text, v_before,
    (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id),
    jsonb_build_object('from_team_id',p_from_team_id,'to_team_id',p_to_team_id));
end $$;
grant execute on function public.rpc_profile_transfer_team(uuid,int,int,uuid) to authenticated, service_role;

create or replace function public.rpc_profile_remove_team_membership(p_user_id uuid, p_team_id int)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid(); v_profile public.profiles; v_next_team int;
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then raise exception 'ERR_NO_PERMISSION:profiles.manage'; end if;
  select * into v_profile from public.profiles where id = p_user_id;
  if v_profile.id is null then raise exception 'ERR_NOT_FOUND:profile'; end if;
  delete from public.profile_team_memberships where profile_id = p_user_id and team_id = p_team_id;
  if v_profile.team_id = p_team_id then
    select m.team_id into v_next_team from public.profile_team_memberships m where m.profile_id = p_user_id order by m.created_at limit 1;
    update public.profiles set team_id = v_next_team where id = p_user_id;
    if v_next_team is not null then
      update public.leads set team_id = v_next_team where owner_id = p_user_id and team_id = p_team_id;
    end if;
  end if;
end $$;
grant execute on function public.rpc_profile_remove_team_membership(uuid,int) to authenticated, service_role;

create or replace function iwish.rpc_profile_update_org(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid(); v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then raise exception 'ERR_NO_PERMISSION:profiles.manage'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and is_active) then raise exception 'ERR_NOT_FOUND:team'; end if;
  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id and p.status = 'active';
  if v_before is null then raise exception 'ERR_INVALID_STATUS:only_active_can_change_org'; end if;
  update public.profiles set team_id = p_team_id, role_id = p_role_id where id = p_user_id;
  delete from public.profile_team_memberships where profile_id = p_user_id and team_id <> p_team_id;
  insert into public.profile_team_memberships(profile_id, team_id, created_by) values (p_user_id, p_team_id, v_actor) on conflict do nothing;
  perform iwish.audit(v_actor, 'update_profile_org', 'profile', p_user_id::text, v_before,
    (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id), null);
end $$;

create or replace function public.rpc_profile_update_org(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void language sql security definer set search_path = public, iwish as $$
  select iwish.rpc_profile_update_org($1,$2,$3);
$$;

-- Approval/restoration must seed the membership table so the first team is
-- visible to both the legacy and the multi-team readers.
create or replace function public.rpc_auth_approve(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void language plpgsql security definer set search_path = public, iwish as $$
begin
  perform iwish.rpc_auth_approve(p_user_id, p_team_id, p_role_id);
  insert into public.profile_team_memberships(profile_id, team_id, created_by)
    values (p_user_id, p_team_id, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.rpc_auth_restore(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void language plpgsql security definer set search_path = public, iwish as $$
begin
  perform iwish.rpc_auth_restore(p_user_id, p_team_id, p_role_id);
  if p_team_id is not null then
    insert into public.profile_team_memberships(profile_id, team_id, created_by)
      values (p_user_id, p_team_id, auth.uid()) on conflict do nothing;
  end if;
end $$;

-- Keep the old RPC name safe for integrations that still call it.
create or replace function iwish.rpc_member_transfer_team(p_user_id uuid, p_new_team_id int, p_role_id uuid)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid(); v_old_team int;
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then raise exception 'ERR_NO_PERMISSION:profiles.manage'; end if;
  select team_id into v_old_team from public.profiles where id = p_user_id and status = 'active';
  if v_old_team is null then raise exception 'ERR_INVALID_STATUS:only_active_can_change_org'; end if;
  perform public.rpc_profile_transfer_team(p_user_id, v_old_team, p_new_team_id, p_role_id);
end $$;
