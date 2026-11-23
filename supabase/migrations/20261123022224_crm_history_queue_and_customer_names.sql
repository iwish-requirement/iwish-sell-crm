-- Move confirmed history out of the active sales list while preserving its allocation record.
create function crm_allocation.history_in_allocation(p_history_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from crm_allocation.history_submissions s
    where s.history_id = p_history_id
      and s.submitted_at >= crm_allocation.required_after()
      and crm_allocation.can_view('history', s.history_id)
  );
$$;
revoke all on function crm_allocation.history_in_allocation(uuid) from public, anon;
grant execute on function crm_allocation.history_in_allocation(uuid) to authenticated;

create function crm_allocation.customer_display_name(p_original text, p_contract jsonb)
returns text language sql immutable set search_path = ''
as $$
  select coalesce((
    select btrim(v.name)
    from (values
      (1, p_original),
      (2, p_contract->>'mainlandCompanyName'),
      (3, p_contract->>'hongKongCompanyName'),
      (4, p_contract->>'companyName')
    ) as v(priority,name)
    where btrim(v.name) not in ('','暂无','未命名客户','未命名线索','未填写公司名称')
    order by v.priority
    limit 1
  ), '未命名客户');
$$;
revoke all on function crm_allocation.customer_display_name(text,jsonb) from public, anon, authenticated;

create or replace function public.rpc_deal_history_list()
returns table (
  id uuid, source_row integer, owner_id uuid, signed_on text, company text, salesperson text,
  contract_number text, base_fee text, contact_name text, website text
)
language sql stable security invoker set search_path = ''
as $$
  select r.id, r.source_row, r.owner_id, coalesce(nullif(r.raw_values->>1,''), r.fields->>'B'),
    r.raw_values->>7, r.raw_values->>6, coalesce(r.generated_contract_number, nullif(r.raw_values->>8,''), r.fields->>'I'),
    coalesce(nullif(r.raw_values->>16,''), r.fields->>'Q'),
    coalesce(nullif(r.raw_values->>11,''), r.fields->>'L'),
    coalesce(nullif(r.raw_values->>9,''), r.fields->>'J')
  from public.deal_history_records r
  where coalesce(
    substring(btrim(r.raw_values->>0) from '^([0-9]{4})[[:space:]]*年?$'),
    substring(btrim(coalesce(nullif(btrim(r.raw_values->>1), ''), r.fields->>'B')) from '^([0-9]{4})[-/.年]')
  )::integer >= 2026
    and not crm_allocation.history_in_allocation(r.id)
  order by r.source_row, r.id;
$$;

create or replace function crm_allocation.workspace(p_pending boolean)
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
    select 'lead' as source, l.id, crm_allocation.customer_display_name(l.name, s.submitted) as company,
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
    select 'history' as source, r.id, crm_allocation.customer_display_name(r.raw_values->>7, s.data) as company, s.data->>'salesperson' as salesperson,
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
