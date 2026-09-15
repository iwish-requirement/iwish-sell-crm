-- 离职/停用成员不再保留在部门中：其名下在谈线索自动退回公海池。
-- 退回口径与 rpc_leads_return_to_pool_batch 一致：
--   status='pool' + pool_return_reason + pool_returned_at + pool_returned_by，并写入审计。
-- 幂等：仅处理 status='open' 且归属账号非 active 的线索，重复执行无副作用。

do $$
declare
  rec record;
  v_reason text := '成员账号已停用，线索自动退回公海';
begin
  -- 1) 归属账号存在但已停用（status <> 'active'）
  for rec in
    select l.*
    from public.leads l
    join public.profiles p on p.id = l.owner_id
    where l.status = 'open'
      and coalesce(p.status, 'active') <> 'active'
  loop
    update public.leads
    set status = 'pool',
        pool_return_reason = v_reason,
        pool_returned_at = now(),
        pool_returned_by = rec.owner_id
    where id = rec.id and status = 'open';

    perform iwish.audit(
      rec.owner_id,
      'return_lead_to_pool',
      'lead',
      rec.id::text,
      to_jsonb(rec),
      (select to_jsonb(l.*) from public.leads l where l.id = rec.id),
      v_reason
    );
  end loop;

  -- 2) 归属账号已被删除（profiles 中不存在）；pool_returned_by 有外键约束，此时置空
  for rec in
    select l.*
    from public.leads l
    where l.status = 'open'
      and l.owner_id is not null
      and not exists (select 1 from public.profiles p where p.id = l.owner_id)
  loop
    update public.leads
    set status = 'pool',
        pool_return_reason = v_reason,
        pool_returned_at = now(),
        pool_returned_by = null
    where id = rec.id and status = 'open';

    perform iwish.audit(
      rec.created_by,
      'return_lead_to_pool',
      'lead',
      rec.id::text,
      to_jsonb(rec),
      (select to_jsonb(l.*) from public.leads l where l.id = rec.id),
      v_reason
    );
  end loop;
end $$;
