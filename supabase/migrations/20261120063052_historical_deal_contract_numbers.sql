alter table public.deal_history_records add column generated_contract_number text unique;

create function iwish.new_historical_contract_number(p_raw jsonb, p_fields jsonb)
returns text language sql volatile set search_path = '' as $$
  select case when year_value::integer between 1 and 2025 then
    'HIS-' || year_value || '-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 12))
  end
  from (select coalesce(
    substring(btrim(p_raw->>0) from '^([0-9]{4})[[:space:]]*年?$'),
    substring(btrim(coalesce(nullif(btrim(p_raw->>1), ''), p_fields->>'B')) from '^([0-9]{4})[-/年]')
  ) as year_value) resolved;
$$;
revoke execute on function iwish.new_historical_contract_number(jsonb,jsonb) from public, anon, authenticated;

with generated as materialized (
  select id, iwish.new_historical_contract_number(raw_values, fields) as number
  from public.deal_history_records where generated_contract_number is null
)
update public.deal_history_records r set generated_contract_number = generated.number
from generated where r.id = generated.id and generated.number is not null;

create function iwish.assign_historical_contract_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.generated_contract_number is not null then
    if new.fields->'I' is distinct from old.fields->'I' then
      raise exception 'ERR_VALIDATION:deal_history_generated_number';
    end if;
    new.generated_contract_number := old.generated_contract_number;
  else
    new.generated_contract_number := iwish.new_historical_contract_number(new.raw_values, new.fields);
  end if;
  return new;
end;
$$;
revoke execute on function iwish.assign_historical_contract_number() from public, anon, authenticated;

create trigger assign_historical_contract_number
before insert or update of fields, raw_values, generated_contract_number on public.deal_history_records
for each row execute function iwish.assign_historical_contract_number();

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
  order by r.source_row, r.id;
$$;

update crm_allocation.history_submissions s
set data = jsonb_set(s.data, '{contractNumber}', to_jsonb(r.generated_contract_number))
from public.deal_history_records r
where r.id = s.history_id and r.generated_contract_number is not null
  and s.data->>'contractNumber' is distinct from r.generated_contract_number;

create or replace function crm_allocation.confirm_history(
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
    'contractNumber', coalesce(v_row.generated_contract_number, v_payload->>'contractNumber'),
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
