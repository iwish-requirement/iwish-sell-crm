-- 019_auto_return_leads_to_pool.sql
-- Automatic public pool drop job based on pipeline.business_rules settings (public_pool_days)

drop function if exists public.rpc_auto_return_leads_to_pool();
drop function if exists iwish.rpc_auto_return_leads_to_pool();

create or replace function iwish.rpc_auto_return_leads_to_pool()
returns jsonb
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_public_pool_days int := 30;
  v_settings jsonb;
  v_now timestamptz := now();
  v_cutoff timestamptz;
  v_dropped_count int := 0;
  v_reason text;
  v_before jsonb;
  v_after jsonb;
  rec public.leads;
begin
  -- load public_pool_days from settings if present
  select value
  into v_settings
  from public.settings
  where key = 'pipeline.business_rules';

  if v_settings is not null and (v_settings ? 'public_pool_days') then
    v_public_pool_days := coalesce((v_settings->>'public_pool_days')::int, v_public_pool_days);
  end if;

  if v_public_pool_days <= 0 then
    -- nothing to do if misconfigured
    return jsonb_build_object(
      'dropped_count', 0,
      'public_pool_days', v_public_pool_days,
      'skipped', true,
      'reason', 'public_pool_days is not positive'
    );
  end if;

  v_cutoff := v_now - (v_public_pool_days || ' days')::interval;
  v_reason := format('超过 %s 天未跟进自动掉入公海池', v_public_pool_days);

  for rec in
    select *
    from public.leads
    where status <> 'pool'
      and status = 'open'
      and coalesce(last_contact_at, created_at) <= v_cutoff
  loop
    v_before := to_jsonb(rec.*);

    update public.leads l
    set status = 'pool'
    where l.id = rec.id
    returning to_jsonb(l.*) into v_after;

    perform iwish.audit(
      rec.owner_id,
      'return_lead_to_pool',
      'lead',
      rec.id::text,
      v_before,
      v_after,
      v_reason
    );

    v_dropped_count := v_dropped_count + 1;
  end loop;

  return jsonb_build_object(
    'dropped_count', v_dropped_count,
    'public_pool_days', v_public_pool_days,
    'cutoff_at', v_cutoff
  );
end;
$$;

create or replace function public.rpc_auto_return_leads_to_pool()
returns jsonb
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_auto_return_leads_to_pool();
$$;

grant execute on function public.rpc_auto_return_leads_to_pool() to authenticated, service_role;
