-- Make public-pool return metadata part of the lead record and add an atomic
-- batch return operation. Audit logs remain the source of history, while these
-- columns make the current pool row readable without requiring audit.read.

alter table public.leads
  add column if not exists pool_return_reason text,
  add column if not exists pool_returned_at timestamptz,
  add column if not exists pool_returned_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_leads_pool_returned_at
  on public.leads(pool_returned_at desc)
  where status = 'pool';

-- Backfill the latest known return event for existing pool rows.
with latest_return as (
  select distinct on (target_id)
    target_id,
    reason,
    created_at,
    actor_id
  from public.audit_logs
  where target_type = 'lead'
    and action = 'return_lead_to_pool'
  order by target_id, created_at desc
)
update public.leads l
set pool_return_reason = nullif(trim(r.reason), ''),
    pool_returned_at = r.created_at,
    pool_returned_by = r.actor_id
from latest_return r
where l.status = 'pool'
  and l.id::text = r.target_id
  and l.pool_returned_at is null;

-- Keep the existing update contract, but persist the return metadata in the
-- same transaction as the status change and audit entry.
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
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    if v_lead.owner_id <> v_actor and v_lead.created_by <> v_actor then
      raise exception 'ERR_OUT_OF_SCOPE:leads.update';
    end if;
  end if;

  if patch ? 'status' and patch->>'status' = 'pool' and v_lead.status <> 'pool' then
    v_is_return_to_pool := true;
    if not iwish.has_permission(v_actor, 'leads.pool.return') then
      raise exception 'ERR_NO_PERMISSION:leads.pool.return';
    end if;
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'ERR_VALIDATION:pool_return_reason_required';
    end if;
  end if;

  if patch ? 'stage' then
    v_old_stage := v_lead.stage;
    v_new_stage := patch->>'stage';
    if v_new_stage is not null and v_new_stage <> v_old_stage then
      if v_lead.status = 'closed' then raise exception 'ERR_INVALID_STATUS:cannot_change_stage_when_closed'; end if;
      if v_new_stage not in ('L1','L2','L3','L4','Won') then raise exception 'ERR_VALIDATION:invalid_stage'; end if;
      v_old_rank := case v_old_stage when 'L1' then 1 when 'L2' then 2 when 'L3' then 3 when 'L4' then 4 when 'Won' then 5 else 0 end;
      v_new_rank := case v_new_stage when 'L1' then 1 when 'L2' then 2 when 'L3' then 3 when 'L4' then 4 when 'Won' then 5 else 0 end;
      if v_new_rank < v_old_rank then raise exception 'ERR_INVALID_STAGE_TRANSITION:cannot_downgrade'; end if;
      if v_new_rank > v_old_rank and (p_reason is null or length(trim(p_reason)) = 0) then
        raise exception 'ERR_VALIDATION:stage_reason_required';
      end if;
    end if;
  end if;

  if v_lead.status = 'closed' and (patch ? 'responsibility_type' or patch ? 'source_level1' or patch ? 'source_level2' or patch ? 'dev_method_key' or patch ? 'referral_customer_name' or patch ? 'referral_type_key' or patch ? 'activity_name' or patch ? 'source_department_key') then
    raise exception 'ERR_INVALID_STATUS:cannot_change_source_when_closed';
  end if;

  v_before := to_jsonb(v_lead.*);
  for k in select jsonb_object_keys(patch) loop
    if k in ('owner_id','team_id','created_by') then raise exception 'ERR_FIELD_FORBIDDEN:use_assign_or_transfer'; end if;
    if k in ('customer_phone','customer_email','address','budget') and not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_sensitive'; end if;
    if k in ('internal_score','blacklist_reason') and not iwish.has_permission(v_actor, 'leads.fields.write_internal') then raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_internal'; end if;
  end loop;

  v_new_resp := coalesce(v_patch_resp, case when v_patch_source_level1 in ('sales_self','company_resource','customer_referral') then v_patch_source_level1 else v_lead.responsibility_type end);
  v_new_source_level1 := coalesce(v_patch_source_level1, v_lead.source_level1);
  v_new_source_level2 := case when patch ? 'source_level2' then nullif(patch->>'source_level2','') else v_lead.source_level2 end;
  v_new_dev_method := case when patch ? 'dev_method_key' then nullif(patch->>'dev_method_key','') else v_lead.dev_method_key end;
  v_new_referral_name := case when patch ? 'referral_customer_name' then nullif(patch->>'referral_customer_name','') else v_lead.referral_customer_name end;
  v_new_referral_type := case when patch ? 'referral_type_key' then nullif(patch->>'referral_type_key','') else v_lead.referral_type_key end;
  v_new_activity_name := case when patch ? 'activity_name' then nullif(patch->>'activity_name','') else v_lead.activity_name end;

  if (v_lead.responsibility_type is not null or patch ? 'responsibility_type' or v_patch_source_level1 in ('sales_self','company_resource','customer_referral')) then
    if v_new_resp is null or length(trim(v_new_resp)) = 0 then raise exception 'ERR_VALIDATION:responsibility_type_required'; end if;
    v_new_source_level1 := v_new_resp;
    if v_new_resp = 'company_resource' and (v_new_source_level2 is null or length(trim(v_new_source_level2)) = 0) then raise exception 'ERR_VALIDATION:secondary_source_required_for_company_resource'; end if;
    if v_new_resp <> 'company_resource' then v_new_source_level2 := null; end if;
    if v_new_resp = 'sales_self' and (v_new_dev_method is null or length(trim(v_new_dev_method)) = 0) then raise exception 'ERR_VALIDATION:dev_method_required_for_sales_self'; end if;
    if v_new_resp = 'customer_referral' and (v_new_referral_name is null or length(trim(v_new_referral_name)) = 0 or v_new_referral_type is null or length(trim(v_new_referral_type)) = 0) then raise exception 'ERR_VALIDATION:referral_info_required_for_customer_referral'; end if;
    if v_new_resp <> 'sales_self' then v_new_dev_method := null; end if;
    if v_new_resp <> 'customer_referral' then v_new_referral_name := null; v_new_referral_type := null; end if;
    if v_new_resp <> 'sales_self' and v_new_resp <> 'customer_referral' then v_new_activity_name := null; end if;
  end if;

  update public.leads
  set name = coalesce(patch->>'name', name), source = coalesce(patch->>'source', source), stage = coalesce(patch->>'stage', stage),
      status = coalesce(patch->>'status', status), customer_name = coalesce(patch->>'customer_name', customer_name),
      customer_phone = coalesce(patch->>'customer_phone', customer_phone), customer_email = coalesce(patch->>'customer_email', customer_email),
      address = coalesce(patch->>'address', address), website = coalesce(patch->>'website', website), budget = coalesce((patch->>'budget')::numeric, budget),
      internal_score = coalesce((patch->>'internal_score')::int, internal_score), blacklist_reason = coalesce(patch->>'blacklist_reason', blacklist_reason),
      last_contact_at = coalesce((patch->>'last_contact_at')::timestamptz, last_contact_at), next_contact_at = coalesce((patch->>'next_contact_at')::timestamptz, next_contact_at),
      customer_grade = coalesce(patch->>'customer_grade', customer_grade), tags = coalesce((select array_agg(value::text) from jsonb_array_elements_text(patch->'tags')), tags),
      source_level1 = case when patch ? 'source_level1' then v_new_source_level1 when patch ? 'responsibility_type' then v_new_resp else source_level1 end,
      source_level2 = case when patch ? 'source_level2' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_source_level2 else source_level2 end,
      responsibility_type = case when patch ? 'responsibility_type' or patch ? 'source_level1' then v_new_resp else responsibility_type end,
      dev_method_key = case when patch ? 'dev_method_key' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_dev_method else dev_method_key end,
      referral_customer_name = case when patch ? 'referral_customer_name' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_referral_name else referral_customer_name end,
      referral_type_key = case when patch ? 'referral_type_key' or patch ? 'source_level1' or patch ? 'responsibility_type' then v_new_referral_type else referral_type_key end,
      activity_name = case when patch ? 'activity_name' or patch ? 'source_level1' or patch ? 'source_level2' or patch ? 'responsibility_type' then v_new_activity_name else activity_name end,
      source_department_key = case when patch ? 'source_department_key' then nullif(patch->>'source_department_key','') else source_department_key end,
      source_locked_at = case when source_locked_at is null and ((patch ? 'responsibility_type' and nullif(patch->>'responsibility_type','') is not null) or (patch ? 'source_level1' and nullif(patch->>'source_level1','') is not null)) then now() else source_locked_at end,
      pool_return_reason = case when v_is_return_to_pool then nullif(trim(p_reason), '') else pool_return_reason end,
      pool_returned_at = case when v_is_return_to_pool then now() when patch ? 'status' and patch->>'status' <> 'pool' then null else pool_returned_at end,
      pool_returned_by = case when v_is_return_to_pool then v_actor when patch ? 'status' and patch->>'status' <> 'pool' then null else pool_returned_by end
  where id = p_lead_id;

  perform iwish.audit(v_actor, case when v_is_return_to_pool then 'return_lead_to_pool' else 'update_lead' end, 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason);
end $$;

create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void language sql security definer set search_path = public, iwish as $$
  select iwish.rpc_lead_update($1, $2, $3);
$$;

-- Return all selected non-pool leads with one reason. Per-row errors are
-- reported to the caller so protected/out-of-scope rows do not disappear.
create or replace function iwish.rpc_leads_return_to_pool_batch(p_lead_ids uuid[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_success uuid[] := '{}'::uuid[];
  v_failed jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception 'ERR_UNAUTHENTICATED'; end if;
  if not iwish.has_permission(v_actor, 'leads.pool.return') then raise exception 'ERR_NO_PERMISSION:leads.pool.return'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'ERR_VALIDATION:pool_return_reason_required'; end if;
  if coalesce(array_length(p_lead_ids, 1), 0) = 0 then raise exception 'ERR_VALIDATION:lead_ids_required'; end if;

  foreach v_id in array p_lead_ids loop
    begin
      perform iwish.rpc_lead_update(v_id, jsonb_build_object('status', 'pool'), p_reason);
      v_success := array_append(v_success, v_id);
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'error', SQLERRM);
    end;
  end loop;

  return jsonb_build_object('success_ids', v_success, 'failed', v_failed, 'success_count', coalesce(array_length(v_success, 1), 0), 'failed_count', jsonb_array_length(v_failed));
end $$;

create or replace function public.rpc_leads_return_to_pool_batch(p_lead_ids uuid[], p_reason text)
returns jsonb language sql security definer set search_path = public, iwish as $$
  select iwish.rpc_leads_return_to_pool_batch($1, $2);
$$;

grant execute on function public.rpc_leads_return_to_pool_batch(uuid[], text) to authenticated, service_role;

-- Automatic returns use the same visible metadata fields as manual returns.
create or replace function iwish.rpc_auto_return_leads_to_pool()
returns jsonb language plpgsql security definer set search_path = public, iwish as $$
declare
  v_settings jsonb; v_protection_days integer := 120; v_cutoff timestamptz; v_now timestamptz := now(); v_dropped_count integer := 0; rec public.leads; v_reason text;
begin
  select value into v_settings from public.settings where key = 'pipeline.business_rules';
  v_protection_days := coalesce((v_settings->>'lead_protection_days')::integer, (v_settings->>'public_pool_days')::integer, 120);
  if v_protection_days <= 0 then return jsonb_build_object('dropped_count', 0, 'lead_protection_days', v_protection_days, 'skipped', true); end if;
  v_cutoff := v_now - make_interval(days => v_protection_days);
  for rec in select l.* from public.leads l where l.status = 'open' and l.owner_id is not null and coalesce(l.ownership_started_at, l.created_at) <= v_cutoff and not exists (select 1 from public.lead_notes n where n.lead_id = l.id and n.is_deleted = false and length(trim(n.content)) > 0) loop
    v_reason := format('首次归属超过 %s 天且没有任何跟进记录', v_protection_days);
    update public.leads set status = 'pool', pool_return_reason = v_reason, pool_returned_at = v_now, pool_returned_by = coalesce(rec.owner_id, rec.created_by) where id = rec.id and status = 'open';
    if found then
      perform iwish.audit(coalesce(rec.owner_id, rec.created_by), 'return_lead_to_pool', 'lead', rec.id::text, to_jsonb(rec.*), (select to_jsonb(l.*) from public.leads l where l.id = rec.id), v_reason);
      v_dropped_count := v_dropped_count + 1;
    end if;
  end loop;
  return jsonb_build_object('dropped_count', v_dropped_count, 'lead_protection_days', v_protection_days, 'cutoff_at', v_cutoff);
end $$;

create or replace function public.rpc_auto_return_leads_to_pool()
returns jsonb language sql security definer set search_path = public, iwish as $$ select iwish.rpc_auto_return_leads_to_pool(); $$;

-- Append the current return metadata to the existing secure view contract.
create or replace view public.leads_secure_view as
select
  l.id, l.team_id, l.owner_id, l.created_by, l.name, l.source, l.stage, l.status,
  l.close_result, l.close_reason, l.last_contact_at, l.created_at, l.updated_at,
  l.customer_name,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone else iwish.mask_phone(l.customer_phone) end as customer_phone,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email else iwish.mask_email(l.customer_email) end as customer_email,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address else null end as address,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget else null end as budget,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score else null end as internal_score,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason else null end as blacklist_reason,
  l.next_contact_at,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.wechat else null end as wechat,
  l.customer_grade, l.source_level1, l.source_level2, l.tags, l.first_contact_at, l.locked_by, l.locked_until, l.protected_until,
  coalesce((select json_agg(json_build_object('id',bc.id,'name',bc.name) order by bc.sort_order) from public.leads_business_categories lbc join public.business_categories bc on bc.id=lbc.category_id and bc.is_active where lbc.lead_id=l.id),'[]'::json) as business_categories,
  coalesce((select json_agg(json_build_object('id',bt.id,'name',bt.name,'category_id',bt.category_id) order by bt.sort_order) from public.leads_business_types lbt join public.business_types bt on bt.id=lbt.type_id and bt.is_active where lbt.lead_id=l.id),'[]'::json) as business_types,
  l.responsibility_type, l.dev_method_key, l.referral_customer_name, l.referral_type_key, l.activity_name, l.source_department_key, l.source_locked_at, l.website,
  l.allocation_status, l.product_category, l.customer_attribute, l.follow_up_stage, l.ownership_started_at,
  l.pool_return_reason, l.pool_returned_at, l.pool_returned_by
from public.leads l
where coalesce(l.is_deleted,false)=false and iwish.is_active_user(auth.uid()) and iwish.has_permission(auth.uid(), 'leads.read') and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read');
