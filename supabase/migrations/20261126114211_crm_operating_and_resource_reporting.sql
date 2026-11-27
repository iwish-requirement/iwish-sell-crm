-- Sales operating reports use the established account and team exclusions.

-- Both the lead list and dashboard read the latest effective action for the current owner.
create function public.rpc_crm_dashboard_next_actions(p_lead_ids uuid[])
returns table(lead_id uuid,next_contact_at timestamptz,last_visit_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select distinct on(v.lead_id) v.lead_id,(v.data->>'nextContactOn')::date::timestamp at time zone 'Asia/Shanghai',
    case when (v.created_at at time zone 'Asia/Shanghai')::date=v.visited_on then v.created_at
      else v.visited_on::timestamp at time zone 'Asia/Shanghai' end
  from iwish.crm_visits v join public.leads l on l.id=v.lead_id
  where (p_lead_ids is null or v.lead_id=any(p_lead_ids))
    and iwish.is_active_user(auth.uid()) and v.invalidated_at is null and l.status='open'
    and not coalesce(l.is_deleted,false) and l.customer_attribute is distinct from 'invalid'
    and l.follow_up_stage not in ('won','payment_received') and v.owner_id=l.owner_id
    and v.created_at>=coalesce(l.ownership_started_at,l.created_at)
    and v.visited_on>=(coalesce(l.ownership_started_at,l.created_at) at time zone 'Asia/Shanghai')::date
    and iwish.crm_visit_access(l.id,false)
  order by v.lead_id,v.visited_on desc,v.created_at desc,v.id;
$$;

create or replace function public.rpc_crm_dashboard_next_actions()
returns table(lead_id uuid,next_contact_at timestamptz,last_visit_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from public.rpc_crm_dashboard_next_actions(null::uuid[]);
$$;

revoke all on function public.rpc_crm_dashboard_next_actions(uuid[]) from public,anon,authenticated;
grant execute on function public.rpc_crm_dashboard_next_actions(uuid[]) to authenticated;

create or replace function iwish.rpc_leads_export_request(p_source text,p_format text,p_filters jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_job public.lead_export_jobs;
begin
  if p_format='xlsx' and p_source in (
    'analytics_source-volume','analytics_source-conversion','analytics_source-roi',
    'analytics_product-type','analytics_team-leaderboard'
  ) then
    if not (iwish.has_permission(v_actor,'reports.read') and iwish.has_permission(v_actor,'reports.export'))
      and not iwish.has_permission(v_actor,'leads.export') then
      raise exception 'ERR_NO_PERMISSION:reports.export';
    end if;
  elsif not iwish.has_permission(v_actor,'leads.export') then
    raise exception 'ERR_NO_PERMISSION:leads.export';
  end if;

  insert into public.lead_export_jobs(created_by,source,format,status,filters)
  values (v_actor,coalesce(p_source,'public_pool'),p_format,'pending',coalesce(p_filters,'{}'::jsonb))
  returning * into v_job;
  perform iwish.audit(v_actor,'request_leads_export','lead_export_job',v_job.id::text,null,to_jsonb(v_job),null);
  return v_job.id;
end;
$$;

create or replace function public.rpc_crm_sales_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_terms iwish.crm_protection_terms;
begin
  if not iwish.is_active_user(auth.uid()) or not iwish.has_permission(auth.uid(),'settings.pipeline.manage') then
    raise exception 'ERR_NO_PERMISSION:settings.pipeline.manage';
  end if;
  v_terms := iwish.crm_protection_terms_at(statement_timestamp());
  return jsonb_build_object('people',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'quota',iwish.crm_quota_limit(p.id)) order by p.full_name)
    from public.profiles p where iwish.is_active_user(p.id) and iwish.has_permission(p.id,'lead_notes.create')
  ),'[]'),'goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.effective_on desc) from iwish.crm_visit_goals g),'[]'),
  'protectionTerms',jsonb_build_object('newIntentDays',v_terms.new_intent_days,'keyIntentDays',v_terms.key_intent_days,
    'nurtureDays',v_terms.nurture_days,'effectiveAt',nullif(v_terms.effective_at,'-infinity')));
end;
$$;

create function public.rpc_crm_save_protection_terms(
  p_new_intent_days integer,p_key_intent_days integer,p_nurture_days integer,p_previous_effective_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before iwish.crm_protection_terms;
  v_after iwish.crm_protection_terms;
begin
  if not iwish.is_active_user(auth.uid()) or not iwish.has_permission(auth.uid(),'settings.pipeline.manage') then
    raise exception 'ERR_NO_PERMISSION:settings.pipeline.manage';
  end if;
  if least(coalesce(p_new_intent_days,0),coalesce(p_key_intent_days,0),coalesce(p_nurture_days,0))<1
    or greatest(p_new_intent_days,p_key_intent_days,p_nurture_days)>date '9999-12-30'-iwish.crm_today() then
    raise exception 'ERR_CRM_PROTECTION_TERMS';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('iwish.crm.protection.terms',0));
  v_before := iwish.crm_protection_terms_at(clock_timestamp());
  if (v_before.new_intent_days,v_before.key_intent_days,v_before.nurture_days)
    is distinct from (p_new_intent_days,p_key_intent_days,p_nurture_days) then
    if nullif(v_before.effective_at,'-infinity') is distinct from p_previous_effective_at then
      raise exception 'ERR_CRM_CONFLICT';
    end if;
    insert into iwish.crm_protection_terms
    values (clock_timestamp(),p_new_intent_days,p_key_intent_days,p_nurture_days)
    returning * into v_after;
    perform iwish.audit(auth.uid(),'crm_protection_terms_save','setting','crm.protection_terms',
      to_jsonb(v_before),to_jsonb(v_after),'修改客户保护天数');
  else
    v_after := v_before;
  end if;
  return jsonb_build_object('newIntentDays',v_after.new_intent_days,'keyIntentDays',v_after.key_intent_days,
    'nurtureDays',v_after.nurture_days,'effectiveAt',nullif(v_after.effective_at,'-infinity'));
end;
$$;

revoke all on function public.rpc_crm_save_protection_terms(integer,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.rpc_crm_save_protection_terms(integer,integer,integer,timestamptz) to authenticated;

create function public.rpc_crm_save_lead_quota(p_profile uuid,p_quota integer) returns void
language plpgsql security definer set search_path = '' as $$
declare old_limit integer;
begin
  if not iwish.is_active_user(auth.uid()) or not iwish.has_permission(auth.uid(),'settings.pipeline.manage') then
    raise exception 'ERR_NO_PERMISSION:settings.pipeline.manage';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_profile::text,0));
  old_limit:=iwish.crm_quota_limit(p_profile);
  insert into iwish.crm_quota_limits values(p_profile,p_quota) on conflict(profile_id) do update set quota=excluded.quota;
  perform iwish.audit(auth.uid(),'crm_lead_quota_save','profile',p_profile::text,
    jsonb_build_object('quota',old_limit),jsonb_build_object('quota',p_quota),'');
end;
$$;

create function public.rpc_crm_dashboard_quotas()
returns table(profile_id uuid,quota integer) language sql stable security definer set search_path = '' as $$
  select p.id,iwish.crm_quota_limit(p.id)
  from public.profiles p where iwish.is_active_user(auth.uid()) and iwish.is_active_user(p.id)
    and (p.id=auth.uid() or (iwish.has_permission(auth.uid(),'reports.read') and iwish.crm_person_in_scope(auth.uid(),p)));
$$;

create function public.rpc_crm_operating_dashboard(
  p_start date,p_end date,p_period text default 'month',p_team integer default null,p_profile uuid default null,p_order_offset integer default 0,p_include_gm boolean default true
) returns jsonb
language sql stable security definer set search_path = '' as $$
with exclusions as materialized (select * from iwish.crm_reporting_exclusions(p_include_gm)), viewer as materialized (
  select auth.uid() as id, iwish.crm_today() as as_of,
    iwish.has_permission(auth.uid(),'reports.read') as reports,
    iwish.has_permission(auth.uid(),'reports.export') as export
  where iwish.is_active_user(auth.uid()) and p_start<p_end
), people as materialized (
  select p.id,p.full_name as name,p.team_id,t.name as team
  from viewer v cross join public.profiles p left join public.teams t on p.team_id=t.id
  cross join exclusions e
  where iwish.is_active_user(p.id) and (v.id=p.id or (v.reports and iwish.crm_person_in_scope(v.id,p)))
    and (p.id=v.id or iwish.has_permission(p.id,'lead_notes.create'))
    and not coalesce(e.teams @> to_jsonb(p.team_id),false)
    and not coalesce(e.profiles @> to_jsonb(p.id),false)
    and not coalesce(e.teams @> to_jsonb(p_team),false)
    and (p_profile is null or p_profile=p.id)
    and (p_team is null or p.team_id=p_team or exists(select 1 from public.profile_team_memberships m where m.profile_id=p.id and m.team_id=p_team))
), all_leads as materialized (
  select l.* from viewer v join public.leads l on not coalesce(l.is_deleted,false) cross join exclusions e
  where iwish.in_scope_for_lead(v.id,l,'leads.read')
    and not coalesce(e.teams @> to_jsonb(l.team_id),false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id,l.created_by)),false)
    and (p_team is null or l.team_id=p_team)
    and (p_profile is null or coalesce(l.owner_id,l.created_by)=p_profile)
), visit_events as materialized (
  select distinct on (v.lead_id,v.visited_on,p.profile_id)
    v.lead_id,v.visited_on,p.profile_id,p.profile_id=v.owner_id as own,
    v.data->>'method' as method,v.data->>'type' as visit_type,v.id
  from iwish.crm_visits v join iwish.crm_visit_participants p on p.visit_id=v.id
  join people s on s.id=p.profile_id join public.leads l on l.id=v.lead_id and not coalesce(l.is_deleted,false)
  join viewer r on p.profile_id=r.id or iwish.in_scope_for_lead(r.id,l,'leads.read')
  cross join exclusions e
  where v.invalidated_at is null and v.visited_on>=p_start and v.visited_on<p_end
    and not coalesce(e.teams @> to_jsonb(l.team_id),false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id,l.created_by)),false)
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
), resources as (
  select p.id,p.name,iwish.crm_quota_limit(p.id) as quota,
    count(l.id) filter(where iwish.lead_counts_toward_quota(l.owner_id,l.status,l.customer_attribute,l.follow_up_stage,l.close_result,l.is_deleted)) as held,
    count(l.id) filter(where l.status='open' and not l.crm_protection_review_required and iwish.crm_effective_protection_class(l)='key_intent' and l.customer_attribute<>'invalid') as key_intent,
    count(l.id) filter(where l.status='open' and not l.crm_protection_review_required and iwish.crm_effective_protection_class(l)='nurture' and l.customer_attribute<>'invalid') as nurture,
    count(l.id) filter(where l.status='open' and iwish.crm_protection_deadline(l) between iwish.crm_today() and iwish.crm_today()+7) as expiring,
    count(l.id) filter(where l.status='open' and iwish.crm_protection_deadline(l)<iwish.crm_today()) as expired,
    count(l.id) filter(where l.status='open' and l.crm_protection_review_required and iwish.crm_review_access(l.id)) as pending_review,
    count(l.id) filter(where l.status='pool' and l.pool_returned_at>=p_start::timestamp at time zone 'Asia/Shanghai'
      and l.pool_returned_at<p_end::timestamp at time zone 'Asia/Shanghai') as released,
    count(l.id) filter(where iwish.crm_customer_is_cooperating(l)) as cooperating
  from people p left join all_leads l on l.owner_id=p.id group by p.id,p.name
), live_contracts as materialized (
  select l.id as lead_id,coalesce(l.parent_lead_id,l.id) as root_id,l.name as customer,
    coalesce(iwish.crm_signed_on(s.finance->>'signedOn'),iwish.crm_signed_on(s.submitted->>'signedOn'),
      (c.signed_at at time zone 'Asia/Shanghai')::date) as signed_on,
    coalesce(nullif(s.finance->>'contractNumber',''),nullif(s.submitted->>'contractNumber',''),c.contract_number) as contract_number,
    case when c.is_renewal then 'renewal' when l.parent_lead_id is not null then 'expansion' else 'first' end as kind,
    coalesce(s.submitted->'services','{}') as services,
    case when s.finance_confirmed_at is not null and iwish.has_permission(v.id,'leads.fields.read_sensitive')
      and s.finance->>'grossProfit' ~ '^-?[0-9]+(\.[0-9]+)?$' then (s.finance->>'grossProfit')::numeric end as gross_profit,
    coalesce(nullif(s.finance->>'grossProfitCurrency',''),nullif(s.submitted->>'currency',''),c.currency,'') as gross_currency
  from all_leads l cross join viewer v
  left join public.contracts c on c.lead_id=l.id and c.status in ('active','closed')
  left join public.deal_contract_submissions s on s.lead_id=l.id and s.submitted_at is not null
  where l.status='closed' and l.close_result in ('won','成交') and (c.id is not null or s.lead_id is not null)
    and iwish.in_scope_for_lead(v.id,l,'contracts.read')
), history_contracts as (
  select r.id as lead_id,r.id as root_id,coalesce(s.data->>'companyName',r.raw_values->>7,'历史客户') as customer,
    coalesce(iwish.crm_signed_on(s.finance->>'signedOn'),iwish.crm_signed_on(s.data->>'signedOn')) as signed_on,
    coalesce(nullif(s.finance->>'contractNumber',''),nullif(s.data->>'contractNumber',''),r.generated_contract_number) as contract_number,
    'history' as kind,coalesce(s.data->'services','{}') as services,
    case when iwish.has_permission(v.id,'leads.fields.read_sensitive')
      and s.finance->>'grossProfit' ~ '^-?[0-9]+(\.[0-9]+)?$' then (s.finance->>'grossProfit')::numeric end as gross_profit,
    coalesce(nullif(s.finance->>'grossProfitCurrency',''),nullif(s.data->>'currency',''),'') as gross_currency
  from crm_allocation.history_submissions s join public.deal_history_records r on r.id=s.history_id
  cross join viewer v left join public.profiles p on p.id=r.owner_id
  cross join exclusions e
  where iwish.can_access_deal_history(r.batch_id,r.owner_id,false)
    and not coalesce(e.teams @> to_jsonb(p.team_id),false)
    and not coalesce(e.profiles @> to_jsonb(r.owner_id),false)
    and (p_team is null or p.team_id=p_team) and (p_profile is null or r.owner_id=p_profile)
), contracts as materialized (
  select distinct on (lower(btrim(x.contract_number))) x.*
  from (select live_contracts.*,0 as origin_rank from live_contracts
    union all select history_contracts.*,1 as origin_rank from history_contracts) x
  where nullif(btrim(x.contract_number),'') is not null
  order by lower(btrim(x.contract_number)),x.origin_rank,x.signed_on desc nulls last,x.lead_id
), contract_finance as materialized (
  select l.id as lead_id,
    (c.verified_paid_at at time zone 'Asia/Shanghai')::date as paid_on,
    c.amount,coalesce(nullif(upper(btrim(c.currency)),''),'CNY') as currency
  from all_leads l cross join viewer v
  join lateral (
    select p.paid_at as verified_paid_at,p.amount,p.currency from public.contracts k join public.contract_payments p on p.contract_id=k.id
    where k.lead_id=l.id and p.status='confirmed' and p.amount>0
  ) c on true
  where iwish.in_scope_for_lead(v.id,l,'contracts.read') and iwish.has_permission(v.id,'leads.fields.read_sensitive')
  union all
  select l.id,f.paid_on,f.amount,f.currency
  from all_leads l cross join viewer v join public.deal_contract_submissions s on s.lead_id=l.id
    cross join lateral (
      select iwish.crm_signed_on(s.finance->>'receivedOn') as paid_on,
             case when s.finance->>'receivedAmount' ~ '^[0-9]+(\.[0-9]+)?$' then (s.finance->>'receivedAmount')::numeric end as amount,
             coalesce(nullif(upper(btrim(s.finance->>'currency')),''),nullif(upper(btrim(s.submitted->>'currency')),''),'CNY') as currency
    ) f
  where s.finance_confirmed_at is not null and f.paid_on is not null and f.amount>0 and f.currency~'^[A-Z]{3}$'
    and iwish.can_access_deal_contract_submission(l.id,false)
    and not exists(select 1 from public.contracts c join public.contract_payments p on p.contract_id=c.id
      where c.lead_id=l.id and p.status='confirmed' and (p.paid_at at time zone 'Asia/Shanghai')::date=f.paid_on
        and p.amount=f.amount and coalesce(nullif(upper(btrim(p.currency)),''),'CNY')=f.currency)
), receipts as (
  select currency,sum(amount) as amount from contract_finance where paid_on>=p_start and paid_on<p_end group by currency
), cohort as (
  select lead_id,min(visited_on) as first_on from team_visits group by lead_id
), orders as materialized (
  select * from contracts where signed_on>=p_start and signed_on<p_end and contract_number is not null
), profits as (
  select gross_currency as currency,count(*) as orders,count(gross_profit) as confirmed,
    case when count(gross_profit)=count(*) then sum(gross_profit) end as amount
  from orders group by gross_currency
), funnel as (
  select case when follow_up_stage='online_communication' then 'offline_visit' else follow_up_stage end as stage,count(*) filter(where (created_at at time zone 'Asia/Shanghai')::date>=p_start
      and (created_at at time zone 'Asia/Shanghai')::date<p_end) as new_count,
    count(*) filter(where status='open' and follow_up_stage not in ('won','payment_received')) as active_count
  from all_leads where status in ('open','closed') and customer_attribute is distinct from 'invalid' group by 1
), cohort_leads as (
  select * from all_leads where status<>'pool' and customer_attribute<>'invalid'
    and (created_at at time zone 'Asia/Shanghai')::date>=p_start and (created_at at time zone 'Asia/Shanghai')::date<p_end
), acquisition_events as (
  select l.id,case when l.follow_up_stage='online_communication' then 'offline_visit' else l.follow_up_stage end as stage,now() as event_at from cohort_leads l
  union all
  select l.id,'uncontacted',l.created_at from cohort_leads l
  union all
  select l.id,case when s.stage='online_communication' then 'offline_visit' else s.stage end,
    a.created_at
  from cohort_leads l join public.audit_logs a on a.target_type='lead' and a.target_id=l.id::text
  cross join lateral (values(a.before->>'follow_up_stage'),(a.after->>'follow_up_stage')) s(stage)
  where s.stage is not null
), steps as (
  select stage,ordinal from unnest(array['uncontacted','connected','offline_visit','proposal_quotation',
    'intent_confirmed','contract_review','won','payment_received']) with ordinality x(stage,ordinal)
), step_rates as (
  select a.stage,
    count(distinct e.id) as reached,
    count(distinct e.id) filter(where exists(select 1 from acquisition_events n
      where n.id=e.id and n.stage=b.stage and n.event_at>=e.event_at)) as advanced
  from steps a join steps b on b.ordinal=a.ordinal+1 left join acquisition_events e on e.stage=a.stage
  group by a.stage
), expected as (
  select sum(case when m.margin~'^\d+(\.\d+)?$' then m.margin::numeric end) as amount
  from all_leads l join lateral (
    select v.data->>'expectedMargin' as margin from iwish.crm_visits v
    where v.lead_id=l.id and v.invalidated_at is null and v.visited_on<=iwish.crm_today() order by v.visited_on desc,v.created_at desc limit 1
  ) m on true where iwish.lead_counts_toward_quota(l.owner_id,l.status,l.customer_attribute,l.follow_up_stage,l.close_result,l.is_deleted)
)
select coalesce((
  select jsonb_build_object(
    'asOf',v.as_of,'canExport',v.export,'canCompare',v.reports,
    'people',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from personal p),'[]'),
    'resources',coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from resources r),'[]'),
    'funnel',coalesce((select jsonb_object_agg(stage,jsonb_build_object('new',new_count,'active',active_count)) from funnel),'{}'),
    'stageRates',case when p_start<date '2026-12-01' then null else coalesce((
      select jsonb_object_agg(stage,case when reached=0 then null else round(100.0*advanced/reached,1) end) from step_rates),'{}') end,
    'teamVisits',(select count(*) from team_visits),'firstVisits',(select count(distinct (lead_id,visited_on)) from visit_events where visit_type='first'),
    'newCustomers',(select coalesce(sum(new_count),0) from funnel),'expectedMargin',(select amount from expected),
    'firstOrders',(select count(*) from orders where kind='first'),'expansionOrders',(select count(*) from orders where kind='expansion'),
    'renewalOrders',(select count(*) from orders where kind='renewal'),
    'unclassifiedHistoryOrders',(select count(*) from orders where kind='history'),
    'profits',coalesce((select jsonb_agg(to_jsonb(p) order by p.currency) from profits p),'[]'),
    'newSignedCustomers',(select count(distinct root_id) from orders where kind='first'),
    'released',(select count(*) from all_leads where pool_returned_at>=p_start::timestamp at time zone 'Asia/Shanghai' and pool_returned_at<p_end::timestamp at time zone 'Asia/Shanghai'),
    'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.currency) from receipts r),'[]'),
    'conversionComplete',p_start>=date '2026-12-01',
    'conversionBase',(select count(*) from cohort),
    'conversionWon',(select count(*) from cohort c where exists(select 1 from contracts k
      where k.lead_id=c.lead_id and k.kind='first' and k.signed_on between c.first_on and v.as_of)),
    'orders',coalesce((select jsonb_agg(to_jsonb(k) order by k.signed_on desc) from (
      select lead_id,customer,contract_number,kind,signed_on,services
      from orders order by signed_on desc,lead_id offset greatest(p_order_offset,0) limit 200
    ) k),'[]')
  ) from viewer v
),'{}'::jsonb);
$$;

create function public.rpc_crm_operating_visit_details(
  p_start date,p_end date,p_profile uuid default null,p_team integer default null,
  p_method text default null,p_type text default null,p_offset integer default 0,p_include_gm boolean default true
) returns jsonb language sql stable security definer set search_path = '' as $$
with scoped as (
  select distinct on (v.lead_id,v.visited_on,p.profile_id) v.id,v.lead_id,l.name as customer,v.visited_on,
    p.profile_id,x.full_name as seller,p.profile_id=v.owner_id as own,
    v.data->>'method' as method,v.data->>'type' as visit_type,
    iwish.crm_visit_access(l.id,false) as can_open
  from iwish.crm_visits v join iwish.crm_visit_participants p on p.visit_id=v.id
  join public.leads l on l.id=v.lead_id join public.profiles x on x.id=p.profile_id
  cross join iwish.crm_reporting_exclusions(p_include_gm) e
  where iwish.is_active_user(auth.uid()) and not coalesce(l.is_deleted,false) and v.invalidated_at is null
    and v.visited_on>=p_start and v.visited_on<p_end
    and not coalesce(e.teams @> to_jsonb(l.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id, l.created_by)), false)
    and not coalesce(e.teams @> to_jsonb(x.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(x.id), false)
    and not coalesce(e.teams @> to_jsonb(p_team), false)
    and iwish.is_active_user(x.id)
    and (p.profile_id=auth.uid() or iwish.has_permission(x.id,'lead_notes.create'))
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

create function public.rpc_crm_resource_details(p_owner uuid,p_metric text,p_offset integer default 0,
  p_team integer default null,p_start date default null,p_end date default null,p_include_gm boolean default true)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (
    select l.id,l.name as customer,iwish.crm_effective_protection_class(l) as category,iwish.crm_protection_deadline(l) as deadline,l.status
    from public.leads l join public.profiles p on p.id=l.owner_id
    cross join iwish.crm_reporting_exclusions(p_include_gm) e
    where l.owner_id=p_owner and not coalesce(l.is_deleted,false) and iwish.is_active_user(auth.uid())
      and (p_owner=auth.uid() or iwish.has_permission(auth.uid(),'reports.read'))
      and iwish.in_scope_for_lead(auth.uid(),l,'leads.read')
    and not coalesce(e.teams @> to_jsonb(l.team_id),false)
    and not coalesce(e.profiles @> to_jsonb(l.owner_id),false)
      and not coalesce(e.teams @> to_jsonb(p.team_id),false)
      and (p_team is null or l.team_id=p_team)
      and case p_metric
        when 'key_intent' then l.status='open' and not l.crm_protection_review_required and iwish.crm_effective_protection_class(l)='key_intent' and l.customer_attribute<>'invalid'
        when 'nurture' then l.status='open' and not l.crm_protection_review_required and iwish.crm_effective_protection_class(l)='nurture' and l.customer_attribute<>'invalid'
        when 'expiring' then l.status='open' and iwish.crm_protection_deadline(l) between iwish.crm_today() and iwish.crm_today()+7
        when 'expired' then l.status='open' and iwish.crm_protection_deadline(l)<iwish.crm_today()
        when 'pending_review' then l.status='open' and l.crm_protection_review_required and iwish.crm_review_access(l.id)
        when 'released' then l.status='pool' and l.pool_returned_at>=p_start::timestamp at time zone 'Asia/Shanghai' and l.pool_returned_at<p_end::timestamp at time zone 'Asia/Shanghai'
        when 'cooperating' then iwish.crm_customer_is_cooperating(l)
        else iwish.lead_counts_toward_quota(l.owner_id,l.status,l.customer_attribute,l.follow_up_stage,l.close_result,l.is_deleted)
      end
    order by l.name,l.id offset greatest(p_offset,0) limit 200
  ) q;
$$;

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
    if v_key not in ('contractNumber','signedOn','legalName','baseFee','currency','actualPayment','receivedOn','receivedAmount','grossProfit')
      or jsonb_typeof(v_value) <> 'string' or nullif(btrim(v_value #>> '{}'), '') is null
    then raise exception 'ERR_VALIDATION:deal_contract_finance'; end if;
    if v_key in ('baseFee','receivedAmount') and (v_value #>> '{}') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
      then raise exception 'ERR_VALIDATION:deal_contract_amount'; end if;
    if v_key = 'grossProfit' and (v_value #>> '{}') !~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$'
      then raise exception using errcode = '22023', message = 'ERR_VALIDATION:deal_contract_gross_profit'; end if;
    if v_key in ('signedOn','receivedOn') then
      if (v_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'ERR_VALIDATION:deal_contract_date'; end if;
      perform (v_value #>> '{}')::date;
    end if;
    if v_key = 'currency' and (v_value #>> '{}') !~ '^[A-Z]{3}$'
      then raise exception 'ERR_VALIDATION:deal_contract_currency'; end if;
  end loop;
  if p_values ? 'grossProfit' and not (p_values ? 'currency') then
    raise exception using errcode = '22023', message = 'ERR_VALIDATION:deal_contract_gross_profit_currency';
  end if;
  if p_values ? 'grossProfit' then
    p_values := (p_values - 'currency') || jsonb_build_object('grossProfitCurrency',p_values->>'currency')
      || case when p_values ? 'receivedOn' then jsonb_build_object('currency',p_values->>'currency') else '{}'::jsonb end;
  end if;
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

revoke all on function public.rpc_crm_save_lead_quota(uuid,integer),public.rpc_crm_dashboard_quotas(),
  public.rpc_crm_operating_dashboard(date,date,text,integer,uuid,integer,boolean),
  public.rpc_crm_resource_details(uuid,text,integer,integer,date,date,boolean),
  public.rpc_crm_operating_visit_details(date,date,uuid,integer,text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.rpc_crm_save_lead_quota(uuid,integer),public.rpc_crm_dashboard_quotas(),
  public.rpc_crm_operating_dashboard(date,date,text,integer,uuid,integer,boolean),
  public.rpc_crm_resource_details(uuid,text,integer,integer,date,date,boolean),
  public.rpc_crm_operating_visit_details(date,date,uuid,integer,text,text,integer,boolean) to authenticated;

-- The existing homepage keeps its operating exclusions and displays the configured quota.
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
begin atomic
with exclusions as materialized (select * from iwish.crm_reporting_exclusions(true)),
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
  from public.leads_secure_view l cross join scope_filter f cross join exclusions e
  left join public.rpc_crm_dashboard_next_actions() actions on actions.lead_id=l.id
  where (select auth.uid()) is not null and l.status <> 'pool'
    and (f.team_id is null or l.team_id = f.team_id)
    and (f.owner_id is null or l.owner_id = f.owner_id)
    and not coalesce(e.teams @> to_jsonb(l.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id, l.created_by)), false)
),
leads as materialized (
  select l.*, not l.invalid and l.qualified_stage as qualified,
    l.status = 'open' and not l.invalid and l.stage_key not in ('won', 'payment_received') as active,
    coalesce(l.next_contact_at < ((now() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai'),false) as overdue
  from scope_leads l
),
notes as materialized (
  select n.lead_id, n.author_id, n.created_at, btrim(n.note_type) as note_type,
    n.created_at >= p_range_start and n.created_at < p_range_end as in_range
  from public.lead_notes n
  join scope_leads l on l.id = n.lead_id
  left join public.profiles_public_view author on author.id = n.author_id
  cross join exclusions e
  where not coalesce(n.is_deleted, false) and n.note_type <> 'visit'
    -- Contract events belong to the eligible lead owner, even when a manager confirms them.
    and (btrim(n.note_type) = 'won' or (
      not coalesce(e.profiles @> to_jsonb(n.author_id), false)
      and not coalesce(e.teams @> to_jsonb(author.team_id), false)
    ))
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
  from public.profiles_public_view p cross join scope_filter f cross join exclusions e
  where (select auth.uid()) is not null and p.status = 'active'
    and (f.team_id is null or p.team_id = f.team_id)
    and (f.owner_id is null or p.id = f.owner_id)
    and not coalesce(e.teams @> to_jsonb(p.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(p.id), false)
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
    coalesce(q.quota,60) as "quotaLimit",
    coalesce(l.active, 0) as "activeLeads", coalesce(l.new_leads, 0) as "newLeads",
    coalesce(l.won, 0) as "wonLeads", coalesce(l.qualified, 0) as "qualifiedLeads",
    coalesce(l.overdue, 0) as "overdueLeads", coalesce(s.counts, '{}'::jsonb) as "stageCounts",
    coalesce(a.contacts, 0) as "contactActions", coalesce(a.visits, 0) as visits,
    coalesce(a.follow_ups, 0) as "followUps",
    coalesce(l.new_leads, 0) + coalesce(a.contacts, 0) + coalesce(a.visits, 0) as "actionScore"
  from profiles p
  left join public.rpc_crm_dashboard_quotas() q on q.profile_id=p.id
  left join lead_rollup l on l.by_team = 0 and l.owner_key = p.id
  left join stages s on s.omit_owner = 0 and s.owner_key = p.id
  left join author_rollup a on a.author_id = p.id
),
team_ids as (
  select t.id
  from public.teams t cross join exclusions e
  where t.is_active and not coalesce(e.teams @> to_jsonb(t.id), false)
  union
  select l.team_id from scope_leads l where l.team_id is not null
),
team_members as (
  select "teamId", count(*) as member_count, sum("quotaLimit") as quota_capacity, sum("contactActions") as contacts,
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
    coalesce(m.quota_capacity,0) as "quotaCapacity",
    coalesce(l.active,0)::numeric / nullif(m.quota_capacity,0) as "quotaUsage"
  from team_ids i
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
end;
end;
