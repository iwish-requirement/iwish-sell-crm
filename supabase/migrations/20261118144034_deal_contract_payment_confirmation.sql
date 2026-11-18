-- Activate when the Deal Center release removes its legacy payment entry point.
create function iwish.enforce_deal_contract_payment_confirmation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_previous_contract_id uuid;
  v_next_contract_id uuid;
begin
  if tg_op <> 'INSERT' and old.status = 'confirmed' then v_previous_contract_id := old.contract_id; end if;
  if tg_op <> 'DELETE' and new.status = 'confirmed' then v_next_contract_id := new.contract_id; end if;

  if auth.uid() is not null and exists (
    select 1 from public.contracts c join public.leads l on l.id = c.lead_id
    where c.id in (v_previous_contract_id, v_next_contract_id)
      and l.status = 'closed' and l.close_result in ('won', '成交')
      and not iwish.can_confirm_deal_contract_finance(l.id)
  ) then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:contracts.finance.confirm';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function iwish.enforce_deal_contract_payment_confirmation() from public, anon, authenticated;

create trigger enforce_deal_contract_payment_confirmation
  before insert or update or delete on public.contract_payments
  for each row execute function iwish.enforce_deal_contract_payment_confirmation();
