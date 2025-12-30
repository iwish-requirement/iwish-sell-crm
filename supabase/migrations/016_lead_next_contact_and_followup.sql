-- 016_lead_next_contact_and_followup.sql
-- Add next_contact_at to leads, expose it via leads_secure_view, and allow rpc_lead_update to patch it

-- 1) Schema: add next_contact_at to leads (if not exists)
alter table public.leads
  add column if not exists next_contact_at timestamptz;


-- 2) View: expose next_contact_at in leads_secure_view (append column to avoid renaming existing ones)
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
  l.next_contact_at
from public.leads l;


-- 3) RPC: extend iwish.rpc_lead_update to support next_contact_at while preserving pool-return behaviour
create or replace function iwish.rpc_lead_update(p_lead_id uuid, patch jsonb)
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
    next_contact_at = coalesce((patch->>'next_contact_at')::timestamptz, next_contact_at)
  where id = p_lead_id;

  if v_is_return_to_pool then
    perform iwish.audit(
      v_actor,
      'return_lead_to_pool',
      'lead',
      p_lead_id::text,
      v_before,
      (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
      null
    );
  else
    perform iwish.audit(
      v_actor,
      'update_lead',
      'lead',
      p_lead_id::text,
      v_before,
      (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
      null
    );
  end if;
end $$;
