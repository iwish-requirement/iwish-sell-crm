-- Separate self-claiming public-pool leads from assigning leads to others.
insert into public.permissions(key, resource, action, name, description, is_system, is_enabled)
values (
  'leads.claim',
  'leads',
  'claim',
  'Claim Lead From Pool',
  'Claim a public-pool lead for yourself',
  true,
  true
)
on conflict (key) do nothing;

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
  v_prevent_previous_owner_reclaim boolean := false;
  v_settings jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.claim') then
    raise exception 'ERR_NO_PERMISSION:leads.claim';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;
  if v_lead.status <> 'pool' then
    raise exception 'ERR_INVALID_STATUS:only_pool_leads_can_be_claimed';
  end if;

  select value into v_settings from public.settings where key = 'pipeline.business_rules';
  v_prevent_previous_owner_reclaim := coalesce((v_settings->>'prevent_previous_owner_reclaim')::boolean, false);

  select exists (
    select 1 from public.audit_logs al
    where al.target_type = 'lead'
      and al.target_id = p_lead_id::text
      and al.action = 'return_lead_to_pool'
      and al.before->>'owner_id' = v_actor::text
  ) into v_previously_returned;
  if v_prevent_previous_owner_reclaim and v_previously_returned then
    raise exception 'ERR_INVALID_STATUS:previous_owner_cannot_claim_after_return';
  end if;

  select team_id into v_team_id from public.profiles where id = v_actor;
  if v_team_id is null then
    raise exception 'ERR_VALIDATION:claim_requires_team';
  end if;

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set owner_id = v_actor, team_id = v_team_id, status = 'open'
  where id = p_lead_id;

  perform iwish.audit(
    v_actor, 'claim_lead_from_pool', 'lead', p_lead_id::text,
    v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason
  );
end $$;

create or replace function public.rpc_lead_claim_from_pool(p_lead_id uuid, p_reason text default null)
returns void language sql security definer set search_path = public, iwish as $$
  select iwish.rpc_lead_claim_from_pool(p_lead_id, p_reason);
$$;

grant execute on function public.rpc_lead_claim_from_pool(uuid, text) to authenticated, service_role;

create or replace function iwish.rpc_me_permissions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_scope jsonb;
  v_create_scope jsonb;
begin
  if v_actor is null then return '{}'::jsonb; end if;
  begin v_scope := iwish.get_effective_scope(v_actor, 'leads.read'); exception when others then v_scope := '{"scope_type":"self"}'::jsonb; end;
  begin v_create_scope := iwish.get_effective_scope(v_actor, 'leads.create'); exception when others then v_create_scope := '{"scope_type":"self"}'::jsonb; end;
  return jsonb_build_object(
    'canAssignLeads', iwish.has_permission(v_actor, 'leads.assign'),
    'canClaimLeads', iwish.has_permission(v_actor, 'leads.claim'),
    'canReturnToPool', iwish.has_permission(v_actor, 'leads.pool.return'),
    'canDeleteLeads', iwish.has_permission(v_actor, 'leads.delete'),
    'canTransferLeads', iwish.has_permission(v_actor, 'leads.transfer'),
    'canViewAudit', iwish.has_permission(v_actor, 'audit.read'),
    'canViewReports', iwish.has_permission(v_actor, 'reports.read'),
    'canViewSettings', iwish.has_permission(v_actor, 'settings.security.manage') or iwish.has_permission(v_actor, 'settings.pipeline.manage') or iwish.has_permission(v_actor, 'settings.ui.manage') or iwish.has_permission(v_actor, 'settings.integrations.manage'),
    'canViewPublicPool', iwish.has_permission(v_actor, 'leads.pool.return'),
    'canImportLeads', iwish.has_permission(v_actor, 'leads.import'),
    'canReadContracts', iwish.has_permission(v_actor, 'contracts.read'),
    'canManageContracts', iwish.has_permission(v_actor, 'contracts.manage'),
    'canReadAllocations', iwish.has_permission(v_actor, 'allocations.read'),
    'canManageAllocations', iwish.has_permission(v_actor, 'allocations.manage'),
    'leadScopeType', coalesce(v_scope->>'scope_type', 'self'),
    'leadCreateScopeType', coalesce(v_create_scope->>'scope_type', 'self')
  );
end $$;

revoke all on function iwish.rpc_me_permissions() from public;
grant execute on function iwish.rpc_me_permissions() to authenticated;
drop function if exists public.rpc_me_permissions();
create or replace function public.rpc_me_permissions() returns jsonb language sql security definer as $$ select iwish.rpc_me_permissions(); $$;
grant execute on function public.rpc_me_permissions() to authenticated;
