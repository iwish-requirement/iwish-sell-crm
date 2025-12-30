-- 008_superadmin_lead_permissions.sql
-- Make SuperAdmin have at least Admin-level lead and audit capabilities

insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select sa.id, rp.permission_key, rp.effect, rp.scope_type
from public.roles sa
join public.roles admin on admin.name = 'Admin'
join public.role_permissions rp on rp.role_id = admin.id
where sa.name = 'SuperAdmin'
on conflict (role_id, permission_key) do nothing;
