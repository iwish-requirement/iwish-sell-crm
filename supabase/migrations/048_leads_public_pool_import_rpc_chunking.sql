-- 048_leads_public_pool_import_rpc_chunking.sql
-- 为公海池批量导入增加可选的“是否自动完结任务”参数，支持前端分批导入。

create or replace function public.rpc_leads_import_public_pool(
  p_job_id uuid,
  p_rows jsonb,
  p_mark_complete boolean default true
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_len integer := coalesce(jsonb_array_length(p_rows), 0);
  v_idx integer;
  v_payload jsonb;
  v_imported integer := 0;
  v_failed integer := 0;
begin
  if v_len = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'empty_rows',
      'detail', '没有可导入的线索数据'
    );
  end if;

  for v_idx in 0 .. v_len - 1 loop
    v_payload := p_rows -> v_idx;

    begin
      perform public.rpc_lead_create(v_payload);
      v_imported := v_imported + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  if coalesce(p_mark_complete, true) then
    begin
      perform public.rpc_leads_import_mark_complete(
        p_job_id => p_job_id,
        p_status => 'completed',
        p_total_count => v_len,
        p_success_count => v_imported,
        p_duplicate_count => 0,
        p_error_message => null
      );
    exception when others then
      raise notice 'rpc_leads_import_mark_complete failed in rpc_leads_import_public_pool: %', sqlerrm;
    end;
  end if;

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

grant execute on function public.rpc_leads_import_public_pool(uuid, jsonb, boolean) to authenticated, service_role;
