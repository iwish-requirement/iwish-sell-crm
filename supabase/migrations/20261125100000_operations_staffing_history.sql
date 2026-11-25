-- 运营人员名单的历史版本（iWish 运营系统 2026-11-25「同时能显示历史人员调整记录」）。
-- 每次接受运营回传的新版本名单都记一行；部门承接进度显示「人员调整记录」。上线前已接受的当前名单补记一行。

create table crm_allocation.operations_staffing_history (
  id bigserial primary key,
  handoff_id uuid not null references crm_allocation.handoffs(id) on delete cascade,
  version bigint not null,
  body jsonb not null,
  accepted_at timestamptz not null default now(),
  unique (handoff_id, version)
);
alter table crm_allocation.operations_staffing_history enable row level security;
revoke all on crm_allocation.operations_staffing_history from public, anon, authenticated;

insert into crm_allocation.operations_staffing_history (handoff_id, version, body, accepted_at)
select d.handoff_id, (d.staffing->>'version')::bigint, d.staffing, coalesce((d.staffing->>'confirmedAt')::timestamptz, now())
from crm_allocation.operations_deliveries d
where d.staffing is not null and d.staffing ? 'version'
on conflict (handoff_id, version) do nothing;

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
  insert into crm_allocation.operations_staffing_history (handoff_id, version, body)
  values (p_handoff_id, incoming_version, p_body) on conflict (handoff_id, version) do nothing;
  return jsonb_build_object('accepted',true,'version',incoming_version);
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
             and crm_allocation.operations_assignment_current(a.id) then delivery.staffing - array['handoffId','departmentId','workOrderId','scopeVersion','version'] end,
          'staffingHistory', coalesce((
            select jsonb_agg(jsonb_build_object('version', sh.version, 'acceptedAt', sh.accepted_at,
              'scopeVersion', (sh.body->>'scopeVersion')::integer,
              'projectLead', sh.body->'projectLead', 'staffing', sh.body->'staffing') order by sh.version desc)
            from crm_allocation.operations_staffing_history sh where sh.handoff_id = h.id), '[]'::jsonb)
        ) else '{}'::jsonb end order by d.name, d.id)
      from crm_allocation.handoffs h join public.ops_departments d on d.id = h.department_id
      left join crm_allocation.operations_deliveries delivery on delivery.handoff_id = h.id
      where h.assignment_id = a.id and h.active
    ), '[]'::jsonb))
    from crm_allocation.assignments a
    where (p_source = 'lead' and a.lead_id = p_id) or (p_source = 'history' and a.history_id = p_id)
  ), '{"revision":0,"handoffs":[]}'::jsonb);
$$;
