-- Public pool access is global for active members. Data scope still applies to
-- owned leads, but pool rows use a dedicated masked view so RLS on public.leads
-- is never weakened for direct table reads.

create or replace view public.public_pool_secure_view
with (security_barrier = true) as
select
  l.id,
  l.team_id,
  l.owner_id,
  l.created_by,
  l.name,
  l.source,
  l.stage,
  l.status,
  l.close_result,
  l.close_reason,
  l.last_contact_at,
  l.created_at,
  l.updated_at,
  l.customer_name,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone else iwish.mask_phone(l.customer_phone) end as customer_phone,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email else iwish.mask_email(l.customer_email) end as customer_email,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address else null end as address,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget else null end as budget,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score else null end as internal_score,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason else null end as blacklist_reason,
  l.next_contact_at,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.wechat else null end as wechat,
  l.customer_grade,
  l.source_level1,
  l.source_level2,
  l.tags,
  l.first_contact_at,
  l.locked_by,
  l.locked_until,
  l.protected_until,
  l.responsibility_type,
  l.dev_method_key,
  l.referral_customer_name,
  l.referral_type_key,
  l.activity_name,
  l.source_department_key,
  l.source_locked_at,
  l.website,
  l.allocation_status,
  l.product_category,
  l.customer_attribute,
  l.follow_up_stage,
  l.ownership_started_at,
  l.pool_return_reason,
  l.pool_returned_at,
  l.pool_returned_by
from public.leads l
where coalesce(l.is_deleted, false) = false
  and iwish.is_active_user(auth.uid())
  and l.status = 'pool';

revoke all on public.public_pool_secure_view from anon;
grant select on public.public_pool_secure_view to authenticated, service_role;

create or replace function iwish.rpc_me_permissions()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_scope jsonb;
  v_create_scope jsonb;
begin
  if v_actor is null then return '{}'::jsonb; end if;
  begin v_scope := iwish.get_effective_scope(v_actor, 'leads.read'); exception when others then v_scope := '{"scope_type":"self"}'; end;
  begin v_create_scope := iwish.get_effective_scope(v_actor, 'leads.create'); exception when others then v_create_scope := '{"scope_type":"self"}'; end;
  return jsonb_build_object(
    'canAssignLeads', iwish.has_permission(v_actor, 'leads.assign'),
    'canClaimLeads', iwish.has_permission(v_actor, 'leads.claim'),
    'canOverrideLeadQuota', iwish.has_permission(v_actor, 'leads.quota.override'),
    'canReturnToPool', iwish.has_permission(v_actor, 'leads.pool.return'),
    'canDeleteLeads', iwish.has_permission(v_actor, 'leads.delete'),
    'canTransferLeads', iwish.has_permission(v_actor, 'leads.transfer'),
    'canViewAudit', iwish.has_permission(v_actor, 'audit.read'),
    'canViewReports', iwish.has_permission(v_actor, 'reports.read'),
    'canViewSettings', iwish.has_permission(v_actor, 'settings.security.manage') or iwish.has_permission(v_actor, 'settings.pipeline.manage') or iwish.has_permission(v_actor, 'settings.ui.manage') or iwish.has_permission(v_actor, 'settings.integrations.manage'),
    'canViewPublicPool', iwish.is_active_user(v_actor),
    'canImportLeads', iwish.has_permission(v_actor, 'leads.import'),
    'canReadContracts', iwish.has_permission(v_actor, 'contracts.read'),
    'canManageContracts', iwish.has_permission(v_actor, 'contracts.manage'),
    'canReadAllocations', iwish.has_permission(v_actor, 'allocations.read'),
    'canManageAllocations', iwish.has_permission(v_actor, 'allocations.manage'),
    'leadScopeType', coalesce(v_scope->>'scope_type', 'self'),
    'leadCreateScopeType', coalesce(v_create_scope->>'scope_type', 'self')
  );
end;
$$;

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
  v_limit integer := least(iwish.lead_quota_limit(), 60);
  v_count integer;
begin
  if p_owner_id is null or v_limit <= 0 then
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

create or replace function iwish.rpc_lead_claim_from_pool(
  p_lead_id uuid,
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
  v_team_id integer;
  v_previously_returned boolean := false;
  v_prevent_previous_owner_reclaim boolean := false;
  v_settings jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.claim') then
    raise exception 'ERR_NO_PERMISSION:leads.claim';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and coalesce(is_deleted, false) = false;
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

  -- Pool claiming is a hard 60-lead limit. Quota override permissions do not
  -- bypass this rule; only the claim permission and previous-owner setting apply.
  perform iwish.enforce_lead_quota_hard(v_actor, p_lead_id);

  v_before := to_jsonb(v_lead.*);
  update public.leads
  set owner_id = v_actor,
      team_id = v_team_id,
      status = 'open'
  where id = p_lead_id
    and status = 'pool'
    and coalesce(is_deleted, false) = false;

  if not found then
    raise exception 'ERR_CONFLICT:lead_already_claimed';
  end if;

  perform iwish.audit(
    v_actor, 'claim_lead_from_pool', 'lead', p_lead_id::text,
    v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason
  );
end;
$$;
