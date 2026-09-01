-- Technical-maintenance accounts are the highest-privilege CRM operators and
-- must be able to inspect and repair the allocation queue.
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'org'
from public.roles r
cross join public.permissions p
where (r.name = '技术维护' or r.role_type = 'tech_maintainer')
  and p.key in ('allocations.read', 'allocations.manage')
on conflict do nothing;
