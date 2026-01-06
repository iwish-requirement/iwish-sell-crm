-- 035_contract_payments_view_and_rpc.sql
-- Secure view and RPC helper for contract_payments

-- 1) secure view for frontend consumption
create or replace view public.contract_payments_secure_view as
select
  p.id,
  p.contract_id,
  p.amount,
  p.currency,
  p.paid_at,
  p.method,
  p.note,
  p.status,
  p.created_by,
  p.created_at,
  p.updated_at
from public.contract_payments p;

-- 2) RPC: add a new payment for a contract, enforcing contracts.manage + leads.update scope
create schema if not exists iwish;

create or replace function iwish.rpc_contract_payment_add(p_contract_id uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_contract public.contracts;
  v_lead public.leads;
  v_payment_id uuid;
  v_amount numeric;
  v_currency text;
  v_paid_at timestamptz;
  v_method text;
  v_note text;
  v_status text;
begin
  if v_actor is null then
    raise exception 'ERR_NOT_AUTHENTICATED';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id;
  if v_contract.id is null then
    raise exception 'ERR_NOT_FOUND:contract';
  end if;

  select * into v_lead from public.leads where id = v_contract.lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;

  if not iwish.has_permission(v_actor, 'contracts.manage') then
    raise exception 'ERR_NO_PERMISSION:contracts.manage';
  end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    raise exception 'ERR_OUT_OF_SCOPE:contracts.manage';
  end if;

  v_amount := coalesce((payload->>'amount')::numeric, 0);
  if v_amount <= 0 then
    raise exception 'ERR_INVALID_AMOUNT';
  end if;

  v_currency := coalesce(payload->>'currency', 'CNY');
  v_paid_at := coalesce((payload->>'paid_at')::timestamptz, now());
  v_method := payload->>'method';
  v_note := payload->>'note';
  v_status := coalesce(payload->>'status', 'confirmed');

  insert into public.contract_payments (
    contract_id,
    amount,
    currency,
    paid_at,
    method,
    note,
    status,
    created_by
  ) values (
    p_contract_id,
    v_amount,
    v_currency,
    v_paid_at,
    v_method,
    v_note,
    v_status,
    v_actor
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function iwish.rpc_contract_payment_add(uuid, jsonb) from public;

grant execute on function iwish.rpc_contract_payment_add(uuid, jsonb) to authenticated;

-- public wrapper
create or replace function public.rpc_contract_payment_add(p_contract_id uuid, payload jsonb)
returns uuid
language sql
security definer
as $$
  select iwish.rpc_contract_payment_add(p_contract_id, payload);
$$;

grant execute on function public.rpc_contract_payment_add(uuid, jsonb) to authenticated;
