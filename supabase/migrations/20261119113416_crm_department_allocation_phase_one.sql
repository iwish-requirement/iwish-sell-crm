create schema crm_allocation;
revoke all on schema crm_allocation from public, anon, authenticated;
grant usage on schema crm_allocation to authenticated;
alter default privileges in schema crm_allocation revoke execute on functions from public;

create table crm_allocation.release (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  required_after timestamptz,
  check (not enabled or required_after is not null)
);
insert into crm_allocation.release default values;

create table crm_allocation.service_departments (
  category text not null check (category in ('performance','brand','seo','website','creative')),
  department_id uuid not null references public.ops_departments(id),
  primary key (category, department_id)
);
create index on crm_allocation.service_departments (department_id);

-- Resolve the reviewed department labels to directory IDs. Subsequent directory renames keep the mapping.
insert into crm_allocation.service_departments (category, department_id)
select m.category, d.id
from public.ops_departments d
cross join lateral (
  values
    ('performance', d.name ~ '^效果营销[一二三四五六七八九十零0-9]+部$'),
    ('brand', d.name = '品牌营销部'),
    ('seo', replace(d.name, ' ', '') = 'SEO营销部'),
    ('website', d.name = '技术部'),
    ('creative', d.name = '创意部')
) m(category, eligible)
where d.is_active and m.eligible;

create table crm_allocation.history_submissions (
  history_id uuid primary key references public.deal_history_records(id) on delete cascade,
  data jsonb not null,
  attachments jsonb not null,
  finance jsonb not null,
  submitted_at timestamptz not null,
  submitted_by uuid not null
);

create table crm_allocation.assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid unique references public.leads(id) on delete cascade,
  history_id uuid unique references public.deal_history_records(id) on delete cascade,
  submitted_at timestamptz not null,
  revision integer not null default 1,
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  check (num_nonnulls(lead_id, history_id) = 1)
);
create table crm_allocation.handoffs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references crm_allocation.assignments(id) on delete cascade,
  department_id uuid not null references public.ops_departments(id),
  service_ids text[] not null check (cardinality(service_ids) > 0),
  active boolean not null default true,
  scope_version integer not null default 1,
  unique (assignment_id, department_id)
);
create index on crm_allocation.handoffs(department_id);

alter table crm_allocation.release enable row level security;
alter table crm_allocation.service_departments enable row level security;
alter table crm_allocation.history_submissions enable row level security;
alter table crm_allocation.assignments enable row level security;
alter table crm_allocation.handoffs enable row level security;
revoke all on all tables in schema crm_allocation from public, anon, authenticated;

create function crm_allocation.required_after()
returns timestamptz language sql stable security definer set search_path = ''
as $$
  select required_after from crm_allocation.release
  where enabled and iwish.is_active_user(auth.uid());
$$;

create function crm_allocation.service_catalog()
returns jsonb language sql immutable set search_path = ''
as $$
  select '{"performance":["google","meta","criteo","bing","pinterest","tiktok","ctv"],
    "brand":["influencer","social","edm","pr","full_service"],"seo":["seo","sem"],"website":[],"creative":[]}'::jsonb;
$$;

create function crm_allocation.service_ids(p_services jsonb)
returns table (id text, category text)
language sql immutable set search_path = ''
as $$
  select g.key || '/' || s.value, g.key
  from jsonb_each(p_services) g
  cross join lateral jsonb_array_elements_text(g.value) s
  union
  select g.key, g.key from jsonb_each(p_services) g
  where g.value = '[]'::jsonb;
$$;

create function crm_allocation.can_view(p_source text, p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case p_source
    when 'lead' then iwish.can_access_deal_contract_submission(p_id, false)
    when 'history' then exists (
      select 1 from public.deal_history_records r
      where r.id = p_id and iwish.can_access_deal_history(r.batch_id, r.owner_id, false))
    else false end;
$$;

create function crm_allocation.summary(p_source text, p_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('revision', a.revision, 'assignedAt', a.submitted_at, 'handoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'departmentId', d.id, 'departmentName', d.name, 'services', h.service_ids
      ) order by d.name, d.id)
      from crm_allocation.handoffs h join public.ops_departments d on d.id = h.department_id
      where h.assignment_id = a.id and h.active
    ), '[]'::jsonb))
    from crm_allocation.assignments a
    where (p_source = 'lead' and a.lead_id = p_id) or (p_source = 'history' and a.history_id = p_id)
  ), '{"revision":0,"handoffs":[]}'::jsonb);
$$;

create function crm_allocation.workspace(p_pending boolean)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cutover timestamptz := crm_allocation.required_after();
  v_rows jsonb;
begin
  if v_cutover is null or p_pending is null
    or (not p_pending and not iwish.has_permission(auth.uid(), 'allocations.read')) then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:department_allocation';
  end if;
  with leads as (
    select 'lead' as source, l.id, coalesce(nullif(s.submitted->>'companyName',''), l.name) as company,
      coalesce(nullif(s.submitted->>'salesperson',''), p.full_name) as salesperson, s.submitted_at,
      s.submitted->'services' as services, previous.name as legacy_department, l.updated_at as sort_at
    from public.leads l
    left join public.profiles p on p.id = l.owner_id
    left join public.deal_contract_submissions s on s.lead_id = l.id
    left join public.lead_project_assignments a on a.lead_id = l.id
    left join public.ops_departments previous on previous.id = a.department_id
    where l.status = 'closed' and l.close_result in ('won','成交') and not coalesce(l.is_deleted, false)
      and crm_allocation.can_view('lead', l.id)
      and case when p_pending then s.submitted_at is null or s.submitted_at < v_cutover
               else s.submitted_at >= v_cutover end
  ), historical as (
    select 'history' as source, r.id, s.data->>'companyName' as company, s.data->>'salesperson' as salesperson,
      s.submitted_at, s.data->'services' as services, nullif(r.raw_values->>30,'') as legacy_department,
      s.submitted_at as sort_at
    from crm_allocation.history_submissions s join public.deal_history_records r on r.id = s.history_id
    where not p_pending and s.submitted_at >= v_cutover and crm_allocation.can_view('history', r.id)
  ), queue as (
    select * from leads union all select * from historical
  )
  select coalesce(jsonb_agg(
    (to_jsonb(q) - 'sort_at') || crm_allocation.summary(q.source, q.id)
    order by q.sort_at desc nulls last, q.id
  ), '[]'::jsonb) into v_rows
  from queue q;
  return jsonb_build_object('rows', v_rows, 'departments', coalesce((
    select jsonb_agg(jsonb_build_object('category', s.category,'id',d.id,'name',d.name) order by d.name,d.id)
    from crm_allocation.service_departments s join public.ops_departments d on d.id = s.department_id
    where d.is_active and not p_pending
  ), '[]'::jsonb));
end;
$$;

create function crm_allocation.details(p_source text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cutover timestamptz := crm_allocation.required_after();
  v_details jsonb;
begin
  if v_cutover is null then return null; end if;
  if not crm_allocation.can_view(p_source, p_id) then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:department_allocation';
  end if;
  if p_source = 'lead' then
    select jsonb_build_object('data', s.submitted, 'attachments', s.submitted_attachments, 'finance', s.finance,
      'submitted_at', s.submitted_at) into v_details
    from public.deal_contract_submissions s where s.lead_id = p_id;
  elsif p_source = 'history' then
    select jsonb_build_object('data', s.data, 'attachments', s.attachments, 'finance', s.finance,
      'submitted_at', s.submitted_at) into v_details
    from crm_allocation.history_submissions s where s.history_id = p_id;
  end if;
  return coalesce(v_details, '{}'::jsonb) || jsonb_build_object('requiredAfter',v_cutover) || crm_allocation.summary(p_source, p_id);
end;
$$;

create function crm_allocation.lead_states(p_lead_ids uuid[])
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(l.id::text, case
    when s.submitted_at is null or s.submitted_at < cutoff.at then 'needs_contract'
    when a.submitted_at = s.submitted_at and exists (
      select 1 from crm_allocation.handoffs h where h.assignment_id = a.id and h.active
    ) then 'assigned'
    else 'ready' end), '{}'::jsonb)
  from public.leads l
  cross join (select crm_allocation.required_after() as at) cutoff
  left join public.deal_contract_submissions s on s.lead_id = l.id
  left join crm_allocation.assignments a on a.lead_id = l.id
  where cutoff.at is not null and cardinality(p_lead_ids) between 1 and 500
    and l.id = any(p_lead_ids) and crm_allocation.can_view('lead', l.id);
$$;

create function crm_allocation.save_assignment(
  p_source text, p_id uuid, p_submitted_at timestamptz, p_revision integer, p_departments jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_cutover timestamptz := crm_allocation.required_after();
  v_form jsonb;
  v_submitted_at timestamptz;
  v_assignment crm_allocation.assignments;
  v_services jsonb;
begin
  if v_cutover is null or not iwish.has_permission(auth.uid(), 'allocations.read')
    or not iwish.has_permission(auth.uid(), 'allocations.manage') or not crm_allocation.can_view(p_source, p_id)
  then raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:department_allocation'; end if;

  if p_source = 'lead' then
    perform 1 from public.leads where id = p_id for update;
    select s.submitted_at, s.submitted into v_submitted_at, v_form
    from public.deal_contract_submissions s where s.lead_id = p_id for share;
    select * into v_assignment from crm_allocation.assignments where lead_id = p_id;
  else
    perform 1 from public.deal_history_records where id = p_id for update;
    select s.submitted_at, s.data into v_submitted_at, v_form
    from crm_allocation.history_submissions s where s.history_id = p_id for share;
    select * into v_assignment from crm_allocation.assignments where history_id = p_id;
  end if;
  if not crm_allocation.can_view(p_source, p_id) then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:department_allocation';
  end if;
  if v_submitted_at is null or v_submitted_at < v_cutover or v_submitted_at is distinct from p_submitted_at
    or coalesce(v_assignment.revision, 0) is distinct from p_revision
  then raise exception using errcode = '40001', message = 'ERR_CONFLICT:department_allocation'; end if;
  if jsonb_typeof(p_departments) is distinct from 'object' or octet_length(p_departments::text) > 65536
  then raise exception 'ERR_VALIDATION:department_allocation'; end if;
  v_services := v_form->'services';
  if not exists (select 1 from crm_allocation.service_ids(v_services))
    or exists (select 1 from jsonb_object_keys(p_departments) k(id)
      where not exists (select 1 from crm_allocation.service_ids(v_services) s where s.id = k.id))
    or exists (select 1 from crm_allocation.service_ids(v_services) s
      where jsonb_typeof(p_departments->s.id) is distinct from 'array' or p_departments->s.id = '[]'::jsonb)
  then raise exception 'ERR_VALIDATION:department_allocation_services'; end if;
  if exists (
    select 1 from crm_allocation.service_ids(v_services) s
    cross join lateral jsonb_array_elements_text(p_departments->s.id) chosen(id)
    where not exists (
      select 1 from crm_allocation.service_departments sd join public.ops_departments d on d.id = sd.department_id
      where sd.category = s.category and d.is_active and d.id::text = chosen.id)
  ) then raise exception 'ERR_VALIDATION:department_allocation_department'; end if;

  if v_assignment.id is null then
    insert into crm_allocation.assignments (lead_id, history_id, submitted_at, confirmed_by)
    values (case when p_source = 'lead' then p_id end, case when p_source = 'history' then p_id end, v_submitted_at, auth.uid())
    returning * into v_assignment;
  else
    update crm_allocation.assignments
    set submitted_at = v_submitted_at, revision = revision + 1, confirmed_by = auth.uid(), confirmed_at = now()
    where id = v_assignment.id returning * into v_assignment;
  end if;

  update crm_allocation.handoffs h set active = false, scope_version = scope_version + 1
  where h.assignment_id = v_assignment.id and h.active and not exists (
    select 1 from jsonb_each(p_departments) e cross join lateral jsonb_array_elements_text(e.value) chosen(id)
    where chosen.id = h.department_id::text);

  insert into crm_allocation.handoffs as h (assignment_id, department_id, service_ids)
  select v_assignment.id, chosen.id::uuid, array_agg(distinct e.key order by e.key)
  from jsonb_each(p_departments) e cross join lateral jsonb_array_elements_text(e.value) chosen(id)
  group by chosen.id
  on conflict (assignment_id, department_id) do update
  set service_ids = excluded.service_ids, active = true, scope_version = h.scope_version + 1
  where not h.active or h.service_ids is distinct from excluded.service_ids;

  perform iwish.audit(auth.uid(), 'assign_service_departments', p_source, p_id::text, null, p_departments, null);
  return crm_allocation.summary(p_source,p_id);
end;
$$;

create function crm_allocation.confirm_history(
  p_id uuid, p_changes jsonb, p_new_attachments jsonb, p_version integer, p_services jsonb
) returns public.deal_history_records language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.deal_history_records;
  v_payload jsonb;
  v_finance jsonb;
  v_choices jsonb := crm_allocation.service_catalog();
  v_entry record;
  v_owner text;
begin
  if crm_allocation.required_after() is null then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:department_allocation';
  end if;
  if jsonb_typeof(p_services) is distinct from 'object' or p_services = '{}'::jsonb
    or octet_length(p_services::text) > 4096
  then raise exception 'ERR_VALIDATION:department_allocation_services'; end if;
  for v_entry in select key, value from jsonb_each(p_services) loop
    if not (v_choices ? v_entry.key) or jsonb_typeof(v_entry.value) <> 'array'
      or not (v_choices->v_entry.key @> v_entry.value)
      or ((v_choices->v_entry.key) <> '[]'::jsonb and v_entry.value = '[]'::jsonb)
    then raise exception 'ERR_VALIDATION:department_allocation_services'; end if;
  end loop;

  v_row := public.rpc_deal_history_save(p_id, p_changes, p_new_attachments, p_version);
  select full_name into v_owner from public.profiles where id = v_row.owner_id;
  select jsonb_object_agg(m.field, coalesce(nullif(btrim(v_row.raw_values->>m.position),''), nullif(btrim(v_row.fields->>m.col),'')))
  into v_payload
  from (values
    ('signedOn','B',1), ('expectedPaymentOn','C',2), ('actualPayment','D',3), ('handoffOn','E',4),
    ('serviceStartsOn','F',5), ('salesperson','G',6), ('companyName','H',7), ('contractNumber','I',8),
    ('website','J',9), ('category','K',10), ('contactName','L',11), ('contactTitle','M',12),
    ('phone','N',13), ('email','O',14), ('cooperation','P',15), ('baseFee','Q',16), ('serviceFees','R',17),
    ('bonusAmount','S',18), ('bonusTerms','T',19), ('needs','AC',28), ('address','AD',29)
  ) m(field,col,position);
  v_payload := v_payload || jsonb_build_object(
    'salesperson', coalesce(v_payload->>'salesperson',v_owner),
    'spendRatio', nullif(v_row.fields->>'spendRatio',''), 'services', p_services);
  v_finance := jsonb_strip_nulls(jsonb_build_object(
    'legalName', nullif(v_row.raw_values->>41,''), 'receivedOn', nullif(v_row.raw_values->>42,''),
    'receivedAmount', nullif(v_row.raw_values->>43,'')));
  if v_payload->>'actualPayment' is null and v_finance ? 'receivedOn' then
    v_payload := v_payload || jsonb_build_object('actualPayment', v_finance->>'receivedOn');
  end if;
  if coalesce(jsonb_array_length(v_row.attachments),0) = 0 or exists (
    select 1 from jsonb_each_text(v_payload) f where f.value is null
      and f.key not in ('bonusAmount','bonusTerms','spendRatio'))
    or (v_payload->>'cooperation' = '基础服务费+激励奖金'
        and (v_payload->>'bonusAmount' is null or v_payload->>'bonusTerms' is null))
    or (v_payload->>'cooperation' = '消耗比例服务费' and v_payload->>'spendRatio' is null)
  then raise exception 'ERR_VALIDATION:department_allocation_history_required'; end if;
  insert into crm_allocation.history_submissions (history_id, data, attachments, finance, submitted_at, submitted_by)
  values (p_id, v_payload, v_row.attachments, v_finance, clock_timestamp(), auth.uid())
  on conflict (history_id) do update set data = excluded.data, attachments = excluded.attachments,
    finance = excluded.finance, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by;
  return v_row;
end;
$$;

-- Block stale clients from creating or re-assigning work through the previous allocation RPC.
-- Existing Feishu team confirmations can still close their original, historic card.
create function crm_allocation.guard_legacy_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select enabled from crm_allocation.release) and (tg_op = 'INSERT' or
    new.assigned_at is distinct from old.assigned_at or new.department_id is distinct from old.department_id
    or new.project_manager_id is distinct from old.project_manager_id)
  then raise exception using errcode = '42501', message = 'ERR_VALIDATION:legacy_allocation_closed'; end if;
  return new;
end;
$$;
create trigger guard_legacy_department_assignment
before insert or update on public.lead_project_assignments
for each row execute function crm_allocation.guard_legacy_assignment();

create function public.rpc_department_allocation_release()
returns timestamptz language sql stable security invoker set search_path = ''
as $$ select crm_allocation.required_after(); $$;
create function public.rpc_department_allocation_workspace(p_pending boolean)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select crm_allocation.workspace(p_pending); $$;
create function public.rpc_department_allocation_details(p_source text,p_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select crm_allocation.details(p_source,p_id); $$;
create function public.rpc_department_allocation_lead_states(p_lead_ids uuid[])
returns jsonb language sql stable security invoker set search_path = ''
as $$ select crm_allocation.lead_states(p_lead_ids); $$;
create function public.rpc_department_allocation_save(p_source text,p_id uuid,p_submitted_at timestamptz,p_revision integer,p_departments jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select crm_allocation.save_assignment(p_source,p_id,p_submitted_at,p_revision,p_departments); $$;
create function public.rpc_department_allocation_history_confirm(p_id uuid,p_changes jsonb,p_new_attachments jsonb,p_version integer,p_services jsonb)
returns public.deal_history_records language sql security invoker set search_path = ''
as $$ select crm_allocation.confirm_history(p_id,p_changes,p_new_attachments,p_version,p_services); $$;

revoke all on all functions in schema crm_allocation from public, anon, authenticated;
grant execute on function crm_allocation.required_after(), crm_allocation.workspace(boolean),
  crm_allocation.details(text,uuid), crm_allocation.lead_states(uuid[]), crm_allocation.save_assignment(text,uuid,timestamptz,integer,jsonb),
  crm_allocation.confirm_history(uuid,jsonb,jsonb,integer,jsonb) to authenticated;
revoke all on function public.rpc_department_allocation_release(), public.rpc_department_allocation_workspace(boolean),
  public.rpc_department_allocation_details(text,uuid), public.rpc_department_allocation_lead_states(uuid[]),
  public.rpc_department_allocation_save(text,uuid,timestamptz,integer,jsonb),
  public.rpc_department_allocation_history_confirm(uuid,jsonb,jsonb,integer,jsonb) from public, anon;
grant execute on function public.rpc_department_allocation_release(), public.rpc_department_allocation_workspace(boolean),
  public.rpc_department_allocation_details(text,uuid), public.rpc_department_allocation_lead_states(uuid[]),
  public.rpc_department_allocation_save(text,uuid,timestamptz,integer,jsonb),
  public.rpc_department_allocation_history_confirm(uuid,jsonb,jsonb,integer,jsonb) to authenticated;
