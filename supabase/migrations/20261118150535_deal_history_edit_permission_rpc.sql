-- Keep iwish private while checking edit permission through one scoped public RPC.
create or replace function public.rpc_deal_history_can_edit(p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.deal_history_records r
    where r.id = p_id and iwish.can_access_deal_history(r.batch_id, r.owner_id, true)
  );
$$;
revoke all on function public.rpc_deal_history_can_edit(uuid) from public, anon;
grant execute on function public.rpc_deal_history_can_edit(uuid) to authenticated;
