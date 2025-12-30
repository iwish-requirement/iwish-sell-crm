-- permissions seed (covering PRD 15.1 and keys used in RLS/RPC)
insert into public.permissions(key, resource, action, name, description, is_system, is_enabled)
values
  -- Leads core
  ('leads.read','leads','read','Read Leads','View leads in allowed scope',true,true),
  ('leads.create','leads','create','Create Lead','Create leads',true,true),
  ('leads.update','leads','update','Update Lead','Update leads in allowed scope',true,true),
  ('leads.delete','leads','delete','Delete Lead','Delete leads in allowed scope',true,true),
  ('leads.assign','leads','assign','Assign Lead','Assign owner within scope',true,true),
  ('leads.transfer','leads','transfer','Transfer Lead','Transfer across teams/owners',true,true),
  ('leads.close','leads','close','Close Lead','Close as won/lost',true,true),
  ('leads.export','leads','export','Export Leads','Export leads data',true,true),
  ('leads.import','leads','import','Import Leads','Import leads data',true,true),
  ('leads.bulk_update','leads','bulk_update','Bulk Update Leads','Bulk update leads',true,true),
  ('leads.bulk_assign','leads','bulk_assign','Bulk Assign Leads','Bulk assign leads',true,true),
  ('leads.bulk_transfer','leads','bulk_transfer','Bulk Transfer Leads','Bulk transfer leads',true,true),
  -- field-level
  ('leads.fields.read_sensitive','leads','fields.read_sensitive','Read Sensitive Fields','Read phone/email/budget',true,true),
  ('leads.fields.write_sensitive','leads','fields.write_sensitive','Write Sensitive Fields','Write phone/email/budget',true,true),
  ('leads.fields.read_internal','leads','fields.read_internal','Read Internal Fields','Read internal score/blacklist reason',true,true),
  ('leads.fields.write_internal','leads','fields.write_internal','Write Internal Fields','Write internal score/blacklist reason',true,true),

  -- Notes
  ('lead_notes.read','lead_notes','read','Read Lead Notes','Read notes for leads',true,true),
  ('lead_notes.create','lead_notes','create','Create Lead Note','Create notes for leads',true,true),
  ('lead_notes.update','lead_notes','update','Update Lead Note','Update notes',true,true),
  ('lead_notes.delete','lead_notes','delete','Delete Lead Note','Delete notes (soft/hard)',true,true),

  -- Auth / Profiles / Org
  ('auth.approve','auth','approve','Approve User','Approve pending user',true,true),
  ('auth.reject','auth','reject','Reject User','Reject pending user',true,true),
  ('auth.disable','auth','disable','Disable User','Disable active user',true,true),
  ('auth.restore','auth','restore','Restore User','Restore disabled user',true,true),

  ('profiles.manage','profiles','manage','Manage Users','Manage profiles and assignments',true,true),
  ('profiles.read','profiles','read','Read Profiles','Read profiles in allowed scope',true,true),
  ('profiles.read_private','profiles','read_private','Read Private Profile Fields','Read private profile fields',true,true),

  ('teams.manage','teams','manage','Manage Teams','Manage organization teams',true,true),
  ('teams.read','teams','read','Read Teams','View teams',true,true),

  ('roles.manage','roles','manage','Manage Roles','Manage role definitions',true,true),
  ('roles.read','roles','read','Read Roles','View roles',true,true),

  -- Permission system
  ('permissions.read','permissions','read','Read Permissions','View permission definitions',true,true),
  ('permissions.manage','permissions','manage','Manage Permissions','Manage permission definitions',true,true),
  ('role_permissions.manage','roles','permissions.manage','Manage Role Permissions','Edit role permission matrix',true,true),
  ('user_permissions.manage','profiles','user_permissions.manage','Manage User Overrides','Grant/deny user permissions',true,true),
  ('field_policies.manage','settings','field_policies.manage','Manage Field Policies','Manage field-level policies',true,true),
  ('scopes.manage','settings','scopes.manage','Manage Scope Sets','Manage custom scope sets',true,true),

  -- Settings / Reports / Audit
  ('settings.read','settings','read','Read Settings','View settings pages',true,true),
  ('settings.pipeline.manage','settings','pipeline.manage','Manage Pipeline Settings','Manage pipeline configuration',true,true),
  ('settings.security.manage','settings','security.manage','Manage Security Settings','Manage security settings',true,true),
  ('settings.ui.manage','settings','ui.manage','Manage UI Settings','Manage UI/settings',true,true),
  ('settings.integrations.manage','settings','integrations.manage','Manage Integrations','Manage integrations',true,true),

  ('reports.read','reports','read','Read Reports','View reports',true,true),
  ('reports.export','reports','export','Export Reports','Export reports data',true,true),

  ('audit.read','audit','read','Read Audit Logs','View audit logs',true,true)

on conflict (key) do nothing;

-- default roles
insert into public.roles(name, description, is_system, is_active)
values
  ('Sales','Sales representative',true,true),
  ('Manager','Team manager',true,true),
  ('Admin','System admin',true,true),
  ('SuperAdmin','Super administrator',true,true)
on conflict (name) do nothing;

-- role_permissions seeds
-- Sales: self scope basic lead + notes
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'self'
from public.roles r
join public.permissions p on p.key in (
  'leads.read','leads.create','leads.update','leads.close',
  'lead_notes.read','lead_notes.create'
)
where r.name = 'Sales'
on conflict do nothing;

-- Manager: team scope
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'team'
from public.roles r
join public.permissions p on p.key in (
  'leads.read','leads.update','leads.close','leads.assign',
  'lead_notes.read','lead_notes.create',
  'reports.read'
)
where r.name = 'Manager'
on conflict do nothing;

-- Admin: org scope core + admin capabilities
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'org'
from public.roles r
join public.permissions p on p.key in (
  'leads.read','leads.create','leads.update','leads.assign','leads.transfer','leads.close','leads.export',
  'leads.fields.read_sensitive','leads.fields.write_sensitive',
  'leads.fields.read_internal','leads.fields.write_internal',
  'lead_notes.read','lead_notes.create','lead_notes.update',
  'auth.approve','auth.reject','auth.disable','auth.restore',
  'profiles.manage','teams.manage','roles.manage',
  'permissions.read','reports.read','audit.read'
)
where r.name = 'Admin'
on conflict do nothing;

-- SuperAdmin: org scope + permission-system and settings
insert into public.role_permissions(role_id, permission_key, effect, scope_type)
select r.id, p.key, 'allow', 'org'
from public.roles r
join public.permissions p on p.key in (
  'permissions.read','permissions.manage',
  'role_permissions.manage','user_permissions.manage',
  'field_policies.manage','scopes.manage',
  'settings.read','settings.pipeline.manage','settings.security.manage','settings.ui.manage','settings.integrations.manage'
)
where r.name = 'SuperAdmin'
on conflict do nothing;

-- field_policies seeds
insert into public.field_policies(resource, field, read_permission_key, write_permission_key, mask_strategy)
values
  ('leads','customer_phone','leads.fields.read_sensitive','leads.fields.write_sensitive','phone_mask'),
  ('leads','customer_email','leads.fields.read_sensitive','leads.fields.write_sensitive','email_mask'),
  ('leads','address','leads.fields.read_sensitive','leads.fields.write_sensitive','null'),
  ('leads','budget','leads.fields.read_sensitive','leads.fields.write_sensitive','null'),
  ('leads','internal_score','leads.fields.read_internal','leads.fields.write_internal','null'),
  ('leads','blacklist_reason','leads.fields.read_internal','leads.fields.write_internal','null')
on conflict (resource, field) do nothing;
