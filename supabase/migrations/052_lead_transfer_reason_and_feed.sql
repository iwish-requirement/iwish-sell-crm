-- 052_lead_transfer_reason_and_feed.sql
-- 为跨团队转移补充原因参数，并写入审计日志，方便接收方在线索详情中查看。

drop function if exists public.rpc_lead_transfer(uuid, int, uuid);
drop function if exists iwish.rpc_lead_transfer(uuid, int, uuid);

create or replace function iwish.rpc_lead_transfer(
  p_lead_id uuid,
  p_new_team_id int,
  p_new_owner uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.leads;
  v_before jsonb;
begin
  if not iwish.has_permission(v_actor, 'leads.transfer') then
    raise exception 'ERR_NO_PERMISSION:leads.transfer';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.transfer') then
    raise exception 'ERR_OUT_OF_SCOPE:leads.transfer';
  end if;

  v_before := to_jsonb(v_lead.*);

  update public.leads
  set team_id = p_new_team_id,
      owner_id = p_new_owner
  where id = p_lead_id;

  perform iwish.audit(
    v_actor,
    'transfer_lead',
    'lead',
    p_lead_id::text,
    v_before,
    (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id),
    nullif(trim(p_reason), '')
  );
end $$;

create or replace function public.rpc_lead_transfer(
  p_lead_id uuid,
  p_new_team_id int,
  p_new_owner uuid,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_transfer(p_lead_id, p_new_team_id, p_new_owner, p_reason);
$$;

grant execute on function public.rpc_lead_transfer(uuid, int, uuid, text) to authenticated, service_role;
