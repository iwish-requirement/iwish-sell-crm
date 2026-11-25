-- 运营送单正式开启（iWish 运营系统 2026-11-25 确认）。
-- 0. 只送效果营销部门（运营系统只管效果营销；技术部、品牌营销部、SEO营销部不送，CRM 里保持「待运营交接」）。
--    已入队的交接照常更新，不受部门限制影响。
-- 1. 清空试单线索，起算时间取分配中心启用时间（试单线索早于它时取试单时间），开启全局送单。
-- 2. 已完成部门分配的线索成交补发一次：入队只在保存分配时发生，开启前已分配的不会自动进队列。
--    历史成交（history_id）不在送单范围内，另行处理。
-- 回退：update crm_allocation.operations_release set enabled = false;（已入队的保留，恢复前核对待发范围）

create or replace function crm_allocation.operations_department_allowed(p_department_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.ops_departments d where d.id = p_department_id and d.name like '效果营销%');
$$;
revoke execute on function crm_allocation.operations_department_allowed(uuid) from public, anon, authenticated, service_role;

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
    and (previous.handoff_id is not null or (h.active and crm_allocation.operations_in_scope(a.lead_id,a.submitted_at)
      and crm_allocation.operations_department_allowed(h.department_id)))
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
      and crm_allocation.operations_department_allowed(h.department_id)
    order by d.due_at, d.handoff_id limit least(greatest(p_limit, 1), 10)
    for update of d skip locked
  )
  update crm_allocation.operations_deliveries d
  set state = 'sending', attempts = attempts + 1, lease_token = gen_random_uuid(), due_at = now() + interval '1 minute'
  from eligible where eligible.handoff_id = d.handoff_id
  returning jsonb_build_object('payload', d.payload || jsonb_build_object('version',d.version), 'lease', d.lease_token);
end;
$$;

update crm_allocation.operations_release o
set pilot_lead_id = null,
    enabled_after = coalesce(
      least(
        (select r.required_after from crm_allocation.release r),
        (select a.submitted_at from crm_allocation.assignments a where a.lead_id = o.pilot_lead_id)
      ),
      '2026-11-24 00:00:00+08'::timestamptz
    ),
    enabled = true;

do $$
declare
  item record;
begin
  for item in
    select a.id from crm_allocation.assignments a
    where a.lead_id is not null and crm_allocation.operations_assignment_current(a.id)
    order by a.submitted_at
  loop
    perform crm_allocation.enqueue_operations_assignment(item.id);
  end loop;
end;
$$;
