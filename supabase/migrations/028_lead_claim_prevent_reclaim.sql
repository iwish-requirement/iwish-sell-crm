-- 028_lead_claim_prevent_reclaim.sql
-- Prevent previous owner from re-claiming a lead they returned to the public pool.

create or replace function iwish.rpc_lead_claim_from_pool(p_lead_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_before jsonb;
  v_team_id int;
  v_previously_returned boolean := false;
begin
  if not iwish.has_permission(v_actor, 'leads.assign') then
    raise exception 'ERR_NO_PERMISSION:leads.assign';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;

  if v_lead.status <> 'pool' then
    raise exception 'ERR_INVALID_STATUS:only_pool_leads_can_be_claimed';
  end if;

  -- prevent the same salesperson from re-claiming a lead they previously returned to pool
  select exists (
    select 1
    from public.audit_logs al
    where al.target_type = 'lead'
      and al.target_id = p_lead_id::text
      and al.action = 'return_lead_to_pool'
      and al.before->>'owner_id' = v_actor::text
  ) into v_previously_returned;

  if v_previously_returned then
    raise exception 'ERR_INVALID_STATUS:previous_owner_cannot_claim_after_return';
  end if;

  select team_id into v_team_id from public.profiles where id = v_actor;
  if v_team_id is null then
    raise exception 'ERR_VALIDATION:claim_requires_team';
  end if;

  v_before := to_jsonb(v_lead.*);

  update public.leads
  set owner_id = v_actor,
      team_id = v_team_id,
      status = 'open'
  where id = p_lead_id;

  perform iwish.audit(
    v_actor,
    'claim_lead_from_pool',
    'lead',
    p_lead_id::text,
    v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
    p_reason
  );
end $$;

create or replace function public.rpc_lead_claim_from_pool(p_lead_id uuid, p_reason text default null)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_claim_from_pool(p_lead_id, p_reason);
$$;

grant execute on function public.rpc_lead_claim_from_pool(uuid, text) to authenticated, service_role;
