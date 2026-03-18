-- 047_leads_public_pool_import_rpc.sql
-- 为公海池导入提供批量 RPC：浏览器侧根据 AI 映射构造 rpc_lead_create 的 payload 列表，
-- 由该 RPC 在数据库侧循环执行导入，并更新 lead_import_jobs 的统计信息。

create or replace function public.rpc_leads_import_public_pool(
  p_job_id uuid,
  p_rows  jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_len           integer := coalesce(jsonb_array_length(p_rows), 0);
  v_idx           integer;
  v_payload       jsonb;
  v_imported      integer := 0;
  v_failed        integer := 0;
begin
  if v_len = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'empty_rows',
      'detail', '没有可导入的线索数据'
    );
  end if;

  -- 逐条调用现有的 rpc_lead_create，由其内部负责权限、RLS 与字段级校验。
  for v_idx in 0 .. v_len - 1 loop
    v_payload := p_rows -> v_idx;

    begin
      perform public.rpc_lead_create(v_payload);
      v_imported := v_imported + 1;
    exception when others then
      -- 任何异常都计入失败计数，具体错误由 rpc_lead_create 内部审计
      v_failed := v_failed + 1;
    end;
  end loop;

  -- 这里的 total_count 以传入的 payload 数量为准；
  -- duplicate_count 暂时记为 0，重复行由 rpc_lead_create/RLS 自行阻断。
  begin
    perform public.rpc_leads_import_mark_complete(
      p_job_id          => p_job_id,
      p_status          => 'completed',
      p_total_count     => v_len,
      p_success_count   => v_imported,
      p_duplicate_count => 0,
      p_error_message   => null
    );
  exception when others then
    -- 标记失败不影响导入结果返回，仅记录在日志中
    raise notice 'rpc_leads_import_mark_complete failed in rpc_leads_import_public_pool: %', sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true,
    'jobId', p_job_id,
    'totalCount', v_len,
    'importedCount', v_imported,
    'failedCount', v_failed,
    'duplicateCount', 0
  );
end;
$$;
