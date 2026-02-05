-- 039_wecom_notifications_and_renewal_job.sql
-- WeCom notification settings and renewal upcoming auto-notify RPC

-- 1) helper: get wecom.notifications settings with defaults
create or replace function iwish.get_wecom_notifications_settings()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_value jsonb;
  v_renewal_enabled boolean := true;
  v_renewal_days int := 30;
begin
  select value into v_value
  from public.settings
  where key = 'wecom.notifications';

  if v_value is not null then
    if (v_value ? 'renewal_upcoming') then
      v_renewal_enabled := coalesce((v_value->'renewal_upcoming'->>'enabled')::boolean, v_renewal_enabled);
      v_renewal_days := coalesce((v_value->'renewal_upcoming'->>'days_before')::int, v_renewal_days);
    end if;
  end if;

  if v_renewal_days is null or v_renewal_days <= 0 then
    v_renewal_days := 30;
  end if;

  return jsonb_build_object(
    'renewal_upcoming', jsonb_build_object(
      'enabled', v_renewal_enabled,
      'days_before', v_renewal_days
    )
  );
end;
$$;

create or replace function public.rpc_get_wecom_notifications_settings()
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.get_wecom_notifications_settings();
$$;

grant execute on function public.rpc_get_wecom_notifications_settings() to authenticated, service_role;


-- 2) RPC: find renewal upcoming WeCom notification targets (grouped by owner profile)
create or replace function iwish.get_renewal_upcoming_wecom_targets()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_settings jsonb;
  v_enabled boolean := true;
  v_days_before int := 30;
  v_today date := current_date;
  v_target_date date;
  v_result jsonb := '[]'::jsonb;
begin
  v_settings := iwish.get_wecom_notifications_settings();

  if v_settings is not null and (v_settings ? 'renewal_upcoming') then
    v_enabled := coalesce((v_settings->'renewal_upcoming'->>'enabled')::boolean, v_enabled);
    v_days_before := coalesce((v_settings->'renewal_upcoming'->>'days_before')::int, v_days_before);
  end if;

  if not v_enabled then
    return '[]'::jsonb;
  end if;

  if v_days_before is null or v_days_before <= 0 then
    v_days_before := 30;
  end if;

  v_target_date := v_today + v_days_before;

  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_result
  from (
    select
      p.id as profile_id,
      p.full_name,
      p.wecom_user_id,
      jsonb_agg(
        jsonb_build_object(
          'contract_id', c.id,
          'lead_id', c.lead_id,
          'end_date', c.end_date,
          'amount', c.amount,
          'currency', c.currency,
          'customer_name', l.customer_name,
          'company_name', l.name,
          'contract_number', c.contract_number
        )
        order by c.end_date, c.signed_at desc
      ) as contracts
    from public.contracts c
    join public.leads l on l.id = c.lead_id
    join public.profiles p on p.id = l.owner_id
    where
      c.status = 'active'
      and c.end_date = v_target_date
      and p.wecom_bind_status = 'bound'
      and p.wecom_user_id is not null
      and (p.wecom_last_notified_at is null or p.wecom_last_notified_at < v_today::timestamptz)
    group by p.id, p.full_name, p.wecom_user_id
  ) as t;

  return v_result;
end;
$$;

create or replace function public.rpc_get_renewal_upcoming_wecom_targets()
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.get_renewal_upcoming_wecom_targets();
$$;

grant execute on function public.rpc_get_renewal_upcoming_wecom_targets() to authenticated, service_role;


-- 3) RPC: mark profiles as notified (update wecom_last_notified_at)
create or replace function iwish.rpc_wecom_mark_notified(p_profile_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
begin
  if p_profile_ids is null or array_length(p_profile_ids, 1) is null then
    return;
  end if;

  update public.profiles
  set wecom_last_notified_at = now()
  where id = any(p_profile_ids);
end;
$$;

create or replace function public.rpc_wecom_mark_notified(p_profile_ids uuid[])
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_wecom_mark_notified(p_profile_ids);
$$;

grant execute on function public.rpc_wecom_mark_notified(uuid[]) to authenticated, service_role;
