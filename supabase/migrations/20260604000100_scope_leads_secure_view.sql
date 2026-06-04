-- Ensure browser queries only receive leads visible to the current user before
-- PostgREST applies its row cap. The previous view was owned by postgres and
-- bypassed table RLS, so old in-scope leads could fall past the first 1000 rows.

create or replace view public.leads_secure_view as
select
  l.id,
  l.team_id,
  l.owner_id,
  l.created_by,
  l.name,
  l.source,
  l.stage,
  l.status,
  l.close_result,
  l.close_reason,
  l.last_contact_at,
  l.created_at,
  l.updated_at,
  l.customer_name,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone
    else iwish.mask_phone(l.customer_phone)
  end as customer_phone,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email
    else iwish.mask_email(l.customer_email)
  end as customer_email,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address
    else null::text
  end as address,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget
    else null::numeric
  end as budget,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score
    else null::integer
  end as internal_score,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason
    else null::text
  end as blacklist_reason,
  l.next_contact_at,
  case
    when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.wechat
    else null::text
  end as wechat,
  l.customer_grade,
  l.source_level1,
  l.source_level2,
  l.tags,
  l.first_contact_at,
  l.locked_by,
  l.locked_until,
  l.protected_until,
  coalesce(
    (
      select json_agg(json_build_object('id', bc.id, 'name', bc.name) order by bc.sort_order)
      from public.leads_business_categories lbc
      join public.business_categories bc on bc.id = lbc.category_id and bc.is_active = true
      where lbc.lead_id = l.id
    ),
    '[]'::json
  ) as business_categories,
  coalesce(
    (
      select json_agg(
        json_build_object('id', bt.id, 'name', bt.name, 'category_id', bt.category_id)
        order by bt.sort_order
      )
      from public.leads_business_types lbt
      join public.business_types bt on bt.id = lbt.type_id and bt.is_active = true
      where lbt.lead_id = l.id
    ),
    '[]'::json
  ) as business_types,
  l.responsibility_type,
  l.dev_method_key,
  l.referral_customer_name,
  l.referral_type_key,
  l.activity_name,
  l.source_department_key,
  l.source_locked_at,
  l.website
from public.leads l
where
  coalesce(l.is_deleted, false) = false
  and iwish.is_active_user(auth.uid())
  and iwish.has_permission(auth.uid(), 'leads.read')
  and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read');
