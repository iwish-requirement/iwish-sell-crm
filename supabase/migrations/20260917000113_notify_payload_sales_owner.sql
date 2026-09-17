-- Include the closing sales owner's name in the notify payload.
create or replace function public.rpc_allocation_notify_payload(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = public, iwish as $$
declare
  v_actor uuid := auth.uid();
  v_assign public.lead_project_assignments;
  v_lead public.leads;
  v_dept public.ops_departments;
  v_pm public.ops_members;
begin
  if not iwish.has_permission(v_actor, 'allocations.manage') then
    raise exception 'ERR_NO_PERMISSION:allocations.manage';
  end if;
  select * into v_assign from public.lead_project_assignments where lead_id = p_lead_id;
  if v_assign.id is null then raise exception 'ERR_NOT_FOUND:assignment'; end if;
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'ERR_NOT_FOUND:lead'; end if;
  select * into v_dept from public.ops_departments where id = v_assign.department_id;
  select * into v_pm from public.ops_members where id = v_assign.project_manager_id;
  return jsonb_build_object(
    'assignment_id', v_assign.id,
    'lead_id', p_lead_id,
    'company_name', v_lead.name,
    'customer_name', v_lead.customer_name,
    'website', v_lead.website,
    'department_name', v_dept.name,
    'platforms', coalesce(v_assign.platforms, '{}'::text[]),
    'note', v_assign.note,
    'detail_link', v_assign.detail_link,
    'pm_open_id', v_pm.feishu_user_id,
    'pm_name', v_pm.full_name,
    'sales_owner_name', (select full_name from public.profiles where id = v_lead.owner_id),
    'confirmed_at', v_assign.confirmed_at
  );
end $$;
grant execute on function public.rpc_allocation_notify_payload(uuid) to authenticated;
