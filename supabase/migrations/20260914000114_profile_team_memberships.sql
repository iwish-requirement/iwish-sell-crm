-- A profile keeps profiles.team_id as its primary/default team for backwards
-- compatibility, while this table records every team the member belongs to.
create table if not exists public.profile_team_memberships (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_id int not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (profile_id, team_id)
);

create index if not exists idx_profile_team_memberships_team
  on public.profile_team_memberships(team_id, profile_id);

insert into public.profile_team_memberships(profile_id, team_id)
select id, team_id from public.profiles where team_id is not null
on conflict do nothing;

alter table public.profile_team_memberships enable row level security;
grant select, insert, update, delete on public.profile_team_memberships to authenticated, service_role;
drop policy if exists profile_team_memberships_select on public.profile_team_memberships;
create policy profile_team_memberships_select on public.profile_team_memberships
for select to authenticated
using (iwish.is_active_user(auth.uid()) and (profile_id = auth.uid() or iwish.has_permission(auth.uid(), 'teams.read') or iwish.has_permission(auth.uid(), 'profiles.manage')));

drop policy if exists profile_team_memberships_manage on public.profile_team_memberships;
create policy profile_team_memberships_manage on public.profile_team_memberships
for all to authenticated
using (iwish.has_permission(auth.uid(), 'profiles.manage'))
with check (iwish.has_permission(auth.uid(), 'profiles.manage'));

create or replace function iwish.rpc_profile_add_team_membership(p_user_id uuid, p_team_id int)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid();
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then raise exception 'ERR_NO_PERMISSION:profiles.manage'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then raise exception 'ERR_INVALID_STATUS:only_active_can_change_org'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and is_active) then raise exception 'ERR_NOT_FOUND:team'; end if;
  insert into public.profile_team_memberships(profile_id, team_id, created_by) values (p_user_id, p_team_id, v_actor) on conflict do nothing;
end $$;

create or replace function public.rpc_profile_add_team_membership(p_user_id uuid, p_team_id int)
returns void language sql security definer set search_path = public, iwish as $$
  select iwish.rpc_profile_add_team_membership($1, $2);
$$;
grant execute on function public.rpc_profile_add_team_membership(uuid, int) to authenticated, service_role;

-- Keep the legacy primary-team write paths in sync for newly approved or
-- transferred members.
create or replace function iwish.rpc_profile_update_org(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void language plpgsql security definer set search_path = public, iwish as $$
declare v_actor uuid := auth.uid(); v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'profiles.manage') then raise exception 'ERR_NO_PERMISSION:profiles.manage'; end if;
  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;
  if v_before is null then raise exception 'ERR_NOT_FOUND:profile'; end if;
  update public.profiles set team_id = p_team_id, role_id = p_role_id where id = p_user_id and status = 'active';
  if not found then raise exception 'ERR_INVALID_STATUS:only_active_can_change_org'; end if;
  insert into public.profile_team_memberships(profile_id, team_id, created_by) values (p_user_id, p_team_id, v_actor) on conflict do nothing;
  perform iwish.audit(v_actor, 'update_profile_org', 'profile', p_user_id::text, v_before, (select to_jsonb(p.*) from public.profiles p where p.id = p_user_id), null);
end $$;

create or replace function public.rpc_profile_update_org(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void language sql security definer set search_path = public, iwish as $$
  select iwish.rpc_profile_update_org($1, $2, $3);
$$;

-- Team-scoped permissions now include every membership, not only the legacy
-- primary team column.
create or replace function iwish.in_scope_for_lead(uid uuid, lead_row public.leads, perm_key text)
returns boolean language plpgsql stable security definer set search_path = public, iwish as $$
declare v_scope jsonb; v_scope_type text; v_scope_rule jsonb; v_user_team int;
begin
  if not iwish.has_permission(uid, perm_key) then return false; end if;
  v_scope := iwish.get_effective_scope(uid, perm_key); if v_scope is null then return false; end if;
  v_scope_type := v_scope->>'scope_type'; v_scope_rule := v_scope->'scope_rule';
  if v_scope_type = 'org' then return true; end if;
  if v_scope_type = 'self' then
    return lead_row.owner_id = uid or lead_row.created_by = uid or exists (select 1 from public.lead_shares ls where ls.lead_id = lead_row.id and ls.shared_to = uid);
  end if;
  if v_scope_type = 'team' then
    return exists (select 1 from public.profile_team_memberships m where m.profile_id = uid and m.team_id = lead_row.team_id)
      or (select p.team_id from public.profiles p where p.id = uid) = lead_row.team_id;
  end if;
  if v_scope_type = 'custom' then return iwish.eval_custom_scope(uid, lead_row, v_scope_rule); end if;
  return false;
end $$;
