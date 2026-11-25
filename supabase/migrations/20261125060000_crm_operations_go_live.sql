-- 运营送单正式开启（iWish 运营系统 2026-11-25 确认）。
-- 1. 清空试单线索，起算时间取分配中心启用时间（试单线索早于它时取试单时间），开启全局送单。
-- 2. 已完成部门分配的线索成交补发一次：入队只在保存分配时发生，开启前已分配的不会自动进队列。
--    历史成交（history_id）不在送单范围内，另行处理。
-- 回退：update crm_allocation.operations_release set enabled = false;（已入队的保留，恢复前核对待发范围）

update crm_allocation.operations_release o
set pilot_lead_id = null,
    enabled_after = coalesce(
      least(
        (select r.required_after from crm_allocation.release r),
        (select a.submitted_at from crm_allocation.assignments a where a.lead_id = o.pilot_lead_id)
      ),
      '2026-11-24 00:00:00+08'::timestamptz
    ),
    enabled = true;

do $$
declare
  item record;
begin
  for item in
    select a.id from crm_allocation.assignments a
    where a.lead_id is not null and crm_allocation.operations_assignment_current(a.id)
    order by a.submitted_at
  loop
    perform crm_allocation.enqueue_operations_assignment(item.id);
  end loop;
end;
$$;
