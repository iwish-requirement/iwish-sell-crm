-- SECURITY DEFINER allocation functions must never be callable by anon/public.
-- The public wrappers are the only API surface for signed-in CRM users.

revoke all on function iwish.rpc_project_allocations_list() from public, anon, authenticated;
revoke all on function public.rpc_project_allocations_list() from public, anon;
grant execute on function public.rpc_project_allocations_list() to authenticated;

revoke all on function iwish.rpc_project_allocation_upsert(
  uuid, int, uuid, text[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], text, text
) from public, anon, authenticated;
revoke all on function public.rpc_project_allocation_upsert(
  uuid, int, uuid, text[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], text, text
) from public, anon;
grant execute on function public.rpc_project_allocation_upsert(
  uuid, int, uuid, text[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], text, text
) to authenticated;

-- Keep the legacy compatibility signature available only to authenticated CRM clients.
revoke all on function iwish.rpc_project_allocation_upsert(
  uuid, int, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.rpc_project_allocation_upsert(
  uuid, int, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon;
grant execute on function public.rpc_project_allocation_upsert(
  uuid, int, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) to authenticated;

