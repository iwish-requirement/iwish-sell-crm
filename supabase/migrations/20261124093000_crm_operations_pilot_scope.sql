-- A launch can be paused, restricted to one synthetic lead, or enabled for new lead submissions.
alter table crm_allocation.operations_release
  add column pilot_lead_id uuid,
  add column enabled_after timestamptz,
  add constraint operations_release_scope_check check (
    not enabled or (pilot_lead_id is null and enabled_after is not null)
  ) not valid;

-- Any previously active release must be assigned a deliberate cutoff before sending resumes.
update crm_allocation.operations_release set enabled = false where enabled and enabled_after is null;
alter table crm_allocation.operations_release validate constraint operations_release_scope_check;

create or replace function crm_allocation.operations_enabled()
returns boolean language sql stable set search_path = '' as $$
  select r.enabled and (o.enabled or o.pilot_lead_id is not null)
  from crm_allocation.release r cross join crm_allocation.operations_release o;
$$;

create function crm_allocation.operations_in_scope(p_lead_id uuid, p_submitted_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_lead_id is not null and exists (
    select 1
    from crm_allocation.release r cross join crm_allocation.operations_release o
    where r.enabled and (o.pilot_lead_id = p_lead_id or (o.enabled and p_submitted_at >= o.enabled_after))
  );
$$;

revoke execute on function crm_allocation.operations_in_scope(uuid,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function crm_allocation.enqueue_operations_assignment(p_assignment_id uuid)
returns void language sql volatile set search_path = '' as $$
  insert into crm_allocation.operations_deliveries as current (handoff_id, payload)
  select h.id, jsonb_build_object(
    'id', h.id, 'dealId', coalesce(a.lead_id, a.history_id),
    'source', case when a.lead_id is not null then 'lead' else 'history' end,
    'scopeVersion', h.scope_version, 'active', h.active,
    'department', jsonb_build_object('id', d.id, 'name', d.name), 'services', mapped.services,
    'company', display.names->>'company',
    'contractNumber', coalesce(form.finance->>'contractNumber', form.data->>'contractNumber'),
    'handoffOn', coalesce(crm_allocation.operations_date(form.data->>'handoffOn'), ''),
    'needs', coalesce(form.data->>'needs', ''), 'attachments', form.attachments,
    'payment', coalesce(nullif(form.finance->>'actualPayment',''), nullif(form.data->>'actualPayment',''), '待财务确认'),
    'finance', jsonb_strip_nulls(jsonb_build_object('legalName', nullif(btrim(form.finance->>'legalName'),'')))
      || case when receipt.received_on is not null and receipt.amount ~ '^(?=.*[1-9])[0-9]{1,14}(\.[0-9]{1,2})?$'
                  and receipt.currency ~ '^[A-Z]{3}$'
           then jsonb_build_object('receivedOn', receipt.received_on, 'receivedAmount', receipt.amount,
             'currency', receipt.currency, 'actualPayment', receipt.received_on)
           else '{}'::jsonb end
  ) || jsonb_strip_nulls(jsonb_build_object(
    'mainlandCompanyName', display.names->>'mainlandCompanyName',
    'hongKongCompanyName', display.names->>'hongKongCompanyName',
    'contractCurrency', case when form.data->>'currency' in ('CNY', 'USD') then form.data->>'currency' end,
    'attachmentStatus', case when form.data->>'attachmentStatus' = 'none'
      and jsonb_array_length(form.attachments) = 0 then 'none' end
  ))
  from crm_allocation.assignments a
  join crm_allocation.handoffs h on h.assignment_id = a.id
  join public.ops_departments d on d.id = h.department_id
  left join public.leads l on l.id = a.lead_id
  left join public.deal_contract_submissions s on s.lead_id = a.lead_id
  left join public.deal_history_records r on r.id = a.history_id
  left join crm_allocation.history_submissions hs on hs.history_id = a.history_id
  -- Legacy spreadsheet finance remains available in CRM for reference.
  cross join lateral (select coalesce(s.submitted, hs.data) as data,
    case when s.finance_confirmed_at is not null then s.finance else '{}'::jsonb end as finance,
    coalesce(s.submitted_attachments, hs.attachments, '[]'::jsonb) as attachments) form
  cross join lateral (select crm_allocation.customer_display_names(coalesce(l.name, r.raw_values->>7), form.data) as names) display
  cross join lateral (select crm_allocation.operations_date(form.finance->>'receivedOn') as received_on,
    form.finance->>'receivedAmount' as amount, form.finance->>'currency' as currency) receipt
  cross join lateral (select crm_allocation.operations_service_names(h.service_ids) as services) mapped
  left join crm_allocation.operations_deliveries previous on previous.handoff_id = h.id
  where a.id = p_assignment_id and crm_allocation.operations_assignment_current(a.id)
    and (previous.handoff_id is not null or (h.active and crm_allocation.operations_in_scope(a.lead_id,a.submitted_at)))
    and jsonb_array_length(mapped.services) = cardinality(h.service_ids)
  on conflict (handoff_id) do update
  set payload = excluded.payload, version = current.version + 1, state = 'queued',
      attempts = 0, due_at = now(), lease_token = null, last_error = null
  where current.payload is distinct from excluded.payload;
$$;

create or replace function crm_allocation.claim_operations_deliveries(p_limit integer)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not crm_allocation.operations_enabled() then return; end if;
  update crm_allocation.operations_deliveries d
  set state = 'failed', lease_token = null, last_error = 'DELIVERY_LEASE_EXPIRED'
  from crm_allocation.handoffs h join crm_allocation.assignments a on a.id = h.assignment_id
  where d.handoff_id = h.id and d.state = 'sending' and d.attempts >= 5 and d.due_at <= now()
    and crm_allocation.operations_in_scope(a.lead_id,a.submitted_at);

  return query with eligible as (
    select d.handoff_id from crm_allocation.operations_deliveries d
    join crm_allocation.handoffs h on h.id = d.handoff_id
    join crm_allocation.assignments a on a.id = h.assignment_id
    where d.state in ('queued','sending','retrying') and d.due_at <= now() and d.attempts < 5
      and crm_allocation.operations_assignment_current(h.assignment_id)
      and crm_allocation.operations_in_scope(a.lead_id,a.submitted_at)
    order by d.due_at, d.handoff_id limit least(greatest(p_limit, 1), 10)
    for update of d skip locked
  )
  update crm_allocation.operations_deliveries d
  set state = 'sending', attempts = attempts + 1, lease_token = gen_random_uuid(), due_at = now() + interval '1 minute'
  from eligible where eligible.handoff_id = d.handoff_id
  returning jsonb_build_object('payload', d.payload || jsonb_build_object('version',d.version), 'lease', d.lease_token);
end;
$$;

create or replace function crm_allocation.accept_operations_staffing(p_handoff_id uuid,p_department_id uuid,p_body jsonb)
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
    or not exists (
      select 1 from crm_allocation.assignments a where a.id = handoff.assignment_id
        and crm_allocation.operations_in_scope(a.lead_id,a.submitted_at)
    )
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

create or replace function crm_allocation.retry_operations_delivery(p_handoff_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not crm_allocation.operations_enabled() then return false; end if;
  update crm_allocation.operations_deliveries d
  set state = 'queued', attempts = 0, due_at = now(), last_error = null
  from crm_allocation.handoffs h join crm_allocation.assignments a on a.id = h.assignment_id
  where d.handoff_id = p_handoff_id and d.handoff_id = h.id and d.state = 'failed'
    and crm_allocation.operations_in_scope(a.lead_id,a.submitted_at);
  return found;
end;
$$;
