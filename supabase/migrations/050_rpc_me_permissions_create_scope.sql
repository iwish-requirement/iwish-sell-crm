-- 050_rpc_me_permissions_create_scope.sql
-- Expose leads.create scope in the existing permissions snapshot for import/create UX.

create or replace function iwish.rpc_me_permissions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_scope jsonb;
  v_scope_type text;
  v_create_scope jsonb;
  v_create_scope_type text;
begin
  if v_actor is null then
    return '{}'::jsonb;
  end if;

  begin
    v_scope := iwish.get_effective_scope(v_actor, 'leads.read');
  exception when others then
    v_scope := jsonb_build_object('scope_type', 'self');
  end;

  begin
    v_create_scope := iwish.get_effective_scope(v_actor, 'leads.create');
  exception when others then
    v_create_scope := jsonb_build_object('scope_type', 'self');
  end;

  v_scope_type := coalesce(v_scope->>'scope_type', 'self');
  v_create_scope_type := coalesce(v_create_scope->>'scope_type', 'self');

  return jsonb_build_object(
    'canAssignLeads',    iwish.has_permission(v_actor, 'leads.assign'),
    'canReturnToPool',   iwish.has_permission(v_actor, 'leads.pool.return'),
    'canDeleteLeads',    iwish.has_permission(v_actor, 'leads.delete'),
    'canTransferLeads',  iwish.has_permission(v_actor, 'leads.transfer'),
    'canViewAudit',      iwish.has_permission(v_actor, 'audit.read'),
    'canViewReports',    iwish.has_permission(v_actor, 'reports.read'),
    'canViewSettings',   iwish.has_permission(v_actor, 'settings.security.manage')
                          or iwish.has_permission(v_actor, 'settings.pipeline.manage')
                          or iwish.has_permission(v_actor, 'settings.ui.manage')
                          or iwish.has_permission(v_actor, 'settings.integrations.manage'),
    'canViewPublicPool', iwish.has_permission(v_actor, 'leads.pool.return'),
    'canImportLeads',    iwish.has_permission(v_actor, 'leads.import'),
    'canReadContracts',  iwish.has_permission(v_actor, 'contracts.read'),
    'canManageContracts',iwish.has_permission(v_actor, 'contracts.manage'),
    'leadScopeType',     v_scope_type,
    'leadCreateScopeType', v_create_scope_type
  );
end;
$$;

revoke all on function iwish.rpc_me_permissions() from public;
grant execute on function iwish.rpc_me_permissions() to authenticated;

drop function if exists public.rpc_me_permissions();

create or replace function public.rpc_me_permissions()
returns jsonb
language sql
security definer
as $$
  select iwish.rpc_me_permissions();
$$;

grant execute on function public.rpc_me_permissions() to authenticated;
