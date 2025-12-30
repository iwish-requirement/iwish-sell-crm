-- Add reason parameter to lead assignment RPC and wire it into audit_logs

create or replace function iwish.rpc_lead_assign(p_lead_id uuid, p_new_owner uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.assign') then
    raise exception 'ERR_NO_PERMISSION:leads.assign';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.assign') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.assign';
  end if;

  v_before := to_jsonb(v_lead.*);

  update public.leads
  set owner_id = p_new_owner
  where id = p_lead_id;

  perform iwish.audit(
    v_actor,
    'assign_lead',
    'lead',
    p_lead_id::text,
    v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
    p_reason
  );
end $$;

create or replace function public.rpc_lead_assign(p_lead_id uuid, p_new_owner uuid, p_reason text default null)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_assign(p_lead_id, p_new_owner, p_reason);
$$;

grant execute on function public.rpc_lead_assign(uuid, uuid, text) to authenticated, service_role;
