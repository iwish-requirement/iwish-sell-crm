create table public.deal_history_batches (
  id text primary key,
  source_sha text not null unique check (source_sha ~ '^[0-9a-f]{64}$'),
  expected_count integer not null check (expected_count > 0),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.deal_history_records (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.deal_history_batches(id),
  source_row integer not null check (source_row > 0),
  owner_id uuid references public.profiles(id) on delete set null,
  raw_values jsonb not null check (jsonb_typeof(raw_values) = 'array' and jsonb_array_length(raw_values) = 44),
  source_types jsonb not null check (jsonb_typeof(source_types) = 'array' and jsonb_array_length(source_types) = 44),
  fields jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (batch_id, source_row)
);

create index deal_history_records_owner_idx on public.deal_history_records(owner_id);
alter table public.deal_history_batches enable row level security;
alter table public.deal_history_records enable row level security;
revoke all on public.deal_history_batches, public.deal_history_records from public, anon, authenticated;
grant select on public.deal_history_records to authenticated;

create function iwish.can_access_deal_history(p_batch_id text, p_owner_id uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    iwish.is_active_user(auth.uid())
    and iwish.has_permission(auth.uid(), 'contracts.read')
    and iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive')
    and exists (select 1 from public.deal_history_batches b where b.id = p_batch_id and b.published_at is not null)
    and iwish.in_scope_for_lead(auth.uid(), target.lead_scope, 'leads.read')
    and (not p_write or p_owner_id = auth.uid() or (
      iwish.has_permission(auth.uid(), 'contracts.manage')
      and iwish.in_scope_for_lead(auth.uid(), target.lead_scope, 'leads.update')
    )), false)
  from (
    -- Evaluate the existing owner/team scope without creating or matching a CRM lead.
    select jsonb_populate_record(null::public.leads, jsonb_build_object(
      'owner_id', p_owner_id, 'team_id', (select team_id from public.profiles where id = p_owner_id)
    )) as lead_scope
  ) target;
$$;
revoke all on function iwish.can_access_deal_history(text, uuid, boolean) from public, anon;
grant execute on function iwish.can_access_deal_history(text, uuid, boolean) to authenticated;

create policy deal_history_read on public.deal_history_records
for select to authenticated using (iwish.can_access_deal_history(batch_id, owner_id, false));

create function public.rpc_deal_history_list()
returns table (
  id uuid, source_row integer, owner_id uuid, signed_on text, company text, salesperson text,
  contract_number text, base_fee text, contact_name text, website text
)
language sql stable security invoker set search_path = ''
as $$
  select r.id, r.source_row, r.owner_id, coalesce(nullif(r.raw_values->>1,''), r.fields->>'B'),
    r.raw_values->>7, r.raw_values->>6, coalesce(nullif(r.raw_values->>8,''), r.fields->>'I'),
    coalesce(nullif(r.raw_values->>16,''), r.fields->>'Q'),
    coalesce(nullif(r.raw_values->>11,''), r.fields->>'L'),
    coalesce(nullif(r.raw_values->>9,''), r.fields->>'J')
  from public.deal_history_records r
  order by r.source_row, r.id;
$$;
revoke all on function public.rpc_deal_history_list() from public, anon;
grant execute on function public.rpc_deal_history_list() to authenticated;

create function public.rpc_deal_history_can_edit(p_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.deal_history_records r
    where r.id = p_id and iwish.can_access_deal_history(r.batch_id, r.owner_id, true)
  );
$$;
revoke all on function public.rpc_deal_history_can_edit(uuid) from public, anon;
grant execute on function public.rpc_deal_history_can_edit(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('deal-history-materials', 'deal-history-materials', false, 20971520);

create function iwish.can_access_deal_history_attachment(p_name text, p_write boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.deal_history_records r
    where r.id = case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid end
      and iwish.can_access_deal_history(r.batch_id, r.owner_id, p_write)
  );
$$;
revoke all on function iwish.can_access_deal_history_attachment(text, boolean) from public, anon;
grant execute on function iwish.can_access_deal_history_attachment(text, boolean) to authenticated;

create policy deal_history_materials_read on storage.objects
for select to authenticated using (
  bucket_id = 'deal-history-materials' and iwish.can_access_deal_history_attachment(name, false)
);

create policy deal_history_materials_upload on storage.objects
for insert to authenticated with check (
  bucket_id = 'deal-history-materials'
  and name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  and iwish.can_access_deal_history_attachment(name, true)
);

create policy deal_history_materials_cleanup on storage.objects
for delete to authenticated using (
  bucket_id = 'deal-history-materials' and owner_id = (select auth.uid())::text
  and iwish.can_access_deal_history_attachment(name, true)
  and not exists (select 1 from public.deal_history_records r
    where r.id::text = split_part(name, '/', 1) and r.attachments @> jsonb_build_array(jsonb_build_object('path', name)))
);

create function public.rpc_deal_history_save(p_id uuid, p_changes jsonb, p_new_attachments jsonb, p_version integer)
returns public.deal_history_records language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.deal_history_records;
  v_columns constant text[] := array[
    'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X',
    'Y','Z','AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR'
  ];
  v_key text;
  v_input jsonb;
  v_value text;
  v_index integer;
  v_path text;
  v_cooperation text;
begin
  select r.* into v_row from public.deal_history_records r
  where r.id = p_id and iwish.can_access_deal_history(r.batch_id, r.owner_id, true)
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:deal_history';
  end if;
  perform 1 from public.deal_history_batches b where b.id = v_row.batch_id and b.published_at is not null for share;
  if not found then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:deal_history';
  end if;
  if p_version is distinct from v_row.version then
    raise exception using errcode = '40001', message = 'ERR_CONFLICT:deal_history';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text) > 65536
    or jsonb_typeof(p_new_attachments) is distinct from 'array' or octet_length(p_new_attachments::text) > 65536
  then raise exception 'ERR_VALIDATION:deal_history_payload'; end if;

  for v_key, v_input in select key, value from jsonb_each(p_changes) loop
    if v_key not in ('B','C','D','E','F','I','J','K','L','M','N','O','P','Q','R','S','T','U','Y','Z','AA','AB','AC','AD','spendRatio')
      or jsonb_typeof(v_input) <> 'string'
    then raise exception 'ERR_VALIDATION:deal_history_field'; end if;
    v_index := array_position(v_columns, v_key) - 1;
    if coalesce(v_row.raw_values->>v_index, '') <> ''
      or (v_key = 'U' and coalesce(nullif(v_row.raw_values->>21,''), nullif(v_row.raw_values->>22,''), nullif(v_row.raw_values->>23,'')) is not null)
    then raise exception 'ERR_VALIDATION:deal_history_original_value'; end if;

    v_value := btrim(v_input #>> '{}');
    if v_value = '' then
      v_row.fields := v_row.fields - v_key;
      continue;
    end if;
    if char_length(v_value) > 20000 then raise exception 'ERR_VALIDATION:deal_history_field'; end if;
    if v_key in ('B','C','E','F') then
      if v_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'ERR_VALIDATION:deal_history_date'; end if;
      perform v_value::date;
    end if;
    if v_key = 'P' and v_value not in ('固定季度服务费','消耗比例服务费','基础服务费+激励奖金')
      then raise exception 'ERR_VALIDATION:deal_history_cooperation'; end if;
    if v_key = 'spendRatio' then
      if v_value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'ERR_VALIDATION:deal_history_ratio'; end if;
      if v_value::numeric <= 0 or v_value::numeric > 100 then raise exception 'ERR_VALIDATION:deal_history_ratio'; end if;
    end if;
    v_row.fields := v_row.fields || jsonb_build_object(v_key, v_value);
  end loop;

  v_cooperation := coalesce(nullif(v_row.raw_values->>15,''), v_row.fields->>'P');
  if v_cooperation is distinct from '消耗比例服务费' then v_row.fields := v_row.fields - 'spendRatio'; end if;
  if v_cooperation is distinct from '基础服务费+激励奖金' then v_row.fields := v_row.fields - array['S','T']; end if;

  for v_input in select value from jsonb_array_elements(p_new_attachments) loop
    v_path := v_input->>'path';
    if v_path is null or split_part(v_path,'/',1) <> p_id::text
      or length(btrim(coalesce(v_input->>'name',''))) not between 1 and 255
      or octet_length(v_input::text) > 1500
      or v_row.attachments @> jsonb_build_array(jsonb_build_object('path',v_path))
    then raise exception 'ERR_VALIDATION:deal_history_attachment'; end if;
    perform 1 from storage.objects where bucket_id='deal-history-materials'
      and name = v_path and owner_id = auth.uid()::text for key share;
    if not found then raise exception 'ERR_VALIDATION:deal_history_attachment'; end if;
    v_row.attachments := v_row.attachments || jsonb_build_array(jsonb_build_object('path',v_path,'name',v_input->>'name'));
  end loop;

  update public.deal_history_records r
  set fields=v_row.fields, attachments=v_row.attachments,
    version=r.version+1, updated_at=now(), updated_by=auth.uid()
  where r.id=p_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.rpc_deal_history_save(uuid,jsonb,jsonb,integer) from public, anon;
grant execute on function public.rpc_deal_history_save(uuid,jsonb,jsonb,integer) to authenticated;
