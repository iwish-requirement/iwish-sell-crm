-- Enable RLS for teams and roles + add RLS for lead_shares
-- and align profiles_public_view with profiles_public table

-- teams RLS
alter table public.teams enable row level security;

drop policy if exists teams_select_read on public.teams;
create policy teams_select_read
on public.teams
for select
using (
  iwish.is_active_user(auth.uid())
  and (
    iwish.has_permission(auth.uid(),'teams.read')
    or iwish.has_permission(auth.uid(),'teams.manage')
  )
);

drop policy if exists teams_manage on public.teams;
create policy teams_manage
on public.teams
for all
using (iwish.has_permission(auth.uid(),'teams.manage'))
with check (iwish.has_permission(auth.uid(),'teams.manage'));

-- roles RLS
alter table public.roles enable row level security;

drop policy if exists roles_select_read on public.roles;
create policy roles_select_read
on public.roles
for select
using (
  iwish.is_active_user(auth.uid())
  and (
    iwish.has_permission(auth.uid(),'roles.read')
    or iwish.has_permission(auth.uid(),'roles.manage')
  )
);

drop policy if exists roles_manage on public.roles;
create policy roles_manage
on public.roles
for all
using (iwish.has_permission(auth.uid(),'roles.manage'))
with check (iwish.has_permission(auth.uid(),'roles.manage'));

-- lead_shares RLS (mirror leads/notes scope semantics)
alter table public.lead_shares enable row level security;

drop policy if exists lead_shares_select_scope on public.lead_shares;
create policy lead_shares_select_scope
on public.lead_shares
for select
using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(),'leads.read')
  and exists (
    select 1 from public.leads l
    where l.id = lead_shares.lead_id
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
  )
);

drop policy if exists lead_shares_insert_scope on public.lead_shares;
create policy lead_shares_insert_scope
on public.lead_shares
for insert
with check (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(),'leads.assign')
  and exists (
    select 1 from public.leads l
    where l.id = lead_shares.lead_id
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
  )
);

drop policy if exists lead_shares_delete_scope on public.lead_shares;
create policy lead_shares_delete_scope
on public.lead_shares
for delete
using (
  iwish.is_active_user(auth.uid())
  and (
    iwish.has_permission(auth.uid(),'leads.assign')
    or iwish.has_permission(auth.uid(),'profiles.manage')
  )
  and exists (
    select 1 from public.leads l
    where l.id = lead_shares.lead_id
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
  )
);

-- align profiles_public_view to use profiles_public as the only exposure surface
create or replace view public.profiles_public_view as
select
  id,
  full_name,
  avatar_url,
  team_id,
  role_id,
  status
from public.profiles_public;
