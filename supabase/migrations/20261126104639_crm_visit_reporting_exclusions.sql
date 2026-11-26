-- Read the same settings as the existing CRM statistics and GM dashboard.
create function iwish.crm_reporting_exclusions()
returns table(teams jsonb, profiles jsonb)
language sql stable set search_path = '' as $$
  select
    coalesce(jsonb_agg(item.id) filter (where s.key <> 'analytics.excluded_profiles'), '[]'::jsonb),
    coalesce(jsonb_agg(item.id) filter (where s.key = 'analytics.excluded_profiles'), '[]'::jsonb)
  from public.settings s
  cross join lateral (select case when s.key = 'analytics.excluded_profiles'
    then s.value->'profile_ids' else s.value->'team_ids' end as ids) configured
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(configured.ids) = 'array' then configured.ids else '[]'::jsonb end
  ) item(id)
  where s.key in ('analytics.excluded_teams', 'analytics.excluded_profiles', 'gm_dashboard.excluded_teams');
$$;
revoke all on function iwish.crm_reporting_exclusions() from public, anon, authenticated, service_role;

create or replace function public.rpc_crm_dashboard_visit_events(p_start date,p_end date)
returns table(lead_id uuid,author_id uuid,visited_on date) language sql stable security definer set search_path = '' as $$
  select distinct v.lead_id,vp.profile_id,v.visited_on
  from iwish.crm_visits v join iwish.crm_visit_participants vp on vp.visit_id=v.id
  join public.leads l on l.id=v.lead_id join public.profiles x on x.id=vp.profile_id
  cross join iwish.crm_reporting_exclusions() e
  where iwish.is_active_user(auth.uid()) and v.invalidated_at is null and not coalesce(l.is_deleted,false)
    and v.visited_on>=p_start and v.visited_on<p_end and iwish.crm_visit_access(l.id,false)
    and not coalesce(e.teams @> to_jsonb(l.team_id), false)
    and not coalesce(e.profiles @> to_jsonb(l.owner_id), false)
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
    and not coalesce(e.profiles @> to_jsonb(l.owner_id), false)
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
    and not coalesce(e.profiles @> to_jsonb(l.owner_id), false)
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
