-- 049_leads_kanban_import_rpc.sql
-- 批量导入标准公司资源线索到线索看板。

create or replace function public.rpc_leads_import_kanban(
  p_job_id uuid,
  p_rows jsonb,
  p_auto_complete boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_row jsonb;
  v_imported integer := 0;
  v_failed integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ERR_VALIDATION:empty_import_rows';
  end if;

  for v_row in
    select value
    from jsonb_array_elements(p_rows)
  loop
    begin
      perform public.rpc_lead_create(v_row);
      v_imported := v_imported + 1;
    exception
      when others then
        v_failed := v_failed + 1;
    end;
  end loop;

  if p_auto_complete then
    begin
      perform public.rpc_leads_import_mark_complete(
        p_job_id => p_job_id,
        p_status => 'completed',
        p_total_count => v_imported + v_failed,
        p_success_count => v_imported,
        p_duplicate_count => 0,
        p_error_message => null
      );
    exception
      when others then
        raise notice 'rpc_leads_import_mark_complete failed in rpc_leads_import_kanban: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'importedCount', v_imported,
    'failedCount', v_failed
  );
end;
$$;

grant execute on function public.rpc_leads_import_kanban(uuid, jsonb, boolean) to authenticated, service_role;
