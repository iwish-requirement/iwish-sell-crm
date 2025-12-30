-- 023_leads_structured_fields.sql
-- Add structured fields to leads (customer_grade, source_level1/2, tags)
-- and expose them via leads_secure_view, updating rpc_lead_update accordingly.

-- 1) Schema: extend leads with structured fields
alter table public.leads
  add column if not exists customer_grade text check (customer_grade in ('S','A','B','C') or customer_grade is null),
  add column if not exists source_level1 text,
  add column if not exists source_level2 text,
  add column if not exists tags text[] default '{}';


-- 2) View: expose new fields in leads_secure_view (append columns to avoid breaking existing clients)
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
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone
    else iwish.mask_phone(l.customer_phone)
  end as customer_phone,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email
    else iwish.mask_email(l.customer_email)
  end as customer_email,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address
    else null
  end as address,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget
    else null
  end as budget,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score
    else null
  end as internal_score,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason
    else null
  end as blacklist_reason,
  l.next_contact_at,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.wechat
    else null
  end as wechat,
  l.customer_grade,
  l.source_level1,
  l.source_level2,
  l.tags
from public.leads l;



-- 3) RPC: extend iwish.rpc_lead_update to keep working with new fields
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

  -- detect return-to-pool transition and enforce dedicated permission
  if patch ? 'status' then
    if patch->>'status' = 'pool' and v_lead.status <> 'pool' then
      v_is_return_to_pool := true;

      if not iwish.has_permission(v_actor, 'leads.pool.return') then
        raise exception 'ERR_NO_PERMISSION:leads.pool.return';
      end if;
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
    tags = coalesce((select array_agg(value::text) from jsonb_array_elements_text(patch->'tags')), tags)
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
