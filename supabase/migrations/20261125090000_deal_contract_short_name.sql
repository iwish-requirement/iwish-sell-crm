-- 合同资料加「客户简称」（shortName，选填）：运营系统用它当客户名 / 项目名（iWish 运营系统 2026-11-25「系统上没有的字段也要补充」）。
-- 只把 shortName 加进允许的字段，不进必填，已提交的合同不受影响。

create or replace function public.rpc_deal_contract_submission_save(
  p_lead_id uuid, p_data jsonb, p_attachments jsonb, p_version integer, p_confirm boolean
)
returns public.deal_contract_submissions language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.deal_contract_submissions;
  v_allowed constant text[] := array[
    'signedOn','expectedPaymentOn','actualPayment','handoffOn','serviceStartsOn','salesperson','companyName','shortName',
    'mainlandCompanyName','hongKongCompanyName',
    'contractNumber','website','category','contactName','contactTitle','phone','email','cooperation',
    'baseFee','serviceFees','spendRatio','bonusAmount','bonusTerms','bonusTermsHtml','services','needs','address','currency','attachmentStatus'
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

  -- Keep the plain terms readable by existing clients. Older clients do not send the HTML field.
  if p_data->>'cooperation' = 'base_bonus' and nullif(btrim(p_data->>'bonusTerms'), '') is not null then
    if not (p_data ? 'bonusTermsHtml') and v_row.draft ? 'bonusTermsHtml'
       and btrim(p_data->>'bonusTerms') = btrim(v_row.draft->>'bonusTerms') then
      p_data := p_data || jsonb_build_object('bonusTermsHtml', v_row.draft->>'bonusTermsHtml');
    end if;
    if char_length(p_data->>'bonusTermsHtml') > 20000 then
      raise exception 'ERR_VALIDATION:deal_bonus_terms_html';
    end if;
  else
    p_data := p_data - 'bonusTermsHtml';
  end if;
  if p_data->>'bonusTermsHtml' = '' then p_data := p_data - 'bonusTermsHtml'; end if;

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
      v_submission := v_submission - array['bonusAmount','bonusTerms','bonusTermsHtml'];
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

