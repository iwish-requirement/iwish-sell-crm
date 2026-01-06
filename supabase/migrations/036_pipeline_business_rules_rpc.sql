-- 036_pipeline_business_rules_rpc.sql
-- RPC wrapper to expose pipeline.business_rules thresholds to all authenticated users

create or replace function iwish.get_pipeline_business_rules()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_value jsonb;
  v_public_pool_days int := 30;
  v_warning_hours int := 72;
  v_danger_hours int := 168;
begin
  select value into v_value
  from public.settings
  where key = 'pipeline.business_rules';

  if v_value is not null then
    v_public_pool_days := coalesce((v_value->>'public_pool_days')::int, v_public_pool_days);
    v_warning_hours := coalesce((v_value->>'warning_hours')::int, v_warning_hours);
    v_danger_hours := coalesce((v_value->>'danger_hours')::int, v_danger_hours);
  end if;

  if v_public_pool_days <= 0 then
    v_public_pool_days := 30;
  end if;
  if v_warning_hours <= 0 then
    v_warning_hours := 72;
  end if;
  if v_danger_hours <= 0 then
    v_danger_hours := 168;
  end if;

  return jsonb_build_object(
    'public_pool_days', v_public_pool_days,
    'warning_hours', v_warning_hours,
    'danger_hours', v_danger_hours
  );
end;
$$;

create or replace function public.rpc_get_pipeline_business_rules()
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.get_pipeline_business_rules();
$$;

grant execute on function public.rpc_get_pipeline_business_rules() to authenticated, service_role;
