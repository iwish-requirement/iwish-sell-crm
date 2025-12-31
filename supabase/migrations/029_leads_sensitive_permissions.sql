-- 029_leads_sensitive_permissions.sql
-- Align lead permissions with business baseline:
-- - All frontline users (Sales) can create leads and edit their own leads, including sensitive fields
-- - Managers can manage team leads, including sensitive fields
--
-- 1) Ensure Sales role has read/write access to sensitive lead fields for own scope
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'self'
from public.roles r
join public.permissions p on p.key in (
  'leads.fields.read_sensitive',
  'leads.fields.write_sensitive'
)
where r.name = 'Sales'
on conflict do nothing;

-- 2) Ensure Manager role has read/write access to sensitive lead fields for team scope
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'team'
from public.roles r
join public.permissions p on p.key in (
  'leads.fields.read_sensitive',
  'leads.fields.write_sensitive'
)
where r.name = 'Manager'
on conflict do nothing;

-- 3) Ensure Manager role can also create leads for their team
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, 'leads.create', 'allow', 'team'
from public.roles r
where r.name = 'Manager'
on conflict do nothing;
