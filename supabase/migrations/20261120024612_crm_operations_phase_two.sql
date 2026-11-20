create table crm_allocation.operations_release (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into crm_allocation.operations_release default values;

create table crm_allocation.operations_deliveries (
  handoff_id uuid primary key references crm_allocation.handoffs(id) on delete cascade,
  version bigint not null default 1,
  payload jsonb not null,
  state text not null default 'queued' check (state in ('queued','sending','retrying','failed','received')),
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  lease_token uuid,
  last_error text,
  work_order_id text,
  receipt_scope integer,
  staffing jsonb
);
create index operations_deliveries_due on crm_allocation.operations_deliveries(due_at, handoff_id)
  where state in ('queued','sending','retrying');
alter table crm_allocation.operations_release enable row level security;
alter table crm_allocation.operations_deliveries enable row level security;
revoke all on crm_allocation.operations_release, crm_allocation.operations_deliveries from public, anon, authenticated;

create function crm_allocation.operations_enabled()
returns boolean language sql stable set search_path = '' as $$
  select r.enabled and o.enabled from crm_allocation.release r cross join crm_allocation.operations_release o;
$$;

create function crm_allocation.operations_date(p_value text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if btrim(p_value) ~ '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}$' then
    return to_char(replace(btrim(p_value), '/', '-')::date, 'YYYY-MM-DD');
  end if;
  return null;
exception when datetime_field_overflow or invalid_datetime_format then
  return null;
end;
$$;

create function crm_allocation.operations_service_names(p_services text[])
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('id', id, 'label', labels.label, 'group', labels.category) order by id)
  from unnest(p_services) as service(id)
  join (values
    ('performance/google','Google','效果营销服务'), ('performance/meta','Meta','效果营销服务'),
    ('performance/criteo','Criteo','效果营销服务'), ('performance/bing','Bing','效果营销服务'),
    ('performance/pinterest','Pinterest','效果营销服务'), ('performance/tiktok','TikTok','效果营销服务'),
    ('performance/ctv','CTV 电视广告','效果营销服务'),
    ('brand/influencer','红人营销服务','品牌营销服务'), ('brand/social','社媒营销服务','品牌营销服务'),
    ('brand/edm','EDM 营销服务','品牌营销服务'), ('brand/pr','PR 营销服务','品牌营销服务'),
    ('brand/full_service','全案营销服务','品牌营销服务'),
    ('seo/seo','SEO营销服务','SEO营销服务'), ('seo/sem','SEM营销服务','SEO营销服务'),
    ('website','网站建站服务','网站建站服务'), ('creative','素材服务','素材服务')
  ) as labels(service_id, label, category) on labels.service_id = service.id;
$$;

create function crm_allocation.operations_assignment_current(p_assignment_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from crm_allocation.assignments a
    left join public.leads l on l.id = a.lead_id
    left join public.deal_contract_submissions s on s.lead_id = a.lead_id
    left join crm_allocation.history_submissions hs on hs.history_id = a.history_id
    where a.id = p_assignment_id and (
      (l.status = 'closed' and l.close_result in ('won','成交') and not coalesce(l.is_deleted, false)
        and s.submitted_at = a.submitted_at)
      or hs.submitted_at = a.submitted_at
    )
  );
$$;

create function crm_allocation.enqueue_operations_assignment(p_assignment_id uuid)
returns void language sql volatile set search_path = '' as $$
  insert into crm_allocation.operations_deliveries as current (handoff_id, payload)
  select h.id, jsonb_build_object(
    'id', h.id, 'dealId', coalesce(a.lead_id, a.history_id), 'scopeVersion', h.scope_version, 'active', h.active,
    'department', jsonb_build_object('id', d.id, 'name', d.name), 'services', mapped.services,
    'company', form.data->>'companyName', 'contractNumber', coalesce(form.finance->>'contractNumber', form.data->>'contractNumber'),
    'handoffOn', coalesce(crm_allocation.operations_date(form.data->>'handoffOn'), ''),
    'needs', coalesce(form.data->>'needs', ''), 'attachments', form.attachments,
    'payment', coalesce(nullif(form.finance->>'actualPayment',''), nullif(form.data->>'actualPayment',''), '待财务确认'),
    'finance', jsonb_strip_nulls(jsonb_build_object('legalName', nullif(form.finance->>'legalName','')))
      || case when receipt.received_on is not null and receipt.amount ~ '^(?=.*[1-9])[0-9]{1,14}(\.[0-9]{1,2})?$'
                  and receipt.currency ~ '^[A-Z]{3}$'
           then jsonb_build_object('receivedOn', receipt.received_on, 'receivedAmount', receipt.amount,
             'currency', receipt.currency, 'actualPayment', receipt.received_on)
           else '{}'::jsonb end
  )
  from crm_allocation.assignments a
  join crm_allocation.handoffs h on h.assignment_id = a.id
  join public.ops_departments d on d.id = h.department_id
  left join public.deal_contract_submissions s on s.lead_id = a.lead_id
  left join crm_allocation.history_submissions hs on hs.history_id = a.history_id
  cross join lateral (select coalesce(s.submitted, hs.data) as data, coalesce(s.finance, hs.finance) as finance,
    coalesce(s.submitted_attachments, hs.attachments, '[]'::jsonb) as attachments) form
  cross join lateral (select crm_allocation.operations_date(form.finance->>'receivedOn') as received_on,
    form.finance->>'receivedAmount' as amount, coalesce(form.finance->>'currency', form.data->>'currency') as currency) receipt
  cross join lateral (select crm_allocation.operations_service_names(h.service_ids) as services) mapped
  left join crm_allocation.operations_deliveries previous on previous.handoff_id = h.id
  where a.id = p_assignment_id and crm_allocation.operations_assignment_current(a.id)
    and (previous.handoff_id is not null or (h.active and crm_allocation.operations_enabled()))
    and jsonb_array_length(mapped.services) = cardinality(h.service_ids)
  on conflict (handoff_id) do update
  set payload = excluded.payload, version = current.version + 1, state = 'queued',
      attempts = 0, due_at = now(), lease_token = null, last_error = null
  where current.payload is distinct from excluded.payload;
$$;

-- Assignment writes precede department writes in phase one. Read the final scope at commit.
create function crm_allocation.queue_operations_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform crm_allocation.enqueue_operations_assignment(new.id);
  return null;
end;
$$;
create constraint trigger queue_operations_assignment
after insert or update on crm_allocation.assignments deferrable initially deferred
for each row execute function crm_allocation.queue_operations_assignment();

create function crm_allocation.queue_operations_finance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform crm_allocation.enqueue_operations_assignment(a.id)
  from crm_allocation.assignments a
  where a.lead_id = new.lead_id and a.submitted_at = new.submitted_at
    and exists (select 1 from crm_allocation.handoffs h
      join crm_allocation.operations_deliveries d on d.handoff_id = h.id where h.assignment_id = a.id);
  return null;
end;
$$;
create trigger queue_operations_finance
after update of finance on public.deal_contract_submissions
for each row when (old.finance is distinct from new.finance)
execute function crm_allocation.queue_operations_finance();

create function crm_allocation.claim_operations_deliveries(p_limit integer)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not crm_allocation.operations_enabled() then return; end if;
  update crm_allocation.operations_deliveries
  set state = 'failed', lease_token = null, last_error = 'DELIVERY_LEASE_EXPIRED'
  where state = 'sending' and attempts >= 5 and due_at <= now();

  return query with eligible as (
    select d.handoff_id from crm_allocation.operations_deliveries d
    join crm_allocation.handoffs h on h.id = d.handoff_id
    where d.state in ('queued','sending','retrying') and d.due_at <= now() and d.attempts < 5
      and crm_allocation.operations_assignment_current(h.assignment_id)
    order by d.due_at, d.handoff_id limit least(greatest(p_limit, 1), 10)
    for update of d skip locked
  )
  update crm_allocation.operations_deliveries d
  set state = 'sending', attempts = attempts + 1, lease_token = gen_random_uuid(), due_at = now() + interval '1 minute'
  from eligible where eligible.handoff_id = d.handoff_id
  returning jsonb_build_object('payload', d.payload || jsonb_build_object('version',d.version), 'lease', d.lease_token);
end;
$$;

create function crm_allocation.finish_operations_delivery(
  p_handoff_id uuid, p_lease uuid, p_work_order_id text, p_error text, p_retry boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  delivery crm_allocation.operations_deliveries;
begin
  select * into delivery from crm_allocation.operations_deliveries
  where handoff_id = p_handoff_id and state = 'sending' and lease_token = p_lease for update;
  if not found then return false; end if;

  if p_work_order_id is not null and (delivery.work_order_id is null or delivery.work_order_id = p_work_order_id) then
    update crm_allocation.operations_deliveries
    set state = 'received', lease_token = null, last_error = null,
        work_order_id = p_work_order_id, receipt_scope = (payload->>'scopeVersion')::integer
    where handoff_id = p_handoff_id;
  else
    update crm_allocation.operations_deliveries
    set state = case when p_retry and attempts < 5 and p_work_order_id is null then 'retrying' else 'failed' end,
        due_at = now() + make_interval(secs => least(60 * power(2, attempts - 1), 900)),
        lease_token = null, last_error = case when p_work_order_id is not null then 'WORK_ORDER_ID_CHANGED' else p_error end
    where handoff_id = p_handoff_id;
  end if;
  return true;
end;
$$;

create function crm_allocation.accept_operations_staffing(p_handoff_id uuid,p_department_id uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  delivery crm_allocation.operations_deliveries;
  handoff crm_allocation.handoffs;
  accepted_version bigint;
  incoming_version bigint := (p_body->>'version')::bigint;
begin
  if not crm_allocation.operations_enabled() then return jsonb_build_object('error','OPS_INTEGRATION_DISABLED'); end if;
  select * into delivery from crm_allocation.operations_deliveries where handoff_id = p_handoff_id for update;
  select * into handoff from crm_allocation.handoffs where id = p_handoff_id;
  if delivery.handoff_id is null or not handoff.active or handoff.department_id <> p_department_id
    or not crm_allocation.operations_assignment_current(handoff.assignment_id)
    or handoff.scope_version is distinct from (p_body->>'scopeVersion')::bigint
  then return jsonb_build_object('error','HANDOFF_SCOPE_CONFLICT'); end if;
  if delivery.receipt_scope is distinct from handoff.scope_version then
    return jsonb_build_object('error','HANDOFF_RECEIPT_PENDING');
  end if;
  if delivery.work_order_id is distinct from p_body->>'workOrderId' then
    return jsonb_build_object('error','HANDOFF_SCOPE_CONFLICT');
  end if;

  if handoff.service_ids is distinct from (select array_agg(x->>'serviceId' order by x->>'serviceId')
    from jsonb_array_elements(p_body->'staffing') x)
  then return jsonb_build_object('error','HANDOFF_SERVICES_CONFLICT'); end if;

  if (delivery.staffing->>'scopeVersion')::integer = handoff.scope_version then
    accepted_version := (delivery.staffing->>'version')::bigint;
    if incoming_version = accepted_version and delivery.staffing is distinct from p_body then
      return jsonb_build_object('error','STAFFING_VERSION_CONFLICT');
    end if;
    if incoming_version <= accepted_version then return jsonb_build_object('accepted',true,'version',accepted_version); end if;
  end if;
  update crm_allocation.operations_deliveries set staffing = p_body where handoff_id = p_handoff_id;
  return jsonb_build_object('accepted',true,'version',incoming_version);
end;
$$;

create function crm_allocation.retry_operations_delivery(p_handoff_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not crm_allocation.operations_enabled() then return false; end if;
  update crm_allocation.operations_deliveries
  set state = 'queued', attempts = 0, due_at = now(), last_error = null
  where handoff_id = p_handoff_id and state = 'failed';
  return found;
end;
$$;

create or replace function crm_allocation.summary(p_source text, p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('revision', a.revision, 'assignedAt', a.submitted_at, 'handoffs', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'departmentId', d.id, 'departmentName', d.name, 'services', h.service_ids)
        || case when delivery.handoff_id is not null then jsonb_build_object(
          'delivery', delivery.state, 'deliveryAttempts', delivery.attempts,
          'workOrderId', case when delivery.receipt_scope = h.scope_version then delivery.work_order_id end,
          'staffing', case when (delivery.staffing->>'scopeVersion')::integer = h.scope_version
             and crm_allocation.operations_assignment_current(a.id) then delivery.staffing - array['handoffId','departmentId','workOrderId','scopeVersion','version'] end
        ) else '{}'::jsonb end order by d.name, d.id)
      from crm_allocation.handoffs h join public.ops_departments d on d.id = h.department_id
      left join crm_allocation.operations_deliveries delivery on delivery.handoff_id = h.id
      where h.assignment_id = a.id and h.active
    ), '[]'::jsonb))
    from crm_allocation.assignments a
    where (p_source = 'lead' and a.lead_id = p_id) or (p_source = 'history' and a.history_id = p_id)
  ), '{"revision":0,"handoffs":[]}'::jsonb);
$$;

revoke execute on function crm_allocation.operations_enabled(), crm_allocation.operations_date(text),
  crm_allocation.operations_service_names(text[]), crm_allocation.operations_assignment_current(uuid),
  crm_allocation.enqueue_operations_assignment(uuid), crm_allocation.queue_operations_assignment(),
  crm_allocation.queue_operations_finance(), crm_allocation.claim_operations_deliveries(integer),
  crm_allocation.finish_operations_delivery(uuid,uuid,text,text,boolean),
  crm_allocation.accept_operations_staffing(uuid,uuid,jsonb), crm_allocation.retry_operations_delivery(uuid)
from public, anon, authenticated;

grant usage on schema crm_allocation to service_role;
grant execute on function crm_allocation.claim_operations_deliveries(integer),
  crm_allocation.finish_operations_delivery(uuid,uuid,text,text,boolean),
  crm_allocation.accept_operations_staffing(uuid,uuid,jsonb), crm_allocation.retry_operations_delivery(uuid) to service_role;

create function public.rpc_operations_handoffs_claim(p_limit integer)
returns setof jsonb language sql security invoker set search_path = '' as $$
  select * from crm_allocation.claim_operations_deliveries(p_limit);
$$;
create function public.rpc_operations_handoff_finish(
  p_handoff_id uuid,p_lease uuid,p_work_order_id text,p_error text,p_retry boolean
) returns boolean language sql security invoker set search_path = '' as $$
  select crm_allocation.finish_operations_delivery(p_handoff_id,p_lease,p_work_order_id,p_error,p_retry);
$$;
create function public.rpc_operations_staffing_accept(p_handoff_id uuid,p_department_id uuid,p_body jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select crm_allocation.accept_operations_staffing(p_handoff_id,p_department_id,p_body);
$$;
create function public.rpc_operations_handoff_retry(p_handoff_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select crm_allocation.retry_operations_delivery(p_handoff_id);
$$;
revoke execute on function public.rpc_operations_handoffs_claim(integer),
  public.rpc_operations_handoff_finish(uuid,uuid,text,text,boolean), public.rpc_operations_staffing_accept(uuid,uuid,jsonb),
  public.rpc_operations_handoff_retry(uuid) from public, anon, authenticated;
grant execute on function public.rpc_operations_handoffs_claim(integer),
  public.rpc_operations_handoff_finish(uuid,uuid,text,text,boolean), public.rpc_operations_staffing_accept(uuid,uuid,jsonb),
  public.rpc_operations_handoff_retry(uuid) to service_role;
