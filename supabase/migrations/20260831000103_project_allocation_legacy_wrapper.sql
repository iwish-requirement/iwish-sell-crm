-- Route the original single-optimizer RPC signature through the multi-select
-- implementation so older clients also populate the new array columns.

create or replace function iwish.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_google_optimizer_id uuid default null, p_meta_optimizer_id uuid default null,
  p_criteo_optimizer_id uuid default null, p_bing_optimizer_id uuid default null,
  p_edm_optimizer_id uuid default null, p_influencer_marketing_id uuid default null,
  p_note text default null, p_detail_link text default null
) returns void language plpgsql security definer set search_path=public,iwish as $$
begin
  perform iwish.rpc_project_allocation_upsert(
    p_lead_id, p_department_team_id, p_project_manager_id,
    '{}'::text[],
    case when p_google_optimizer_id is null then '{}'::uuid[] else array[p_google_optimizer_id] end,
    case when p_meta_optimizer_id is null then '{}'::uuid[] else array[p_meta_optimizer_id] end,
    case when p_criteo_optimizer_id is null then '{}'::uuid[] else array[p_criteo_optimizer_id] end,
    case when p_bing_optimizer_id is null then '{}'::uuid[] else array[p_bing_optimizer_id] end,
    case when p_edm_optimizer_id is null then '{}'::uuid[] else array[p_edm_optimizer_id] end,
    case when p_influencer_marketing_id is null then '{}'::uuid[] else array[p_influencer_marketing_id] end,
    p_note, p_detail_link
  );
end $$;

create or replace function public.rpc_project_allocation_upsert(
  p_lead_id uuid, p_department_team_id int, p_project_manager_id uuid,
  p_google_optimizer_id uuid default null, p_meta_optimizer_id uuid default null,
  p_criteo_optimizer_id uuid default null, p_bing_optimizer_id uuid default null,
  p_edm_optimizer_id uuid default null, p_influencer_marketing_id uuid default null,
  p_note text default null, p_detail_link text default null
) returns void language sql security definer set search_path=public,iwish
as $$ select iwish.rpc_project_allocation_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11); $$;
grant execute on function public.rpc_project_allocation_upsert(uuid,int,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text) to authenticated;
