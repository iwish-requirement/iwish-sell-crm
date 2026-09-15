-- Make assignment of a pool lead an atomic acquisition.
-- The public-pool UI historically called assign and status=open separately;
-- this closes the gap where the first call could succeed at quota 60.

create or replace function iwish.rpc_lead_assign(
  p_lead_id uuid,
  p_new_owner uuid
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_before jsonb;
  v_opens boolean;
begin
  if not iwish.has_permission(v_actor, 'leads.assign') then
    raise exception 'ERR_NO_PERMISSION:leads.assign';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and coalesce(is_deleted, false) = false;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.assign') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.assign';
  end if;
  perform iwish.validate_lead_assignment_target(p_new_owner, v_lead.team_id);

  v_opens := v_lead.status = 'pool';
  perform iwish.enforce_lead_quota(
    p_new_owner,
    case when v_opens then null else p_lead_id end
  );

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set owner_id = p_new_owner,
      status = case when status = 'pool' then 'open' else status end
  where id = p_lead_id and coalesce(is_deleted, false) = false;

  perform iwish.audit(v_actor, 'assign_lead', 'lead', p_lead_id::text, v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), null);
end;
$$;

create or replace function iwish.rpc_lead_assign(
  p_lead_id uuid,
  p_new_owner uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_before jsonb;
  v_opens boolean;
begin
  if not iwish.has_permission(v_actor, 'leads.assign') then
    raise exception 'ERR_NO_PERMISSION:leads.assign';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and coalesce(is_deleted, false) = false;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.assign') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.assign';
  end if;
  perform iwish.validate_lead_assignment_target(p_new_owner, v_lead.team_id);

  v_opens := v_lead.status = 'pool';
  perform iwish.enforce_lead_quota(
    p_new_owner,
    case when v_opens then null else p_lead_id end
  );

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set owner_id = p_new_owner,
      status = case when status = 'pool' then 'open' else status end
  where id = p_lead_id and coalesce(is_deleted, false) = false;

  perform iwish.audit(v_actor, 'assign_lead', 'lead', p_lead_id::text, v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), nullif(trim(p_reason), ''));
end;
$$;
