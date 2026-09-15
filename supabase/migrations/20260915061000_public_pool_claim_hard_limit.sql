-- The public-pool claim rule is a hard product limit: it must never be
-- widened or disabled by a configurable quota value.
create or replace function iwish.enforce_lead_quota_hard(
  p_owner_id uuid,
  p_lead_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := 60;
  v_count integer;
begin
  if p_owner_id is null then
    return;
  end if;
  if v_actor is null and current_user <> 'service_role' then
    raise exception 'ERR_NOT_AUTHENTICATED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  select count(*) into v_count
  from public.leads l
  where l.owner_id = p_owner_id
    and l.id is distinct from p_lead_id
    and iwish.lead_counts_toward_quota(
      l.owner_id, l.status, l.customer_attribute,
      l.follow_up_stage, l.close_result, l.is_deleted
    );

  if v_count >= v_limit then
    raise exception 'ERR_QUOTA_EXCEEDED:lead_quota_limit:%', v_limit;
  end if;
end;
$$;
revoke all on function iwish.enforce_lead_quota_hard(uuid, uuid) from public, anon, authenticated;
