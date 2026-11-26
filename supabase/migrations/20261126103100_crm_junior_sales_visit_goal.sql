-- Correct the first release seed to match the approved trial and junior targets.
-- Preserve any later administrator change to either effective date.
with salesperson as (
  select p.id
  from public.profiles p
  where btrim(p.full_name) = '冀腾飞' and p.status = 'active' and p.disabled_at is null
), targets(effective_on, monthly, quarterly, yearly, weekly_reference, old_monthly, old_quarterly, old_yearly, old_weekly) as (
  values
    (date '2026-12-01',16,null::integer,null::integer,null::text,8,null::integer,null::integer,null::text),
    (date '2027-01-01',20,60,240,'5',10,30,120,'2–3')
)
update iwish.crm_visit_goals g
set monthly = t.monthly, quarterly = t.quarterly, yearly = t.yearly, weekly_reference = t.weekly_reference
from salesperson p cross join targets t
where g.profile_id = p.id and g.effective_on = t.effective_on
  and (select count(*) from salesperson) = 1
  and (g.monthly,g.quarterly,g.yearly,g.weekly_reference)
      is not distinct from (t.old_monthly,t.old_quarterly,t.old_yearly,t.old_weekly);
