-- 042_lead_source_model_alignment.sql
-- Align lead source semantics to:
-- source_level1 = 一级来源（责任归因）
-- source_level2 = 二级来源（渠道归因，仅 company_resource 场景使用）
-- keep legacy columns/data for historical compatibility, but stop requiring source_department_key.

insert into public.settings(key, value)
values (
  'leads.company_resource_source_groups',
  '{
    "groups": [
      {
        "key": "social_media",
        "label": "社媒渠道",
        "children": [
          { "key": "wechat_company", "label": "视频号（公司号）" },
          { "key": "wechat_ip_1", "label": "视频号（IP号）" },
          { "key": "wechat_ip_2", "label": "视频号（IP号2）" },
          { "key": "xiaohongshu", "label": "小红书" },
          { "key": "douyin", "label": "抖音" },
          { "key": "official_account", "label": "公众号" },
          { "key": "community", "label": "社群" }
        ]
      },
      {
        "key": "website",
        "label": "官网来源",
        "children": [
          { "key": "website_form", "label": "官网表单" },
          { "key": "website_wechat", "label": "官网加微信" }
        ]
      },
      {
        "key": "offline_events",
        "label": "线下活动",
        "children": [
          { "key": "strategy_course", "label": "一号位战略课" },
          { "key": "traffic_course", "label": "流量系列课" },
          { "key": "brand_course", "label": "品牌系列课" },
          { "key": "seo_course", "label": "SEO系列课" },
          { "key": "expo", "label": "展会" },
          { "key": "public_workshop", "label": "公开课分享会" },
          { "key": "other_event", "label": "其他活动" }
        ]
      },
      {
        "key": "livestream",
        "label": "直播类",
        "children": [
          { "key": "livestream_lead", "label": "直播间线索" }
        ]
      }
    ]
  }'::jsonb
)
on conflict (key) do nothing;

insert into public.settings(key, value)
values (
  'leads.responsibility_types',
  '{
    "responsibilityTypes": [
      { "key": "sales_self", "label": "销售自主开发" },
      { "key": "company_resource", "label": "公司分配资源" },
      { "key": "customer_referral", "label": "客户转介绍" }
    ]
  }'::jsonb
)
on conflict (key) do update
set value = excluded.value
where exists (
  select 1
  from jsonb_array_elements(coalesce(settings.value->'responsibilityTypes', '[]'::jsonb)) as item
  where item->>'key' = 'company_resource' and item->>'label' = '公司资源'
);


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
  v_resp text := nullif(payload->>'responsibility_type','');
  v_dev_method text := nullif(payload->>'dev_method_key','');
  v_referral_name text := nullif(payload->>'referral_customer_name','');
  v_referral_type text := nullif(payload->>'referral_type_key','');
  v_activity_name text := nullif(payload->>'activity_name','');
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

  if (iwish.get_effective_scope(v_actor, 'leads.create')->>'scope_type') in ('self','team') then
    if v_team_id <> (select team_id from public.profiles where id = v_actor) then
      raise exception 'ERR_VALIDATION:team_mismatch_on_create';
    end if;
  end if;

  if (payload ? 'customer_phone' or payload ? 'customer_email' or payload ? 'address' or payload ? 'budget') then
    if not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then
      raise exception 'ERR_FIELD_FORBIDDEN:write_sensitive_required';
    end if;
  end if;

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

  if v_resp is null then
    raise exception 'ERR_VALIDATION:responsibility_type_required';
  end if;

  v_source_level1 := v_resp;

  if v_resp = 'company_resource' then
    if v_source_level2 is null then
      raise exception 'ERR_VALIDATION:secondary_source_required_for_company_resource';
    end if;
  else
    v_source_level2 := null;
  end if;

  if v_resp = 'sales_self' then
    if v_dev_method is null then
      raise exception 'ERR_VALIDATION:dev_method_required_for_sales_self';
    end if;
    v_referral_name := null;
    v_referral_type := null;
    v_activity_name := null;
  elsif v_resp = 'customer_referral' then
    if v_referral_name is null or v_referral_type is null then
      raise exception 'ERR_VALIDATION:referral_info_required_for_customer_referral';
    end if;
    v_dev_method := null;
    v_activity_name := null;
  else
    v_dev_method := null;
    v_referral_name := null;
    v_referral_type := null;
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
    nullif(payload->>'source_department_key',''),
    case when v_resp is not null then now() else null end
  )
  returning id into v_id;

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

create or replace function public.rpc_lead_create(payload jsonb)
returns uuid
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_create(payload);
$$;

grant execute on function public.rpc_lead_create(jsonb) to authenticated, service_role;

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
  v_patch_source_level1 text := nullif(patch->>'source_level1','');
  v_patch_resp text := nullif(patch->>'responsibility_type','');
  v_new_resp text;
  v_new_source_level1 text;
  v_new_source_level2 text;
  v_new_dev_method text;
  v_new_referral_name text;
  v_new_referral_type text;
  v_new_activity_name text;
begin
  if not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:leads.update';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    if v_lead.owner_id <> v_actor and v_lead.created_by <> v_actor then
      raise exception 'ERR_OUT_OF_SCOPE:leads.update';
    end if;
  end if;

  if patch ? 'status' then
    if patch->>'status' = 'pool' and v_lead.status <> 'pool' then
      v_is_return_to_pool := true;

      if not iwish.has_permission(v_actor, 'leads.pool.return') then
        raise exception 'ERR_NO_PERMISSION:leads.pool.return';
      end if;
    end if;
  end if;

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

  if v_lead.status = 'closed' then
    if patch ? 'responsibility_type' or patch ? 'source_level1' or patch ? 'source_level2' or
       patch ? 'dev_method_key' or patch ? 'referral_customer_name' or patch ? 'referral_type_key' or
       patch ? 'activity_name' or patch ? 'source_department_key' then
      raise exception 'ERR_INVALID_STATUS:cannot_change_source_when_closed';
    end if;
  end if;

  v_before := to_jsonb(v_lead.*);

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

  v_new_resp := coalesce(v_patch_resp, case when v_patch_source_level1 in ('sales_self','company_resource','customer_referral') then v_patch_source_level1 else v_lead.responsibility_type end);
  v_new_source_level1 := coalesce(v_patch_source_level1, v_lead.source_level1);
  v_new_source_level2 := case when patch ? 'source_level2' then nullif(patch->>'source_level2','') else v_lead.source_level2 end;
  v_new_dev_method := case when patch ? 'dev_method_key' then nullif(patch->>'dev_method_key','') else v_lead.dev_method_key end;
  v_new_referral_name := case when patch ? 'referral_customer_name' then nullif(patch->>'referral_customer_name','') else v_lead.referral_customer_name end;
  v_new_referral_type := case when patch ? 'referral_type_key' then nullif(patch->>'referral_type_key','') else v_lead.referral_type_key end;
  v_new_activity_name := case when patch ? 'activity_name' then nullif(patch->>'activity_name','') else v_lead.activity_name end;

  if (v_lead.responsibility_type is not null or patch ? 'responsibility_type' or v_patch_source_level1 in ('sales_self','company_resource','customer_referral')) then
    if v_new_resp is null or length(trim(v_new_resp)) = 0 then
      raise exception 'ERR_VALIDATION:responsibility_type_required';
    end if;

    v_new_source_level1 := v_new_resp;

    if v_new_resp = 'company_resource' then
      if v_new_source_level2 is null or length(trim(v_new_source_level2)) = 0 then
        raise exception 'ERR_VALIDATION:secondary_source_required_for_company_resource';
      end if;
    else
      v_new_source_level2 := null;
    end if;

    if v_new_resp = 'sales_self' then
      if v_new_dev_method is null or length(trim(v_new_dev_method)) = 0 then
        raise exception 'ERR_VALIDATION:dev_method_required_for_sales_self';
      end if;
      v_new_referral_name := null;
      v_new_referral_type := null;
      v_new_activity_name := null;
    elsif v_new_resp = 'customer_referral' then
      if v_new_referral_name is null or length(trim(v_new_referral_name)) = 0 or v_new_referral_type is null or length(trim(v_new_referral_type)) = 0 then
        raise exception 'ERR_VALIDATION:referral_info_required_for_customer_referral';
      end if;
      v_new_dev_method := null;
      v_new_activity_name := null;
    else
      v_new_dev_method := null;
      v_new_referral_name := null;
      v_new_referral_type := null;
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
    source_level1 = case
      when patch ? 'source_level1' then v_new_source_level1
      when patch ? 'responsibility_type' then v_new_resp
      else source_level1
    end,
    source_level2 = case
      when patch ? 'source_level2' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_source_level2
      else source_level2
    end,
    tags = coalesce((select array_agg(value::text) from jsonb_array_elements_text(patch->'tags')), tags),
    responsibility_type = case
      when patch ? 'responsibility_type' or patch ? 'source_level1' then v_new_resp
      else responsibility_type
    end,
    dev_method_key = case
      when patch ? 'dev_method_key' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_dev_method
      else dev_method_key
    end,
    referral_customer_name = case
      when patch ? 'referral_customer_name' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_referral_name
      else referral_customer_name
    end,
    referral_type_key = case
      when patch ? 'referral_type_key' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_referral_type
      else referral_type_key
    end,
    activity_name = case
      when patch ? 'activity_name' or patch ? 'source_level1' or patch ? 'source_level2' or patch ? 'responsibility_type' then v_new_activity_name
      else activity_name
    end,
    source_department_key = case
      when patch ? 'source_department_key' then nullif(patch->>'source_department_key','')
      else source_department_key
    end,
    source_locked_at = case
      when source_locked_at is null and (
        (patch ? 'responsibility_type' and nullif(patch->>'responsibility_type','') is not null) or
        (patch ? 'source_level1' and nullif(patch->>'source_level1','') is not null)
      ) then now()
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

create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_update(p_lead_id, patch, p_reason);
$$;

grant execute on function public.rpc_lead_update(uuid, jsonb, text) to authenticated, service_role;
