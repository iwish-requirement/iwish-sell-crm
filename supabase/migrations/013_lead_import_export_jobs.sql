-- 013_lead_import_export_jobs.sql
-- Lead import/export job tables and RPCs for public pool flows

create table if not exists public.lead_import_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  source text not null default 'public_pool',
  file_name text not null,
  file_size bigint,
  status text not null default 'pending', -- pending/processing/completed/failed
  total_count int,
  success_count int,
  duplicate_count int,
  error_message text,
  options jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_lead_import_jobs_created_by on public.lead_import_jobs(created_by, created_at desc);

alter table public.lead_import_jobs enable row level security;

drop policy if exists lead_import_jobs_select_own on public.lead_import_jobs;
create policy lead_import_jobs_select_own
on public.lead_import_jobs
for select
using (
  iwish.is_active_user(auth.uid())
  and created_by = auth.uid()
  and iwish.has_permission(auth.uid(), 'leads.import')
);

create table if not exists public.lead_export_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  source text not null default 'public_pool',
  format text not null, -- e.g. 'xlsx' | 'csv'
  status text not null default 'pending', -- pending/processing/completed/failed
  total_count int,
  exported_count int,
  error_message text,
  filters jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_lead_export_jobs_created_by on public.lead_export_jobs(created_by, created_at desc);

alter table public.lead_export_jobs enable row level security;

drop policy if exists lead_export_jobs_select_own on public.lead_export_jobs;
create policy lead_export_jobs_select_own
on public.lead_export_jobs
for select
using (
  iwish.is_active_user(auth.uid())
  and created_by = auth.uid()
  and iwish.has_permission(auth.uid(), 'leads.export')
);

-- RPC: request lead import job
create or replace function iwish.rpc_leads_import_request(
  p_source text,
  p_file_name text,
  p_file_size bigint,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_after jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.import') then
    raise exception 'ERR_NO_PERMISSION:leads.import';
  end if;

  insert into public.lead_import_jobs(
    created_by,
    source,
    file_name,
    file_size,
    status,
    options
  ) values (
    v_actor,
    coalesce(p_source, 'public_pool'),
    p_file_name,
    p_file_size,
    'pending',
    coalesce(p_options, '{}'::jsonb)
  )
  returning id into v_id;

  select to_jsonb(j.*) into v_after
  from public.lead_import_jobs j
  where j.id = v_id;

  perform iwish.audit(
    v_actor,
    'request_leads_import',
    'lead_import_job',
    v_id::text,
    null,
    v_after,
    null
  );

  return v_id;
end $$;

create or replace function public.rpc_leads_import_request(
  p_source text,
  p_file_name text,
  p_file_size bigint,
  p_options jsonb
)
returns uuid
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_leads_import_request(p_source, p_file_name, p_file_size, p_options);
$$;

-- RPC: request lead export job
create or replace function iwish.rpc_leads_export_request(
  p_source text,
  p_format text,
  p_filters jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_after jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.export') then
    raise exception 'ERR_NO_PERMISSION:leads.export';
  end if;

  insert into public.lead_export_jobs(
    created_by,
    source,
    format,
    status,
    filters
  ) values (
    v_actor,
    coalesce(p_source, 'public_pool'),
    p_format,
    'pending',
    coalesce(p_filters, '{}'::jsonb)
  )
  returning id into v_id;

  select to_jsonb(j.*) into v_after
  from public.lead_export_jobs j
  where j.id = v_id;

  perform iwish.audit(
    v_actor,
    'request_leads_export',
    'lead_export_job',
    v_id::text,
    null,
    v_after,
    null
  );

  return v_id;
end $$;

create or replace function public.rpc_leads_export_request(
  p_source text,
  p_format text,
  p_filters jsonb
)
returns uuid
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_leads_export_request(p_source, p_format, p_filters);
$$;

grant execute on function public.rpc_leads_import_request(text, text, bigint, jsonb) to authenticated, service_role;
grant execute on function public.rpc_leads_export_request(text, text, jsonb) to authenticated, service_role;
