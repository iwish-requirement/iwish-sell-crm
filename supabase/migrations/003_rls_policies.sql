-- profiles RLS
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
on public.profiles
for select
using (iwish.has_permission(auth.uid(), 'profiles.manage'));

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
on public.profiles
for update
using (iwish.has_permission(auth.uid(), 'profiles.manage'))
with check (iwish.has_permission(auth.uid(), 'profiles.manage'));

-- profiles_public RLS (active users can read)
alter table public.profiles_public enable row level security;

drop policy if exists profiles_public_select_active on public.profiles_public;
create policy profiles_public_select_active
on public.profiles_public
for select
using (iwish.is_active_user(auth.uid()));

-- leads RLS
alter table public.leads enable row level security;

drop policy if exists leads_select_scope on public.leads;
create policy leads_select_scope
on public.leads
for select
using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.read')
  and iwish.in_scope_for_lead(auth.uid(), leads, 'leads.read')
);

drop policy if exists leads_update_scope on public.leads;
create policy leads_update_scope
on public.leads
for update
using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.update')
  and iwish.in_scope_for_lead(auth.uid(), leads, 'leads.update')
)
with check (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.update')
  and iwish.in_scope_for_lead(auth.uid(), leads, 'leads.update')
);

drop policy if exists leads_delete_scope on public.leads;
create policy leads_delete_scope
on public.leads
for delete
using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.delete')
  and iwish.in_scope_for_lead(auth.uid(), leads, 'leads.delete')
);

drop policy if exists leads_insert_basic on public.leads;
create policy leads_insert_basic
on public.leads
for insert
with check (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.create')
  and created_by = auth.uid()
);

-- lead_notes RLS
alter table public.lead_notes enable row level security;

drop policy if exists notes_select_scope on public.lead_notes;
create policy notes_select_scope
on public.lead_notes
for select
using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'lead_notes.read')
  and exists (
    select 1 from public.leads l
    where l.id = lead_notes.lead_id
      and iwish.has_permission(auth.uid(), 'leads.read')
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
  )
);

drop policy if exists notes_insert_scope on public.lead_notes;
create policy notes_insert_scope
on public.lead_notes
for insert
with check (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'lead_notes.create')
  and author_id = auth.uid()
  and exists (
    select 1 from public.leads l
    where l.id = lead_notes.lead_id
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
  )
);

drop policy if exists notes_update_author on public.lead_notes;
create policy notes_update_author
on public.lead_notes
for update
using (
  iwish.is_active_user(auth.uid())
  and (author_id = auth.uid() or iwish.has_permission(auth.uid(),'profiles.manage'))
)
with check (
  iwish.is_active_user(auth.uid())
  and (author_id = auth.uid() or iwish.has_permission(auth.uid(),'profiles.manage'))
);

-- permissions & RBAC tables RLS
alter table public.permissions enable row level security;

drop policy if exists perm_select_admin on public.permissions;
create policy perm_select_admin on public.permissions
for select using (iwish.has_permission(auth.uid(),'permissions.read'));

drop policy if exists perm_manage_super on public.permissions;
create policy perm_manage_super on public.permissions
for all using (iwish.has_permission(auth.uid(),'permissions.manage'))
with check (iwish.has_permission(auth.uid(),'permissions.manage'));

alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.field_policies enable row level security;
alter table public.custom_scope_sets enable row level security;

create policy role_perm_manage on public.role_permissions
for all using (iwish.has_permission(auth.uid(),'role_permissions.manage'))
with check (iwish.has_permission(auth.uid(),'role_permissions.manage'));

create policy user_perm_manage on public.user_permissions
for all using (iwish.has_permission(auth.uid(),'user_permissions.manage'))
with check (iwish.has_permission(auth.uid(),'user_permissions.manage'));

create policy field_policies_manage on public.field_policies
for all using (iwish.has_permission(auth.uid(),'field_policies.manage'))
with check (iwish.has_permission(auth.uid(),'field_policies.manage'));

create policy scopes_manage on public.custom_scope_sets
for all using (iwish.has_permission(auth.uid(),'scopes.manage'))
with check (iwish.has_permission(auth.uid(),'scopes.manage'));

-- audit_logs RLS
alter table public.audit_logs enable row level security;

create policy audit_read on public.audit_logs
for select using (iwish.has_permission(auth.uid(),'audit.read'));
