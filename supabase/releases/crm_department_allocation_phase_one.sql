begin;
set local lock_timeout = '3s';

-- The existing directory IDs must be mapped before the queue switches.
do $$
begin
  if exists (
    select 1 from unnest(array['performance','brand','seo','website','creative']) c(category)
    where not exists (
      select 1 from crm_allocation.service_departments m join public.ops_departments d on d.id = m.department_id
      where m.category = c.category and d.is_active
    )
  ) then raise exception 'Missing active departments for the service allocation release'; end if;
end;
$$;

update crm_allocation.release
set enabled = true, required_after = coalesce(required_after, clock_timestamp())
where singleton;

commit;
