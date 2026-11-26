-- Apply one acquisition quota and prepare guarded public-pool automation.
create table iwish.crm_quota_limits (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  quota integer not null check (quota between 1 and 60)
);
alter table iwish.crm_quota_limits enable row level security;
revoke all on iwish.crm_quota_limits from public, anon, authenticated;

create function iwish.crm_quota_limit(p_owner uuid) returns integer
language sql stable set search_path = '' as $$
  select coalesce((select quota from iwish.crm_quota_limits where profile_id=p_owner),60);
$$;

create or replace function iwish.lead_counts_toward_quota(
  p_owner_id uuid,p_status text,p_customer_attribute text,p_follow_up_stage text,p_close_result text,p_is_deleted boolean default false
) returns boolean language sql immutable set search_path = '' as $$
  select p_owner_id is not null and not coalesce(p_is_deleted,false) and p_status='open'
    and coalesce(p_customer_attribute,'followable') <> 'invalid'
    and coalesce(p_follow_up_stage,'uncontacted') not in ('won','payment_received')
    and coalesce(p_close_result,'') not in ('won','成交');
$$;

create function iwish.crm_quota_full(p_owner uuid,p_except uuid) returns boolean
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  if p_owner is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select count(*) into v_count from public.leads l where l.owner_id=p_owner and l.id is distinct from p_except
    and l.status='open' and iwish.lead_counts_toward_quota(l.owner_id,l.status,l.customer_attribute,l.follow_up_stage,l.close_result,l.is_deleted);
  return v_count >= iwish.crm_quota_limit(p_owner);
end;
$$;

create or replace function iwish.enforce_lead_quota(p_owner_id uuid,p_lead_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if iwish.crm_quota_full(p_owner_id,p_lead_id) then
    raise exception 'ERR_QUOTA_EXCEEDED:lead_quota_limit:%',iwish.crm_quota_limit(p_owner_id);
  end if;
end;
$$;
create or replace function iwish.enforce_lead_quota_hard(p_owner_id uuid,p_lead_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  select iwish.enforce_lead_quota(p_owner_id,p_lead_id);
$$;

create or replace function iwish.trg_lead_pipeline_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_consumes boolean;
begin
  if new.owner_id is not null and new.ownership_started_at is null then new.ownership_started_at:=now(); end if;
  v_consumes := iwish.lead_counts_toward_quota(new.owner_id,new.status,new.customer_attribute,new.follow_up_stage,new.close_result,new.is_deleted);
  if tg_op='INSERT' then
    if v_consumes and iwish.crm_quota_full(new.owner_id,null) then
      new.status:='pool';
      new.crm_pending_assignment:=true;
      new.ownership_started_at:=null;
      new.protected_until:=null;
    end if;
  elsif (old.owner_id is distinct from new.owner_id or old.status='pool') and new.status='open' then
    new.ownership_started_at:=now();
    if v_consumes then perform iwish.enforce_lead_quota(new.owner_id,new.id); end if;
  elsif v_consumes and not iwish.lead_counts_toward_quota(old.owner_id,old.status,old.customer_attribute,old.follow_up_stage,old.close_result,old.is_deleted) then
    perform iwish.enforce_lead_quota(new.owner_id,new.id);
  end if;
  return new;
end;
$$;

create function iwish.crm_protected_owner_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status='open' and old.protected_until > now() and auth.uid() is not null
    and auth.uid() is distinct from old.owner_id and (
      new.owner_id is distinct from old.owner_id or new.team_id is distinct from old.team_id or new.status='pool'
    ) then
    raise exception 'ERR_CRM_PROTECTED_OWNER';
  end if;
  return new;
end;
$$;
create trigger crm_protected_owner_guard before update of owner_id,team_id,status on public.leads
for each row execute function iwish.crm_protected_owner_guard();

insert into public.settings(key,value) values ('crm.protection_release','{"enabled":false}'::jsonb) on conflict(key) do nothing;

create table iwish.crm_protection_notices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  deadline date not null,
  offset_days integer not null check (offset_days in (0,3,7)),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(profile_id,lead_id,deadline,offset_days)
);
create index crm_protection_notices_lead on iwish.crm_protection_notices(lead_id);
alter table iwish.crm_protection_notices enable row level security;
revoke all on iwish.crm_protection_notices from public,anon,authenticated;

create function iwish.crm_run_protection() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_today date := iwish.crm_today();
  v_removed integer := 0;
  v_notices integer := 0;
  v_enabled boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('iwish.crm.protection.job')) then
    return jsonb_build_object('busy',true);
  end if;
  insert into iwish.crm_protection_notices(profile_id,lead_id,deadline,offset_days)
  select distinct r.profile_id,l.id,d.deadline,d.deadline-v_today
  from public.leads l cross join lateral (
    select (l.protected_until at time zone 'Asia/Shanghai')::date-1 as deadline
  ) d cross join lateral (
    select l.owner_id as profile_id
    union
    select p.id from public.profiles p
    where d.deadline=v_today and p.id<>l.owner_id and l.team_id is not null
      and (p.team_id=l.team_id or exists(select 1 from public.profile_team_memberships m where m.profile_id=p.id and m.team_id=l.team_id))
      and iwish.is_active_user(p.id) and iwish.has_permission(p.id,'leads.assign')
      and iwish.in_scope_for_lead(p.id,l,'leads.read')
  ) r
  where l.status='open' and not coalesce(l.is_deleted,false) and l.owner_id is not null
    and iwish.is_active_user(l.owner_id)
    and not l.crm_protection_review_required and l.customer_attribute is distinct from 'invalid' and l.follow_up_stage not in ('won','payment_received')
    and d.deadline-v_today in (0,3,7)
    and l.protected_until is not null
  on conflict(profile_id,lead_id,deadline,offset_days) do nothing;
  get diagnostics v_notices = row_count;

  select value->>'enabled' = 'true' into v_enabled from public.settings where key='crm.protection_release';
  if v_enabled and v_today >= date '2026-12-16' then
    for v_lead in select * from public.leads f
      where f.status='open' and not coalesce(f.is_deleted,false)
        and not f.crm_protection_review_required and f.owner_id is not null and f.customer_attribute is distinct from 'invalid'
        and f.follow_up_stage not in ('won','payment_received') and f.protected_until <= now()
      order by f.protected_until,f.id limit 100 for update skip locked
    loop
      if iwish.crm_protection_deadline(v_lead) < v_today then
        update public.leads set status='pool',crm_pending_assignment=false,pool_return_reason='新版保护期到期自动流转',
          pool_returned_at=now(),pool_returned_by=v_lead.owner_id where id=v_lead.id;
        perform iwish.audit(v_lead.owner_id,'crm_auto_release','lead',v_lead.id::text,to_jsonb(v_lead),
          (select to_jsonb(r) from public.leads r where r.id=v_lead.id),'新版保护期到期自动流转');
        v_removed := v_removed+1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('dropped_count',v_removed,'notices',v_notices);
end;
$$;

-- Existing external callers switch to the new guarded release logic.
create or replace function iwish.rpc_auto_return_leads_to_pool() returns jsonb
language sql security definer set search_path = '' as $$
  select iwish.crm_run_protection();
$$;
create function public.rpc_crm_run_protection() returns jsonb
language sql security definer set search_path = '' as $$
  select iwish.crm_run_protection();
$$;

create function public.rpc_crm_protection_notices() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]')
  from (
    select m.id,m.lead_id,l.name as customer,m.deadline,m.offset_days,m.read_at,m.created_at
    from iwish.crm_protection_notices m join public.leads l on l.id=m.lead_id
    where m.profile_id=auth.uid() and iwish.is_active_user(auth.uid())
      and iwish.in_scope_for_lead(auth.uid(),l,'leads.read')
      and l.status='open' and not l.crm_protection_review_required
      and iwish.crm_protection_deadline(l)=m.deadline
    order by m.created_at desc limit 50
  ) n;
$$;
create function public.rpc_crm_protection_notice_read(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update iwish.crm_protection_notices set read_at=coalesce(read_at,now())
  where id=p_id and profile_id=auth.uid() and iwish.is_active_user(auth.uid());
$$;

create function public.rpc_crm_protection_admin(p_enabled boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_enabled boolean;
begin
  if not iwish.is_active_user(auth.uid()) or not iwish.has_permission(auth.uid(),'settings.pipeline.manage') then
    raise exception 'ERR_NO_PERMISSION:settings.pipeline.manage';
  end if;
  if p_enabled is not null then
    update public.settings set value=jsonb_build_object('enabled',p_enabled) where key='crm.protection_release';
  end if;
  select value->>'enabled'='true' into v_enabled from public.settings where key='crm.protection_release';
  return jsonb_build_object('enabled',v_enabled,'earliest','2026-12-16');
end;
$$;

create function public.rpc_crm_restore_release(p_lead_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads; b public.leads; v_before jsonb; v_enabled boolean;
begin
  if not iwish.crm_review_access(p_lead_id) or not iwish.has_permission(auth.uid(),'settings.pipeline.manage') then
    raise exception 'ERR_NO_PERMISSION:crm_protection.restore';
  end if;
  select value->>'enabled'='true' into v_enabled from public.settings where key='crm.protection_release';
  if v_enabled or nullif(btrim(p_reason),'') is null then raise exception 'ERR_CRM_RESTORE_DISABLED_REQUIRED'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  if l.status<>'pool' or l.pool_return_reason is distinct from '新版保护期到期自动流转' then raise exception 'ERR_CRM_CONFLICT'; end if;
  select a.before into v_before from public.audit_logs a
  where a.action='crm_auto_release' and a.target_type='lead' and a.target_id=l.id::text
    and (a.after->>'pool_returned_at')::timestamptz=l.pool_returned_at order by a.created_at desc limit 1;
  if v_before is null then raise exception 'ERR_CRM_CONFLICT'; end if;
  b := jsonb_populate_record(null::public.leads,v_before);
  if not iwish.is_active_user(b.owner_id) then raise exception 'ERR_CRM_RESTORE_OWNER'; end if;
  update public.leads set status='open',owner_id=b.owner_id,team_id=b.team_id,pool_return_reason=null,
    pool_returned_at=null,pool_returned_by=null where id=l.id;
  update public.leads set ownership_started_at=b.ownership_started_at,crm_protection_class=b.crm_protection_class,
    crm_protection_review_required=true,crm_protection_confirmed_until=null,crm_protection_extension_until=null,
    protected_until=null where id=l.id;
  perform iwish.audit(auth.uid(),'crm_restore_release','lead',l.id::text,to_jsonb(l),
    (select to_jsonb(r) from public.leads r where r.id=l.id),btrim(p_reason));
end;
$$;

revoke all on function iwish.crm_quota_limit(uuid), iwish.crm_quota_full(uuid,uuid),
  iwish.crm_protected_owner_guard(), iwish.crm_run_protection() from public,anon,authenticated;
revoke all on function public.rpc_crm_run_protection(),public.rpc_crm_protection_notices(),public.rpc_crm_protection_notice_read(uuid),
  public.rpc_crm_protection_admin(boolean),public.rpc_crm_restore_release(uuid,text) from public,anon,authenticated;
grant execute on function public.rpc_crm_run_protection() to service_role;
grant execute on function public.rpc_crm_protection_notices(),public.rpc_crm_protection_notice_read(uuid),
  public.rpc_crm_protection_admin(boolean),public.rpc_crm_restore_release(uuid,text) to authenticated;

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
  l.pool_returned_by,
  l.crm_pending_assignment
from public.leads l
where coalesce(l.is_deleted, false) = false
  and iwish.is_active_user(auth.uid())
  and l.status = 'pool'
  and (not l.crm_pending_assignment or (
    iwish.has_permission(auth.uid(), 'leads.assign') and iwish.in_scope_for_lead(auth.uid(),l,'leads.assign')
  ));

revoke all on public.public_pool_secure_view from anon;
grant select on public.public_pool_secure_view to authenticated, service_role;

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
  if v_lead.crm_pending_assignment then
    raise exception 'ERR_CRM_PENDING_ASSIGNMENT';
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
      and al.action in ('return_lead_to_pool','crm_auto_release')
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


create function public.rpc_crm_create_lead(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_pending boolean;
  v_actor uuid := auth.uid();
  v_owner uuid := coalesce(nullif(payload->>'owner_id','')::uuid,v_actor);
  v_team integer := (payload->>'team_id')::integer;
begin
  if v_owner is distinct from v_actor then
    if not iwish.has_permission(v_actor,'leads.assign') or not iwish.in_scope_for_lead(v_actor,
      jsonb_populate_record(null::public.leads,jsonb_build_object('created_by',v_actor,'owner_id',v_owner,'team_id',v_team)),
      'leads.assign') then
      raise exception 'ERR_NO_PERMISSION:leads.assign';
    end if;
    perform iwish.validate_lead_assignment_target(v_owner,v_team);
  end if;
  v_id:=public.rpc_lead_create(payload);
  if v_id is null then raise exception 'ERR_CRM_LEAD_CREATE'; end if;
  select crm_pending_assignment into v_pending from public.leads where id=v_id;
  return jsonb_build_object('id',v_id,'pendingAssignment',v_pending);
end;
$$;

create function public.rpc_crm_my_quota() returns integer
language sql stable security definer set search_path = '' as $$
  select iwish.crm_quota_limit(auth.uid()) where iwish.is_active_user(auth.uid());
$$;

revoke all on function public.rpc_crm_create_lead(jsonb),public.rpc_crm_my_quota() from public,anon,authenticated;
grant execute on function public.rpc_crm_create_lead(jsonb),public.rpc_crm_my_quota() to authenticated;


-- Policy state is written through the scoped CRM routines. Direct client
-- updates to leads retain their existing generic permissions.
create function iwish.crm_guard_protected_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' then
      if new.crm_protection_class<>'new_intent' or new.crm_protection_review_required
        or new.crm_protection_confirmed_until is not null or new.crm_protection_extension_until is not null
        or new.crm_legacy_protected_until is not null or new.crm_pending_assignment or new.crm_visit_previous_stage is not null then
        raise exception 'ERR_NO_PERMISSION:crm_protection.direct_write';
      end if;
    elsif (new.crm_protection_class,new.crm_protection_review_required,new.crm_protection_confirmed_until,
        new.crm_protection_extension_until,new.crm_pending_assignment,new.crm_visit_previous_stage,new.crm_legacy_protected_until)
      is distinct from
        (old.crm_protection_class,old.crm_protection_review_required,old.crm_protection_confirmed_until,
        old.crm_protection_extension_until,old.crm_pending_assignment,old.crm_visit_previous_stage,old.crm_legacy_protected_until) then
      raise exception 'ERR_NO_PERMISSION:crm_protection.direct_write';
    end if;
  end if;
  return new;
end;
$$;
create trigger crm_00_guard_protected_columns
before insert or update of crm_protection_class,crm_protection_review_required,crm_protection_confirmed_until,
  crm_protection_extension_until,crm_pending_assignment,crm_visit_previous_stage,crm_legacy_protected_until on public.leads
for each row execute function iwish.crm_guard_protected_columns();
revoke all on function iwish.crm_guard_protected_columns() from public,anon,authenticated;

-- Keep the batch transactional and expose how many imported rows entered the queue.
create or replace function public.rpc_leads_import_kanban(
  p_job_id uuid,
  p_rows jsonb,
  p_auto_complete boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_check jsonb;
  v_item jsonb;
  v_payload jsonb;
  v_row_index integer := 0;
  v_imported integer := 0;
  v_pending integer := 0;
  v_result jsonb;
  v_total_count integer := 0;
  v_row_errors jsonb := '[]'::jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ERR_VALIDATION:empty_import_rows';
  end if;

  v_total_count := jsonb_array_length(p_rows);
  v_check := public.rpc_leads_import_kanban_check(p_rows);
  v_row_errors := coalesce(v_check->'rowErrors', '[]'::jsonb);

  if jsonb_array_length(v_row_errors) > 0 then
    if p_auto_complete then
      perform public.rpc_leads_import_mark_complete(
        p_job_id => p_job_id,
        p_status => 'failed',
        p_total_count => v_total_count,
        p_success_count => 0,
        p_duplicate_count => 0,
        p_error_message => '存在未通过校验的导入行，请先修正后再导入'
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'importedCount', 0,
      'failedCount', jsonb_array_length(v_row_errors),
      'rowErrors', v_row_errors
    );
  end if;

  begin
    for v_item in
      select value
      from jsonb_array_elements(p_rows)
    loop
      v_row_index := coalesce((v_item->>'rowIndex')::integer, v_imported + 1);
      v_payload := case
        when jsonb_typeof(v_item) = 'object' and v_item ? 'payload' then v_item->'payload'
        else v_item
      end;

      v_result := public.rpc_crm_create_lead(v_payload);
      if (v_result->>'pendingAssignment')::boolean then v_pending := v_pending + 1; end if;
      v_imported := v_imported + 1;
    end loop;
  exception
    when others then
      v_row_errors := jsonb_build_array(
        jsonb_build_object(
          'rowIndex', v_row_index,
          'message', sqlerrm
        )
      );

      if p_auto_complete then
        perform public.rpc_leads_import_mark_complete(
          p_job_id => p_job_id,
          p_status => 'failed',
          p_total_count => v_total_count,
          p_success_count => 0,
          p_duplicate_count => 0,
          p_error_message => sqlerrm
        );
      end if;

      return jsonb_build_object(
        'ok', false,
        'importedCount', 0,
        'failedCount', 1,
        'rowErrors', v_row_errors
      );
  end;

  if p_auto_complete then
    perform public.rpc_leads_import_mark_complete(
      p_job_id => p_job_id,
      p_status => 'completed',
      p_total_count => v_total_count,
      p_success_count => v_imported,
      p_duplicate_count => 0,
      p_error_message => null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'importedCount', v_imported,
    'pendingAssignmentCount', v_pending,
    'failedCount', 0,
    'rowErrors', '[]'::jsonb
  );
end;
$$;
