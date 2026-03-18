-- 046_lead_import_jobs_status_and_complete_rpc.sql
-- 补充导入任务状态更新 RPC，用于在导入执行完毕后回写统计信息并写审计

set search_path = public, iwish;

-- 内部实现：iwish.rpc_leads_import_mark_complete
create or replace function iwish.rpc_leads_import_mark_complete(
  p_job_id uuid,
  p_status text,
  p_total_count int,
  p_success_count int,
  p_duplicate_count int,
  p_error_message text
)
returns void
language plpgsql
security definer
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
begin
  if v_actor is null then
    raise exception 'ERR_UNAUTHORIZED';
  end if;

  -- 仅任务创建者本人可以标记完成
  select to_jsonb(j.*) into v_before
  from public.lead_import_jobs j
  where j.id = p_job_id
    and j.created_by = v_actor;

  if v_before is null then
    raise exception 'ERR_NOT_FOUND_OR_FORBIDDEN:lead_import_job';
  end if;

  update public.lead_import_jobs
  set
    status = coalesce(p_status, status),
    total_count = coalesce(p_total_count, total_count),
    success_count = coalesce(p_success_count, success_count),
    duplicate_count = coalesce(p_duplicate_count, duplicate_count),
    error_message = p_error_message,
    completed_at = case when p_status in ('completed', 'failed') then now() else completed_at end
  where id = p_job_id;

  select to_jsonb(j.*) into v_after
  from public.lead_import_jobs j
  where j.id = p_job_id;

  perform iwish.audit(
    v_actor,
    'complete_leads_import',
    'lead_import_job',
    p_job_id::text,
    v_before,
    v_after,
    null
  );
end
$$;

-- 对外公开包装：public.rpc_leads_import_mark_complete
create or replace function public.rpc_leads_import_mark_complete(
  p_job_id uuid,
  p_status text,
  p_total_count int,
  p_success_count int,
  p_duplicate_count int,
  p_error_message text
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_leads_import_mark_complete(
    p_job_id,
    p_status,
    p_total_count,
    p_success_count,
    p_duplicate_count,
    p_error_message
  );
$$;

grant execute on function public.rpc_leads_import_mark_complete(uuid, text, int, int, int, text) to authenticated, service_role;
