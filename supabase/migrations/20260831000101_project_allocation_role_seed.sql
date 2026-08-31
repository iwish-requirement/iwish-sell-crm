-- Align allocation permissions with the production role names used by this org.
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, 'allocations.read', 'allow', 'org'
from public.roles r
where r.name in ('业务总经理','销售经理','市场总监','市场人员')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, 'allocations.manage', 'allow', 'org'
from public.roles r
where r.name in ('业务总经理','销售经理','市场总监')
on conflict do nothing;
