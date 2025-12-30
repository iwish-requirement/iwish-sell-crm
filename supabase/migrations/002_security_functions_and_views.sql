-- is_active_user
create or replace function iwish.is_active_user(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.status = 'active'
  );
$$;

-- has_permission
create or replace function iwish.has_permission(uid uuid, perm_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, iwish
as $$
declare
  v_role_id uuid;
  v_now timestamptz := now();
begin
  -- must be active
  if not iwish.is_active_user(uid) then
    return false;
  end if;

  -- permission enabled
  if not exists (select 1 from public.permissions where key = perm_key and is_enabled = true) then
    return false;
  end if;

  -- user deny
  if exists (
    select 1 from public.user_permissions up
    where up.user_id = uid
      and up.permission_key = perm_key
      and up.effect = 'deny'
      and (up.expires_at is null or up.expires_at > v_now)
  ) then
    return false;
  end if;

  -- user allow
  if exists (
    select 1 from public.user_permissions up
    where up.user_id = uid
      and up.permission_key = perm_key
      and up.effect = 'allow'
      and (up.expires_at is null or up.expires_at > v_now)
  ) then
    return true;
  end if;

  select role_id into v_role_id from public.profiles where id = uid;

  -- role deny
  if exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_role_id
      and rp.permission_key = perm_key
      and rp.effect = 'deny'
  ) then
    return false;
  end if;

  -- role allow
  if exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_role_id
      and rp.permission_key = perm_key
      and rp.effect = 'allow'
  ) then
    return true;
  end if;

  return false;
end $$;

-- get_effective_scope
create or replace function iwish.get_effective_scope(uid uuid, perm_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, iwish
as $$
declare
  v_now timestamptz := now();
  v_role_id uuid;
  v_scope_type scope_type;
  v_scope_rule jsonb;
begin
  if not iwish.has_permission(uid, perm_key) then
    return null;
  end if;

  -- user allow override
  select up.scope_type, up.scope_rule
    into v_scope_type, v_scope_rule
  from public.user_permissions up
  where up.user_id = uid
    and up.permission_key = perm_key
    and up.effect = 'allow'
    and (up.expires_at is null or up.expires_at > v_now)
  order by up.created_at desc
  limit 1;

  if v_scope_type is not null then
    return jsonb_build_object('scope_type', v_scope_type::text, 'scope_rule', v_scope_rule);
  end if;

  select role_id into v_role_id from public.profiles where id = uid;

  -- role allow
  select rp.scope_type, rp.scope_rule
    into v_scope_type, v_scope_rule
  from public.role_permissions rp
  where rp.role_id = v_role_id
    and rp.permission_key = perm_key
    and rp.effect = 'allow'
  limit 1;

  if v_scope_type is null then
    return jsonb_build_object('scope_type', 'self', 'scope_rule', null);
  end if;

  return jsonb_build_object('scope_type', v_scope_type::text, 'scope_rule', v_scope_rule);
end $$;

-- eval_custom_scope
create or replace function iwish.eval_custom_scope(uid uuid, lead_row public.leads, scope_rule jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public, iwish
as $$
declare
  v_scope_set_id uuid;
  v_def jsonb;
  v_team_ids int[];
  v_user_ids uuid[];
begin
  v_scope_set_id := (scope_rule->>'scope_set_id')::uuid;
  if v_scope_set_id is null then
    return false;
  end if;

  select definition into v_def
  from public.custom_scope_sets
  where id = v_scope_set_id and resource = 'leads';

  if v_def is null then
    return false;
  end if;

  -- team_ids
  if (v_def ? 'team_ids') then
    select array_agg(value::int) into v_team_ids
    from jsonb_array_elements_text(v_def->'team_ids');

    if v_team_ids is not null and lead_row.team_id = any(v_team_ids) then
      return true;
    end if;
  end if;

  -- user_ids (owner)
  if (v_def ? 'user_ids') then
    select array_agg(value::uuid) into v_user_ids
    from jsonb_array_elements_text(v_def->'user_ids');

    if v_user_ids is not null and lead_row.owner_id = any(v_user_ids) then
      return true;
    end if;
  end if;

  -- rules: source_in / stage_in
  if (v_def ? 'rules') then
    if (v_def->'rules' ? 'source_in') then
      if lead_row.source is not null and lead_row.source = any (
        select array_agg(value::text) from jsonb_array_elements_text(v_def->'rules'->'source_in')
      ) then
        return true;
      end if;
    end if;

    if (v_def->'rules' ? 'stage_in') then
      if lead_row.stage = any (
        select array_agg(value::text) from jsonb_array_elements_text(v_def->'rules'->'stage_in')
      ) then
        return true;
      end if;
    end if;
  end if;

  return false;
end $$;

-- in_scope_for_lead
create or replace function iwish.in_scope_for_lead(uid uuid, lead_row public.leads, perm_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, iwish
as $$
declare
  v_scope jsonb;
  v_scope_type text;
  v_scope_rule jsonb;
  v_user_team int;
begin
  if not iwish.has_permission(uid, perm_key) then
    return false;
  end if;

  v_scope := iwish.get_effective_scope(uid, perm_key);
  if v_scope is null then
    return false;
  end if;

  v_scope_type := v_scope->>'scope_type';
  v_scope_rule := v_scope->'scope_rule';

  if v_scope_type = 'org' then
    return true;
  end if;

  if v_scope_type = 'self' then
    if lead_row.owner_id = uid or lead_row.created_by = uid then
      return true;
    end if;

    if exists (
      select 1 from public.lead_shares ls
      where ls.lead_id = lead_row.id and ls.shared_to = uid
    ) then
      return true;
    end if;

    return false;
  end if;

  if v_scope_type = 'team' then
    select team_id into v_user_team from public.profiles where id = uid;
    return lead_row.team_id = v_user_team;
  end if;

  if v_scope_type = 'custom' then
    return iwish.eval_custom_scope(uid, lead_row, v_scope_rule);
  end if;

  return false;
end $$;

-- masking helpers
create or replace function iwish.mask_phone(v text)
returns text language sql immutable as $$
  select case
    when v is null or length(v) < 4 then null
    else concat(left(v, 3), '****', right(v, 2))
  end;
$$;

create or replace function iwish.mask_email(v text)
returns text language sql immutable as $$
  select case
    when v is null or position('@' in v) = 0 then null
    else concat(left(v, 2), '***', substring(v from position('@' in v)))
  end;
$$;

-- profiles_public_view
create or replace view public.profiles_public_view as
select
  id,
  full_name,
  avatar_url,
  team_id,
  role_id,
  status
from public.profiles;

-- leads_secure_view
create or replace view public.leads_secure_view as
select
  l.id,
  l.team_id,
  l.owner_id,
  l.created_by,
  l.name,
  l.source,
  l.stage,
  l.status,
  l.close_result,
  l.close_reason,
  l.last_contact_at,
  l.created_at,
  l.updated_at,
  l.customer_name,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone
    else iwish.mask_phone(l.customer_phone)
  end as customer_phone,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email
    else iwish.mask_email(l.customer_email)
  end as customer_email,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address
    else null
  end as address,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget
    else null
  end as budget,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score
    else null
  end as internal_score,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason
    else null
  end as blacklist_reason
from public.leads l;
