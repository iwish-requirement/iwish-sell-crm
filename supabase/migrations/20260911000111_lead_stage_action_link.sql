-- Keep explicit stage changes and close outcomes visible in the customer action timeline.
-- The wrapper functions run both writes in one transaction so a stage cannot move
-- without a corresponding interaction record.

create or replace function iwish.rpc_lead_advance_with_action(
  p_lead_id uuid,
  p_next_stage text,
  p_content text
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'ERR_UNAUTHENTICATED';
  end if;
  if not iwish.has_permission(v_actor, 'lead_notes.create') then
    raise exception 'ERR_NO_PERMISSION:lead_notes.create';
  end if;
  if p_content is null or length(trim(p_content)) = 0 then
    raise exception 'ERR_VALIDATION:stage_action_content_required';
  end if;

  perform iwish.rpc_lead_pipeline_update(
    p_lead_id,
    null,
    p_next_stage,
    p_content
  );

  insert into public.lead_notes(lead_id, author_id, content, note_type)
  values (p_lead_id, v_actor, trim(p_content), 'stage_change');
end;
$$;

revoke all on function iwish.rpc_lead_advance_with_action(uuid, text, text) from public;
grant execute on function iwish.rpc_lead_advance_with_action(uuid, text, text) to authenticated, service_role;

create or replace function public.rpc_lead_advance_with_action(
  p_lead_id uuid,
  p_next_stage text,
  p_content text
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_advance_with_action($1, $2, $3);
$$;

revoke all on function public.rpc_lead_advance_with_action(uuid, text, text) from public;
grant execute on function public.rpc_lead_advance_with_action(uuid, text, text) to authenticated, service_role;

create or replace function iwish.rpc_lead_close_with_action(
  p_lead_id uuid,
  p_result text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'ERR_UNAUTHENTICATED';
  end if;
  if not iwish.has_permission(v_actor, 'lead_notes.create') then
    raise exception 'ERR_NO_PERMISSION:lead_notes.create';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'ERR_VALIDATION:close_reason_required';
  end if;
  if p_result not in ('won', 'lost') then
    raise exception 'ERR_VALIDATION:close_result_must_be_won_or_lost';
  end if;

  if p_result = 'won' then
    perform iwish.rpc_lead_pipeline_update(p_lead_id, null, 'won', p_reason);
  end if;

  perform iwish.rpc_lead_close(p_lead_id, p_result, trim(p_reason));

  insert into public.lead_notes(lead_id, author_id, content, note_type)
  values (p_lead_id, v_actor, trim(p_reason), p_result);
end;
$$;

revoke all on function iwish.rpc_lead_close_with_action(uuid, text, text) from public;
grant execute on function iwish.rpc_lead_close_with_action(uuid, text, text) to authenticated, service_role;

create or replace function public.rpc_lead_close_with_action(
  p_lead_id uuid,
  p_result text,
  p_reason text
)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_close_with_action($1, $2, $3);
$$;

revoke all on function public.rpc_lead_close_with_action(uuid, text, text) from public;
grant execute on function public.rpc_lead_close_with_action(uuid, text, text) to authenticated, service_role;
