-- Simplified allocation flow: the CRM form only sets department, project
-- manager, platforms, note and detail link; team roles are confirmed by the
-- project manager via the Feishu card. p_preserve_team keeps existing role
-- arrays so admin edits (note/link/platform tweaks) do not wipe the confirmed
-- team; changing the manager or department resets the confirmation instead.

drop function if exists public.rpc_project_allocation_upsert(uuid, int, uuid, text[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], text, text);
drop function if exists iwish.rpc_project_allocation_upsert(uuid, int, uuid, text[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], text, text);

create or replace function iwish.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_platforms text[] default '{}', p_google_optimizer_ids uuid[] default '{}', p_meta_optimizer_ids uuid[] default '{}',
  p_criteo_optimizer_ids uuid[] default '{}', p_bing_optimizer_ids uuid[] default '{}', p_edm_optimizer_ids uuid[] default '{}',
  p_influencer_marketing_ids uuid[] default '{}', p_note text default null, p_detail_link text default null,
  p_preserve_team boolean default false
) returns void language plpgsql security definer set search_path=public,iwish as $$
declare v_actor uuid:=auth.uid(); v_lead public.leads; v_before jsonb;
  v_existing public.lead_project_assignments;
  v_platforms text[] := coalesce(array(select distinct trim(x) from unnest(coalesce(p_platforms,'{}')) x where trim(x) <> ''), '{}');
  v_google uuid[] := coalesce(p_google_optimizer_ids,'{}'); v_meta uuid[] := coalesce(p_meta_optimizer_ids,'{}');
  v_criteo uuid[] := coalesce(p_criteo_optimizer_ids,'{}'); v_bing uuid[] := coalesce(p_bing_optimizer_ids,'{}');
  v_edm uuid[] := coalesce(p_edm_optimizer_ids,'{}'); v_influencer uuid[] := coalesce(p_influencer_marketing_ids,'{}');
  v_all uuid[];
  v_keep_confirmation boolean;
begin
  if not iwish.has_permission(v_actor,'allocations.manage') then raise exception 'ERR_NO_PERMISSION:allocations.manage'; end if;
  select * into v_lead from public.leads where id=p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  if not iwish.in_scope_for_lead(v_actor, v_lead, 'allocations.manage') then raise exception 'ERR_OUT_OF_SCOPE:allocations.manage'; end if;
  if v_lead.status <> 'closed' or v_lead.close_result not in ('won','成交') then raise exception 'ERR_VALIDATION:allocation_requires_won_deal'; end if;
  if p_department_team_id is null or p_project_manager_id is null then raise exception 'ERR_VALIDATION:allocation_required_fields'; end if;
  if not exists (select 1 from public.teams where id=p_department_team_id and is_active) then raise exception 'ERR_VALIDATION:invalid_project_team'; end if;
  if not exists (select 1 from public.ops_members where id=p_project_manager_id and is_active) then raise exception 'ERR_VALIDATION:invalid_project_manager'; end if;

  if p_preserve_team then
    select * into v_existing from public.lead_project_assignments a where a.lead_id=p_lead_id;
    if v_existing.id is not null then
      v_google := coalesce(v_existing.google_optimizer_ids, v_google);
      v_meta := coalesce(v_existing.meta_optimizer_ids, v_meta);
      v_criteo := coalesce(v_existing.criteo_optimizer_ids, v_criteo);
      v_bing := coalesce(v_existing.bing_optimizer_ids, v_bing);
      v_edm := coalesce(v_existing.edm_optimizer_ids, v_edm);
      v_influencer := coalesce(v_existing.influencer_marketing_ids, v_influencer);
    end if;
  end if;

  v_all := v_google || v_meta || v_criteo || v_bing || v_edm || v_influencer;
  if exists (select 1 from public.ops_members where id = any(v_all) and not is_active)
     or exists (select 1 from unnest(v_all) x(id) left join public.ops_members om on om.id=x.id where om.id is null)
  then raise exception 'ERR_VALIDATION:invalid_optimizer'; end if;

  v_before := (select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id);
  insert into public.lead_project_assignments(lead_id,department_team_id,project_manager_id,platforms,google_optimizer_ids,meta_optimizer_ids,criteo_optimizer_ids,bing_optimizer_ids,edm_optimizer_ids,influencer_marketing_ids,google_optimizer_id,meta_optimizer_id,criteo_optimizer_id,bing_optimizer_id,edm_optimizer_id,influencer_marketing_id,note,detail_link,assigned_by,assigned_at,allocation_source,sync_status,sync_version,idempotency_key,confirmed_at,confirmed_by)
  values(p_lead_id,p_department_team_id,p_project_manager_id,v_platforms,v_google,v_meta,v_criteo,v_bing,v_edm,v_influencer,v_google[1],v_meta[1],v_criteo[1],v_bing[1],v_edm[1],v_influencer[1],nullif(trim(p_note),''),nullif(trim(p_detail_link),''),v_actor,now(),'crm_manual','not_connected',1,gen_random_uuid(),null,null)
  on conflict(lead_id) do update set
    department_team_id=excluded.department_team_id,
    project_manager_id=excluded.project_manager_id,
    platforms=excluded.platforms,
    google_optimizer_ids=excluded.google_optimizer_ids,meta_optimizer_ids=excluded.meta_optimizer_ids,
    criteo_optimizer_ids=excluded.criteo_optimizer_ids,bing_optimizer_ids=excluded.bing_optimizer_ids,
    edm_optimizer_ids=excluded.edm_optimizer_ids,influencer_marketing_ids=excluded.influencer_marketing_ids,
    google_optimizer_id=excluded.google_optimizer_id,meta_optimizer_id=excluded.meta_optimizer_id,
    criteo_optimizer_id=excluded.criteo_optimizer_id,bing_optimizer_id=excluded.bing_optimizer_id,
    edm_optimizer_id=excluded.edm_optimizer_id,influencer_marketing_id=excluded.influencer_marketing_id,
    note=excluded.note,detail_link=excluded.detail_link,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at,
    allocation_source='crm_manual',
    sync_status=case when public.lead_project_assignments.sync_status='not_connected' then 'not_connected' else 'pending' end,
    external_assignment_id=null,last_synced_at=null,sync_error=null,
    sync_version=public.lead_project_assignments.sync_version+1,
    confirmed_at=case
      when p_preserve_team
        and public.lead_project_assignments.project_manager_id = excluded.project_manager_id
        and public.lead_project_assignments.department_team_id = excluded.department_team_id
      then public.lead_project_assignments.confirmed_at else null end,
    confirmed_by=case
      when p_preserve_team
        and public.lead_project_assignments.project_manager_id = excluded.project_manager_id
        and public.lead_project_assignments.department_team_id = excluded.department_team_id
      then public.lead_project_assignments.confirmed_by else null end;
  update public.leads set allocation_status='assigned' where id=p_lead_id;
  perform iwish.audit(v_actor,'assign_project_group','lead',p_lead_id::text,v_before,(select to_jsonb(a) from public.lead_project_assignments a where a.lead_id=p_lead_id),null);
end $$;

create or replace function public.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_platforms text[] default '{}', p_google_optimizer_ids uuid[] default '{}', p_meta_optimizer_ids uuid[] default '{}',
  p_criteo_optimizer_ids uuid[] default '{}', p_bing_optimizer_ids uuid[] default '{}', p_edm_optimizer_ids uuid[] default '{}',
  p_influencer_marketing_ids uuid[] default '{}', p_note text default null, p_detail_link text default null,
  p_preserve_team boolean default false
) returns void language sql security definer set search_path=public,iwish
as $$ select iwish.rpc_project_allocation_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13); $$;
grant execute on function public.rpc_project_allocation_upsert(uuid,int,uuid,text[],uuid[],uuid[],uuid[],uuid[],uuid[],uuid[],text,text,boolean) to authenticated;
