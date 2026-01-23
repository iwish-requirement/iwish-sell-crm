-- 038_wecom_gateway_bind_tokens.sql
-- WeCom unified gateway binding: bindToken persistence + secure callback RPC

-- 1) bind tokens table (one-time + expiry)
create table if not exists public.wecom_bind_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_wecom_bind_tokens_user_time on public.wecom_bind_tokens(user_id, created_at desc);
create index if not exists idx_wecom_bind_tokens_expires on public.wecom_bind_tokens(expires_at);

alter table public.wecom_bind_tokens enable row level security;

drop policy if exists wecom_bind_tokens_select_self on public.wecom_bind_tokens;
create policy wecom_bind_tokens_select_self
on public.wecom_bind_tokens
for select
using (user_id = auth.uid());

drop policy if exists wecom_bind_tokens_insert_self on public.wecom_bind_tokens;
create policy wecom_bind_tokens_insert_self
on public.wecom_bind_tokens
for insert
with check (
  user_id = auth.uid()
  and iwish.is_active_user(auth.uid())
);

-- 2) callback RPC (called by Next.js route handler using service_role key)
create or replace function iwish.rpc_wecom_bind_callback(p_bind_token text, p_wecom_user_id text)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_token public.wecom_bind_tokens;
  v_user_id uuid;
  v_trim_user_id text;
  v_before jsonb;
  v_after jsonb;
begin
  v_trim_user_id := nullif(trim(p_wecom_user_id), '');
  if v_trim_user_id is null then
    raise exception 'ERR_VALIDATION:wecom_user_id_required';
  end if;

  if p_bind_token is null or length(trim(p_bind_token)) = 0 then
    raise exception 'ERR_VALIDATION:bind_token_required';
  end if;

  -- lock token row to prevent replay/race
  select * into v_token
  from public.wecom_bind_tokens
  where token = p_bind_token
  for update;

  if v_token.token is null then
    raise exception 'ERR_NOT_FOUND:bind_token';
  end if;

  if v_token.used then
    raise exception 'ERR_ALREADY_USED:bind_token';
  end if;

  if v_token.expires_at <= now() then
    raise exception 'ERR_EXPIRED:bind_token';
  end if;

  v_user_id := v_token.user_id;

  select to_jsonb(p.*) into v_before from public.profiles p where p.id = v_user_id;

  update public.profiles
  set wecom_user_id = v_trim_user_id,
      wecom_bind_status = 'bound',
      wecom_bound_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'ERR_NOT_FOUND:profile';
  end if;

  update public.wecom_bind_tokens
  set used = true,
      used_at = now()
  where token = p_bind_token;

  v_after := (select to_jsonb(p.*) from public.profiles p where p.id = v_user_id);
  perform iwish.audit(v_user_id, 'wecom_bind', 'profile', v_user_id::text, v_before, v_after, null);
end $$;

-- restrict execute to service_role only
revoke execute on function iwish.rpc_wecom_bind_callback(text, text) from public;
revoke execute on function iwish.rpc_wecom_bind_callback(text, text) from anon;
revoke execute on function iwish.rpc_wecom_bind_callback(text, text) from authenticated;

grant execute on function iwish.rpc_wecom_bind_callback(text, text) to service_role;
