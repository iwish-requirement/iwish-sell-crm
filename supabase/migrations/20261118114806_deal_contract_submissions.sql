create table public.deal_contract_submissions (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  draft_attachments jsonb not null default '[]'::jsonb,
  submitted jsonb,
  submitted_attachments jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  finance jsonb not null default '{}'::jsonb,
  finance_confirmed_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.deal_contract_submissions enable row level security;
revoke all on public.deal_contract_submissions from public, anon, authenticated;
grant select on public.deal_contract_submissions to authenticated;

create function iwish.can_access_deal_contract_submission(p_lead_id uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select iwish.is_active_user(auth.uid()) and iwish.has_permission(auth.uid(), 'contracts.read')
    and iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive')
    and exists (
      select 1 from public.leads l
      where l.id = p_lead_id and not coalesce(l.is_deleted, false)
        and l.status = 'closed' and l.close_result in ('won', '成交')
        and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
        and (not p_write or l.owner_id = auth.uid()
          or (iwish.has_permission(auth.uid(), 'contracts.manage')
            and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')))
    );
$$;
revoke all on function iwish.can_access_deal_contract_submission(uuid, boolean) from public, anon;
grant execute on function iwish.can_access_deal_contract_submission(uuid, boolean) to authenticated;

create policy deal_contract_submissions_read on public.deal_contract_submissions
  for select to authenticated using (iwish.can_access_deal_contract_submission(lead_id, false));

insert into storage.buckets (id, name, public, file_size_limit)
values ('deal-contract-materials', 'deal-contract-materials', false, 20971520);

create policy deal_contract_materials_read on storage.objects
  for select to authenticated
  using (bucket_id = 'deal-contract-materials' and iwish.can_access_deal_contract_submission(
    case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then split_part(name, '/', 1)::uuid end, false));

create policy deal_contract_materials_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'deal-contract-materials'
    and name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and iwish.can_access_deal_contract_submission(
      case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid end, true));

create policy deal_contract_materials_cleanup on storage.objects
  for delete to authenticated
  using (bucket_id = 'deal-contract-materials'
    and owner_id = (select auth.uid())::text
    and not exists (
      select 1 from public.deal_contract_submissions s
      where s.lead_id::text = split_part(name, '/', 1)
        and (s.draft_attachments @> jsonb_build_array(jsonb_build_object('path', name))
          or s.submitted_attachments @> jsonb_build_array(jsonb_build_object('path', name)))
    )
    and iwish.can_access_deal_contract_submission(
      case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid end, true));

create function public.rpc_deal_contract_submission_can_edit(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select iwish.can_access_deal_contract_submission(p_lead_id, true) $$;
revoke all on function public.rpc_deal_contract_submission_can_edit(uuid) from public, anon;
grant execute on function public.rpc_deal_contract_submission_can_edit(uuid) to authenticated;

create function public.rpc_deal_contract_allocation_result(p_lead_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('department', d.name, 'manager', manager.full_name)
    || case when a.confirmed_at is not null then coalesce((
      select jsonb_object_agg(optimizer.role, (
        select string_agg(member.full_name, '、' order by member.full_name)
        from public.ops_members member
        where member.id = any(coalesce(nullif(optimizer.member_ids, '{}'::uuid[]), array[optimizer.member_id]))
      ))
      from (values
        ('google', a.google_optimizer_ids, a.google_optimizer_id),
        ('meta', a.meta_optimizer_ids, a.meta_optimizer_id),
        ('criteo', a.criteo_optimizer_ids, a.criteo_optimizer_id),
        ('bing', a.bing_optimizer_ids, a.bing_optimizer_id),
        ('edm', a.edm_optimizer_ids, a.edm_optimizer_id),
        ('influencer', a.influencer_marketing_ids, a.influencer_marketing_id)
      ) optimizer(role, member_ids, member_id)
    ), '{}'::jsonb) else '{}'::jsonb end)
  from public.lead_project_assignments a
  join public.leads l on l.id = a.lead_id
  left join public.ops_departments d on d.id = a.department_id
  left join public.ops_members manager on manager.id = a.project_manager_id
  where a.lead_id = p_lead_id and l.allocation_status = 'assigned'
    and iwish.can_access_deal_contract_submission(p_lead_id, false);
$$;
revoke all on function public.rpc_deal_contract_allocation_result(uuid) from public, anon;
grant execute on function public.rpc_deal_contract_allocation_result(uuid) to authenticated;

create function public.rpc_deal_contract_submission_save(
  p_lead_id uuid, p_data jsonb, p_attachments jsonb, p_version integer, p_confirm boolean
)
returns public.deal_contract_submissions language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.deal_contract_submissions;
  v_allowed constant text[] := array[
    'signedOn','expectedPaymentOn','actualPayment','handoffOn','serviceStartsOn','salesperson','companyName',
    'contractNumber','website','category','contactName','contactTitle','phone','email','cooperation',
    'baseFee','serviceFees','spendRatio','bonusAmount','bonusTerms','services','needs','address','currency'
  ];
  v_required constant text[] := array[
    'signedOn','expectedPaymentOn','actualPayment','handoffOn','serviceStartsOn','salesperson','companyName',
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

  if p_confirm then
    v_effective := p_data || coalesce(v_row.finance, '{}'::jsonb);
    foreach v_key in array v_required loop
      if nullif(btrim(v_effective->>v_key), '') is null then raise exception 'ERR_VALIDATION:deal_contract_required'; end if;
    end loop;
    if p_data->'services' = '{}'::jsonb or jsonb_array_length(p_attachments) = 0
      then raise exception 'ERR_VALIDATION:deal_contract_required'; end if;
    if v_effective->>'cooperation' not in ('fixed_quarter', 'spend_ratio', 'base_bonus')
      or v_effective->>'currency' !~ '^[A-Z]{3}$'
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
revoke all on function public.rpc_deal_contract_submission_save(uuid, jsonb, jsonb, integer, boolean) from public, anon;
grant execute on function public.rpc_deal_contract_submission_save(uuid, jsonb, jsonb, integer, boolean) to authenticated;

insert into public.permissions (key, resource, action, name, description, is_system, is_enabled)
values ('contracts.finance.confirm', 'contracts', 'confirm_finance', 'Confirm deal contract financial information',
  'Confirm contract and receipt values for a submitted deal', true, true)
on conflict (key) do nothing;

create function iwish.can_confirm_deal_contract_finance(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select iwish.can_access_deal_contract_submission(p_lead_id, false)
    and iwish.has_permission(auth.uid(), 'contracts.finance.confirm')
    and exists (select 1 from public.leads l where l.id = p_lead_id
      and iwish.in_scope_for_lead(auth.uid(), l, 'contracts.finance.confirm'));
$$;
revoke all on function iwish.can_confirm_deal_contract_finance(uuid) from public, anon, authenticated;

create function public.rpc_deal_contract_submission_confirm_finance(p_lead_id uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
begin
  perform 1 from public.leads where id = p_lead_id for update;
  if not iwish.can_confirm_deal_contract_finance(p_lead_id)
  then raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:contracts.finance.confirm'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' or p_values = '{}'::jsonb or octet_length(p_values::text) > 16000
    then raise exception 'ERR_VALIDATION:deal_contract_finance'; end if;
  for v_key, v_value in select key, value from jsonb_each(p_values) loop
    if v_key not in ('contractNumber','signedOn','legalName','baseFee','currency','actualPayment','receivedOn','receivedAmount')
      or jsonb_typeof(v_value) <> 'string' or nullif(btrim(v_value #>> '{}'), '') is null
    then raise exception 'ERR_VALIDATION:deal_contract_finance'; end if;
    if v_key in ('baseFee','receivedAmount') and (v_value #>> '{}') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
      then raise exception 'ERR_VALIDATION:deal_contract_amount'; end if;
    if v_key in ('signedOn','receivedOn') then
      if (v_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'ERR_VALIDATION:deal_contract_date'; end if;
      perform (v_value #>> '{}')::date;
    end if;
    if v_key = 'currency' and (v_value #>> '{}') !~ '^[A-Z]{3}$'
      then raise exception 'ERR_VALIDATION:deal_contract_currency'; end if;
  end loop;
  if (p_values ? 'receivedOn') <> (p_values ? 'receivedAmount')
    then raise exception 'ERR_VALIDATION:deal_contract_receipt'; end if;
  if p_values ? 'receivedOn' then
    p_values := p_values || jsonb_build_object('actualPayment', p_values->>'receivedOn');
  end if;
  update public.deal_contract_submissions
  set finance = finance || p_values, finance_confirmed_at = now(), version = version + 1
  where lead_id = p_lead_id and submitted_at is not null;
  if not found then raise exception 'ERR_STATE:deal_contract_not_submitted'; end if;
end;
$$;
revoke all on function public.rpc_deal_contract_submission_confirm_finance(uuid, jsonb) from public, anon;
grant execute on function public.rpc_deal_contract_submission_confirm_finance(uuid, jsonb) to authenticated;
