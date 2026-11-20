-- Let sales explicitly confirm that the contract has no handoff attachments.
create or replace function public.rpc_deal_contract_submission_save(
  p_lead_id uuid, p_data jsonb, p_attachments jsonb, p_version integer, p_confirm boolean
)
returns public.deal_contract_submissions language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.deal_contract_submissions;
  v_allowed constant text[] := array[
    'signedOn','expectedPaymentOn','actualPayment','handoffOn','serviceStartsOn','salesperson','companyName',
    'mainlandCompanyName','hongKongCompanyName',
    'contractNumber','website','category','contactName','contactTitle','phone','email','cooperation',
    'baseFee','serviceFees','spendRatio','bonusAmount','bonusTerms','services','needs','address','currency','attachmentStatus'
  ];
  v_required constant text[] := array[
    'signedOn','expectedPaymentOn','actualPayment','handoffOn','serviceStartsOn','salesperson',
    'mainlandCompanyName','hongKongCompanyName',
    'contractNumber','website','category','contactName','contactTitle','phone','email','cooperation',
    'baseFee','serviceFees','needs','address','currency'
  ];
  v_choices constant jsonb := '{
    "performance":["google","meta","criteo","bing","pinterest","tiktok","ctv"],
    "brand":["influencer","social","edm","pr","full_service"],
    "seo":["seo","sem"],
    "website":[],
    "creative":[]
  }';
  v_key text;
  v_value jsonb;
  v_attachment jsonb;
  v_path text;
  v_effective jsonb;
  v_submission jsonb;
  v_ratio text;
begin
  perform 1 from public.leads where id = p_lead_id for update;
  if not iwish.can_access_deal_contract_submission(p_lead_id, true) then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:deal_contract_submission';
  end if;

  select * into v_row from public.deal_contract_submissions where lead_id = p_lead_id for update;
  if coalesce(v_row.version, 0) is distinct from p_version then
    raise exception using errcode = '40001', message = 'ERR_CONFLICT:deal_contract_submission';
  end if;

  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 65536
    or jsonb_typeof(p_attachments) is distinct from 'array' or octet_length(p_attachments::text) > 65536
  then raise exception 'ERR_VALIDATION:deal_contract_payload'; end if;
  for v_key, v_value in select key, value from jsonb_each(p_data) loop
    if not v_key = any(v_allowed) or (v_key <> 'services' and jsonb_typeof(v_value) <> 'string')
      then raise exception 'ERR_VALIDATION:deal_contract_field'; end if;
  end loop;

  -- Preserve split company fields when an older client saves an unrelated draft edit.
  p_data := jsonb_strip_nulls(jsonb_build_object(
    'mainlandCompanyName', v_row.draft->'mainlandCompanyName',
    'hongKongCompanyName', v_row.draft->'hongKongCompanyName'
  )) || p_data;
  if nullif(btrim(p_data->>'mainlandCompanyName'), '') is not null then
    -- Keep the existing queue and integration display field compatible.
    p_data := p_data || jsonb_build_object('companyName', btrim(p_data->>'mainlandCompanyName'));
  end if;
  if coalesce(p_data->>'currency', '') not in ('', 'CNY', 'USD') then
    raise exception 'ERR_VALIDATION:deal_contract_currency';
  end if;
  if v_row.finance->>'currency' in ('CNY', 'USD') then
    p_data := p_data || jsonb_build_object('currency', v_row.finance->>'currency');
  end if;

  if jsonb_typeof(p_data->'services') is distinct from 'object' then
    raise exception 'ERR_VALIDATION:deal_contract_services';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_data->'services') loop
    if not (v_choices ? v_key) or jsonb_typeof(v_value) <> 'array' or not (v_choices->v_key @> v_value)
      then raise exception 'ERR_VALIDATION:deal_contract_services'; end if;
    if p_confirm and jsonb_array_length(v_choices->v_key) > 0 and jsonb_array_length(v_value) = 0
      then raise exception 'ERR_VALIDATION:deal_contract_services'; end if;
  end loop;

  for v_attachment in select value from jsonb_array_elements(p_attachments) loop
    v_path := v_attachment->>'path';
    if v_path is null or split_part(v_path, '/', 1) <> p_lead_id::text
      or length(btrim(coalesce(v_attachment->>'name', ''))) not between 1 and 255
      or octet_length(v_attachment::text) > 1500
    then raise exception 'ERR_VALIDATION:deal_contract_attachment'; end if;
    perform 1 from storage.objects where bucket_id = 'deal-contract-materials' and name = v_path for key share;
    if not found then raise exception 'ERR_VALIDATION:deal_contract_attachment'; end if;
  end loop;

  -- Older clients omit this field. Keep a saved answer unless explicitly cleared or replaced with a file.
  if p_data ? 'attachmentStatus' and p_data->>'attachmentStatus' not in ('', 'none') then
    raise exception 'ERR_VALIDATION:deal_contract_attachment_status';
  end if;
  if jsonb_array_length(p_attachments) = 0
     and coalesce(p_data->>'attachmentStatus', v_row.draft->>'attachmentStatus') = 'none' then
    p_data := p_data || '{"attachmentStatus":"none"}'::jsonb;
  else
    p_data := p_data - 'attachmentStatus';
  end if;

  if p_confirm then
    v_effective := p_data || coalesce(v_row.finance, '{}'::jsonb);
    foreach v_key in array v_required loop
      if nullif(btrim(v_effective->>v_key), '') is null then raise exception 'ERR_VALIDATION:deal_contract_required'; end if;
    end loop;
    if p_data->'services' = '{}'::jsonb
       or (jsonb_array_length(p_attachments) = 0 and p_data->>'attachmentStatus' is distinct from 'none')
      then raise exception 'ERR_VALIDATION:deal_contract_required'; end if;
    if v_effective->>'cooperation' not in ('fixed_quarter', 'spend_ratio', 'base_bonus')
      or coalesce(p_data->>'currency', '') not in ('CNY', 'USD')
      or v_effective->>'email' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      or (v_effective->>'website' <> '暂无网站'
        and v_effective->>'website' !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]*[a-z][a-z0-9-]*$')
    then raise exception 'ERR_VALIDATION:deal_contract_format'; end if;
    if v_effective->>'baseFee' !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
      then raise exception 'ERR_VALIDATION:deal_contract_amount'; end if;
    v_submission := p_data;
    if v_effective->>'cooperation' = 'base_bonus' then
      if coalesce(v_effective->>'bonusAmount', '') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
        or nullif(btrim(v_effective->>'bonusTerms'), '') is null
        then raise exception 'ERR_VALIDATION:deal_contract_bonus'; end if;
    else
      v_submission := v_submission - array['bonusAmount','bonusTerms'];
    end if;
    if v_effective->>'cooperation' = 'spend_ratio' then
      v_ratio := btrim(coalesce(v_effective->>'spendRatio', ''));
      if v_ratio !~ '^([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then
        raise exception 'ERR_VALIDATION:deal_contract_spend_ratio';
      end if;
      if v_ratio::numeric <= 0 or v_ratio::numeric > 100 then
        raise exception 'ERR_VALIDATION:deal_contract_spend_ratio';
      end if;
    else
      v_submission := v_submission - 'spendRatio';
    end if;
    foreach v_key in array array['signedOn','expectedPaymentOn','handoffOn','serviceStartsOn'] loop
      if v_effective->>v_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then raise exception 'ERR_VALIDATION:deal_contract_date'; end if;
      perform (v_effective->>v_key)::date;
    end loop;
  end if;

  insert into public.deal_contract_submissions as d (
    lead_id, draft, draft_attachments, submitted, submitted_attachments, submitted_at, submitted_by
  ) values (
    p_lead_id, p_data, p_attachments,
    v_submission,
    case when p_confirm then p_attachments else '[]'::jsonb end,
    case when p_confirm then now() end,
    case when p_confirm then auth.uid() end
  )
  on conflict (lead_id) do update set
    draft = excluded.draft,
    draft_attachments = excluded.draft_attachments,
    submitted = case when p_confirm then excluded.submitted else d.submitted end,
    submitted_attachments = case when p_confirm then excluded.submitted_attachments else d.submitted_attachments end,
    submitted_at = case when p_confirm then excluded.submitted_at else d.submitted_at end,
    submitted_by = case when p_confirm then excluded.submitted_by else d.submitted_by end,
    version = d.version + 1,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.rpc_deal_history_save(p_id uuid, p_changes jsonb, p_new_attachments jsonb, p_version integer)
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
    if v_key not in ('B','C','D','E','F','I','J','K','L','M','N','O','P','Q','R','S','T','U','Y','Z','AA','AB','AC','AD',
        'spendRatio','mainlandCompanyName','hongKongCompanyName','currency','attachmentStatus')
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
    if v_key = 'currency' and v_value not in ('CNY', 'USD')
      then raise exception 'ERR_VALIDATION:deal_history_currency'; end if;
    if v_key = 'attachmentStatus' and v_value <> 'none'
      then raise exception 'ERR_VALIDATION:deal_history_attachment_status'; end if;
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

  if jsonb_array_length(v_row.attachments) > 0 then
    v_row.fields := v_row.fields - 'attachmentStatus';
  end if;

  update public.deal_history_records r
  set fields=v_row.fields, attachments=v_row.attachments,
    version=r.version+1, updated_at=now(), updated_by=auth.uid()
  where r.id=p_id returning * into v_row;
  return v_row;
end;
$$;

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
    ('serviceStartsOn','F',5), ('salesperson','G',6), ('contractNumber','I',8),
    ('website','J',9), ('category','K',10), ('contactName','L',11), ('contactTitle','M',12),
    ('phone','N',13), ('email','O',14), ('cooperation','P',15), ('baseFee','Q',16), ('serviceFees','R',17),
    ('bonusAmount','S',18), ('bonusTerms','T',19), ('needs','AC',28), ('address','AD',29)
  ) m(field,col,position);
  v_payload := v_payload || jsonb_build_object(
    'salesperson', coalesce(v_payload->>'salesperson',v_owner),
    'companyName', nullif(btrim(v_row.fields->>'mainlandCompanyName'), ''),
    'mainlandCompanyName', nullif(btrim(v_row.fields->>'mainlandCompanyName'), ''),
    'hongKongCompanyName', nullif(btrim(v_row.fields->>'hongKongCompanyName'), ''),
    'currency', case when v_row.fields->>'currency' in ('CNY', 'USD') then v_row.fields->>'currency' end,
    'contractNumber', coalesce(v_row.generated_contract_number, v_payload->>'contractNumber'),
    'spendRatio', nullif(v_row.fields->>'spendRatio',''), 'services', p_services);
  v_finance := jsonb_strip_nulls(jsonb_build_object(
    'legalName', nullif(v_row.raw_values->>41,''), 'receivedOn', nullif(v_row.raw_values->>42,''),
    'receivedAmount', nullif(v_row.raw_values->>43,'')));
  if v_payload->>'actualPayment' is null and v_finance ? 'receivedOn' then
    v_payload := v_payload || jsonb_build_object('actualPayment', v_finance->>'receivedOn');
  end if;
  if (coalesce(jsonb_array_length(v_row.attachments),0) = 0
      and v_row.fields->>'attachmentStatus' is distinct from 'none') or exists (
    select 1 from jsonb_each_text(v_payload) f where f.value is null
      and f.key not in ('bonusAmount','bonusTerms','spendRatio'))
    or (v_payload->>'cooperation' = '基础服务费+激励奖金'
        and (v_payload->>'bonusAmount' is null or v_payload->>'bonusTerms' is null))
    or (v_payload->>'cooperation' = '消耗比例服务费' and v_payload->>'spendRatio' is null)
  then raise exception 'ERR_VALIDATION:department_allocation_history_required'; end if;
  if v_row.fields->>'attachmentStatus' = 'none' then
    v_payload := v_payload || '{"attachmentStatus":"none"}'::jsonb;
  end if;
  insert into crm_allocation.history_submissions (history_id, data, attachments, finance, submitted_at, submitted_by)
  values (p_id, v_payload, v_row.attachments, v_finance, clock_timestamp(), auth.uid())
  on conflict (history_id) do update set data = excluded.data, attachments = excluded.attachments,
    finance = excluded.finance, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by;
  return v_row;
end;
$$;
