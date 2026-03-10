-- 045_leads_secure_view_website.sql
-- Extend leads_secure_view to expose website column at the end.

create or replace view public.leads_secure_view as
 SELECT id,
    team_id,
    owner_id,
    created_by,
    name,
    source,
    stage,
    status,
    close_result,
    close_reason,
    last_contact_at,
    created_at,
    updated_at,
    customer_name,
        CASE
            WHEN iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive'::text) THEN customer_phone
            ELSE iwish.mask_phone(customer_phone)
        END AS customer_phone,
        CASE
            WHEN iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive'::text) THEN customer_email
            ELSE iwish.mask_email(customer_email)
        END AS customer_email,
        CASE
            WHEN iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive'::text) THEN address
            ELSE NULL::text
        END AS address,
        CASE
            WHEN iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive'::text) THEN budget
            ELSE NULL::numeric
        END AS budget,
        CASE
            WHEN iwish.has_permission(auth.uid(), 'leads.fields.read_internal'::text) THEN internal_score
            ELSE NULL::integer
        END AS internal_score,
        CASE
            WHEN iwish.has_permission(auth.uid(), 'leads.fields.read_internal'::text) THEN blacklist_reason
            ELSE NULL::text
        END AS blacklist_reason,
    next_contact_at,
        CASE
            WHEN iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive'::text) THEN wechat
            ELSE NULL::text
        END AS wechat,
    customer_grade,
    source_level1,
    source_level2,
    tags,
    first_contact_at,
    locked_by,
    locked_until,
    protected_until,
    COALESCE(( SELECT json_agg(json_build_object('id', bc.id, 'name', bc.name) ORDER BY bc.sort_order) AS json_agg
           FROM leads_business_categories lbc
             JOIN business_categories bc ON bc.id = lbc.category_id AND bc.is_active = true
          WHERE lbc.lead_id = l.id), '[]'::json) AS business_categories,
    COALESCE(( SELECT json_agg(json_build_object('id', bt.id, 'name', bt.name, 'category_id', bt.category_id) ORDER BY bt.sort_order) AS json_agg
           FROM leads_business_types lbt
             JOIN business_types bt ON bt.id = lbt.type_id AND bt.is_active = true
          WHERE lbt.lead_id = l.id), '[]'::json) AS business_types,
    responsibility_type,
    dev_method_key,
    referral_customer_name,
    referral_type_key,
    activity_name,
    source_department_key,
    source_locked_at,
    website
   FROM public.leads l;
