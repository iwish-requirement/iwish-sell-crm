-- 051_leads_kanban_import_strict_validation.sql
-- 线索看板导入改为严格校验：预检查与正式导入共享同一套数据库规则，
-- 任一行失败则整批不落库，并返回明确的行级错误。

create or replace function iwish.rpc_leads_import_kanban_validate_payload(p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public, iwish
as $$
begin
  begin
    perform public.rpc_lead_create(p_payload);
    raise sqlstate 'ZX001' using message = 'ROLLBACK_AFTER_VALIDATE';
  exception
    when sqlstate 'ZX001' then
      return null;
    when others then
      return sqlerrm;
  end;
end;
$$;

create or replace function public.rpc_leads_import_kanban_check(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_item jsonb;
  v_payload jsonb;
  v_row_index integer;
  v_error text;
  v_row_errors jsonb := '[]'::jsonb;
  v_total_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ERR_VALIDATION:empty_import_rows';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_rows)
  loop
    v_total_count := v_total_count + 1;
    v_row_index := coalesce((v_item->>'rowIndex')::integer, v_total_count);
    v_payload := case
      when jsonb_typeof(v_item) = 'object' and v_item ? 'payload' then v_item->'payload'
      else v_item
    end;

    if v_payload is null or jsonb_typeof(v_payload) <> 'object' then
      v_row_errors := v_row_errors || jsonb_build_array(
        jsonb_build_object(
          'rowIndex', v_row_index,
          'message', '该行没有生成有效的导入数据，请先修正模板内容'
        )
      );
      continue;
    end if;

    v_error := iwish.rpc_leads_import_kanban_validate_payload(v_payload);

    if v_error is not null then
      v_row_errors := v_row_errors || jsonb_build_array(
        jsonb_build_object(
          'rowIndex', v_row_index,
          'message', v_error
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_row_errors) = 0,
    'totalCount', v_total_count,
    'validCount', v_total_count - jsonb_array_length(v_row_errors),
    'rowErrors', v_row_errors
  );
end;
$$;

grant execute on function public.rpc_leads_import_kanban_check(jsonb) to authenticated, service_role;

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
  v_check jsonb;
  v_item jsonb;
  v_payload jsonb;
  v_row_index integer := 0;
  v_imported integer := 0;
  v_total_count integer := 0;
  v_row_errors jsonb := '[]'::jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ERR_VALIDATION:empty_import_rows';
  end if;

  v_total_count := jsonb_array_length(p_rows);
  v_check := public.rpc_leads_import_kanban_check(p_rows);
  v_row_errors := coalesce(v_check->'rowErrors', '[]'::jsonb);

  if jsonb_array_length(v_row_errors) > 0 then
    if p_auto_complete then
      perform public.rpc_leads_import_mark_complete(
        p_job_id => p_job_id,
        p_status => 'failed',
        p_total_count => v_total_count,
        p_success_count => 0,
        p_duplicate_count => 0,
        p_error_message => '存在未通过校验的导入行，请先修正后再导入'
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'importedCount', 0,
      'failedCount', jsonb_array_length(v_row_errors),
      'rowErrors', v_row_errors
    );
  end if;

  begin
    for v_item in
      select value
      from jsonb_array_elements(p_rows)
    loop
      v_row_index := coalesce((v_item->>'rowIndex')::integer, v_imported + 1);
      v_payload := case
        when jsonb_typeof(v_item) = 'object' and v_item ? 'payload' then v_item->'payload'
        else v_item
      end;

      perform public.rpc_lead_create(v_payload);
      v_imported := v_imported + 1;
    end loop;
  exception
    when others then
      v_row_errors := jsonb_build_array(
        jsonb_build_object(
          'rowIndex', v_row_index,
          'message', sqlerrm
        )
      );

      if p_auto_complete then
        perform public.rpc_leads_import_mark_complete(
          p_job_id => p_job_id,
          p_status => 'failed',
          p_total_count => v_total_count,
          p_success_count => 0,
          p_duplicate_count => 0,
          p_error_message => sqlerrm
        );
      end if;

      return jsonb_build_object(
        'ok', false,
        'importedCount', 0,
        'failedCount', 1,
        'rowErrors', v_row_errors
      );
  end;

  if p_auto_complete then
    perform public.rpc_leads_import_mark_complete(
      p_job_id => p_job_id,
      p_status => 'completed',
      p_total_count => v_total_count,
      p_success_count => v_imported,
      p_duplicate_count => 0,
      p_error_message => null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'importedCount', v_imported,
    'failedCount', 0,
    'rowErrors', '[]'::jsonb
  );
end;
$$;

grant execute on function public.rpc_leads_import_kanban(uuid, jsonb, boolean) to authenticated, service_role;
