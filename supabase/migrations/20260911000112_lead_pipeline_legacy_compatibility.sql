-- Preserve the legacy lifecycle stage when the follow-up pipeline is introduced.
-- This is intentionally idempotent and only fills the new field when it still
-- has its default value, so manually progressed follow-up stages are untouched.

update public.leads
set follow_up_stage = case lower(trim(coalesce(stage, '')))
  when 'l1' then 'uncontacted'
  when 'l2' then 'connected'
  when 'l3' then 'proposal_quotation'
  when 'l4' then 'proposal_negotiation'
  when 'won' then 'won'
  when 'new' then 'uncontacted'
  else follow_up_stage
end
where follow_up_stage = 'uncontacted'
  and lower(trim(coalesce(stage, ''))) in ('l1', 'l2', 'l3', 'l4', 'won', 'new');
