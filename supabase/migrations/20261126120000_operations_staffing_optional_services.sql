begin;
-- 运营名单允许只含部分服务（iWish 运营系统 2026-11-26：配人必填 / 选填按项目合作渠道判断，选填服务没人不回传）。
-- 只改 accept_operations_staffing 的服务校验：名单服务须属于该交接且至少一项；其余逻辑与 20261125100000 相同。

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

  -- 选填服务没人时运营系统不回传这一行（iWish 2026-11-26「按项目的合作渠道判断，合作渠道里有的必填，没有的选填」）：
  -- 名单里的服务只要都属于这张交接、至少一项即可，不再要求和交接的服务完全一致。
  if jsonb_array_length(coalesce(p_body->'staffing', '[]'::jsonb)) = 0
    or exists (select 1 from jsonb_array_elements(p_body->'staffing') x
               where not ((x->>'serviceId') = any(handoff.service_ids)))
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

commit;
