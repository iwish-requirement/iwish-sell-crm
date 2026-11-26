
-- Structured sales visits and existing CRM stages. Keep protection and quotas under production rules.
create table iwish.crm_visits (
  id uuid primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  submitted_by uuid references public.profiles(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  visited_on date not null,
  data jsonb not null,
  protection_on date,
  invalidated_at timestamptz,
  invalid_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_visits_lead_date on iwish.crm_visits(lead_id, visited_on desc);
create index crm_visits_valid_date on iwish.crm_visits(visited_on, lead_id) where invalidated_at is null;

create table iwish.crm_visit_participants (
  visit_id uuid not null references iwish.crm_visits(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (visit_id, profile_id)
);
create index crm_visit_participants_profile on iwish.crm_visit_participants(profile_id, visit_id);


alter table iwish.crm_visits enable row level security;
alter table iwish.crm_visit_participants enable row level security;
revoke all on iwish.crm_visits, iwish.crm_visit_participants from public, anon, authenticated;

alter table public.leads add column crm_visit_previous_stage text
  check (crm_visit_previous_stage in ('uncontacted', 'connected'));
alter table public.lead_notes add column crm_substantive_kind text
  check (crm_substantive_kind in ('feedback','demand','progress'));
create index crm_substantive_notes_lead_date on public.lead_notes(lead_id, created_at desc)
  where crm_substantive_kind is not null and not is_deleted;

create function iwish.crm_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Shanghai')::date;
$$;

create function iwish.crm_customer_is_cooperating(p_lead public.leads) returns boolean
language sql stable set search_path = '' as $$
  select p_lead.status='closed' and coalesce(p_lead.close_result,'') in ('won','成交') and (
    exists(select 1 from public.contracts c where c.lead_id=p_lead.id and c.status='active'
      and coalesce(c.start_date,(c.signed_at at time zone 'Asia/Shanghai')::date)<=iwish.crm_today()
      and (c.end_date is null or c.end_date>=iwish.crm_today()))
    or exists(select 1 from public.deal_contract_submissions s where s.lead_id=p_lead.id and s.submitted_at is not null
      and coalesce(nullif(crm_allocation.operations_date(s.submitted->>'serviceStartsOn'),'')::date,
        nullif(crm_allocation.operations_date(s.finance->>'signedOn'),'')::date,
        nullif(crm_allocation.operations_date(s.submitted->>'signedOn'),'')::date)<=iwish.crm_today()
      and not exists(select 1 from public.contracts c where c.lead_id=p_lead.id and (c.status in ('cancelled','closed') or c.end_date<iwish.crm_today())))
  );
$$;

create function iwish.crm_visit_access(p_lead uuid, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select iwish.is_active_user(auth.uid()) and exists (
    select 1 from public.leads l
    where l.id = p_lead and not coalesce(l.is_deleted, false) and l.status <> 'pool'
      and iwish.has_permission(auth.uid(), case when p_write then 'lead_notes.create' else 'lead_notes.read' end)
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
      and (not p_write or l.status = 'open' or l.close_result in ('won','成交'))
  );
$$;

create function iwish.crm_review_access(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select iwish.is_active_user(auth.uid()) and iwish.has_permission(auth.uid(), 'leads.assign') and exists (
    select 1 from public.leads l where l.id = p_lead and not coalesce(l.is_deleted,false)
      and iwish.in_scope_for_lead(auth.uid(),l,'leads.update')
  );
$$;

create function iwish.crm_latest_visit(p_lead uuid, p_since timestamptz) returns date
language sql stable set search_path = '' as $$
  select max(v.visited_on)
  from iwish.crm_visits v
  where v.lead_id = p_lead and v.invalidated_at is null
    and v.visited_on >= coalesce((p_since at time zone 'Asia/Shanghai')::date, '-infinity'::date);
$$;

create function iwish.crm_apply_lead_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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
create trigger crm_apply_lead_rules
before insert or update of follow_up_stage
on public.leads for each row execute function iwish.crm_apply_lead_rules();

create function iwish.crm_validate_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.note_type = 'visit' and auth.uid() is not null then
    raise exception 'ERR_CRM_VISIT_REQUIRED';
  end if;
  if new.crm_substantive_kind is not null and char_length(btrim(new.content)) < 2 then
    raise exception 'ERR_CRM_SUBSTANTIVE_FOLLOWUP';
  end if;
  return new;
end;
$$;
create trigger crm_validate_note
before insert or update of content,note_type,crm_substantive_kind on public.lead_notes
for each row execute function iwish.crm_validate_note();

insert into storage.buckets (id,name,public,file_size_limit)
values ('crm-visit-materials','crm-visit-materials',false,20971520);

create function iwish.crm_visit_file_access(p_path text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lead uuid;
begin
  if p_path !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}){2}$' then
    return false;
  end if;
  v_lead := split_part(p_path,'/',1)::uuid;
  if not iwish.crm_visit_access(v_lead,p_write) then return false; end if;
  if p_write then
    return not exists (
      select 1 from iwish.crm_visits v where v.id = split_part(p_path,'/',2)::uuid
        and (v.lead_id <> v_lead or (v.submitted_by is distinct from auth.uid() and not iwish.crm_review_access(v_lead)))
    );
  end if;
  return exists (
    select 1 from iwish.crm_visits v where v.id = split_part(p_path,'/',2)::uuid and v.lead_id = v_lead
      and v.data->'files' @> jsonb_build_array(jsonb_build_object('path',p_path))
  );
end;
$$;

create function iwish.crm_visit_file_unattached(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from iwish.crm_visits v
    where v.id::text = split_part(p_path,'/',2)
      and v.data->'files' @> jsonb_build_array(jsonb_build_object('path',p_path))
  );
$$;

create policy crm_visit_file_read on storage.objects for select to authenticated using (
  bucket_id = 'crm-visit-materials' and (
    iwish.crm_visit_file_access(name,false)
    or (owner_id = (select auth.uid())::text and iwish.crm_visit_file_unattached(name))
  )
);
create policy crm_visit_file_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'crm-visit-materials' and iwish.crm_visit_file_access(name,true)
);
create policy crm_visit_file_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'crm-visit-materials' and owner_id = (select auth.uid())::text and iwish.crm_visit_file_unattached(name)
);

create function public.rpc_crm_visit_participants(p_lead_id uuid,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not iwish.crm_visit_access(p_lead_id,true) then raise exception 'ERR_NO_PERMISSION:lead_notes.create'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'name',q.full_name) order by q.full_name),'[]') into v_result
  from (
    select p.id,p.full_name from public.profiles p
    where p.status = 'active' and p.disabled_at is null
      and iwish.has_permission(p.id,'lead_notes.create')
      and (coalesce(p_query,'') = '' or strpos(lower(p.full_name),lower(left(p_query,80))) > 0)
    order by p.full_name limit 50
  ) q;
  return v_result;
end;
$$;

create function public.rpc_crm_lead_workflow(p_lead_id uuid) returns jsonb
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
    else 'new_intent' end;
  return jsonb_build_object(
    'owner',(select jsonb_build_object('id',p.id,'name',p.full_name) from public.profiles p where p.id=l.owner_id),
    'actor',auth.uid(),'canSubmit',iwish.crm_visit_access(l.id,true),'canReview',v_review,
    'canManageProtection',false,
    'canRequestProtection',false,
    'protectionClass',v_class, 'reviewRequired',false,
    'expiresOn',(l.protected_until at time zone 'Asia/Shanghai')::date,
    'firstVisitSatisfied',iwish.crm_latest_visit(l.id,l.ownership_started_at) is not null,
    'requests','[]'::jsonb,
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

create function public.rpc_crm_visit_save(
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
  update iwish.crm_visits set protection_on=(select (n.protected_until at time zone 'Asia/Shanghai')::date from public.leads n where n.id=l.id) where id=p_id;
  perform iwish.audit(v_actor,case when existing.id is null then 'crm_visit_create' else 'crm_visit_update' end,
    'crm_visit',p_id::text,nullif(to_jsonb(existing),'null'::jsonb),
    jsonb_build_object('lead_id',l.id,'data',p_payload,'participants',v_ids),'');
  return p_id;
end;
$$;

create function public.rpc_crm_visit_invalidate(p_id uuid,p_reason text) returns void
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
    perform iwish.audit(auth.uid(),'crm_visit_invalidated','crm_visit',p_id::text,to_jsonb(v),
      jsonb_build_object('lead_id',v.lead_id,'invalid_reason',btrim(p_reason)),btrim(p_reason));
  end if;
end;
$$;

create function iwish.crm_mark_lead_paid(p_lead uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
  select * into l from public.leads where id=p_lead for update;
  if l.id is not null and l.status='closed' and l.close_result in ('won','成交')
    and l.follow_up_stage <> 'payment_received' then
    update public.leads set follow_up_stage='payment_received',stage='Won' where id=l.id;
    perform iwish.audit(coalesce(auth.uid(),l.owner_id),'update_lead_pipeline','lead',l.id::text,to_jsonb(l),
      (select to_jsonb(a) from public.leads a where a.id=l.id),'财务确认首笔到账');
  end if;
end;
$$;

create function iwish.crm_confirmed_payment_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='deal_contract_submissions' then
    if new.finance_confirmed_at is not null and nullif(new.finance->>'receivedOn','') is not null
      and new.finance->>'receivedAmount' ~ '^[0-9]+(\.[0-9]+)?$'
      and (new.finance->>'receivedAmount')::numeric > 0 then
      perform iwish.crm_mark_lead_paid(new.lead_id);
    end if;
  elsif new.status='confirmed' and new.amount>0 and new.paid_at is not null then
    perform iwish.crm_mark_lead_paid((select lead_id from public.contracts where id=new.contract_id));
  end if;
  return null;
end;
$$;
create trigger crm_stage_on_finance_confirmation
after insert or update of finance,finance_confirmed_at on public.deal_contract_submissions
for each row execute function iwish.crm_confirmed_payment_stage();
create trigger crm_stage_on_legacy_payment
after insert or update of status,amount,paid_at on public.contract_payments
for each row execute function iwish.crm_confirmed_payment_stage();


revoke all on function iwish.crm_today(), iwish.crm_customer_is_cooperating(public.leads),
  iwish.crm_visit_access(uuid,boolean), iwish.crm_review_access(uuid), iwish.crm_latest_visit(uuid,timestamptz),
  iwish.crm_apply_lead_rules(), iwish.crm_validate_note(), iwish.crm_visit_file_access(text,boolean),
  iwish.crm_visit_file_unattached(text), iwish.crm_mark_lead_paid(uuid), iwish.crm_confirmed_payment_stage()
  from public, anon, authenticated;
grant execute on function iwish.crm_visit_file_access(text,boolean), iwish.crm_visit_file_unattached(text) to authenticated;
revoke all on function public.rpc_crm_lead_workflow(uuid), public.rpc_crm_visit_participants(uuid,text),
  public.rpc_crm_visit_save(uuid,uuid,jsonb,uuid[],timestamptz), public.rpc_crm_visit_invalidate(uuid,text) from public, anon;
grant execute on function public.rpc_crm_lead_workflow(uuid), public.rpc_crm_visit_participants(uuid,text),
  public.rpc_crm_visit_save(uuid,uuid,jsonb,uuid[],timestamptz), public.rpc_crm_visit_invalidate(uuid,text) to authenticated;



create table iwish.crm_visit_goals (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  effective_on date not null,
  monthly integer check (monthly between 0 and 10000),
  quarterly integer check (quarterly between 0 and 30000),
  yearly integer check (yearly between 0 and 120000),
  weekly_reference text,
  primary key (profile_id,effective_on)
);
alter table iwish.crm_visit_goals enable row level security;
revoke all on iwish.crm_visit_goals from public,anon,authenticated;

with targets(name,effective_on,monthly,quarterly,yearly,weekly_reference) as (values
  ('张乐',date '2026-12-01',8,null,null,null),('章珈铭',date '2026-12-01',10,null,null,null),
  ('黄顺芳',date '2026-12-01',12,null,null,null),('陈茵茵',date '2026-12-01',12,null,null,null),
  ('赵亚娟',date '2026-12-01',16,null,null,null),('吴晓东',date '2026-12-01',16,null,null,null),
  ('冀腾飞',date '2026-12-01',8,null,null,null),
  ('张乐',date '2027-01-01',10,30,120,'2–3'),('章珈铭',date '2027-01-01',12,36,144,'3'),
  ('黄顺芳',date '2027-01-01',16,48,192,'4'),('陈茵茵',date '2027-01-01',16,48,192,'4'),
  ('赵亚娟',date '2027-01-01',20,60,240,'5'),('吴晓东',date '2027-01-01',20,60,240,'5'),
  ('冀腾飞',date '2027-01-01',10,30,120,'2–3')
), matched as (
  select p.id,t.*,count(*) over(partition by t.name,t.effective_on) as matches
  from targets t join public.profiles p on btrim(p.full_name)=t.name and p.status='active' and p.disabled_at is null
)
insert into iwish.crm_visit_goals(profile_id,effective_on,monthly,quarterly,yearly,weekly_reference)
select id,effective_on,monthly,quarterly,yearly,weekly_reference from matched where matches=1;

create function iwish.crm_person_in_scope(p_actor uuid,p_target public.profiles) returns boolean
language sql stable set search_path = '' as $$
  select iwish.in_scope_for_lead(p_actor,jsonb_populate_record(null::public.leads,
    jsonb_build_object('owner_id',p_target.id,'team_id',p_target.team_id,'created_by',p_target.id)),'leads.read');
$$;

create function public.rpc_crm_sales_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not iwish.is_active_user(auth.uid()) or not iwish.has_permission(auth.uid(),'settings.pipeline.manage') then
    raise exception 'ERR_NO_PERMISSION:settings.pipeline.manage';
  end if;
  return jsonb_build_object('people',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name)
    from public.profiles p where iwish.is_active_user(p.id) and iwish.has_permission(p.id,'lead_notes.create')
  ),'[]'),'goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.effective_on desc) from iwish.crm_visit_goals g),'[]'));
end;
$$;

create function public.rpc_crm_save_visit_goal(
  p_profile uuid,p_effective_on date,p_monthly integer,p_quarterly integer,p_yearly integer,p_weekly_reference text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_old jsonb;
begin
  if not iwish.is_active_user(auth.uid()) or not iwish.has_permission(auth.uid(),'settings.pipeline.manage') then
    raise exception 'ERR_NO_PERMISSION:settings.pipeline.manage';
  end if;
  if not iwish.is_active_user(p_profile) or length(p_weekly_reference)>40 then raise exception 'ERR_CRM_GOAL'; end if;
  select to_jsonb(g) into v_old from iwish.crm_visit_goals g where profile_id=p_profile and effective_on=p_effective_on;
  insert into iwish.crm_visit_goals values (p_profile,p_effective_on,p_monthly,p_quarterly,p_yearly,nullif(btrim(p_weekly_reference),''))
  on conflict(profile_id,effective_on) do update set monthly=excluded.monthly,quarterly=excluded.quarterly,
    yearly=excluded.yearly,weekly_reference=excluded.weekly_reference;
  perform iwish.audit(auth.uid(),'crm_visit_goal_save','profile',p_profile::text,v_old,
    (select to_jsonb(g) from iwish.crm_visit_goals g where profile_id=p_profile and effective_on=p_effective_on),'');
end;
$$;

-- Used by the existing homepage aggregates. These dates are the business dates
-- on effective visit records and the assigned next action, not note timestamps.
create function public.rpc_crm_dashboard_visit_events(p_start date,p_end date)
returns table(lead_id uuid,author_id uuid,visited_on date) language sql stable security definer set search_path = '' as $$
  select distinct v.lead_id,vp.profile_id,v.visited_on
  from iwish.crm_visits v join iwish.crm_visit_participants vp on vp.visit_id=v.id
  join public.leads l on l.id=v.lead_id
  where iwish.is_active_user(auth.uid()) and v.invalidated_at is null and not coalesce(l.is_deleted,false)
    and v.visited_on>=p_start and v.visited_on<p_end and iwish.crm_visit_access(l.id,false);
$$;

create function public.rpc_crm_dashboard_next_actions()
returns table(lead_id uuid,next_contact_at timestamptz,last_visit_at timestamptz) language sql stable security definer set search_path = '' as $$
  select distinct on(v.lead_id) v.lead_id,(v.data->>'nextContactOn')::date::timestamp at time zone 'Asia/Shanghai',
    case when (v.created_at at time zone 'Asia/Shanghai')::date=v.visited_on then v.created_at
      else v.visited_on::timestamp at time zone 'Asia/Shanghai' end
  from iwish.crm_visits v join public.leads l on l.id=v.lead_id
  where iwish.is_active_user(auth.uid()) and v.invalidated_at is null and l.status='open'
    and not coalesce(l.is_deleted,false) and iwish.crm_visit_access(l.id,false)
  order by v.lead_id,v.visited_on desc,v.created_at desc,v.id;
$$;

create function iwish.crm_signed_on(p_value text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p_value ~ '^\d{4}-\d{2}-\d{2}$' then return p_value::date; end if;
  return null;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end;
$$;

create function public.rpc_crm_visit_goal_report(
  p_start date,p_end date,p_period text default 'month',p_team integer default null,p_profile uuid default null
) returns jsonb
language sql stable security definer set search_path = '' as $$
with viewer as materialized (
  select auth.uid() as id, iwish.crm_today() as as_of,
    iwish.has_permission(auth.uid(),'reports.read') as reports,
    iwish.has_permission(auth.uid(),'reports.export') as export
  where iwish.is_active_user(auth.uid()) and p_start<p_end
), people as materialized (
  select p.id,p.full_name as name,p.team_id,t.name as team
  from viewer v cross join public.profiles p left join public.teams t on p.team_id=t.id
  where iwish.is_active_user(p.id) and (v.id=p.id or (v.reports and iwish.crm_person_in_scope(v.id,p)))
    and (p.id=v.id or iwish.has_permission(p.id,'lead_notes.create'))
    and (p_profile is null or p_profile=p.id)
    and (p_team is null or p.team_id=p_team or exists(select 1 from public.profile_team_memberships m where m.profile_id=p.id and m.team_id=p_team))
), visit_events as materialized (
  select distinct on (v.lead_id,v.visited_on,p.profile_id)
    v.lead_id,v.visited_on,p.profile_id,p.profile_id=v.owner_id as own,
    v.data->>'method' as method,v.data->>'type' as visit_type,v.id
  from iwish.crm_visits v join iwish.crm_visit_participants p on p.visit_id=v.id
  join people s on s.id=p.profile_id join public.leads l on l.id=v.lead_id and not coalesce(l.is_deleted,false)
  join viewer r on p.profile_id=r.id or iwish.in_scope_for_lead(r.id,l,'leads.read')
  where v.invalidated_at is null and v.visited_on>=p_start and v.visited_on<p_end
  order by v.lead_id,v.visited_on,p.profile_id,(p.profile_id=v.owner_id) desc nulls last,v.created_at,v.id
), team_visits as materialized (
  select lead_id,visited_on from visit_events group by lead_id,visited_on
), personal as (
  select p.id,p.name,p.team_id,p.team, count(e.id) as total,
    count(e.id) filter(where e.own) as own, count(e.id) filter(where e.own is not true) as accompanied,
    count(e.id) filter(where e.visit_type='first') as first,
    count(e.id) filter(where e.visit_type like 'repeat_%') as repeat,
    count(e.id) filter(where e.visit_type='expansion') as expansion,
    case p_period when 'month' then g.monthly when 'quarter' then g.quarterly when 'year' then g.yearly end as goal,
    g.weekly_reference
  from people p left join visit_events e on e.profile_id=p.id
  left join lateral (select * from iwish.crm_visit_goals x where x.profile_id=p.id
    and x.effective_on<=least(p_end-1,iwish.crm_today()) order by x.effective_on desc limit 1) g on true
  group by p.id,p.name,p.team_id,p.team,g.monthly,g.quarterly,g.yearly,g.weekly_reference
)
select coalesce((
  select jsonb_build_object(
    'asOf',v.as_of,'canExport',v.export,'canCompare',v.reports,
    'people',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from personal p),'[]'),
    'teamVisits',(select count(*) from team_visits)
  ) from viewer v
),'{}'::jsonb);
$$;
create function public.rpc_crm_visit_details(
  p_start date,p_end date,p_profile uuid default null,p_team integer default null,
  p_method text default null,p_type text default null,p_offset integer default 0
) returns jsonb language sql stable security definer set search_path = '' as $$
with scoped as (
  select distinct on (v.lead_id,v.visited_on,p.profile_id) v.id,v.lead_id,l.name as customer,v.visited_on,
    p.profile_id,x.full_name as seller,p.profile_id=v.owner_id as own,
    v.data->>'method' as method,v.data->>'type' as visit_type,
    iwish.crm_visit_access(l.id,false) as can_open
  from iwish.crm_visits v join iwish.crm_visit_participants p on p.visit_id=v.id
  join public.leads l on l.id=v.lead_id join public.profiles x on x.id=p.profile_id
  where iwish.is_active_user(auth.uid()) and not coalesce(l.is_deleted,false) and v.invalidated_at is null
    and v.visited_on>=p_start and v.visited_on<p_end
    and (p_profile is null or p.profile_id=p_profile)
    and (p_team is null or x.team_id=p_team or exists(select 1 from public.profile_team_memberships m where m.profile_id=x.id and m.team_id=p_team))
    and (p.profile_id=auth.uid() or (iwish.has_permission(auth.uid(),'reports.read') and iwish.crm_person_in_scope(auth.uid(),x)
      and iwish.in_scope_for_lead(auth.uid(),l,'leads.read')))
    and (p_method is null or v.data->>'method'=p_method) and (p_type is null or v.data->>'type'=p_type)
  order by v.lead_id,v.visited_on,p.profile_id,(p.profile_id=v.owner_id) desc nulls last,v.created_at,v.id
), display_rows as (
  select lead_id as sort_id,case when can_open then lead_id end as lead_id,customer,visited_on,seller,own,method,visit_type
  from scoped where p_profile is not null
  union all
  select lead_id,case when bool_or(can_open) then lead_id end,max(customer),visited_on,string_agg(distinct seller,'、' order by seller),
    case when count(*)=1 then bool_or(own) end,
    string_agg(distinct method,',' order by method),string_agg(distinct visit_type,',' order by visit_type)
  from scoped where p_profile is null group by lead_id,visited_on
), page as (
  select * from display_rows order by visited_on desc,sort_id offset greatest(p_offset,0) limit 200
)
select coalesce(jsonb_agg(to_jsonb(page)-'sort_id' order by visited_on desc,sort_id),'[]') from page;
$$;

create function public.rpc_crm_can_confirm_finance(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select iwish.can_confirm_deal_contract_finance(p_lead_id);
$$;


revoke all on function iwish.crm_person_in_scope(uuid,public.profiles), iwish.crm_signed_on(text)
  from public, anon, authenticated;
revoke all on function public.rpc_crm_sales_settings(),
  public.rpc_crm_save_visit_goal(uuid,date,integer,integer,integer,text),
  public.rpc_crm_dashboard_visit_events(date,date), public.rpc_crm_dashboard_next_actions(),
  public.rpc_crm_visit_goal_report(date,date,text,integer,uuid), public.rpc_crm_visit_details(date,date,uuid,integer,text,text,integer),
  public.rpc_crm_can_confirm_finance(uuid) from public, anon, authenticated;
grant execute on function public.rpc_crm_sales_settings(),
  public.rpc_crm_save_visit_goal(uuid,date,integer,integer,integer,text),
  public.rpc_crm_dashboard_visit_events(date,date), public.rpc_crm_dashboard_next_actions(),
  public.rpc_crm_visit_goal_report(date,date,text,integer,uuid), public.rpc_crm_visit_details(date,date,uuid,integer,text,text,integer),
  public.rpc_crm_can_confirm_finance(uuid) to authenticated;


-- Route existing dashboard panels to the new records without changing their RPC contract.
-- Keep dashboard reads under the caller's existing view grants and RLS policies.
-- The overview returns aggregates only. Details use the same scope and date rules.
create or replace function public.rpc_sales_dashboard(
  p_part text,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_trend_start timestamptz,
  p_timezone text,
  p_scope text default null,
  p_department_id integer default null,
  p_unassigned boolean default false,
  p_todo_only boolean default false,
  p_limit integer default 20,
  p_after jsonb default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with settings as materialized (
  select key, value from public.settings
  where key in ('analytics.excluded_teams', 'analytics.excluded_profiles', 'gm_dashboard.excluded_teams')
),
excluded_teams as (
  select element as id
  from settings
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(value->'team_ids') = 'array' then value->'team_ids' else '[]'::jsonb end
  ) as items(element)
  where key in ('analytics.excluded_teams', 'gm_dashboard.excluded_teams')
),
excluded_profiles as (
  select element as id
  from settings
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(value->'profile_ids') = 'array' then value->'profile_ids' else '[]'::jsonb end
  ) as items(element)
  where key = 'analytics.excluded_profiles'
),
rules as materialized (
  select public.rpc_get_pipeline_business_rules() as value
),
-- The requested dashboard mode can only narrow the data allowed by RLS.
scope_filter as materialized (
  select case when p_scope = 'self' then auth.uid() end as owner_id,
    case when p_scope = 'team' then (
      select p.team_id from public.profiles_public_view p where p.id = auth.uid()
    ) end as team_id
),
scope_leads as materialized (
  select l.id, l.team_id, coalesce(l.owner_id, l.created_by) as owner_key,
    l.name, l.customer_name, l.customer_grade, l.status,
    l.created_at, l.updated_at, greatest(l.last_contact_at,actions.last_visit_at) as last_contact_at, actions.next_contact_at,
    coalesce(greatest(l.last_contact_at,actions.last_visit_at), l.created_at, '-infinity'::timestamptz) as sort_at,
    case when l.follow_up_stage = 'online_communication' then 'offline_visit' else coalesce(l.follow_up_stage,l.stage) end as display_stage,
    case when l.follow_up_stage = 'online_communication' then 'offline_visit' else coalesce(nullif(btrim(l.follow_up_stage), ''), 'uncontacted') end as stage_key,
    coalesce(l.customer_attribute, '') = 'invalid' as invalid,
    coalesce(
      btrim(l.stage) = 'Won' or (l.status = 'closed' and btrim(l.close_result) in ('won', '成交')), false
    ) as won,
    coalesce(nullif(btrim(l.follow_up_stage), ''), btrim(l.stage), '') not in ('', 'uncontacted', 'L1')
      or coalesce(upper(btrim(l.customer_grade)), '') in ('S', 'A', 'B') as qualified_stage,
    coalesce(l.created_at >= p_range_start and l.created_at < p_range_end, false) as new_in_range,
    coalesce(actions.next_contact_at >= p_range_start and actions.next_contact_at < p_range_end, false) as due_in_range
  from public.leads_secure_view l cross join scope_filter f
  left join public.rpc_crm_dashboard_next_actions() actions on actions.lead_id=l.id
  where (select auth.uid()) is not null and l.status <> 'pool'
    and (f.team_id is null or l.team_id = f.team_id)
    and (f.owner_id is null or l.owner_id = f.owner_id)
    and not exists (select 1 from excluded_teams e where e.id = to_jsonb(l.team_id))
    and not exists (select 1 from excluded_profiles e where e.id = to_jsonb(l.owner_id))
),
leads as materialized (
  select l.*, not l.invalid and l.qualified_stage as qualified,
    l.status = 'open' and not l.invalid and l.stage_key not in ('won', 'payment_received') as active,
    l.status = 'open' and coalesce(l.next_contact_at < now(),
      l.sort_at <= now() - make_interval(hours => coalesce((r.value->>'danger_hours')::integer, 168))
    ) as overdue
  from scope_leads l cross join rules r
),
notes as materialized (
  select n.lead_id, n.author_id, n.created_at, btrim(n.note_type) as note_type,
    n.created_at >= p_range_start and n.created_at < p_range_end as in_range
  from public.lead_notes n
  join scope_leads l on l.id = n.lead_id
  where not coalesce(n.is_deleted, false) and n.note_type <> 'visit'
    and n.created_at >= case when p_part = 'overview' then least(p_range_start, p_trend_start) else p_range_start end
    and n.created_at < p_range_end
  union all
  select v.lead_id,v.author_id,v.visited_on::timestamp at time zone 'Asia/Shanghai','visit',
    v.visited_on >= (p_range_start at time zone 'Asia/Shanghai')::date
  from public.rpc_crm_dashboard_visit_events(
    ((case when p_part='overview' then least(p_range_start,p_trend_start) else p_range_start end) at time zone 'Asia/Shanghai')::date,
    (p_range_end at time zone 'Asia/Shanghai')::date
  ) v join scope_leads l on l.id=v.lead_id
),
profiles as materialized (
  select p.id, coalesce(nullif(p.full_name, ''), left(p.id::text, 8)) as name, p.avatar_url, p.team_id
  from public.profiles_public_view p cross join scope_filter f
  where (select auth.uid()) is not null and p.status = 'active'
    and (f.team_id is null or p.team_id = f.team_id)
    and (f.owner_id is null or p.id = f.owner_id)
    and not exists (select 1 from excluded_teams e where e.id = to_jsonb(p.team_id))
    and not exists (select 1 from excluded_profiles e where e.id = to_jsonb(p.id))
),
lead_rollup as (
  select grouping(owner_key) as by_team, owner_key, team_id,
    count(*) filter (where active) as active,
    count(*) filter (where new_in_range) as new_leads,
    count(*) filter (where won) as won,
    count(*) filter (where qualified) as qualified,
    count(*) filter (where active and overdue) as overdue,
    count(*) filter (where stage_key = 'payment_received') as payment_received
  from leads group by grouping sets ((owner_key), (team_id))
),
stage_rollup as (
  select grouping(owner_key) as omit_owner, grouping(team_id) as omit_team,
    owner_key, team_id, stage_key, count(*) as total
  from leads where new_in_range and not invalid
  group by grouping sets ((stage_key), (owner_key, stage_key), (team_id, stage_key))
),
stages as (
  select omit_owner, omit_team, owner_key, team_id, jsonb_object_agg(stage_key, total) as counts
  from stage_rollup group by omit_owner, omit_team, owner_key, team_id
),
author_rollup as (
  select author_id, count(*) as follow_ups,
    count(*) filter (where note_type in ('call', 'wechat')) as contacts,
    count(*) filter (where note_type = 'visit') as visits
  from notes where in_range group by author_id
),
members as materialized (
  select p.id, p.name, p.avatar_url as "avatarUrl", p.team_id as "teamId",
    coalesce(l.active, 0) as "activeLeads", coalesce(l.new_leads, 0) as "newLeads",
    coalesce(l.won, 0) as "wonLeads", coalesce(l.qualified, 0) as "qualifiedLeads",
    coalesce(l.overdue, 0) as "overdueLeads", coalesce(s.counts, '{}'::jsonb) as "stageCounts",
    coalesce(a.contacts, 0) as "contactActions", coalesce(a.visits, 0) as visits,
    coalesce(a.follow_ups, 0) as "followUps",
    coalesce(l.new_leads, 0) + coalesce(a.contacts, 0) + coalesce(a.visits, 0) as "actionScore"
  from profiles p
  left join lead_rollup l on l.by_team = 0 and l.owner_key = p.id
  left join stages s on s.omit_owner = 0 and s.owner_key = p.id
  left join author_rollup a on a.author_id = p.id
),
team_ids as (
  select t.id
  from public.teams t
  where t.is_active and not exists (select 1 from excluded_teams e where e.id = to_jsonb(t.id))
  union
  select l.team_id from scope_leads l where l.team_id is not null
),
team_members as (
  select "teamId", count(*) as member_count, sum("contactActions") as contacts,
    (select count(distinct (n.lead_id,n.created_at)) from notes n
     join members m on m.id=n.author_id where n.note_type='visit' and n.in_range and m."teamId"=a."teamId") as visits,
    sum("followUps") as follow_ups, sum("overdueLeads") as overdue
  from members a group by "teamId"
),
teams as (
  select i.id as "teamId",
    coalesce(case when t.is_active then t.name end, '团队 ' || i.id) as "teamName",
    coalesce(m.member_count, 0) as "memberCount", coalesce(l.active, 0) as "activeLeads",
    coalesce(l.new_leads, 0) as "newLeads", coalesce(m.contacts, 0) as "contactActions",
    coalesce(m.visits, 0) as visits, coalesce(m.follow_ups, 0) as "followUps",
    coalesce(l.won, 0) as "wonLeads", coalesce(l.payment_received, 0) as "paymentReceived",
    coalesce(m.overdue, 0) as "overdueLeads", coalesce(s.counts, '{}'::jsonb) as "stageCounts",
    coalesce(l.active, 0)::numeric / (coalesce((r.value->>'quota_limit')::integer, 60) * greatest(m.member_count, 1)) as "quotaUsage"
  from team_ids i
  cross join rules r
  left join public.teams t on t.id = i.id
  left join team_members m on m."teamId" = i.id
  left join lead_rollup l on l.by_team = 1 and l.team_id = i.id
  left join stages s on s.omit_team = 0 and s.team_id = i.id
),
trend_day_leads as (
  select (created_at at time zone p_timezone)::date as day, count(*) as total
  from scope_leads where created_at >= p_trend_start and created_at < p_range_end
  group by 1
),
trend_day_notes as (
  select (created_at at time zone p_timezone)::date as day,
    count(*) filter (where note_type in ('call', 'wechat')) as contacts,
    count(distinct (lead_id,created_at)) filter (where note_type = 'visit') as visits,
    count(*) filter (where note_type = 'won') as won
  from notes where created_at >= p_trend_start group by 1
),
trend as (
  select days.day, to_char(days.day, 'MM-DD') as date, coalesce(l.total, 0) as "newLeads",
    coalesce(n.contacts, 0) as "contactActions", coalesce(n.visits, 0) as visits, coalesce(n.won, 0) as won
  from generate_series(0, 6) as day_index(i)
  cross join lateral (select (p_trend_start at time zone p_timezone)::date + day_index.i as day) days
  left join trend_day_leads l on l.day = days.day
  left join trend_day_notes n on n.day = days.day
),
page_members as (
  select m.*, (p_department_id is not null and m."teamId" is distinct from p_department_id) as "isAdditional"
  from members m
  where (
    (p_department_id is null and not p_unassigned)
    or m."teamId" = p_department_id
    or (p_department_id is not null and exists (
      select 1 from public.profile_team_memberships pm
      where pm.profile_id = m.id and pm.team_id = p_department_id
    ))
    or (p_unassigned and not exists (
      select 1 from team_ids i where i.id = m."teamId" or exists (
        select 1 from public.profile_team_memberships pm where pm.profile_id = m.id and pm.team_id = i.id
      )
    ))
  )
    and (p_department_id is null or exists (select 1 from team_ids i where i.id = p_department_id))
    and (p_after is null or (m."overdueLeads", m."actionScore", m.id) <
      ((p_after->>'overdue')::bigint, (p_after->>'score')::bigint, (p_after->>'id')::uuid))
  order by m."overdueLeads" desc, m."actionScore" desc, m.id desc
  limit least(50, greatest(1, coalesce(p_limit, 20))) + 1
),
customer_notes as (
  select lead_id, count(*) as follow_ups,
    count(*) filter (where note_type in ('call', 'wechat')) as contacts,
    count(distinct created_at) filter (where note_type = 'visit') as visits
  from notes where in_range group by lead_id
),
page_customers as (
  select l.id, coalesce(nullif(l.name, ''), '未命名线索') as "companyName",
    coalesce(nullif(l.customer_name, ''), '-') as "contactName", l.owner_key as "ownerId",
    coalesce(p.name, left(l.owner_key::text, 8), '未分配') as "ownerName",
    l.display_stage as stage, l.status, l.customer_grade as grade, l.created_at as "createdAt",
    l.last_contact_at as "lastContactAt", l.next_contact_at as "nextContactAt",
    coalesce(n.contacts, 0) as "contactActions", coalesce(n.visits, 0) as visits,
    coalesce(n.follow_ups, 0) as "followUps", l.qualified as "isQualified", l.won as "isWon",
    l.overdue as "isOverdue", l.sort_at as "sortAt"
  from leads l
  left join profiles p on p.id = l.owner_key
  left join customer_notes n on n.lead_id = l.id
  where (l.new_in_range or l.due_in_range or n.lead_id is not null)
    and (not p_todo_only or l.overdue or l.next_contact_at < p_range_end)
    and (p_after is null or (l.overdue, l.sort_at, l.id) <
      ((p_after->>'overdue')::boolean, (p_after->>'sortAt')::timestamptz, (p_after->>'id')::uuid))
  order by l.overdue desc, l.sort_at desc, l.id desc
  limit least(50, greatest(1, coalesce(p_limit, 20))) + 1
)
select case p_part
  when 'overview' then jsonb_build_object(
    'quotaLimit', 60,
    'stageCounts', coalesce((select counts from stages where omit_owner = 1 and omit_team = 1), '{}'::jsonb),
    'trends', (select jsonb_agg(to_jsonb(t) - 'day' order by t.day) from trend t),
    'teams', coalesce((select jsonb_agg(t order by t."wonLeads" desc, t."activeLeads" desc, t."teamId") from teams t), '[]'::jsonb),
    'totals', (select jsonb_build_object(
      'newLeads', count(*) filter (where new_in_range),
      'qualifiedLeads', count(*) filter (where qualified), 'wonLeads', count(*) filter (where won),
      'wonInRange', (select count(*) from notes where in_range and note_type = 'won'),
      'overdueLeads', count(*) filter (where active and overdue),
      'pendingToday', count(*) filter (where active and due_in_range),
      'newlyAssigned', count(*) filter (where updated_at >= p_range_start and updated_at < p_range_end),
      'contactActions', (select coalesce(sum("contactActions"), 0) from members),
      'visits', (select count(distinct (lead_id,created_at)) from notes where in_range and note_type='visit'),
      'followUps', (select coalesce(sum("followUps"), 0) from members)
    ) from leads),
    'alerts', jsonb_build_object(
      'noNew', (select count(*) from members where "newLeads" = 0),
      'noContact', (select count(*) from members where "contactActions" = 0),
      'noVisits', (select count(*) from members where visits = 0),
      'noNewNames', array(select name from members where "newLeads" = 0 order by "overdueLeads" desc, "actionScore" desc, id desc limit 4),
      'noContactNames', array(select name from members where "contactActions" = 0 order by "overdueLeads" desc, "actionScore" desc, id desc limit 4),
      'highOverdue', coalesce((select jsonb_agg(m order by m."overdueLeads" desc, m."actionScore" desc, m.id desc) from (
        select id, name, "overdueLeads", "actionScore" from members where "overdueLeads" > 0
        order by "overdueLeads" desc, "actionScore" desc, id desc limit 3
      ) m), '[]'::jsonb)
    )
  )
  when 'members' then coalesce((select jsonb_agg(m order by m."overdueLeads" desc, m."actionScore" desc, m.id desc) from page_members m), '[]'::jsonb)
  when 'customers' then coalesce((select jsonb_agg(c order by c."isOverdue" desc, c."sortAt" desc, c.id desc) from page_customers c), '[]'::jsonb)
end
$$;

revoke execute on function public.rpc_sales_dashboard(text, timestamptz, timestamptz, timestamptz, text, text, integer, boolean, boolean, integer, jsonb) from public, anon;
grant execute on function public.rpc_sales_dashboard(text, timestamptz, timestamptz, timestamptz, text, text, integer, boolean, boolean, integer, jsonb) to authenticated;


alter table public.lead_notes
  add column crm_connection_confirmed boolean;

create function public.rpc_crm_record_contact(
  p_lead_id uuid,
  p_note_id uuid,
  p_channel text,
  p_content text,
  p_connection_confirmed boolean default null,
  p_substantive_kind text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_note public.lead_notes;
  v_content text := btrim(p_content);
begin
  if v_actor is null or not iwish.is_active_user(v_actor)
    or not iwish.has_permission(v_actor, 'lead_notes.create')
    or not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:lead_notes.create';
  end if;

  select * into v_lead from public.leads l
  where l.id = p_lead_id and l.status = 'open' and not coalesce(l.is_deleted, false)
    and iwish.in_scope_for_lead(v_actor, l, 'leads.update')
  for update;
  if not found then raise exception 'ERR_NO_PERMISSION:leads.update'; end if;

  if p_note_id is null or coalesce(p_channel, '') not in ('call', 'wechat')
    or nullif(v_content, '') is null
    or (p_connection_confirmed is not null and p_substantive_kind is not null) then
    raise exception 'ERR_CRM_CONTACT_FIELDS';
  end if;

  insert into public.lead_notes
    (id, lead_id, author_id, note_type, content, crm_connection_confirmed, crm_substantive_kind)
  values (p_note_id, p_lead_id, v_actor, p_channel, v_content, p_connection_confirmed, p_substantive_kind)
  on conflict (id) do nothing;
  if not found then
    select * into v_note from public.lead_notes where id = p_note_id;
    if v_note.lead_id = p_lead_id and v_note.author_id = v_actor
      and v_note.note_type = p_channel and v_note.content = v_content
      and v_note.crm_connection_confirmed is not distinct from p_connection_confirmed
      and v_note.crm_substantive_kind is not distinct from p_substantive_kind
      and not v_note.is_deleted then return; end if;
    raise exception 'ERR_CRM_CONFLICT';
  end if;

  if p_connection_confirmed and v_lead.follow_up_stage = 'uncontacted' then
    perform iwish.rpc_lead_pipeline_update(p_lead_id, null, 'connected', '确认双向建联');
  elsif p_connection_confirmed and v_lead.follow_up_stage = 'offline_visit'
    and v_lead.crm_visit_previous_stage = 'uncontacted' then
    update public.leads set crm_visit_previous_stage = 'connected' where id = p_lead_id;
  end if;

  update public.leads set last_contact_at = greatest(last_contact_at, now()) where id = p_lead_id;
end;
$$;

create function public.rpc_crm_lead_stage_events(p_lead_id uuid)
returns table (
  id uuid, previous_stage text, next_stage text, reason text,
  created_at timestamptz, actor_name text, note_id uuid, visit_id uuid
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.before->>'follow_up_stage', a.after->>'follow_up_stage', a.reason,
    a.created_at, coalesce(p.full_name, '系统'), n.id, v.id
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  left join lateral (
    select note.id from public.lead_notes note
    where note.lead_id = p_lead_id and note.created_at = a.created_at and note.author_id = a.actor_id
      and not note.is_deleted and (
        (note.note_type in ('stage_change', 'won') and note.content = a.reason)
        or (a.reason = '确认双向建联' and note.crm_connection_confirmed is true)
      )
    order by note.id limit 1
  ) n on true
  left join lateral (
    select visit.id from iwish.crm_visits visit
    where a.reason = '提交有效拜访' and visit.lead_id = p_lead_id
      and visit.created_at = a.created_at and visit.submitted_by = a.actor_id
    order by visit.id limit 1
  ) v on true
  where (select iwish.crm_visit_access(p_lead_id, false))
    and a.target_type = 'lead' and a.target_id = p_lead_id::text
    and a.before->>'follow_up_stage' is distinct from a.after->>'follow_up_stage'
    and nullif(a.before->>'follow_up_stage', '') is not null
    and nullif(a.after->>'follow_up_stage', '') is not null
  order by a.created_at desc, a.id;
$$;

-- The original manual action remains for the three sales-confirmed milestones.
create or replace function iwish.rpc_lead_advance_with_action(
  p_lead_id uuid, p_next_stage text, p_content text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
begin
  if v_actor is null or not iwish.is_active_user(v_actor)
    or not iwish.has_permission(v_actor, 'lead_notes.create')
    or not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:leads.update';
  end if;

  select * into v_lead from public.leads l
  where l.id = p_lead_id and l.status = 'open' and not coalesce(l.is_deleted, false)
    and iwish.in_scope_for_lead(v_actor, l, 'leads.update')
  for update;
  if not found then raise exception 'ERR_NO_PERMISSION:leads.update'; end if;

  if p_next_stage is null or p_next_stage is distinct from (case v_lead.follow_up_stage
    when 'offline_visit' then 'proposal_quotation'
    when 'online_communication' then 'proposal_quotation'
    when 'proposal_quotation' then 'intent_confirmed'
    when 'intent_confirmed' then 'contract_review'
    else null end) then
    raise exception 'ERR_CRM_STAGE_ACTION_REQUIRED';
  end if;
  if nullif(btrim(p_content), '') is null then
    raise exception 'ERR_VALIDATION:stage_action_content_required';
  end if;

  perform iwish.rpc_lead_pipeline_update(p_lead_id, null, p_next_stage, btrim(p_content));
  insert into public.lead_notes(lead_id, author_id, content, note_type)
  values (p_lead_id, v_actor, btrim(p_content), 'stage_change');
end;
$$;

revoke all on function public.rpc_crm_record_contact(uuid, uuid, text, text, boolean, text),
  public.rpc_crm_lead_stage_events(uuid) from public, anon;
grant execute on function public.rpc_crm_record_contact(uuid, uuid, text, text, boolean, text),
  public.rpc_crm_lead_stage_events(uuid) to authenticated;


create or replace function iwish.can_access_deal_contract_submission(p_lead_id uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select iwish.is_active_user(auth.uid()) and iwish.has_permission(auth.uid(), 'contracts.read')
    and iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive')
    and exists (
      select 1 from public.leads l
      where l.id = p_lead_id and not coalesce(l.is_deleted, false)
        and (
          (l.status = 'closed' and l.close_result in ('won', '成交'))
          or (l.status = 'open' and l.follow_up_stage = 'contract_review'
            and (not p_write or (
              iwish.has_permission(auth.uid(), 'lead_notes.create')
              and iwish.in_scope_for_lead(auth.uid(), l, 'leads.close')
              and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
            )))
        )
        and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
        and (not p_write or l.owner_id = auth.uid()
          or (iwish.has_permission(auth.uid(), 'contracts.manage')
            and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')))
    );
$$;

create function iwish.crm_has_signed_contract(p_lead_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.deal_contract_submissions s
    where s.lead_id = p_lead_id and s.submitted_at is not null
      and coalesce(nullif(btrim(s.finance->>'contractNumber'), ''), nullif(btrim(s.submitted->>'contractNumber'), '')) is not null
      and coalesce(iwish.crm_signed_on(s.finance->>'signedOn'), iwish.crm_signed_on(s.submitted->>'signedOn')) <= iwish.crm_today()
  ) or exists (
    select 1 from public.contracts c
    where c.lead_id = p_lead_id and c.status in ('active', 'closed')
      and nullif(btrim(c.contract_number), '') is not null
      and (c.signed_at at time zone 'Asia/Shanghai')::date <= iwish.crm_today()
  );
$$;

create function iwish.crm_require_signed_contract() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_signed_stage boolean := new.follow_up_stage in ('won', 'payment_received');
  v_first_signed_close boolean := new.status = 'closed' and new.close_result in ('won', '成交')
    and not (new.parent_lead_id is not null and new.follow_up_stage = 'contract_review');
begin
  -- Legacy rows may still await backfill. Apply the guard on new transitions.
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then
    v_signed_stage := v_signed_stage and new.follow_up_stage is distinct from old.follow_up_stage;
    v_first_signed_close := v_first_signed_close
      and (old.status is distinct from 'closed' or coalesce(old.close_result, '') not in ('won', '成交'));
  end if;
  if (v_signed_stage or v_first_signed_close) and not iwish.crm_has_signed_contract(new.id) then
    raise exception 'ERR_CRM_SIGNED_CONTRACT_REQUIRED';
  end if;
  if v_first_signed_close and new.follow_up_stage not in ('won', 'payment_received') then
    new.follow_up_stage := 'won';
  end if;
  return new;
end;
$$;

create trigger crm_require_signed_contract
before insert or update of follow_up_stage, status, close_result on public.leads
for each row execute function iwish.crm_require_signed_contract();

create function iwish.crm_confirm_contract_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_reason text;
begin
  if auth.uid() is null or new.submitted_at is null then return null; end if;
  if tg_op = 'UPDATE' and old.submitted_at is not distinct from new.submitted_at
    and old.submitted is not distinct from new.submitted then return null; end if;

  select * into v_lead from public.leads where id = new.lead_id for update;
  if v_lead.follow_up_stage is distinct from 'contract_review' then return null; end if;
  -- Apply this check to the just-confirmed submission, even if another valid
  -- legacy contract is already attached to the lead.
  if nullif(btrim(new.submitted->>'contractNumber'), '') is null
    or iwish.crm_signed_on(new.submitted->>'signedOn') is null
    or iwish.crm_signed_on(new.submitted->>'signedOn') > iwish.crm_today() then
    raise exception 'ERR_CRM_CONTRACT_SIGNED_DATE';
  end if;
  v_reason := '确认合同资料 · ' || btrim(new.submitted->>'contractNumber');
  if v_lead.status = 'open' then
    perform iwish.rpc_lead_close_with_action(v_lead.id, 'won', v_reason);
  elsif v_lead.status = 'closed' and v_lead.parent_lead_id is not null and v_lead.close_result in ('won', '成交') then
    update public.leads set follow_up_stage = 'won', stage = 'Won' where id = v_lead.id;
    perform iwish.audit(auth.uid(), 'update_lead_pipeline', 'lead', v_lead.id::text, to_jsonb(v_lead),
      (select to_jsonb(l) from public.leads l where l.id = v_lead.id), v_reason);
    insert into public.lead_notes(lead_id, author_id, content, note_type)
    values (v_lead.id, auth.uid(), v_reason, 'won');
  end if;
  return null;
end;
$$;

create trigger crm_confirm_contract_stage
after insert or update of submitted_at, submitted on public.deal_contract_submissions
for each row execute function iwish.crm_confirm_contract_stage();

revoke all on function iwish.crm_has_signed_contract(uuid), iwish.crm_require_signed_contract(),
  iwish.crm_confirm_contract_stage() from public, anon, authenticated;

-- An add-on draft stays attached to the signed customer without reserving another lead slot.
create or replace function public.rpc_deal_addon_create(p_parent_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.leads;
  v_root public.leads;
  v_seq integer;
  v_id uuid;
  v_prefill jsonb;
begin
  if not iwish.can_access_deal_contract_submission(p_parent_id, true) then
    raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:deal_addon';
  end if;
  select * into v_parent from public.leads where id = p_parent_id;
  select * into v_root from public.leads where id = coalesce(v_parent.parent_lead_id, v_parent.id) for update;
  if v_root.id is null or coalesce(v_root.is_deleted, false) or v_root.status <> 'closed' or v_root.close_result not in ('won', '成交') then
    raise exception 'ERR_VALIDATION:deal_addon_parent';
  end if;
  select count(*) + 1 into v_seq from public.leads where parent_lead_id = v_root.id;

  insert into public.leads (
    team_id, owner_id, created_by, name, source, stage, status, close_result, close_reason,
    customer_name, customer_phone, customer_email, address, wechat, customer_grade,
    source_level1, source_level2, responsibility_type, website, product_category,
    customer_attribute, follow_up_stage, allocation_status, parent_lead_id
  ) values (
    v_root.team_id, v_root.owner_id, auth.uid(), v_root.name || ' · 追加合同 ' || v_seq, v_root.source, 'Won', 'closed', 'won',
    '追加合同（首签：' || v_root.name || '）',
    v_root.customer_name, v_root.customer_phone, v_root.customer_email, v_root.address, v_root.wechat, v_root.customer_grade,
    v_root.source_level1, v_root.source_level2, v_root.responsibility_type, v_root.website, v_root.product_category,
    v_root.customer_attribute, 'contract_review', 'pending', v_root.id
  ) returning id into v_id;

  -- 预填首签合同的公司、联系人、网址、品类、销售、客户简称；合同号、服务、金额、日期、附件不带。
  select jsonb_strip_nulls(jsonb_build_object(
    'mainlandCompanyName', s.data->'mainlandCompanyName', 'hongKongCompanyName', s.data->'hongKongCompanyName',
    'companyName', s.data->'companyName', 'shortName', s.data->'shortName', 'salesperson', s.data->'salesperson',
    'website', s.data->'website', 'category', s.data->'category', 'contactName', s.data->'contactName',
    'contactTitle', s.data->'contactTitle', 'phone', s.data->'phone', 'email', s.data->'email',
    'address', s.data->'address', 'currency', s.data->'currency'))
  into v_prefill
  from (select coalesce(submitted, draft) as data from public.deal_contract_submissions where lead_id = v_root.id) s;
  insert into public.deal_contract_submissions (lead_id, draft) values (v_id, coalesce(v_prefill, '{}'::jsonb));

  perform iwish.audit(auth.uid(), 'deal_addon_create', 'lead', v_id::text,
    jsonb_build_object('parent_lead_id', v_root.id), jsonb_build_object('name', v_root.name || ' · 追加合同 ' || v_seq), null);
  return v_id;
end;
$$;
revoke all on function public.rpc_deal_addon_create(uuid) from public, anon;
grant execute on function public.rpc_deal_addon_create(uuid) to authenticated;


create or replace function public.rpc_deal_contract_submission_confirm_finance(p_lead_id uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
begin
  perform 1 from public.leads where id = p_lead_id for update;
  if not iwish.can_confirm_deal_contract_finance(p_lead_id)
  then raise exception using errcode = '42501', message = 'ERR_NO_PERMISSION:contracts.finance.confirm'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' or p_values = '{}'::jsonb or octet_length(p_values::text) > 16000
    then raise exception 'ERR_VALIDATION:deal_contract_finance'; end if;
  for v_key, v_value in select key, value from jsonb_each(p_values) loop
    if v_key not in ('contractNumber','signedOn','legalName','baseFee','currency','actualPayment','receivedOn','receivedAmount')
      or jsonb_typeof(v_value) <> 'string' or nullif(btrim(v_value #>> '{}'), '') is null
    then raise exception 'ERR_VALIDATION:deal_contract_finance'; end if;
    if v_key in ('baseFee','receivedAmount') and (v_value #>> '{}') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
      then raise exception 'ERR_VALIDATION:deal_contract_amount'; end if;
    if v_key in ('signedOn','receivedOn') then
      if (v_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'ERR_VALIDATION:deal_contract_date'; end if;
      perform (v_value #>> '{}')::date;
    end if;
    if v_key = 'currency' and (v_value #>> '{}') !~ '^[A-Z]{3}$'
      then raise exception 'ERR_VALIDATION:deal_contract_currency'; end if;
  end loop;
  if (p_values ? 'receivedOn') <> (p_values ? 'receivedAmount')
    then raise exception 'ERR_VALIDATION:deal_contract_receipt'; end if;
  if p_values ? 'receivedOn' then
    p_values := p_values || jsonb_build_object('actualPayment', p_values->>'receivedOn');
  end if;
  if p_values ? 'receivedOn' and (
    (p_values->>'receivedAmount')::numeric <= 0
    or (p_values->>'receivedOn')::date > iwish.crm_today()
  ) then raise exception using errcode='22023',message='ERR_VALIDATION:deal_contract_receipt'; end if;
  update public.deal_contract_submissions
  set finance = finance || p_values, finance_confirmed_at = now(), version = version + 1
  where lead_id = p_lead_id and submitted_at is not null;
  if not found then raise exception 'ERR_STATE:deal_contract_not_submitted'; end if;
end;
$$;
