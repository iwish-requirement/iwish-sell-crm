create or replace function iwish.rpc_auth_reject(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
begin
  if not iwish.has_permission(v_actor, 'auth.reject') then
    raise exception 'ERR_NO_PERMISSION:auth.reject';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'ERR_VALIDATION:rejection_reason_required';
  end if;

  select to_jsonb(p.*) into v_before from public.profiles p where p.id = p_user_id;

  update public.profiles
  set status = 'rejected',
      rejected_at = now(),
      rejected_by = v_actor,
      rejection_reason = p_reason
  where id = p_user_id and status = 'pending';

  if not found then
    raise exception 'ERR_INVALID_STATUS:only_pending_can_reject';
  end if;

  select to_jsonb(p.*) into v_after from public.profiles p where p.id = p_user_id;

  perform iwish.audit(v_actor, 'reject_user', 'profile', p_user_id::text, v_before, v_after, p_reason);

  delete from auth.users
  where id = p_user_id;
end $$;
