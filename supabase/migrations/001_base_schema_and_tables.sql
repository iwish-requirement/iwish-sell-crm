create schema if not exists iwish;

create extension if not exists "pgcrypto";

-- profile_status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_status') THEN
    CREATE TYPE profile_status AS ENUM ('pending','active','disabled','rejected');
  END IF;
END $$;

-- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text not null,
  phone text not null,
  avatar_url text,
  status profile_status not null default 'pending',
  role_id uuid null,
  team_id int null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejection_reason text,
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id),
  disable_reason text
);

alter table public.profiles
  add constraint profiles_active_requires_role_team
  check (
    status <> 'active'
    or (role_id is not null and team_id is not null)
  );

-- generic updated_at trigger
create or replace function iwish.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function iwish.set_updated_at();

-- teams
create table if not exists public.teams (
  id serial primary key,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- roles
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_team_fk foreign key (team_id) references public.teams(id) on delete set null;

alter table public.profiles
  add constraint profiles_role_fk foreign key (role_id) references public.roles(id) on delete set null;

-- leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  team_id int not null references public.teams(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  source text,
  stage text not null default 'new',
  status text not null default 'open',
  close_result text,
  close_reason text,
  customer_name text,
  customer_phone text,
  customer_email text,
  address text,
  budget numeric,
  internal_score int,
  blacklist_reason text,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
before update on public.leads
for each row execute function iwish.set_updated_at();

create index if not exists idx_leads_team on public.leads(team_id);
create index if not exists idx_leads_owner on public.leads(owner_id);
create index if not exists idx_leads_updated on public.leads(updated_at desc);

-- lead_notes
create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null,
  note_type text default 'note',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

drop trigger if exists trg_lead_notes_updated_at on public.lead_notes;
create trigger trg_lead_notes_updated_at
before update on public.lead_notes
for each row execute function iwish.set_updated_at();

create index if not exists idx_notes_lead on public.lead_notes(lead_id, created_at desc);
create index if not exists idx_notes_author on public.lead_notes(author_id, created_at desc);

-- lead_shares
create table if not exists public.lead_shares (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  shared_to uuid not null references public.profiles(id) on delete cascade,
  shared_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (lead_id, shared_to)
);

create index if not exists idx_lead_shares_to on public.lead_shares(shared_to);

-- permissions core tables
do $$ begin
  if not exists (select 1 from pg_type where typname = 'perm_effect') then
    create type perm_effect as enum ('allow','deny');
  end if;
  if not exists (select 1 from pg_type where typname = 'scope_type') then
    create type scope_type as enum ('self','team','org','custom');
  end if;
end $$;

create table if not exists public.permissions (
  key text primary key,
  resource text not null,
  action text not null,
  name text not null,
  description text,
  is_system boolean not null default true,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  effect perm_effect not null,
  scope_type scope_type not null default 'self',
  scope_rule jsonb,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  effect perm_effect not null,
  scope_type scope_type,
  scope_rule jsonb,
  expires_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  primary key (user_id, permission_key, effect, created_at)
);

create index if not exists idx_user_permissions_user on public.user_permissions(user_id);
create index if not exists idx_user_permissions_expires on public.user_permissions(expires_at);

-- custom_scope_sets
create table if not exists public.custom_scope_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  resource text not null,
  definition jsonb not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_scope_sets_resource on public.custom_scope_sets(resource);

-- field_policies
create table if not exists public.field_policies (
  resource text not null,
  field text not null,
  read_permission_key text references public.permissions(key) on delete set null,
  write_permission_key text references public.permissions(key) on delete set null,
  mask_strategy text not null default 'null',
  created_at timestamptz not null default now(),
  primary key (resource, field)
);

-- audit_logs
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text not null,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_actor_time on public.audit_logs(actor_id, created_at desc);
create index if not exists idx_audit_target on public.audit_logs(target_type, target_id);

-- profiles_public table and sync trigger (RLS will be added later)
create table if not exists public.profiles_public (
  id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null,
  avatar_url text,
  team_id int,
  role_id uuid,
  status profile_status not null,
  updated_at timestamptz not null default now()
);

create or replace function iwish.sync_profiles_public()
returns trigger
language plpgsql
as $$
begin
  insert into public.profiles_public(id, full_name, avatar_url, team_id, role_id, status, updated_at)
  values (new.id, new.full_name, new.avatar_url, new.team_id, new.role_id, new.status, now())
  on conflict (id) do update set
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    team_id = excluded.team_id,
    role_id = excluded.role_id,
    status = excluded.status,
    updated_at = now();
  return new;
end $$;

drop trigger if exists trg_sync_profiles_public on public.profiles;
create trigger trg_sync_profiles_public
after insert or update on public.profiles
for each row execute function iwish.sync_profiles_public();

-- registration trigger: auth.users -> profiles
create or replace function iwish.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, iwish
as $$
declare
  v_full_name text;
  v_phone text;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_phone := coalesce(new.raw_user_meta_data->>'phone', '');

  insert into public.profiles (id, email, full_name, phone, status)
  values (new.id, new.email, nullif(v_full_name,''), nullif(v_phone,''), 'pending')
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function iwish.handle_new_user();
