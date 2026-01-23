-- 031_business_types_and_wecom.sql
-- Add business category/type taxonomy and lead associations; expose via secure view; update RPCs.
-- Add WeCom binding fields on profiles.

-- 1) Business taxonomy tables
create table if not exists public.business_categories (
  id bigserial primary key,
  name text not null unique,
  description text,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.business_types (
  id bigserial primary key,
  category_id bigint not null references public.business_categories(id) on delete restrict,
  name text not null,
  description text,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  unique(category_id, name)
);

create table if not exists public.leads_business_categories (
  lead_id uuid not null references public.leads(id) on delete cascade,
  category_id bigint not null references public.business_categories(id) on delete restrict,
  primary key (lead_id, category_id)
);

create table if not exists public.leads_business_types (
  lead_id uuid not null references public.leads(id) on delete cascade,
  type_id bigint not null references public.business_types(id) on delete restrict,
  primary key (lead_id, type_id)
);

create index if not exists idx_business_categories_active_sort on public.business_categories(is_active, sort_order);
create index if not exists idx_business_types_active_sort on public.business_types(category_id, is_active, sort_order);
create index if not exists idx_leads_business_types_lead on public.leads_business_types(lead_id);
create index if not exists idx_leads_business_categories_lead on public.leads_business_categories(lead_id);

-- updated_at triggers
drop trigger if exists set_updated_at_before_update_business_categories on public.business_categories;
create trigger set_updated_at_before_update_business_categories
  before update on public.business_categories
  for each row execute procedure iwish.set_updated_at();

drop trigger if exists set_updated_at_before_update_business_types on public.business_types;
create trigger set_updated_at_before_update_business_types
  before update on public.business_types
  for each row execute procedure iwish.set_updated_at();


-- 2) RLS
alter table public.business_categories enable row level security;
alter table public.business_types enable row level security;
alter table public.leads_business_categories enable row level security;
alter table public.leads_business_types enable row level security;

-- categories
drop policy if exists business_categories_select on public.business_categories;
drop policy if exists business_categories_insert on public.business_categories;
drop policy if exists business_categories_update on public.business_categories;
drop policy if exists business_categories_delete on public.business_categories;

create policy business_categories_select on public.business_categories
  for select using (iwish.is_active_user(auth.uid()));
create policy business_categories_insert on public.business_categories
  for insert with check (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'));
create policy business_categories_update on public.business_categories
  for update using (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'))
  with check (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'));
create policy business_categories_delete on public.business_categories
  for delete using (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'));

-- types
drop policy if exists business_types_select on public.business_types;
drop policy if exists business_types_insert on public.business_types;
drop policy if exists business_types_update on public.business_types;
drop policy if exists business_types_delete on public.business_types;

create policy business_types_select on public.business_types
  for select using (iwish.is_active_user(auth.uid()));
create policy business_types_insert on public.business_types
  for insert with check (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'));
create policy business_types_update on public.business_types
  for update using (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'))
  with check (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'));
create policy business_types_delete on public.business_types
  for delete using (iwish.has_permission(auth.uid(), 'settings.pipeline.manage'));

-- lead associations: scoped per-lead visibility
drop policy if exists leads_business_categories_select on public.leads_business_categories;
drop policy if exists leads_business_categories_insert on public.leads_business_categories;
drop policy if exists leads_business_categories_delete on public.leads_business_categories;
drop policy if exists leads_business_categories_update on public.leads_business_categories;

drop policy if exists leads_business_types_select on public.leads_business_types;
drop policy if exists leads_business_types_insert on public.leads_business_types;
drop policy if exists leads_business_types_delete on public.leads_business_types;
drop policy if exists leads_business_types_update on public.leads_business_types;

create policy leads_business_categories_select on public.leads_business_categories
  for select using (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
    )
  );
create policy leads_business_categories_insert on public.leads_business_categories
  for insert with check (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  );
create policy leads_business_categories_delete on public.leads_business_categories
  for delete using (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  );
create policy leads_business_categories_update on public.leads_business_categories
  for update using (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  )
  with check (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  );

create policy leads_business_types_select on public.leads_business_types
  for select using (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
    )
  );
create policy leads_business_types_insert on public.leads_business_types
  for insert with check (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  );
create policy leads_business_types_delete on public.leads_business_types
  for delete using (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  );
create policy leads_business_types_update on public.leads_business_types
  for update using (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  )
  with check (
    exists (
      select 1 from public.leads l
      where l.id = lead_id and iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
    )
  );


-- 3) Profiles & leads: WeCom binding fields + ensure wechat column exists
alter table public.profiles
  add column if not exists wecom_user_id text,
  add column if not exists wecom_bind_status text check (wecom_bind_status in ('bound','unbound','failed') or wecom_bind_status is null) default 'unbound',
  add column if not exists wecom_bound_at timestamptz,
  add column if not exists wecom_last_notified_at timestamptz;

alter table public.leads
  add column if not exists wechat text;

-- 4) leads_secure_view: include business categories/types aggregations
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
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_phone else iwish.mask_phone(l.customer_phone) end as customer_phone,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.customer_email else iwish.mask_email(l.customer_email) end as customer_email,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.address else null end as address,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.budget else null end as budget,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.internal_score else null end as internal_score,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_internal') then l.blacklist_reason else null end as blacklist_reason,
  l.next_contact_at,
  case when iwish.has_permission(auth.uid(), 'leads.fields.read_sensitive') then l.wechat else null end as wechat,
  l.customer_grade,
  l.source_level1,
  l.source_level2,
  l.tags,
  coalesce(
    (
      select json_agg(json_build_object('id', bc.id, 'name', bc.name) order by bc.sort_order)
      from public.leads_business_categories lbc
      join public.business_categories bc on bc.id = lbc.category_id and bc.is_active = true
      where lbc.lead_id = l.id
    ), '[]'::json
  ) as business_categories,
  coalesce(
    (
      select json_agg(json_build_object('id', bt.id, 'name', bt.name, 'category_id', bt.category_id) order by bt.sort_order)
      from public.leads_business_types lbt
      join public.business_types bt on bt.id = lbt.type_id and bt.is_active = true
      where lbt.lead_id = l.id
    ), '[]'::json
  ) as business_types
from public.leads l;

-- 5) rpc_lead_create: accept business_category_ids & business_type_ids; require at least one type
create or replace function iwish.rpc_lead_create(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_team_id int := (payload->>'team_id')::int;
  v_owner uuid := coalesce((payload->>'owner_id')::uuid, v_actor);
  v_stage text := coalesce(nullif(payload->>'stage',''), 'L1');
  v_status text := coalesce(nullif(payload->>'status',''), 'open');
  v_type_ids bigint[] := coalesce((select array_agg((value)::bigint) from jsonb_array_elements_text(payload->'business_type_ids')), '{}');
  v_category_ids bigint[] := coalesce((select array_agg((value)::bigint) from jsonb_array_elements_text(payload->'business_category_ids')), '{}');
  v_valid_type_ids bigint[] := '{}';
  v_all_category_ids bigint[] := '{}';
  v_valid_category_ids bigint[] := '{}';
begin
  if not iwish.has_permission(v_actor, 'leads.create') then
    raise exception 'ERR_NO_PERMISSION:leads.create';
  end if;

  if v_stage not in ('L1','L2','L3','L4','Won') then
    raise exception 'ERR_VALIDATION:invalid_stage';
  end if;

  if v_status not in ('open','closed','pool') then
    raise exception 'ERR_VALIDATION:invalid_status';
  end if;

  -- scope: if create scope is self/team, enforce team match
  if (iwish.get_effective_scope(v_actor, 'leads.create')->>'scope_type') in ('self','team') then
    if v_team_id <> (select team_id from public.profiles where id = v_actor) then
      raise exception 'ERR_OUT_OF_SCOPE:team_mismatch_on_create';
    end if;
  end if;

  -- sensitive fields write permission
  if (payload ? 'customer_phone' or payload ? 'customer_email' or payload ? 'address' or payload ? 'budget') then
    if not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then
      raise exception 'ERR_FIELD_FORBIDDEN:write_sensitive_required';
    end if;
  end if;

  -- business types required
  if v_type_ids is null or cardinality(v_type_ids) = 0 then
    raise exception 'ERR_VALIDATION:business_type_required';
  end if;

  select array_agg(id) into v_valid_type_ids
    from public.business_types bt
    where bt.id = any(v_type_ids) and bt.is_active = true;

  if v_valid_type_ids is null or cardinality(v_valid_type_ids) <> cardinality(v_type_ids) then
    raise exception 'ERR_VALIDATION:invalid_business_type';
  end if;

  select array_agg(distinct bt.category_id) into v_all_category_ids
    from public.business_types bt
    where bt.id = any(v_valid_type_ids);

  if v_category_ids is not null and cardinality(v_category_ids) > 0 then
    select array_agg(distinct cid) into v_all_category_ids
    from (
      select unnest(v_all_category_ids) as cid
      union
      select unnest(v_category_ids) as cid
    ) t;
  end if;

  if v_all_category_ids is null then
    v_all_category_ids := '{}';
  end if;

  if cardinality(v_all_category_ids) > 0 then
    select array_agg(id) into v_valid_category_ids
      from public.business_categories bc
      where bc.id = any(v_all_category_ids) and bc.is_active = true;

    if v_valid_category_ids is null or cardinality(v_valid_category_ids) <> cardinality(v_all_category_ids) then
      raise exception 'ERR_VALIDATION:invalid_business_category';
    end if;
  end if;

  insert into public.leads(
    team_id, owner_id, created_by,
    name, source, stage, status,
    customer_name, customer_phone, customer_email, address, budget,
    internal_score, blacklist_reason, last_contact_at,
    next_contact_at, customer_grade, source_level1, source_level2, tags
  ) values (
    v_team_id,
    v_owner,
    v_actor,
    payload->>'name',
    payload->>'source',
    v_stage,
    v_status,
    payload->>'customer_name',
    payload->>'customer_phone',
    payload->>'customer_email',
    payload->>'address',
    (payload->>'budget')::numeric,
    (payload->>'internal_score')::int,
    payload->>'blacklist_reason',
    (payload->>'last_contact_at')::timestamptz,
    (payload->>'next_contact_at')::timestamptz,
    payload->>'customer_grade',
    payload->>'source_level1',
    payload->>'source_level2',
    (select coalesce(array_agg(value::text), '{}') from jsonb_array_elements_text(payload->'tags'))
  )
  returning id into v_id;

  -- associations
  delete from public.leads_business_types where lead_id = v_id;
  insert into public.leads_business_types(lead_id, type_id)
    select v_id, unnest(v_valid_type_ids);

  if cardinality(v_all_category_ids) > 0 then
    delete from public.leads_business_categories where lead_id = v_id;
    insert into public.leads_business_categories(lead_id, category_id)
      select v_id, unnest(v_all_category_ids);
  end if;

  perform iwish.audit(v_actor, 'create_lead', 'lead', v_id::text, null, (select to_jsonb(l.*) from public.leads l where l.id = v_id), null);
  return v_id;
end $$;

-- 6) rpc_lead_update: handle business types/categories when provided
create or replace function iwish.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_lead public.leads;
  k text;
  v_is_return_to_pool boolean := false;
  v_old_stage text;
  v_new_stage text;
  v_old_rank int;
  v_new_rank int;
  v_type_ids bigint[];
  v_category_ids bigint[];
  v_valid_type_ids bigint[];
  v_all_category_ids bigint[];
  v_valid_category_ids bigint[];
begin
  if not iwish.has_permission(v_actor, 'leads.update') then
    raise exception 'ERR_NO_PERMISSION:leads.update';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'ERR_NOT_FOUND:lead';
  end if;

  if not iwish.in_scope_for_lead(v_actor, v_lead, 'leads.update') then
    if v_lead.owner_id <> v_actor and v_lead.created_by <> v_actor then
      raise exception 'ERR_OUT_OF_SCOPE:leads.update';
    end if;
  end if;

  if patch ? 'status' then
    if patch->>'status' = 'pool' and v_lead.status <> 'pool' then
      v_is_return_to_pool := true;
      if not iwish.has_permission(v_actor, 'leads.pool.return') then
        raise exception 'ERR_NO_PERMISSION:leads.pool.return';
      end if;
    end if;
  end if;

  if patch ? 'stage' then
    v_old_stage := v_lead.stage;
    v_new_stage := patch->>'stage';
    if v_new_stage is not null and v_new_stage <> v_old_stage then
      if v_lead.status = 'closed' then
        raise exception 'ERR_INVALID_STATUS:cannot_change_stage_when_closed';
      end if;
      if v_new_stage not in ('L1','L2','L3','L4','Won') then
        raise exception 'ERR_VALIDATION:invalid_stage';
      end if;
      v_old_rank := case v_old_stage when 'L1' then 1 when 'L2' then 2 when 'L3' then 3 when 'L4' then 4 when 'Won' then 5 else 0 end;
      v_new_rank := case v_new_stage when 'L1' then 1 when 'L2' then 2 when 'L3' then 3 when 'L4' then 4 when 'Won' then 5 else 0 end;
      if v_new_rank < v_old_rank then
        raise exception 'ERR_INVALID_STAGE_TRANSITION:cannot_downgrade';
      end if;
      if v_new_rank > v_old_rank then
        if p_reason is null or length(trim(p_reason)) = 0 then
          raise exception 'ERR_VALIDATION:stage_reason_required';
        end if;
      end if;
    end if;
  end if;

  -- parse business types/categories if present
  if patch ? 'business_type_ids' then
    v_type_ids := coalesce((select array_agg((value)::bigint) from jsonb_array_elements_text(patch->'business_type_ids')), '{}');
    if v_type_ids is null or cardinality(v_type_ids) = 0 then
      raise exception 'ERR_VALIDATION:business_type_required';
    end if;
    select array_agg(id) into v_valid_type_ids from public.business_types bt where bt.id = any(v_type_ids) and bt.is_active = true;
    if v_valid_type_ids is null or cardinality(v_valid_type_ids) <> cardinality(v_type_ids) then
      raise exception 'ERR_VALIDATION:invalid_business_type';
    end if;
    select array_agg(distinct bt.category_id) into v_all_category_ids from public.business_types bt where bt.id = any(v_valid_type_ids);
  end if;

  if patch ? 'business_category_ids' then
    v_category_ids := coalesce((select array_agg((value)::bigint) from jsonb_array_elements_text(patch->'business_category_ids')), '{}');
    if v_category_ids is not null and cardinality(v_category_ids) > 0 then
      if v_all_category_ids is null then
        v_all_category_ids := '{}';
      end if;
      select array_agg(distinct cid) into v_all_category_ids
      from (
        select unnest(coalesce(v_all_category_ids, '{}')) as cid
        union
        select unnest(v_category_ids) as cid
      ) t;
    end if;
  end if;

  if v_all_category_ids is not null and cardinality(v_all_category_ids) > 0 then
    select array_agg(id) into v_valid_category_ids
      from public.business_categories bc
      where bc.id = any(v_all_category_ids) and bc.is_active = true;
    if v_valid_category_ids is null or cardinality(v_valid_category_ids) <> cardinality(v_all_category_ids) then
      raise exception 'ERR_VALIDATION:invalid_business_category';
    end if;
  end if;

  v_before := to_jsonb(v_lead.*);

  for k in select jsonb_object_keys(patch) loop
    if k in ('owner_id','team_id','created_by') then
      raise exception 'ERR_FIELD_FORBIDDEN:use_assign_or_transfer';
    end if;
    if k in ('customer_phone','customer_email','address','budget') then
      if not iwish.has_permission(v_actor, 'leads.fields.write_sensitive') then
        raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_sensitive';
      end if;
    end if;
    if k in ('internal_score','blacklist_reason') then
      if not iwish.has_permission(v_actor, 'leads.fields.write_internal') then
        raise exception 'ERR_FIELD_FORBIDDEN:leads.fields.write_internal';
      end if;
    end if;
  end loop;

  update public.leads
  set
    name = coalesce(patch->>'name', name),
    source = coalesce(patch->>'source', source),
    stage = coalesce(patch->>'stage', stage),
    status = coalesce(patch->>'status', status),
    customer_name = coalesce(patch->>'customer_name', customer_name),
    customer_phone = coalesce(patch->>'customer_phone', customer_phone),
    customer_email = coalesce(patch->>'customer_email', customer_email),
    address = coalesce(patch->>'address', address),
    budget = coalesce((patch->>'budget')::numeric, budget),
    internal_score = coalesce((patch->>'internal_score')::int, internal_score),
    blacklist_reason = coalesce(patch->>'blacklist_reason', blacklist_reason),
    last_contact_at = coalesce((patch->>'last_contact_at')::timestamptz, last_contact_at),
    next_contact_at = coalesce((patch->>'next_contact_at')::timestamptz, next_contact_at),
    customer_grade = coalesce(patch->>'customer_grade', customer_grade),
    source_level1 = coalesce(patch->>'source_level1', source_level1),
    source_level2 = coalesce(patch->>'source_level2', source_level2),
    tags = coalesce((select array_agg(value::text) from jsonb_array_elements_text(patch->'tags')), tags)
  where id = p_lead_id;

  if v_valid_type_ids is not null then
    delete from public.leads_business_types where lead_id = p_lead_id;
    insert into public.leads_business_types(lead_id, type_id)
      select p_lead_id, unnest(v_valid_type_ids);

    delete from public.leads_business_categories where lead_id = p_lead_id;
    if v_all_category_ids is not null and cardinality(v_all_category_ids) > 0 then
      insert into public.leads_business_categories(lead_id, category_id)
        select p_lead_id, unnest(v_all_category_ids);
    end if;
  end if;

  if v_is_return_to_pool then
    perform iwish.audit(v_actor, 'return_lead_to_pool', 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason);
  else
    perform iwish.audit(v_actor, 'update_lead', 'lead', p_lead_id::text, v_before, (select to_jsonb(l.*) from public.leads l where l.id = p_lead_id), p_reason);
  end if;
end $$;

-- keep public wrapper signature unchanged
create or replace function public.rpc_lead_update(p_lead_id uuid, patch jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = public, iwish
as $$
  select iwish.rpc_lead_update(p_lead_id, patch, p_reason);
$$;

grant execute on function public.rpc_lead_update(uuid, jsonb, text) to authenticated, service_role;
