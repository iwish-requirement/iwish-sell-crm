-- Keep renewal/deal contract reads aligned with the underlying lead scope.
-- The old view exposed every contract row and the client then tried to enrich
-- names through leads_secure_view. Users could therefore see contract rows
-- without a readable lead, which rendered them as “未命名客户”.
create or replace view public.contracts_secure_view as
select
  c.id,
  c.lead_id,
  c.contract_number,
  c.title,
  c.amount,
  c.currency,
  c.signed_at,
  c.start_date,
  c.end_date,
  c.is_renewal,
  c.original_contract_id,
  c.status,
  c.created_by,
  c.created_at,
  c.updated_at
from public.contracts c
join public.leads l on l.id = c.lead_id
where coalesce(l.is_deleted, false) = false
  and iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'contracts.read')
  and iwish.has_permission(auth.uid(), 'leads.read')
  and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read');

comment on view public.contracts_secure_view is
  'Contracts readable only when the caller can read the linked lead; keeps renewal customer enrichment in scope.';
