-- 026_lead_view_presets.sql
-- Per-user saved view presets for lead board filters.

create table if not exists public.lead_view_presets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  filters jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lead_view_presets enable row level security;

-- 每个用户只能访问/管理自己的视图

drop policy if exists lead_view_presets_read on public.lead_view_presets;
create policy lead_view_presets_read
on public.lead_view_presets
for select
using (auth.uid() = profile_id);


drop policy if exists lead_view_presets_write on public.lead_view_presets;
create policy lead_view_presets_write
on public.lead_view_presets
for all
using (auth.uid() = profile_id)
with check (auth.uid() = profile_id);

-- updated_at 维护

create or replace function iwish.lead_view_presets_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, iwish
as $$
begin
  new.updated_at := now();
  return new;
end
$$;


drop trigger if exists trg_lead_view_presets_set_updated_at on public.lead_view_presets;
create trigger trg_lead_view_presets_set_updated_at
before update on public.lead_view_presets
for each row
execute function iwish.lead_view_presets_set_updated_at();

-- 保证每个用户最多一个默认视图

create unique index if not exists idx_lead_view_presets_profile_default
on public.lead_view_presets(profile_id)
where is_default;
