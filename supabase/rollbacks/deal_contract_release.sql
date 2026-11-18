-- Run after the Deal Center release is taken out of service. Keep saved drafts,
-- submissions, returned finance values, and the private attachment bucket.
begin;
set local lock_timeout = '3s';

drop trigger if exists enforce_deal_contract_payment_confirmation on public.contract_payments;
revoke execute on function public.rpc_deal_contract_submission_save(uuid, jsonb, jsonb, integer, boolean) from authenticated;
revoke execute on function public.rpc_deal_contract_submission_confirm_finance(uuid, jsonb) from authenticated;

update public.deal_history_batches
set published_at = null
where id = 'legacy-sales-all-2026-11-18';

commit;
