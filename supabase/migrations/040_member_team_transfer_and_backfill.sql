-- 040_member_team_transfer_and_backfill.sql
-- 新增成员转团队级联 RPC，并对历史数据做一次性回填

-- 1) 新增后端 RPC：成员转团队时，顺带把其名下线索的 team_id 一起迁移
create or replace function iwish.rpc_member_transfer_team(
  p_user_id uuid,
  p_new_team_id int,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before_profile jsonb;
  v_after_profile jsonb;
begin
  if v_actor is null then
    raise exception 'ERR_UNAUTHENTICATED';
  end if;

  if not iwish.has_permission(v_actor, 'profiles.manage') then
    raise exception 'ERR_NO_PERMISSION:profiles.manage';
  end if;

  select to_jsonb(p.*) into v_before_profile from public.profiles p where p.id = p_user_id;
  if v_before_profile is null then
    raise exception 'ERR_NOT_FOUND:profile';
  end if;

  update public.profiles
  set team_id = p_new_team_id,
      role_id = p_role_id
  where id = p_user_id
    and status = 'active';

  if not found then
    raise exception 'ERR_INVALID_STATUS:only_active_can_change_org';
  end if;

  -- 将该成员当前名下的线索团队归属一并迁移到新团队
  update public.leads l
  set team_id = p_new_team_id
  where l.owner_id = p_user_id
    and l.team_id is distinct from p_new_team_id;

  select to_jsonb(p.*) into v_after_profile from public.profiles p where p.id = p_user_id;

  perform iwish.audit(
    v_actor,
    'member_transfer_team_with_leads',
    'profile',
    p_user_id::text,
    v_before_profile,
    v_after_profile,
    jsonb_build_object('new_team_id', p_new_team_id)
  );
end
$$;

create or replace function public.rpc_member_transfer_team(
  p_user_id uuid,
  p_new_team_id int,
  p_role_id uuid
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_member_transfer_team(p_user_id, p_new_team_id, p_role_id);
$$;


-- 2) 一次性回填历史数据：
--    对已经调整过 profiles.team_id 的成员，将其名下线索的 team_id 对齐为当前团队，
--    避免报表中“人已在新团队，但线索团队仍停留在旧团队”
update public.leads l
set team_id = p.team_id
from public.profiles p
where l.owner_id = p.id
  and p.team_id is not null
  and l.team_id is distinct from p.team_id;