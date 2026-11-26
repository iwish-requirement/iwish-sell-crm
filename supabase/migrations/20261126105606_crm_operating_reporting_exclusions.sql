-- Read the same settings as the existing CRM statistics and GM dashboard.
create function iwish.crm_reporting_exclusions(p_include_gm boolean)
returns table(teams jsonb, profiles jsonb)
language sql stable security definer set search_path = '' as $$
  select
    coalesce(jsonb_agg(item.id) filter (where s.key <> 'analytics.excluded_profiles'), '[]'::jsonb),
    coalesce(jsonb_agg(item.id) filter (where s.key = 'analytics.excluded_profiles'), '[]'::jsonb)
  from public.settings s
  cross join lateral (select case when s.key = 'analytics.excluded_profiles'
    then s.value->'profile_ids' else s.value->'team_ids' end as ids) configured
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(configured.ids) = 'array' then configured.ids else '[]'::jsonb end
  ) item(id)
  where iwish.is_active_user(auth.uid())
    and (s.key in ('analytics.excluded_teams', 'analytics.excluded_profiles')
      or (p_include_gm and s.key = 'gm_dashboard.excluded_teams'));
$$;revoke all on function iwish.crm_reporting_exclusions(boolean) from public, anon, authenticated, service_role;
grant execute on function iwish.crm_reporting_exclusions(boolean) to authenticated;

create or replace function iwish.crm_reporting_exclusions()
returns table(teams jsonb, profiles jsonb)
language sql stable set search_path = '' as $$
  select e.teams, e.profiles from iwish.crm_reporting_exclusions(true) e;
$$;

-- General analytics shares the base exclusions, while Dashboard keeps its GM-specific rule.
create function public.rpc_crm_analytics_exclusions()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not iwish.is_active_user(auth.uid()) or not iwish.has_permission(auth.uid(), 'reports.read') then
    raise exception using errcode='42501', message='ERR_NO_PERMISSION:reports.read';
  end if;
  return (select to_jsonb(e) from iwish.crm_reporting_exclusions(false) e);
end;
$$;
revoke all on function public.rpc_crm_analytics_exclusions() from public, anon, authenticated, service_role;
grant execute on function public.rpc_crm_analytics_exclusions() to authenticated;

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
  from public.teams t cross join exclusions e
  where t.is_active and not coalesce(e.teams @> to_jsonb(t.id), false)
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
end;
end;

-- Keep caller RLS on payment, contract, lead and finance-submission reads.
create function public.rpc_crm_dashboard_monthly_revenue()
returns table(currency text, amount numeric)
language sql stable security invoker set search_path = '' begin atomic
with month_bounds as (
  select date_trunc('month', now() at time zone 'Asia/Shanghai') as month_start,
    (now() at time zone 'Asia/Shanghai')::date as today
), eligible_leads as materialized (
  select l.id
  from public.leads_secure_view l cross join iwish.crm_reporting_exclusions(true) e
  where not coalesce(e.teams @> to_jsonb(l.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id, l.created_by)), false)
), payments as materialized (
  select c.lead_id, (p.paid_at at time zone 'Asia/Shanghai')::date as received_on,
    case when upper(btrim(p.currency)) ~ '^[A-Z]{3}$' then upper(btrim(p.currency)) else 'CNY' end as currency, p.amount
  from public.contract_payments_secure_view p
  join public.contracts_secure_view c on c.id = p.contract_id
  join eligible_leads l on l.id = c.lead_id
  cross join month_bounds b
  where p.status = 'confirmed' and p.amount > 0
    and p.paid_at >= b.month_start at time zone 'Asia/Shanghai' and p.paid_at <= now()
), submitted_receipts as (
  select s.lead_id, f.received_on, f.currency, f.amount
  from public.deal_contract_submissions s
  join eligible_leads l on l.id = s.lead_id
  cross join month_bounds b
  cross join lateral (
    select case when s.finance->>'receivedOn' ~ '^\d{4}-\d{2}-\d{2}$'
        and pg_input_is_valid(s.finance->>'receivedOn', 'date') then (s.finance->>'receivedOn')::date end as received_on,
      case when s.finance->>'receivedAmount' ~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
        then (s.finance->>'receivedAmount')::numeric end as amount,
      coalesce(
        case when upper(btrim(s.finance->>'currency')) ~ '^[A-Z]{3}$' then upper(btrim(s.finance->>'currency')) end,
        case when upper(btrim(s.submitted->>'currency')) ~ '^[A-Z]{3}$' then upper(btrim(s.submitted->>'currency')) end,
        'CNY'
      ) as currency
  ) f
  where s.submitted_at is not null and s.finance_confirmed_at is not null
    and f.received_on between b.month_start::date and b.today and f.amount > 0
    and not exists (select 1 from payments p
      where (p.lead_id, p.received_on, p.amount, p.currency) = (s.lead_id, f.received_on, f.amount, f.currency))
), all_receipts as (
  select p.currency, p.amount from payments p
  union all
  select s.currency, s.amount from submitted_receipts s
)
select r.currency, sum(r.amount) as amount from all_receipts r group by r.currency order by r.currency;
end;
revoke all on function public.rpc_crm_dashboard_monthly_revenue() from public, anon, authenticated, service_role;
grant execute on function public.rpc_crm_dashboard_monthly_revenue() to authenticated;

create or replace function public.rpc_crm_dashboard_visit_events(p_start date,p_end date)
returns table(lead_id uuid,author_id uuid,visited_on date) language sql stable security definer set search_path = '' as $$
  select distinct v.lead_id,vp.profile_id,v.visited_on
  from iwish.crm_visits v join iwish.crm_visit_participants vp on vp.visit_id=v.id
  join public.leads l on l.id=v.lead_id join public.profiles x on x.id=vp.profile_id
  cross join iwish.crm_reporting_exclusions() e
  where iwish.is_active_user(auth.uid()) and v.invalidated_at is null and not coalesce(l.is_deleted,false)
    and v.visited_on>=p_start and v.visited_on<p_end and iwish.crm_visit_access(l.id,false)
    and not coalesce(e.teams @> to_jsonb(l.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id, l.created_by)), false)
    and not coalesce(e.teams @> to_jsonb(x.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(x.id), false);
$$;

create or replace function public.rpc_crm_visit_goal_report(
  p_start date,p_end date,p_period text default 'month',p_team integer default null,p_profile uuid default null
) returns jsonb
language sql stable security definer set search_path = '' as $$
with exclusions as materialized (select * from iwish.crm_reporting_exclusions()), viewer as materialized (
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
    and not coalesce(e.teams @> to_jsonb(p.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(p.id), false)
    and not coalesce(e.teams @> to_jsonb(p_team), false)
    and (p_profile is null or p_profile=p.id)
    and (p_team is null or p.team_id=p_team or exists(select 1 from public.profile_team_memberships m where m.profile_id=p.id and m.team_id=p_team))
), visit_events as materialized (
  select distinct on (v.lead_id,v.visited_on,p.profile_id)
    v.lead_id,v.visited_on,p.profile_id,p.profile_id=v.owner_id as own,
    v.data->>'method' as method,v.data->>'type' as visit_type,v.id
  from iwish.crm_visits v join iwish.crm_visit_participants p on p.visit_id=v.id
  join people s on s.id=p.profile_id join public.leads l on l.id=v.lead_id and not coalesce(l.is_deleted,false)
  join viewer r on p.profile_id=r.id or iwish.in_scope_for_lead(r.id,l,'leads.read')
  cross join exclusions e
  where v.invalidated_at is null and v.visited_on>=p_start and v.visited_on<p_end
    and not coalesce(e.teams @> to_jsonb(l.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id, l.created_by)), false)
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

create or replace function public.rpc_crm_visit_details(
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
  cross join iwish.crm_reporting_exclusions() e
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

-- Scope the deal center's summary independently of its operational contract list.
create function public.rpc_crm_reportable_deals(p_lead_ids uuid[])
returns uuid[]
language sql stable security invoker set search_path = '' begin atomic
  select coalesce(array_agg(l.id), '{}'::uuid[])
  from public.leads_secure_view l cross join iwish.crm_reporting_exclusions(false) e
  where l.id = any(p_lead_ids)
    and iwish.has_permission(auth.uid(), 'contracts.read')
    and not coalesce(e.teams @> to_jsonb(l.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(coalesce(l.owner_id, l.created_by)), false);
end;
revoke all on function public.rpc_crm_reportable_deals(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.rpc_crm_reportable_deals(uuid[]) to authenticated;
