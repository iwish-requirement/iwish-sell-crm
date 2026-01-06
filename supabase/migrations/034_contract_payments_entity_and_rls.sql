-- 034_contract_payments_entity_and_rls.sql
-- Define contract_payments entity linked to contracts, with RLS mirroring contracts/leads scope

create table if not exists public.contract_payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  amount numeric not null,
  currency text not null default 'CNY',
  paid_at timestamptz not null,
  method text,
  note text,
  status text not null default 'confirmed',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at trigger
drop trigger if exists trg_contract_payments_updated_at on public.contract_payments;
create trigger trg_contract_payments_updated_at
before update on public.contract_payments
for each row execute function iwish.set_updated_at();

create index if not exists idx_contract_payments_contract on public.contract_payments(contract_id);
create index if not exists idx_contract_payments_paid_at on public.contract_payments(paid_at desc);

-- RLS: mirror contracts/leads scope semantics
alter table public.contract_payments enable row level security;

-- select: only when user can read the underlying contract and lead in scope
drop policy if exists contract_payments_select_scope on public.contract_payments;
create policy contract_payments_select_scope
on public.contract_payments
for select
using (
  iwish.is_active_user(auth.uid())
  and exists (
    select 1
    from public.contracts c
    join public.leads l on l.id = c.lead_id
    where c.id = contract_payments.contract_id
      and iwish.has_permission(auth.uid(),'contracts.read')
      and iwish.has_permission(auth.uid(),'leads.read')
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
  )
);

-- insert: only when user can manage contracts for the underlying lead in scope
drop policy if exists contract_payments_insert_scope on public.contract_payments;
create policy contract_payments_insert_scope
on public.contract_payments
for insert
with check (
  iwish.is_active_user(auth.uid())
  and created_by = auth.uid()
  and exists (
    select 1
    from public.contracts c
    join public.leads l on l.id = c.lead_id
    where c.id = contract_payments.contract_id
      and iwish.has_permission(auth.uid(),'contracts.manage')
      and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
  )
);

-- update/delete: only for users with contracts.manage; scope is enforced via join
drop policy if exists contract_payments_update_scope on public.contract_payments;
create policy contract_payments_update_scope
on public.contract_payments
for update
using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(),'contracts.manage')
)
with check (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(),'contracts.manage')
);

drop policy if exists contract_payments_delete_scope on public.contract_payments;
create policy contract_payments_delete_scope
on public.contract_payments
for delete
using (
  iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(),'contracts.manage')
);
