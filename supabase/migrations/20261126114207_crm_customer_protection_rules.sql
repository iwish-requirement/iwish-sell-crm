-- Activate classification-based protection on top of the existing visits and contract workflow.

create table iwish.crm_protection_terms (
  effective_at timestamptz primary key,
  new_intent_days integer not null check (new_intent_days > 0),
  key_intent_days integer not null check (key_intent_days > 0),
  nurture_days integer not null check (nurture_days > 0)
);
alter table iwish.crm_protection_terms enable row level security;
revoke all on iwish.crm_protection_terms from public, anon, authenticated;

insert into iwish.crm_protection_terms values ('-infinity',15,45,90);

create function iwish.crm_protection_terms_at(p_at timestamptz) returns iwish.crm_protection_terms
language sql stable set search_path = '' as $$
  select t from iwish.crm_protection_terms t where t.effective_at <= p_at
  order by t.effective_at desc limit 1;
$$;

create table iwish.crm_protection_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('extension', 'nurture')),
  days integer not null check (
    (kind = 'extension' and days between 1 and 30) or (kind = 'nurture' and days = 0)
  ),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index crm_protection_requests_lead on iwish.crm_protection_requests(lead_id);
create unique index crm_protection_requests_pending on iwish.crm_protection_requests(lead_id, kind)
  where status = 'pending';

alter table iwish.crm_protection_requests enable row level security;
revoke all on iwish.crm_protection_requests from public, anon, authenticated;

alter table public.leads
  add column crm_protection_class text not null default 'new_intent'
    check (crm_protection_class in ('new_intent','key_intent','nurture')),
  add column crm_protection_review_required boolean not null default false,
  add column crm_protection_confirmed_until date,
  add column crm_protection_extension_until date,
  add column crm_pending_assignment boolean not null default false,
  add column crm_legacy_protected_until timestamptz;

-- Preserve the legacy timestamps and leave existing ownership untouched.
-- Unverified customers remain on the management review list until confirmed.
do $$
declare v_timestamp_trigger "char";
begin
  -- The dashboard uses updated_at for activity. A migration is not a sales action.
  select tgenabled into v_timestamp_trigger from pg_trigger
  where tgrelid='public.leads'::regclass and tgname='trg_leads_updated_at';
  if v_timestamp_trigger in ('O','A') then
    alter table public.leads disable trigger trg_leads_updated_at;
  end if;

  update public.leads
  set crm_legacy_protected_until = protected_until,
      crm_protection_review_required = status='open' and owner_id is not null
        and customer_attribute is distinct from 'invalid'
        and coalesce(follow_up_stage,'uncontacted') not in ('won','payment_received'),
      protected_until = null
  where not coalesce(is_deleted,false)
    and (protected_until is not null or (status='open' and owner_id is not null
      and customer_attribute is distinct from 'invalid' and coalesce(follow_up_stage,'uncontacted') not in ('won','payment_received')));

  if v_timestamp_trigger='O' then
    alter table public.leads enable trigger trg_leads_updated_at;
  elsif v_timestamp_trigger='A' then
    alter table public.leads enable always trigger trg_leads_updated_at;
  end if;
end;
$$;

create index crm_lead_protection_due on public.leads(protected_until,id)
  where status='open' and owner_id is not null and not crm_protection_review_required and protected_until is not null;
create index crm_lead_pending_assignment on public.leads(team_id,created_at)
  where status='pool' and crm_pending_assignment;

create function iwish.crm_extension_review_access(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select iwish.crm_review_access(p_lead) and exists (
    select 1 from public.profiles p join public.roles r on r.id=p.role_id
    where p.id=auth.uid() and (r.role_type='biz_owner' or r.name='SuperAdmin')
  );
$$;

-- Earlier visits remain in the timeline but cannot renew a new ownership cycle.
create function iwish.crm_protection_latest_visit(p_lead public.leads) returns iwish.crm_visits
language sql stable set search_path = '' as $$
  select v
  from iwish.crm_visits v
  where v.lead_id=p_lead.id and v.invalidated_at is null
    and v.owner_id is not distinct from p_lead.owner_id
    and v.created_at >= coalesce(p_lead.ownership_started_at,p_lead.created_at)
    and v.visited_on >= (coalesce(p_lead.ownership_started_at,p_lead.created_at) at time zone 'Asia/Shanghai')::date
  order by v.visited_on desc,v.created_at desc,v.id limit 1;
$$;

create function iwish.crm_protection_visit_date(p_lead public.leads) returns date
language sql stable set search_path = '' as $$
  select (iwish.crm_protection_latest_visit(p_lead)).visited_on;
$$;

-- A verified first visit starts the key-intent period without overwriting the classification decision.
create function iwish.crm_effective_protection_class(p_lead public.leads) returns text
language sql stable set search_path = '' as $$
  select case when p_lead.crm_protection_class='new_intent'
    and iwish.crm_protection_visit_date(p_lead) is not null
    then 'key_intent' else p_lead.crm_protection_class end;
$$;

create function iwish.crm_protection_deadline(p_lead public.leads) returns date
language plpgsql stable set search_path = '' as $$
declare
  v_base date;
  v_ownership_at timestamptz := coalesce(p_lead.ownership_started_at,p_lead.created_at);
  v_visit iwish.crm_visits;
  v_followup_at timestamptz;
begin
  if p_lead.status <> 'open' or p_lead.owner_id is null or coalesce(p_lead.is_deleted,false)
    or p_lead.customer_attribute = 'invalid' or p_lead.follow_up_stage in ('won','payment_received')
    or p_lead.crm_protection_review_required then
    return null;
  end if;
  -- Recompute with the terms in effect at the triggering action, including when an action is invalidated.
  if p_lead.crm_protection_class='nurture' then
    select max(n.created_at) into v_followup_at from public.lead_notes n
    where n.lead_id=p_lead.id and n.crm_substantive_kind is not null and not n.is_deleted
      and n.created_at>=v_ownership_at;
    v_base := (v_followup_at at time zone 'Asia/Shanghai')::date
      + (iwish.crm_protection_terms_at(v_followup_at)).nurture_days;
  else
    v_visit := iwish.crm_protection_latest_visit(p_lead);
    v_base := v_visit.visited_on + (iwish.crm_protection_terms_at(v_visit.created_at)).key_intent_days;
  end if;
  return coalesce(
    greatest(v_base,p_lead.crm_protection_confirmed_until,p_lead.crm_protection_extension_until),
    (v_ownership_at at time zone 'Asia/Shanghai')::date + (iwish.crm_protection_terms_at(v_ownership_at)).new_intent_days
  );
end;
$$;

create function iwish.crm_project_protection(p_lead public.leads) returns timestamptz
language sql stable set search_path = '' as $$
  select (iwish.crm_protection_deadline(p_lead) + 1)::timestamp at time zone 'Asia/Shanghai';
$$;

create function iwish.crm_refresh_protection(p_lead uuid) returns void
language sql set search_path = '' as $$
  update public.leads l set protected_until = iwish.crm_project_protection(l)
  where l.id = p_lead and l.protected_until is distinct from iwish.crm_project_protection(l);
$$;

create or replace function iwish.crm_apply_lead_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.locked_by := null;
    new.locked_until := null;
    new.protected_until := iwish.crm_project_protection(new);
  elsif (old.owner_id is distinct from new.owner_id or old.status = 'pool') and new.status = 'open' then
    new.ownership_started_at := now();
    new.crm_pending_assignment := false;
    new.crm_protection_class := 'new_intent';
    new.crm_protection_review_required := false;
    new.crm_protection_confirmed_until := null;
    new.crm_protection_extension_until := null;
    new.protected_until := iwish.crm_project_protection(new);
  elsif new.status <> 'open' or new.follow_up_stage in ('won','payment_received') or new.customer_attribute = 'invalid' then
    new.protected_until := null;
  elsif new.protected_until is distinct from old.protected_until then
    new.protected_until := iwish.crm_project_protection(new);
  end if;
  if tg_op = 'UPDATE' then
    new.locked_by := old.locked_by;
    new.locked_until := old.locked_until;
  end if;
  if new.follow_up_stage = 'offline_visit' and (tg_op = 'INSERT' or old.follow_up_stage is distinct from new.follow_up_stage)
    and auth.uid() is not null and iwish.crm_latest_visit(new.id,null) is null then
    raise exception 'ERR_CRM_VISIT_REQUIRED';
  end if;
  if new.follow_up_stage = 'payment_received' and (tg_op = 'INSERT' or old.follow_up_stage is distinct from new.follow_up_stage)
    and auth.uid() is not null and not (
      exists (select 1 from public.deal_contract_submissions s where s.lead_id = new.id
        and s.finance_confirmed_at is not null and nullif(s.finance->>'receivedOn','') is not null
        and case when s.finance->>'receivedAmount' ~ '^[0-9]+(\.[0-9]+)?$' then (s.finance->>'receivedAmount')::numeric > 0 else false end)
      or exists (select 1 from public.contracts c join public.contract_payments p on p.contract_id = c.id
        where c.lead_id = new.id and p.status = 'confirmed' and p.amount > 0)
    ) then
    raise exception 'ERR_CRM_PAID_REQUIRES_FINANCE';
  end if;
  return new;
end;
$$;

create or replace trigger crm_apply_lead_rules
before insert or update of owner_id,status,follow_up_stage,customer_attribute,protected_until,locked_until,locked_by
on public.leads for each row execute function iwish.crm_apply_lead_rules();

create function iwish.crm_recompute_after_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
  if (tg_op <> 'DELETE' and new.crm_substantive_kind is not null)
    or (tg_op <> 'INSERT' and old.crm_substantive_kind is not null) then
    select * into l from public.leads where id=case when tg_op='DELETE' then old.lead_id else new.lead_id end;
    perform iwish.crm_refresh_protection(l.id);
    perform iwish.audit(coalesce(auth.uid(),l.owner_id),'crm_substantive_followup','lead',l.id::text,to_jsonb(l),
      (select to_jsonb(a) from public.leads a where a.id=l.id),'实质性跟进变更');
  end if;
  return null;
end;
$$;
create trigger crm_recompute_after_note
after insert or delete or update of crm_substantive_kind,is_deleted,content on public.lead_notes
for each row execute function iwish.crm_recompute_after_note();

create or replace function public.rpc_crm_lead_workflow(p_lead_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.leads;
  v_review boolean;
  v_class text;
begin
  if not iwish.crm_visit_access(p_lead_id,false) then raise exception 'ERR_NO_PERMISSION:lead_notes.read'; end if;
  select * into strict l from public.leads where id = p_lead_id;
  v_review := iwish.crm_review_access(l.id);
  v_class := case
    when l.status = 'pool' then 'pool'
    when iwish.crm_customer_is_cooperating(l) then 'cooperating'
    when l.close_result in ('won','成交') and l.status = 'closed' then 'awaiting_cooperation'
    when l.customer_attribute = 'invalid' or l.status <> 'open' then 'invalid'
    else iwish.crm_effective_protection_class(l) end;
  return jsonb_build_object(
    'owner',(select jsonb_build_object('id',p.id,'name',p.full_name) from public.profiles p where p.id=l.owner_id),
    'actor',auth.uid(),'canSubmit',iwish.crm_visit_access(l.id,true),'canReview',v_review,
    'canManageProtection',v_review and l.status='open' and v_class not in ('invalid','cooperating'),
    'canRequestProtection',l.owner_id=auth.uid() and l.status='open' and v_class not in ('invalid','cooperating'),
    'protectionClass',v_class, 'reviewRequired',l.crm_protection_review_required,
    'expiresOn',iwish.crm_protection_deadline(l),
    'legacyProtectedUntil',l.crm_legacy_protected_until,
    'firstVisitSatisfied',iwish.crm_protection_visit_date(l) is not null,
    'requests',coalesce((
      select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'days',r.days,'reason',r.reason,
        'canReview',case when r.kind='extension' then iwish.crm_extension_review_access(l.id) else v_review end) order by r.created_at)
      from iwish.crm_protection_requests r where r.lead_id=l.id and r.status='pending'
        and (v_review or r.requested_by=auth.uid())
    ),'[]'),
    'visits',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',v.id,'data',v.data,'createdAt',v.created_at,'updatedAt',v.updated_at,'invalidReason',v.invalid_reason,'protectionOn',v.protection_on,
        'submittedBy',coalesce(p.full_name,''),
        'canEdit',v.invalidated_at is null and (v.submitted_by=auth.uid() or v_review) and iwish.crm_visit_access(l.id,true),
        'participants',coalesce((
          select jsonb_agg(jsonb_build_object('id',vp.profile_id,'name',pp.full_name) order by pp.full_name)
          from iwish.crm_visit_participants vp join public.profiles pp on pp.id=vp.profile_id where vp.visit_id=v.id
        ),'[]')
      ) order by v.visited_on desc,v.created_at desc)
      from iwish.crm_visits v left join public.profiles p on p.id=v.submitted_by where v.lead_id=l.id
    ),'[]')
  );
end;
$$;

create or replace function public.rpc_crm_visit_save(
  p_lead_id uuid,p_id uuid,p_payload jsonb,p_participants uuid[],p_previous_updated_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.leads;
  existing iwish.crm_visits;
  v_actor uuid := auth.uid();
  v_field text;
  v_path text;
  v_file jsonb;
  v_meeting boolean := false;
  v_has_url boolean;
  v_date date;
  v_ids uuid[] := array(select distinct x from unnest(p_participants) x order by x);
begin
  select * into l from public.leads where id=p_lead_id for update;
  if not iwish.crm_visit_access(p_lead_id,true) then raise exception 'ERR_NO_PERMISSION:lead_notes.create'; end if;
  if p_id is null or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>48000 then
    raise exception 'ERR_CRM_VISIT_PAYLOAD';
  end if;
  foreach v_field in array array['visitDate','method','type','contactName','contactTitle','needs','outcome','expectedMargin','expectedSignedOn','nextAction','nextContactOn'] loop
    if jsonb_typeof(p_payload->v_field) is distinct from 'string' or nullif(btrim(p_payload->>v_field),'') is null then
      raise exception 'ERR_CRM_VISIT_REQUIRED_FIELD:%',v_field;
    end if;
  end loop;
  if p_payload->>'method' not in ('onsite','office','video','phone','course','event')
    or p_payload->>'type' not in ('first','repeat_2','repeat_3','repeat_4','repeat_5','repeat_6','repeat_7','expansion')
    or (p_payload->>'expectedMargin' <> '待确认' and p_payload->>'expectedMargin' !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
    or jsonb_typeof(p_payload->'services') is distinct from 'array'
    or jsonb_typeof(p_payload->'files') is distinct from 'array' then
    raise exception 'ERR_CRM_VISIT_PAYLOAD';
  end if;
  if jsonb_array_length(p_payload->'services') not between 1 and 19 or jsonb_array_length(p_payload->'files') > 12
    or exists (select 1 from jsonb_array_elements_text(p_payload->'services') s where s is null or s not in (
      'Google广告运营','Meta广告运营','Bing广告运营','Criteo广告运营','Pinterest广告运营','Moloco电视广告运营',
      'TK广告运营','SEO营销','GEO营销','红人营销','社媒营销','PR营销','EDM营销','联盟营销','独立站建站',
      '独立站整合全案运营服务','课程培训','素材营销服务（图片或视频）','其他')) then
    raise exception 'ERR_CRM_VISIT_PAYLOAD';
  end if;
  if p_payload->>'type'='expansion' and not iwish.crm_customer_is_cooperating(l) then
    raise exception 'ERR_CRM_VISIT_EXPANSION';
  end if;
  v_date := (p_payload->>'visitDate')::date;
  if v_date > iwish.crm_today() or (p_payload->>'nextContactOn')::date < v_date then
    raise exception 'ERR_CRM_VISIT_DATE';
  end if;
  if p_payload->>'expectedSignedOn' <> '待确认' then perform (p_payload->>'expectedSignedOn')::date; end if;
  if cardinality(v_ids) not between 1 and 30 or exists (
    select 1 from unnest(v_ids) x
    where not iwish.is_active_user(x) or not iwish.has_permission(x,'lead_notes.create')
  ) then raise exception 'ERR_CRM_VISIT_PARTICIPANTS'; end if;
  select * into existing from iwish.crm_visits where id=p_id for update;
  if existing.id is not null and (
    existing.lead_id <> l.id or existing.invalidated_at is not null
    or (existing.submitted_by is distinct from v_actor and not iwish.crm_review_access(l.id))
  ) then raise exception 'ERR_CRM_VISIT_EXISTS'; end if;
  if existing.id is not null and existing.updated_at is distinct from p_previous_updated_at then
    if existing.data=p_payload and v_ids=array(select profile_id from iwish.crm_visit_participants where visit_id=p_id order by profile_id) then
      return p_id;
    end if;
    raise exception 'ERR_CRM_CONFLICT';
  end if;
  for v_file in select value from jsonb_array_elements(p_payload->'files') loop
    v_path := v_file->>'path';
    if v_path is null or split_part(v_path,'/',1) <> l.id::text or split_part(v_path,'/',2) <> p_id::text
       or v_file->>'kind' is null or v_file->>'kind' not in ('meeting','attachment')
       or nullif(btrim(v_file->>'name'),'') is null
       or not exists(select 1 from storage.objects o where o.bucket_id='crm-visit-materials' and o.name=v_path
         and (o.owner_id=v_actor::text or existing.data->'files' @> jsonb_build_array(v_file))) then
      raise exception 'ERR_CRM_VISIT_ATTACHMENT';
    end if;
    if v_file->>'kind' = 'meeting' then v_meeting := true; end if;
  end loop;
  v_has_url := coalesce(p_payload->>'meetingUrl','') <> '';
  if v_has_url and (p_payload->>'meetingUrl' !~* '^https?://[^[:space:]]+$' or length(p_payload->>'meetingUrl') > 3000) then
    raise exception 'ERR_CRM_VISIT_EVIDENCE';
  end if;
  if p_payload->>'method' in ('video','phone') and (
    (not v_has_url and not v_meeting)
    or (v_has_url <> v_meeting and nullif(btrim(p_payload->>'missingReason'),'') is null)
  ) then raise exception 'ERR_CRM_VISIT_EVIDENCE'; end if;

  insert into iwish.crm_visits(id,lead_id,submitted_by,owner_id,visited_on,data)
  values (p_id,l.id,v_actor,l.owner_id,v_date,p_payload)
  on conflict (id) do update set visited_on=excluded.visited_on,data=excluded.data,updated_at=clock_timestamp();
  delete from iwish.crm_visit_participants where visit_id=p_id;
  insert into iwish.crm_visit_participants(visit_id,profile_id) select p_id,x from unnest(v_ids) x;

  if l.status='open' and l.follow_up_stage in ('uncontacted','connected','online_communication') then
    update public.leads set follow_up_stage='offline_visit',stage='L2',
      crm_visit_previous_stage=case when l.follow_up_stage in ('uncontacted','connected') then l.follow_up_stage end
    where id=l.id;
    perform iwish.audit(v_actor,'update_lead_pipeline','lead',l.id::text,to_jsonb(l),
      (select to_jsonb(a) from public.leads a where a.id=l.id),'提交有效拜访');
  end if;
  perform iwish.crm_refresh_protection(l.id);
  update iwish.crm_visits set protection_on=(select iwish.crm_protection_deadline(n) from public.leads n where n.id=l.id) where id=p_id;
  perform iwish.audit(v_actor,case when existing.id is null then 'crm_visit_create' else 'crm_visit_update' end,
    'crm_visit',p_id::text,nullif(to_jsonb(existing),'null'::jsonb),
    jsonb_build_object('lead_id',l.id,'data',p_payload,'participants',v_ids),'');
  return p_id;
end;
$$;

create or replace function public.rpc_crm_visit_invalidate(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v iwish.crm_visits; l public.leads;
begin
  select * into v from iwish.crm_visits where id=p_id;
  if not iwish.crm_review_access(v.lead_id) then raise exception 'ERR_NO_PERMISSION:crm_visit.review'; end if;
  if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'ERR_CRM_VISIT_REASON'; end if;
  select * into l from public.leads where id=v.lead_id for update;
  update iwish.crm_visits set invalidated_at=now(),invalid_reason=btrim(p_reason),updated_at=clock_timestamp()
  where id=p_id and invalidated_at is null;
  if found then
    if l.status='open' and l.follow_up_stage='offline_visit' and l.crm_visit_previous_stage is not null
      and iwish.crm_latest_visit(l.id,null) is null then
      update public.leads set follow_up_stage=l.crm_visit_previous_stage,
        stage=case when l.crm_visit_previous_stage='connected' then 'L2' else 'L1' end,
        crm_visit_previous_stage=null where id=l.id;
      perform iwish.audit(auth.uid(),'update_lead_pipeline','lead',l.id::text,to_jsonb(l),
        (select to_jsonb(a) from public.leads a where a.id=l.id),'撤销无效拜访所产生的阶段');
    end if;
    perform iwish.crm_refresh_protection(v.lead_id);
    perform iwish.audit(auth.uid(),'crm_visit_invalidated','crm_visit',p_id::text,to_jsonb(v),
      jsonb_build_object('lead_id',v.lead_id,'invalid_reason',btrim(p_reason)),btrim(p_reason));
  end if;
end;
$$;

create function public.rpc_crm_protection_configure(p_lead_id uuid,p_class text,p_confirmed_until date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
  if not iwish.crm_review_access(p_lead_id) then raise exception 'ERR_NO_PERMISSION:crm_protection.review'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  if l.status <> 'open' or p_class is null or p_class not in ('new_intent','key_intent','nurture')
    or l.customer_attribute='invalid' or l.follow_up_stage in ('won','payment_received')
    or (l.crm_protection_review_required and p_confirmed_until is null)
    or (p_class='key_intent' and l.crm_protection_class<>'key_intent'
      and not l.crm_protection_review_required and iwish.crm_protection_visit_date(l) is null) then
    raise exception 'ERR_CRM_PROTECTION_CLASS';
  end if;
  if iwish.crm_effective_protection_class(l)='key_intent' and p_class='nurture' then
    raise exception 'ERR_CRM_PROTECTION_APPROVAL';
  end if;
  update public.leads set crm_protection_class=p_class,crm_protection_review_required=false,
    crm_protection_confirmed_until=p_confirmed_until where id=l.id;
  perform iwish.crm_refresh_protection(l.id);
  perform iwish.audit(auth.uid(),'crm_protection_configure','lead',l.id::text,to_jsonb(l),
    (select to_jsonb(a) from public.leads a where a.id=l.id),'确认客户分类及保护期');
end;
$$;

create function public.rpc_crm_protection_request(p_lead_id uuid,p_kind text,p_days integer,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
  select * into l from public.leads where id=p_lead_id for update;
  if not iwish.crm_visit_access(l.id,true) or l.owner_id is distinct from auth.uid() or l.status <> 'open'
    or l.follow_up_stage in ('won','payment_received') or l.customer_attribute='invalid' then
    raise exception 'ERR_NO_PERMISSION:crm_protection.request';
  end if;
  if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 or p_kind is null
    or (p_kind='nurture' and iwish.crm_effective_protection_class(l) <> 'key_intent')
    or (p_kind='extension' and iwish.crm_protection_deadline(l) is null) then
    raise exception 'ERR_CRM_PROTECTION_REQUEST';
  end if;
  insert into iwish.crm_protection_requests(lead_id,requested_by,kind,days,reason)
    values (l.id,auth.uid(),p_kind,p_days,btrim(p_reason));
end;
$$;

create function public.rpc_crm_protection_review(p_request_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r iwish.crm_protection_requests;
  l public.leads;
begin
  select * into r from iwish.crm_protection_requests where id=p_request_id;
  if not iwish.crm_review_access(r.lead_id)
    or (r.kind='extension' and not iwish.crm_extension_review_access(r.lead_id)) then
    raise exception 'ERR_NO_PERMISSION:crm_protection.review';
  end if;
  select * into l from public.leads where id=r.lead_id for update;
  select * into r from iwish.crm_protection_requests where id=p_request_id for update;
  if r.status <> 'pending' or p_approve is null or l.status <> 'open'
    or l.customer_attribute='invalid' or l.follow_up_stage in ('won','payment_received') then
    raise exception 'ERR_CRM_CONFLICT';
  end if;
  if p_approve then
    if l.owner_id is distinct from r.requested_by or l.crm_protection_review_required then raise exception 'ERR_CRM_CONFLICT'; end if;
    if r.kind='extension' and iwish.crm_protection_deadline(l) is not null then
      update public.leads set crm_protection_extension_until=iwish.crm_protection_deadline(l)+r.days where id=l.id;
    elsif r.kind='nurture' and iwish.crm_effective_protection_class(l)='key_intent' then
      update public.leads set crm_protection_class='nurture',crm_protection_confirmed_until=null,
        crm_protection_extension_until=null where id=l.id;
    else raise exception 'ERR_CRM_CONFLICT';
    end if;
    perform iwish.crm_refresh_protection(l.id);
  end if;
  update iwish.crm_protection_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now() where id=r.id;
  perform iwish.audit(auth.uid(),'crm_protection_review','lead',l.id::text,to_jsonb(l),
    (select to_jsonb(a) from public.leads a where a.id=l.id),r.kind || ': ' || r.reason);
end;
$$;

revoke all on function iwish.crm_extension_review_access(uuid),iwish.crm_effective_protection_class(public.leads),
  iwish.crm_protection_terms_at(timestamptz),iwish.crm_protection_latest_visit(public.leads),
  iwish.crm_protection_visit_date(public.leads),iwish.crm_protection_deadline(public.leads),iwish.crm_project_protection(public.leads),
  iwish.crm_refresh_protection(uuid),iwish.crm_recompute_after_note() from public,anon,authenticated;
revoke all on function public.rpc_crm_protection_configure(uuid,text,date),public.rpc_crm_protection_request(uuid,text,integer,text),
  public.rpc_crm_protection_review(uuid,boolean) from public,anon,authenticated;
grant execute on function public.rpc_crm_protection_configure(uuid,text,date),public.rpc_crm_protection_request(uuid,text,integer,text),
  public.rpc_crm_protection_review(uuid,boolean) to authenticated;
