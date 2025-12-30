-- 021_rpc_recent_activities_feed.sql
-- Purpose: Provide a scoped recent activities feed for the dashboard based on audit_logs and lead scope

create or replace function iwish.rpc_recent_activities(p_limit integer default 32)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  target_type text,
  target_id text,
  reason text,
  created_at timestamptz,
  before jsonb,
  after jsonb
)
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_can_view_audit boolean;
  v_limit integer := coalesce(p_limit, 32);
begin
  if v_actor is null then
    return;
  end if;

  -- 管理员/具备 audit.read 权限的账号：可以查看全局审计动态
  v_can_view_audit := iwish.has_permission(v_actor, 'audit.read');

  if v_can_view_audit then
    return query
    select
      al.id,
      al.actor_id,
      coalesce(pp.full_name, '') as actor_name,
      al.action,
      al.target_type,
      al.target_id,
      al.reason,
      al.created_at,
      al.before,
      al.after
    from public.audit_logs al
    left join public.profiles_public pp on pp.id = al.actor_id
    order by al.created_at desc
    limit v_limit;
  else
    -- 普通账号：仅返回与当前用户强相关的动态
    -- 1) 当前用户作为 actor 触发的动作
    -- 2) 目标对象为线索，且该线索在当前用户的 leads.read scope 内的动作
    return query
    select
      al.id,
      al.actor_id,
      coalesce(pp.full_name, '') as actor_name,
      al.action,
      al.target_type,
      al.target_id,
      al.reason,
      al.created_at,
      al.before,
      al.after
    from public.audit_logs al
    left join public.profiles_public pp on pp.id = al.actor_id
    where
      al.actor_id = v_actor
      or (
        al.target_type = 'lead'
        and exists (
          select 1
          from public.leads l
          where l.id::text = al.target_id
            and iwish.in_scope_for_lead(v_actor, l, 'leads.read')
        )
      )
    order by al.created_at desc
    limit v_limit;
  end if;
end;
$$;

revoke all on function iwish.rpc_recent_activities(integer) from public;

grant execute on function iwish.rpc_recent_activities(integer) to authenticated;

drop function if exists public.rpc_recent_activities(integer);

create or replace function public.rpc_recent_activities(p_limit integer default 32)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  target_type text,
  target_id text,
  reason text,
  created_at timestamptz,
  before jsonb,
  after jsonb
)
language sql
security definer
set search_path = public, iwish
as $$
  select * from iwish.rpc_recent_activities(p_limit);
$$;

grant execute on function public.rpc_recent_activities(integer) to authenticated;
