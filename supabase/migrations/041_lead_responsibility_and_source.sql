-- 041_lead_responsibility_and_source.sql
-- Add responsibility/source attribution fields to leads, expose them via leads_secure_view,
-- and extend rpc_lead_create / rpc_lead_update to enforce business rules.

-----------------------------
-- 1) Table: extend public.leads
-----------------------------

alter table public.leads
  add column if not exists responsibility_type text
    check (responsibility_type in ('company_resource','sales_self','customer_referral') or responsibility_type is null),
  add column if not exists dev_method_key text,
  add column if not exists referral_customer_name text,
  add column if not exists referral_type_key text,
  add column if not exists activity_name text,
  add column if not exists source_department_key text,
  add column if not exists source_locked_at timestamptz;


-----------------------------
-- 2) View: extend public.leads_secure_view
-----------------------------
-- IMPORTANT: keep existing column order stable and only append new columns at the end.

create or replace view public.leads_secure_view as
select
  l.id,
  l.team_id,
  l.owner_id,
  l.created_by,
  l.name,
  l.source,
  l.stage,
  l.status,
  l.close_result,
  l.close_reason,
  l.last_contact_at,
  l.created_at,
  l.updated_at,
  l.customer_name,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone else iwish.mask_phone(l.customer_phone) end as customer_phone,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email else iwish.mask_email(l.customer_email) end as customer_email,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address else null end as address,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget else null end as budget,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score else null end as internal_score,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason else null end as blacklist_reason,
  l.next_contact_at,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.wechat else null end as wechat,
  l.customer_grade,
  l.source_level1,
  l.source_level2,
  l.tags,
  coalesce(
    (
      select json_agg(json_build_object('id', bc.id, 'name', bc.name) order by bc.sort_order)
      from public.leads_business_categories lbc
      join public.business_categories bc on bc.id = lbc.category_id and bc.is_active = true
      where lbc.lead_id = l.id
    ), '[]'::json
  ) as business_categories,
  coalesce(
    (
      select json_agg(json_build_object('id', bt.id, 'name', bt.name, 'category_id', bt.category_id) order by bt.sort_order)
      from public.leads_business_types lbt
      join public.business_types bt on bt.id = lbt.type_id and bt.is_active = true
      where lbt.lead_id = l.id
    ), '[]'::json
  ) as business_types,
  -- newly exposed responsibility/source attribution fields (non-sensitive)
  l.responsibility_type,
  l.dev_method_key,
  l.referral_customer_name,
  l.referral_type_key,
  l.activity_name,
  l.source_department_key,
  l.source_locked_at
from public.leads l;


-----------------------------
-- 3) RPC: extend iwish.rpc_lead_create
-----------------------------

create or replace function iwish.rpc_lead_create(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_team_id int := (payload->>'team_id')::int;
  v_owner uuid := coalesce((payload->>'owner_id')::uuid, v_actor);
  v_stage text := coalesce(nullif(payload->>'stage',''), 'L1');
  v_status text := coalesce(nullif(payload->>'status',''), 'open');
  v_type_ids bigint[] := coalesce((select array_agg((value)::bigint) from jsonb_array_elements_text(payload->'business_type_ids')), '{}');
  v_category_ids bigint[] := coalesce((select array_agg((value)::bigint) from jsonb_array_elements_text(payload->'business_category_ids')), '{}');
  v_valid_type_ids bigint[] := '{}';
  v_all_category_ids bigint[] := '{}';
  v_valid_category_ids bigint[] := '{}';
  -- responsibility / source attribution
  v_resp text := nullif(payload->>'responsibility_type','');
  v_dev_method text := nullif(payload->>'dev_method_key','');
  v_referral_name text := nullif(payload->>'referral_customer_name','');
  v_referral_type text := nullif(payload->>'referral_type_key','');
  v_activity_name text := nullif(payload->>'activity_name','');
  v_source_dept text := nullif(payload->>'source_department_key','');
  v_source_level1 text := nullif(payload->>'source_level1','');
  v_source_level2 text := nullif(payload->>'source_level2','');
begin
  if not iwish.has_permission(v_actor, 'leads.create') then
    raise exception 'ERR_NO_PERMISSION:leads.create';
  end if;

  if v_stage not in ('L1','L2','L3','L4','Won') then
    raise exception 'ERR_VALIDATION:invalid_stage';
  end if;

  if v_status not in ('open','closed','pool') then
    raise exception 'ERR_VALIDATION:invalid_status';
  end if;

  -- scope: if create scope is self/team, enforce team match
  if (iwish.get_effective_scope(v_actor, 'leads.create')->>'scope_type') in ('self','team') then
    if v_team_id <> (select team_id from public.profiles where id = v_actor) then
      raise exception 'ERR_OUT_OF_SCOPE:team_mismatch_on_create';
    end if;
  end if;

  -- sensitive fields write permission
  if (payload ? 'customer_phone' or payload ? 'customer_email' or payload ? 'address' or payload ? 'budget') then
    if not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then
      raise exception 'ERR_FIELD_FORBIDDEN:write_sensitive_required';
    end if;
  end if;

  -- business types required
  if v_type_ids is null or cardinality(v_type_ids) = 0 then
    raise exception 'ERR_VALIDATION:business_type_required';
  end if;

  select array_agg(id) into v_valid_type_ids
    from public.business_types bt
    where bt.id = any(v_type_ids) and bt.is_active = true;

  if v_valid_type_ids is null or cardinality(v_valid_type_ids) <> cardinality(v_type_ids) then
    raise exception 'ERR_VALIDATION:invalid_business_type';
  end if;

  select array_agg(distinct bt.category_id) into v_all_category_ids
    from public.business_types bt
    where bt.id = any(v_valid_type_ids);

  if v_category_ids is not null and cardinality(v_category_ids) > 0 then
    select array_agg(distinct cid) into v_all_category_ids
    from (
      select unnest(v_all_category_ids) as cid
      union
      select unnest(v_category_ids) as cid
    ) t;
  end if;

  if v_all_category_ids is null then
    v_all_category_ids := '{}';
  end if;

  if cardinality(v_all_category_ids) > 0 then
    select array_agg(id) into v_valid_category_ids
      from public.business_categories bc
      where bc.id = any(v_all_category_ids) and bc.is_active = true;

    if v_valid_category_ids is null or cardinality(v_valid_category_ids) <> cardinality(v_all_category_ids) then
      raise exception 'ERR_VALIDATION:invalid_business_category';
    end if;
  end if;

  -- responsibility / source validation (creation)
  if v_resp is null then
    raise exception 'ERR_VALIDATION:responsibility_type_required';
  end if;

  if v_resp = 'company_resource' then
    if v_source_level1 is null then
      raise exception 'ERR_VALIDATION:source_channel_required_for_company_resource';
    end if;
    if v_source_dept is null then
      raise exception 'ERR_VALIDATION:source_department_required_for_company_resource';
    end if;
    if v_source_level1 = 'offline' and v_activity_name is null then
      raise exception 'ERR_VALIDATION:activity_name_required_for_offline_company_resource';
    end if;
  elsif v_resp = 'sales_self' then
    if v_dev_method is null then
      raise exception 'ERR_VALIDATION:dev_method_required_for_sales_self';
    end if;
  elsif v_resp = 'customer_referral' then
    if v_referral_name is null or v_referral_type is null then
      raise exception 'ERR_VALIDATION:referral_info_required_for_customer_referral';
    end if;
  end if;

  insert into public.leads(
    team_id, owner_id, created_by,
    name, source, stage, status,
    customer_name, customer_phone, customer_email, address, budget,
    internal_score, blacklist_reason, last_contact_at,
    next_contact_at, customer_grade, source_level1, source_level2, tags,
    responsibility_type, dev_method_key, referral_customer_name, referral_type_key,
    activity_name, source_department_key, source_locked_at
  ) values (
    v_team_id,
    v_owner,
    v_actor,
    payload->>'name',
    payload->>'source',
    v_stage,
    v_status,
    payload->>'customer_name',
    payload->>'customer_phone',
    payload->>'customer_email',
    payload->>'address',
    (payload->>'budget')::numeric,
    (payload->>'internal_score')::int,
    payload->>'blacklist_reason',
    (payload->>'last_contact_at')::timestamptz,
    (payload->>'next_contact_at')::timestamptz,
    payload->>'customer_grade',
    v_source_level1,
    v_source_level2,
    (select coalesce(array_agg(value::text), '{}') from jsonb_array_elements_text(payload->'tags')),
    v_resp,
    v_dev_method,
    v_referral_name,
    v_referral_type,
    v_activity_name,
    v_source_dept,
    case when v_resp is not null then now() else null end
  )
  returning id into v_id;

  -- associations
  delete from public.leads_business_types where lead_id = v_id;
  insert into public.leads_business_types(lead_id, type_id)
    select v_id, unnest(v_valid_type_ids);

  if cardinality(v_all_category_ids) > 0 then
    delete from public.leads_business_categories where lead_id = v_id;
    insert into public.leads_business_categories(lead_id, category_id)
      select v_id, unnest(v_valid_category_ids);
  end if;

  perform iwish.audit(v_actor, 'create_lead', 'lead', v_id::text, null, (select to_jsonb(l.*) from public.leads l where l.id = v_id), null);
  return v_id;
end $$;

-- keep public wrapper signature unchanged
create or replace function public.rpc_lead_create(payload jsonb)
returns uuid
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_create(payload);
$$;

grant execute on function public.rpc_lead_create(jsonb) to authenticated, service_role;


-----------------------------
-- 4) RPC: extend iwish.rpc_lead_update with responsibility/source rules
-----------------------------

create or replace function iwish.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_lead public.leads;
  k text;
  v_is_return_to_pool boolean := false;
  v_old_stage text;
  v_new_stage text;
  v_old_rank int;
  v_new_rank int;
  -- responsibility-related new/old values
  v_new_resp text;
  v_new_source_level1 text;
  v_new_source_level2 text;
  v_new_dev_method text;
  v_new_referral_name text;
  v_new_referral_type text;
  v_new_activity_name text;
  v_new_source_dept text;
begin
  if not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:leads.update';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;

  -- scope check: allow generic scope OR always allow owner/creator
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    if v_lead.owner_id <> v_actor and v_lead.created_by <> v_actor then
      raise exception 'ERR_OUT_OF_SCOPE:leads.update';
    end if;
  end if;

  -- detect return-to-pool transition and enforce dedicated permission
  if patch ? 'status' then
    if patch->>'status' = 'pool' and v_lead.status <> 'pool' then
      v_is_return_to_pool := true;

      if not iwish.has_permission(v_actor, 'leads.pool.return') then
        raise exception 'ERR_NO_PERMISSION:leads.pool.return';
      end if;
    end if;
  end if;

  -- stage lifecycle validation (forward-only, require reason on upgrade, forbid changing closed leads)
  if patch ? 'stage' then
    v_old_stage := v_lead.stage;
    v_new_stage := patch->>'stage';

    if v_new_stage is not null and v_new_stage <> v_old_stage then
      if v_lead.status = 'closed' then
        raise exception 'ERR_INVALID_STATUS:cannot_change_stage_when_closed';
      end if;

      if v_new_stage not in ('L1','L2','L3','L4','Won') then
        raise exception 'ERR_VALIDATION:invalid_stage';
      end if;

      v_old_rank := case v_old_stage
        when 'L1' then 1
        when 'L2' then 2
        when 'L3' then 3
        when 'L4' then 4
        when 'Won' then 5
        else 0
      end;

      v_new_rank := case v_new_stage
        when 'L1' then 1
        when 'L2' then 2
        when 'L3' then 3
        when 'L4' then 4
        when 'Won' then 5
        else 0
      end;

      if v_new_rank < v_old_rank then
        raise exception 'ERR_INVALID_STAGE_TRANSITION:cannot_downgrade';
      end if;

      if v_new_rank > v_old_rank then
        if p_reason is null or length(trim(p_reason)) = 0 then
          raise exception 'ERR_VALIDATION:stage_reason_required';
        end if;
      end if;
    end if;
  end if;

  -- closed leads cannot change responsibility/source attribution
  if v_lead.status = 'closed' then
    if patch ? 'responsibility_type' or patch ? 'source_level1' or patch ? 'source_level2' or
       patch ? 'dev_method_key' or patch ? 'referral_customer_name' or patch ? 'referral_type_key' or
       patch ? 'activity_name' or patch ? 'source_department_key' then
      raise exception 'ERR_INVALID_STATUS:cannot_change_source_when_closed';
    end if;
  end if;

  v_before := to_jsonb(v_lead.*);

  -- field-level checks
  for k in select jsonb_object_keys(patch)
  loop
    if k in ('owner_id','team_id','created_by') then
      raise exception 'ERR_FIELD_FORBIDDEN:use_assign_or_transfer';
    end if;

    if k in ('customer_phone','customer_email','address','budget') then
      if not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then
        raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_sensitive';
      end if;
    end if;

    if k in ('internal_score','blacklist_reason') then
      if not iwish.has_permission(v_actor, 'leads.fields.write_internal') then
        raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_internal';
      end if;
    end if;
  end loop;

  -- compute new responsibility/source values for validation if this lead is already in new system
  v_new_resp := coalesce(patch->>'responsibility_type', v_lead.responsibility_type);
  v_new_source_level1 := coalesce(patch->>'source_level1', v_lead.source_level1);
  v_new_source_level2 := coalesce(patch->>'source_level2', v_lead.source_level2);
  v_new_dev_method := coalesce(patch->>'dev_method_key', v_lead.dev_method_key);
  v_new_referral_name := coalesce(patch->>'referral_customer_name', v_lead.referral_customer_name);
  v_new_referral_type := coalesce(patch->>'referral_type_key', v_lead.referral_type_key);
  v_new_activity_name := coalesce(patch->>'activity_name', v_lead.activity_name);
  v_new_source_dept := coalesce(patch->>'source_department_key', v_lead.source_department_key);

  if (v_lead.responsibility_type is not null or patch ? 'responsibility_type') then
    if v_new_resp is null or length(trim(v_new_resp)) = 0 then
      raise exception 'ERR_VALIDATION:responsibility_type_required';
    end if;

    if v_new_resp = 'company_resource' then
      if v_new_source_level1 is null or length(trim(v_new_source_level1)) = 0 then
        raise exception 'ERR_VALIDATION:source_channel_required_for_company_resource';
      end if;
      if v_new_source_dept is null or length(trim(v_new_source_dept)) = 0 then
        raise exception 'ERR_VALIDATION:source_department_required_for_company_resource';
      end if;
      if v_new_source_level1 = 'offline' and (v_new_activity_name is null or length(trim(v_new_activity_name)) = 0) then
        raise exception 'ERR_VALIDATION:activity_name_required_for_offline_company_resource';
      end if;
    elsif v_new_resp = 'sales_self' then
      if v_new_dev_method is null or length(trim(v_new_dev_method)) = 0 then
        raise exception 'ERR_VALIDATION:dev_method_required_for_sales_self';
      end if;
    elsif v_new_resp = 'customer_referral' then
      if v_new_referral_name is null or length(trim(v_new_referral_name)) = 0
         or v_new_referral_type is null or length(trim(v_new_referral_type)) = 0 then
        raise exception 'ERR_VALIDATION:referral_info_required_for_customer_referral';
      end if;
    end if;
  end if;

  update public.leads
  set
    name = coalesce(patch->>'name', name),
    source = coalesce(patch->>'source', source),
    stage = coalesce(patch->>'stage', stage),
    status = coalesce(patch->>'status', status),
    customer_name = coalesce(patch->>'customer_name', customer_name),
    customer_phone = coalesce(patch->>'customer_phone', customer_phone),
    customer_email = coalesce(patch->>'customer_email', customer_email),
    address = coalesce(patch->>'address', address),
    budget = coalesce((patch->>'budget')::numeric, budget),
    internal_score = coalesce((patch->>'internal_score')::int, internal_score),
    blacklist_reason = coalesce(patch->>'blacklist_reason', blacklist_reason),
    last_contact_at = coalesce((patch->>'last_contact_at')::timestamptz, last_contact_at),
    next_contact_at = coalesce((patch->>'next_contact_at')::timestamptz, next_contact_at),
    customer_grade = coalesce(patch->>'customer_grade', customer_grade),
    source_level1 = coalesce(patch->>'source_level1', source_level1),
    source_level2 = coalesce(patch->>'source_level2', source_level2),
    tags = coalesce((select array_agg(value::text) from jsonb_array_elements_text(patch->'tags')), tags),
    responsibility_type = coalesce(patch->>'responsibility_type', responsibility_type),
    dev_method_key = coalesce(patch->>'dev_method_key', dev_method_key),
    referral_customer_name = coalesce(patch->>'referral_customer_name', referral_customer_name),
    referral_type_key = coalesce(patch->>'referral_type_key', referral_type_key),
    activity_name = coalesce(patch->>'activity_name', activity_name),
    source_department_key = coalesce(patch->>'source_department_key', source_department_key),
    source_locked_at = case
      when responsibility_type is null and patch ? 'responsibility_type' and patch->>'responsibility_type' is not null then now()
      else source_locked_at
    end
  where id = p_lead_id;

  if v_is_return_to_pool then
    perform iwish.audit(
      v_actor,
      'return_lead_to_pool',
      'lead',
      p_lead_id::text,
      v_before,
      (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
      p_reason
    );
  else
    perform iwish.audit(
      v_actor,
      'update_lead',
      'lead',
      p_lead_id::text,
      v_before,
      (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
      p_reason
    );
  end if;
end $$;

-- keep public wrapper signature unchanged
create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_update(p_lead_id, patch, p_reason);
$$;

grant execute on function public.rpc_lead_update(uuid, jsonb, text) to authenticated, service_role;


-----------------------------
-- 5) Seed configurable responsibility/source settings
-----------------------------

insert into public.settings(key, value)
values (
  'leads.responsibility_types',
  '{
    "responsibilityTypes": [
      { "key": "company_resource", "label": "公司资源" },
      { "key": "sales_self", "label": "销售自主开发" },
      { "key": "customer_referral", "label": "客户转介绍" }
    ]
  }'::jsonb
)
on conflict (key) do nothing;

insert into public.settings(key, value)
values (
  'leads.dev_methods',
  '{
    "devMethods": [
      { "key": "email_outreach", "label": "邮件开发" },
      { "key": "private_domain", "label": "私域运营/朋友圈" },
      { "key": "old_customer_mining", "label": "老客挖掘" },
      { "key": "short_video", "label": "短视频/内容引流" },
      { "key": "other", "label": "其他" }
    ]
  }'::jsonb
)
on conflict (key) do nothing;

insert into public.settings(key, value)
values (
  'leads.referral_types',
  '{
    "referralTypes": [
      { "key": "existing_customer", "label": "老客户介绍" },
      { "key": "partner", "label": "渠道伙伴介绍" },
      { "key": "friend", "label": "朋友/人脉介绍" }
    ]
  }'::jsonb
)
on conflict (key) do nothing;

insert into public.settings(key, value)
values (
  'leads.source_departments',
  '{
    "departments": [
      { "key": "sz_sales", "label": "深圳销售团队" },
      { "key": "sz_cs", "label": "深圳客服团队" },
      { "key": "hz_sales", "label": "杭州销售团队" }
    ]
  }'::jsonb
)
on conflict (key) do nothing;
