-- 调整跟进阶段流程为:
--   未建联 → 已建联 → 线上沟通 → 线下拜访 → 方案及报价 → 合作意向已确认 → 审合同 → 成交 → 到款
-- 变更点:
--   1) 移除"方案谈判"(proposal_negotiation), 存量数据回退到"方案及报价";
--   2) 新增"到款"(payment_received) 作为成交后的终态, 与 won 一样不计入销售配额;
--   3) 同步各 RPC 的阶段校验与旧 stage(L1-L4) 映射。

-- 以 postgres 身份执行迁移时（db push / SQL 编辑器）没有 JWT，trg_lead_pipeline_defaults
-- 中的配额校验会拒绝这类批量更新，因此迁移窗口内临时禁用，结束后立即恢复。
alter table public.leads
  disable trigger trg_lead_pipeline_defaults;

update public.leads
set follow_up_stage = 'proposal_quotation'
where follow_up_stage = 'proposal_negotiation';

alter table public.leads
  enable trigger trg_lead_pipeline_defaults;

alter table public.leads
  drop constraint if exists leads_follow_up_stage_valid;

alter table public.leads
  add constraint leads_follow_up_stage_valid
    check (follow_up_stage in (
      'uncontacted',
      'connected',
      'online_communication',
      'offline_visit',
      'proposal_quotation',
      'intent_confirmed',
      'contract_review',
      'won',
      'payment_received'
    ));

create or replace function iwish.rpc_lead_pipeline_update(
  p_lead_id uuid,
  p_customer_attribute text default null,
  p_follow_up_stage text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_before jsonb;
  v_next_attribute text;
  v_next_stage text;
begin
  if not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:leads.update';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.update';
  end if;
  if v_lead.status = 'closed' and p_follow_up_stage is not null then
    raise exception 'ERR_INVALID_STATUS:cannot_change_stage_when_closed';
  end if;

  v_next_attribute := coalesce(nullif(trim(p_customer_attribute), ''), v_lead.customer_attribute);
  v_next_stage := coalesce(nullif(trim(p_follow_up_stage), ''), v_lead.follow_up_stage);

  if v_next_attribute not in ('followable', 'potential_intent', 'invalid') then
    raise exception 'ERR_VALIDATION:invalid_customer_attribute';
  end if;
  if v_next_stage not in (
    'uncontacted', 'connected', 'online_communication', 'offline_visit',
    'proposal_quotation', 'intent_confirmed', 'contract_review',
    'won', 'payment_received'
  ) then
    raise exception 'ERR_VALIDATION:invalid_follow_up_stage';
  end if;

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set customer_attribute = v_next_attribute,
      follow_up_stage = v_next_stage,
      stage = case
        when v_next_stage in ('won', 'payment_received') then 'Won'
        when v_next_stage in ('contract_review') then 'L4'
        when v_next_stage in ('proposal_quotation', 'intent_confirmed') then 'L3'
        when v_next_stage in ('connected', 'online_communication', 'offline_visit') then 'L2'
        else 'L1'
      end
  where id = p_lead_id;

  perform iwish.audit(
    v_actor,
    'update_lead_pipeline',
    'lead',
    p_lead_id::text,
    v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
    p_reason
  );
end;
$$;

create or replace function public.rpc_lead_pipeline_update(
  p_lead_id uuid,
  p_customer_attribute text default null,
  p_follow_up_stage text default null,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_pipeline_update($1, $2, $3, $4);
$$;

revoke all on function public.rpc_lead_pipeline_update(uuid, text, text, text) from public;
grant execute on function public.rpc_lead_pipeline_update(uuid, text, text, text)
to authenticated, service_role;

-- 到款与成交同样不计入销售配额。
create or replace function iwish.enforce_lead_quota(p_owner_id uuid, p_lead_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := iwish.lead_quota_limit();
  v_count integer;
begin
  if p_owner_id is null or v_limit <= 0 then
    return;
  end if;

  -- A missing JWT is never an implicit quota override.  Service-role jobs are
  -- the only intentional non-user caller.
  if v_actor is null and current_user <> 'service_role' then
    raise exception 'ERR_NOT_AUTHENTICATED';
  end if;
  if v_actor is not null and iwish.has_permission(v_actor, 'leads.quota.override') then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  select count(*)
    into v_count
  from public.leads l
  where l.owner_id = p_owner_id
    and l.id is distinct from p_lead_id
    and l.status = 'open'
    and l.customer_attribute <> 'invalid'
    and l.follow_up_stage not in ('won', 'payment_received')
    and not (l.status = 'closed' or l.close_result in ('won', '成交'));

  if v_count >= v_limit then
    raise exception 'ERR_QUOTA_EXCEEDED:lead_quota_limit:%', v_limit;
  end if;
end;
$$;

create or replace function iwish.trg_lead_pipeline_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, iwish
as $$
begin
  if new.owner_id is not null and new.ownership_started_at is null then
    new.ownership_started_at := now();
  end if;

  if tg_op = 'UPDATE' and (
    new.owner_id is distinct from old.owner_id
    or (old.status = 'pool' and new.status = 'open')
  ) then
    new.ownership_started_at := now();
  end if;

  if new.status = 'open'
    and new.owner_id is not null
    and new.customer_attribute <> 'invalid'
    and new.follow_up_stage not in ('won', 'payment_received')
  then
    perform iwish.enforce_lead_quota(new.owner_id, case when tg_op = 'UPDATE' then new.id else null end);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lead_pipeline_defaults on public.leads;
create trigger trg_lead_pipeline_defaults
before insert or update of owner_id, status, customer_attribute, follow_up_stage
on public.leads
for each row execute function iwish.trg_lead_pipeline_defaults();

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

  if v_follow_up_stage not in ('uncontacted','connected','online_communication','offline_visit','proposal_quotation','intent_confirmed','contract_review','won','payment_received') then
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

-- Persist pipeline fields at insertion time so quota enforcement sees the intended values.
create or replace function public.rpc_lead_create(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_id uuid;
  v_attribute text := nullif(payload->>'customer_attribute', '');
  v_follow_stage text := nullif(payload->>'follow_up_stage', '');
begin
  if v_attribute is not null and v_attribute not in ('followable', 'potential_intent', 'invalid') then
    raise exception 'ERR_VALIDATION:invalid_customer_attribute';
  end if;
  if v_follow_stage is not null and v_follow_stage not in (
    'uncontacted','connected','online_communication','offline_visit',
    'proposal_quotation','intent_confirmed',
    'contract_review','won','payment_received'
  ) then
    raise exception 'ERR_VALIDATION:invalid_follow_up_stage';
  end if;

  v_id := iwish.rpc_lead_create(payload);

  update public.leads
  set customer_attribute = coalesce(v_attribute, customer_attribute),
      follow_up_stage = coalesce(v_follow_stage, follow_up_stage)
  where id = v_id;

  if payload ? 'product_category' then
    perform iwish.rpc_lead_set_product_category(v_id, payload->>'product_category');
  end if;
  return v_id;
end;
$$;
grant execute on function public.rpc_lead_create(jsonb) to authenticated, service_role;

-- 已到款的线索标记成交关闭时, 不把阶段从 payment_received 降回 won。
create or replace function iwish.rpc_lead_close_with_action(
  p_lead_id uuid,
  p_result text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'ERR_UNAUTHENTICATED';
  end if;
  if not iwish.has_permission(v_actor, 'lead_notes.create') then
    raise exception 'ERR_NO_PERMISSION:lead_notes.create';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'ERR_VALIDATION:close_reason_required';
  end if;
  if p_result not in ('won', 'lost') then
    raise exception 'ERR_VALIDATION:close_result_must_be_won_or_lost';
  end if;

  if p_result = 'won'
    and coalesce((select follow_up_stage from public.leads where id = p_lead_id), '') <> 'payment_received'
  then
    perform iwish.rpc_lead_pipeline_update(p_lead_id, null, 'won', p_reason);
  end if;

  perform iwish.rpc_lead_close(p_lead_id, p_result, trim(p_reason));

  insert into public.lead_notes(lead_id, author_id, content, note_type)
  values (p_lead_id, v_actor, trim(p_reason), p_result);
end;
$$;

revoke all on function iwish.rpc_lead_close_with_action(uuid, text, text) from public;
grant execute on function iwish.rpc_lead_close_with_action(uuid, text, text) to authenticated, service_role;

create or replace function public.rpc_lead_close_with_action(
  p_lead_id uuid,
  p_result text,
  p_reason text
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_close_with_action($1, $2, $3);
$$;

revoke all on function public.rpc_lead_close_with_action(uuid, text, text) from public;
grant execute on function public.rpc_lead_close_with_action(uuid, text, text) to authenticated, service_role;
