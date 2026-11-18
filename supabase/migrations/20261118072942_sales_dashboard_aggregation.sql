-- Keep dashboard reads under the caller's existing view grants and RLS policies.
-- The overview returns aggregates only. Details use the same scope and date rules.
create function public.rpc_sales_dashboard(
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
    l.created_at, l.updated_at, l.last_contact_at, l.next_contact_at,
    coalesce(l.last_contact_at, l.created_at, '-infinity'::timestamptz) as sort_at,
    coalesce(l.follow_up_stage, l.stage) as display_stage,
    coalesce(nullif(btrim(l.follow_up_stage), ''), 'uncontacted') as stage_key,
    coalesce(l.customer_attribute, '') = 'invalid' as invalid,
    coalesce(
      btrim(l.stage) = 'Won' or (l.status = 'closed' and btrim(l.close_result) in ('won', '成交')), false
    ) as won,
    coalesce(nullif(btrim(l.follow_up_stage), ''), btrim(l.stage), '') not in ('', 'uncontacted', 'L1')
      or coalesce(upper(btrim(l.customer_grade)), '') in ('S', 'A', 'B') as qualified_stage,
    coalesce(l.created_at >= p_range_start and l.created_at < p_range_end, false) as new_in_range,
    coalesce(l.next_contact_at >= p_range_start and l.next_contact_at < p_range_end, false) as due_in_range
  from public.leads_secure_view l cross join scope_filter f
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
  where not coalesce(n.is_deleted, false)
    and n.created_at >= case when p_part = 'overview' then least(p_range_start, p_trend_start) else p_range_start end
    and n.created_at < p_range_end
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
    sum(visits) as visits, sum("followUps") as follow_ups, sum("overdueLeads") as overdue
  from members group by "teamId"
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
    count(*) filter (where note_type = 'visit') as visits,
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
    count(*) filter (where note_type = 'visit') as visits
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
    'quotaLimit', (select coalesce((value->>'quota_limit')::integer, 60) from rules),
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
      'visits', (select coalesce(sum(visits), 0) from members),
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
