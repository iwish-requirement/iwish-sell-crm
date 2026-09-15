-- Persist pipeline fields at insertion time so quota enforcement sees the intended values.
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
  v_customer_attribute text := coalesce(nullif(payload->>'customer_attribute',''), 'followable');
  v_follow_up_stage text := coalesce(nullif(payload->>'follow_up_stage',''), 'uncontacted');
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

  if v_customer_attribute not in ('followable', 'potential_intent', 'invalid') then
    raise exception 'ERR_VALIDATION:invalid_customer_attribute';
  end if;

  if v_follow_up_stage not in ('uncontacted','connected','online_communication','offline_visit','proposal_quotation','proposal_negotiation','intent_confirmed','contract_review','won') then
    raise exception 'ERR_VALIDATION:invalid_follow_up_stage';
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

  -- Align semantics: source_level1 mirrors responsibility_type; source_level2 only for company_resource
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
    name, source, stage, status, customer_attribute, follow_up_stage,
    customer_name, customer_phone, customer_email, address, budget,
    internal_score, blacklist_reason, last_contact_at,
    next_contact_at, customer_grade, source_level1, source_level2, tags, website,
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
    v_customer_attribute,
    v_follow_up_stage,
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
    nullif(payload->>'website',''),
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


