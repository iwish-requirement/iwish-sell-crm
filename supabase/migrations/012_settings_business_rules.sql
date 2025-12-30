-- 012_settings_business_rules.sql
-- Settings table and audit for pipeline business rules (public pool drop, warning thresholds)

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.settings enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read
on public.settings
for select
using (iwish.has_permission(auth.uid(), 'settings.read'));

drop policy if exists settings_manage on public.settings;
create policy settings_manage
on public.settings
for all
using (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'))
with check (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'));

create or replace function iwish.audit_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_action text;
  v_target_key text;
  v_before jsonb;
  v_after jsonb;
begin
  v_target_key := coalesce(new.key, old.key);

  if tg_op = 'INSERT' then
    v_action := 'create_setting';
    v_before := null;
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update_setting';
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_action := 'delete_setting';
    v_before := to_jsonb(old);
    v_after := null;
  end if;

  if v_actor is not null and v_action is not null then
    perform iwish.audit(
      v_actor,
      v_action,
      'setting',
      v_target_key,
      v_before,
      v_after,
      null
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    new.updated_at := now();
    new.updated_by := v_actor;
    return new;
  else
    return old;
  end if;
end
$$;

drop trigger if exists trg_settings_audit on public.settings;
create trigger trg_settings_audit
after insert or update or delete on public.settings
for each row execute function iwish.audit_settings_change();
