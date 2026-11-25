-- 追加合同（iWish 运营系统 2026-11-25「做『追加合同』」）：已成交客户再签合同（二次开发 / 加服务）。
-- 做法：在已成交线索上建一条子线索（parent_lead_id 指向首签线索，名字带「追加合同 N」，状态直接是成交），
-- 之后沿用现有的合同资料提交、部门分配、送运营。子线索预填首签合同里的公司 / 联系人 / 网址等资料，
-- 合同编号、服务板块、金额、日期、附件由销售重新填。送运营时带 parentDealId 和 contractKind=addon，运营系统挂回原客户。

alter table public.leads add column if not exists parent_lead_id uuid references public.leads(id) on delete set null;
create index if not exists idx_leads_parent on public.leads(parent_lead_id) where parent_lead_id is not null;

create or replace function public.rpc_deal_addon_create(p_parent_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.leads;
  v_root public.leads;
  v_seq integer;
  v_id uuid;
  v_prefill jsonb;
begin
  if not iwish.can_access_deal_contract_submission(p_parent_id, true) then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:deal_addon';
  end if;
  select * into v_parent from public.leads where id = p_parent_id;
  select * into v_root from public.leads where id = coalesce(v_parent.parent_lead_id, v_parent.id) for update;
  if v_root.id is null or coalesce(v_root.is_deleted, false) or v_root.status <> 'closed' or v_root.close_result not in ('won', '成交') then
    raise exception 'ERR_VALIDATION:deal_addon_parent';
  end if;
  select count(*) + 1 into v_seq from public.leads where parent_lead_id = v_root.id;

  insert into public.leads (
    team_id, owner_id, created_by, name, source, stage, status, close_result, close_reason,
    customer_name, customer_phone, customer_email, address, wechat, customer_grade,
    source_level1, source_level2, responsibility_type, website, product_category,
    customer_attribute, follow_up_stage, allocation_status, parent_lead_id
  ) values (
    v_root.team_id, v_root.owner_id, auth.uid(), v_root.name || ' · 追加合同 ' || v_seq, v_root.source, 'Won', 'closed', 'won',
    '追加合同（首签：' || v_root.name || '）',
    v_root.customer_name, v_root.customer_phone, v_root.customer_email, v_root.address, v_root.wechat, v_root.customer_grade,
    v_root.source_level1, v_root.source_level2, v_root.responsibility_type, v_root.website, v_root.product_category,
    v_root.customer_attribute, 'won', 'pending', v_root.id
  ) returning id into v_id;

  -- 预填首签合同的公司、联系人、网址、品类、销售、客户简称；合同号、服务、金额、日期、附件不带。
  select jsonb_strip_nulls(jsonb_build_object(
    'mainlandCompanyName', s.data->'mainlandCompanyName', 'hongKongCompanyName', s.data->'hongKongCompanyName',
    'companyName', s.data->'companyName', 'shortName', s.data->'shortName', 'salesperson', s.data->'salesperson',
    'website', s.data->'website', 'category', s.data->'category', 'contactName', s.data->'contactName',
    'contactTitle', s.data->'contactTitle', 'phone', s.data->'phone', 'email', s.data->'email',
    'address', s.data->'address', 'currency', s.data->'currency'))
  into v_prefill
  from (select coalesce(submitted, draft) as data from public.deal_contract_submissions where lead_id = v_root.id) s;
  insert into public.deal_contract_submissions (lead_id, draft) values (v_id, coalesce(v_prefill, '{}'::jsonb));

  perform iwish.audit(auth.uid(), 'deal_addon_create', 'lead', v_id::text,
    jsonb_build_object('parent_lead_id', v_root.id), jsonb_build_object('name', v_root.name || ' · 追加合同 ' || v_seq), null);
  return v_id;
end;
$$;
revoke all on function public.rpc_deal_addon_create(uuid) from public, anon;
grant execute on function public.rpc_deal_addon_create(uuid) to authenticated;

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
    'parentDealId', l.parent_lead_id,
    'contractKind', case when l.parent_lead_id is not null then 'addon' when a.lead_id is not null then 'initial' end,
    'serviceStartsOn', crm_allocation.operations_date(form.data->>'serviceStartsOn'),
    'signedOn', crm_allocation.operations_date(form.data->>'signedOn'),
    'expectedPaymentOn', crm_allocation.operations_date(form.data->>'expectedPaymentOn'),
    'actualPayment', nullif(btrim(form.data->>'actualPayment'), ''),
    'salesperson', nullif(btrim(form.data->>'salesperson'), ''),
    'shortName', nullif(btrim(form.data->>'shortName'), ''),
    'website', nullif(btrim(form.data->>'website'), ''),
    'category', nullif(btrim(form.data->>'category'), ''),
    'cooperation', nullif(btrim(form.data->>'cooperation'), ''),
    'baseFee', nullif(btrim(form.data->>'baseFee'), ''),
    'serviceFees', nullif(btrim(form.data->>'serviceFees'), ''),
    'spendRatio', nullif(btrim(form.data->>'spendRatio'), ''),
    'bonusAmount', nullif(btrim(form.data->>'bonusAmount'), ''),
    'bonusTerms', nullif(btrim(form.data->>'bonusTerms'), ''),
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
