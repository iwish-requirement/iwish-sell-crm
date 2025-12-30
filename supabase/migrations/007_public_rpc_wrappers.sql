-- public wrappers for iwish.* RPC functions so they are exposed via /rest/v1/rpc

create or replace function public.rpc_lead_create(payload jsonb)
returns uuid
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_create(payload);
$$;

create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_update(p_lead_id, patch);
$$;

create or replace function public.rpc_lead_assign(p_lead_id uuid, p_new_owner uuid)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_assign(p_lead_id, p_new_owner);
$$;

create or replace function public.rpc_lead_transfer(p_lead_id uuid, p_new_team_id int, p_new_owner uuid)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_transfer(p_lead_id, p_new_team_id, p_new_owner);
$$;

create or replace function public.rpc_lead_close(p_lead_id uuid, p_result text, p_reason text)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_close(p_lead_id, p_result, p_reason);
$$;

create or replace function public.rpc_auth_approve(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_auth_approve(p_user_id, p_team_id, p_role_id);
$$;

create or replace function public.rpc_auth_reject(p_user_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_auth_reject(p_user_id, p_reason);
$$;

create or replace function public.rpc_auth_disable(p_user_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_auth_disable(p_user_id, p_reason);
$$;

create or replace function public.rpc_auth_restore(p_user_id uuid, p_team_id int, p_role_id uuid)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_auth_restore(p_user_id, p_team_id, p_role_id);
$$;

create or replace function public.rpc_permissions_preview(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_permissions_preview(p_user_id);
$$;

-- grant execute on RPC wrappers to application roles

grant execute on function public.rpc_lead_create(jsonb) to authenticated, service_role;
grant execute on function public.rpc_lead_update(uuid, jsonb) to authenticated, service_role;
grant execute on function public.rpc_lead_assign(uuid, uuid) to authenticated, service_role;
grant execute on function public.rpc_lead_transfer(uuid, int, uuid) to authenticated, service_role;
grant execute on function public.rpc_lead_close(uuid, text, text) to authenticated, service_role;
grant execute on function public.rpc_auth_approve(uuid, int, uuid) to authenticated, service_role;
grant execute on function public.rpc_auth_reject(uuid, text) to authenticated, service_role;
grant execute on function public.rpc_auth_disable(uuid, text) to authenticated, service_role;
grant execute on function public.rpc_auth_restore(uuid, int, uuid) to authenticated, service_role;
grant execute on function public.rpc_permissions_preview(uuid) to authenticated, service_role;
