-- 037_audit_business_taxonomy.sql
-- Add audit + updated_by stamps for business_categories / business_types.

create or replace function iwish.set_updated_at_and_by()
returns trigger
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
begin
  new.updated_at := now();
  if v_actor is not null then
    new.updated_by := v_actor;
  end if;
  return new;
end
$$;

create or replace function iwish.audit_business_taxonomy_change()
returns trigger
language plpgsql
security definer
set search_path = public, iwish
as $$
declare
  v_actor uuid := auth.uid();
  v_action text;
  v_target_type text;
  v_target_id text;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_table_name = 'business_categories' then
    v_target_type := 'business_category';
    v_target_id := coalesce(new.id::text, old.id::text);
    if tg_op = 'INSERT' then
      v_action := 'create_business_category';
      v_before := null;
      v_after := to_jsonb(new);
    elsif tg_op = 'UPDATE' then
      v_action := 'update_business_category';
      v_before := to_jsonb(old);
      v_after := to_jsonb(new);
    elsif tg_op = 'DELETE' then
      v_action := 'delete_business_category';
      v_before := to_jsonb(old);
      v_after := null;
    end if;
  elsif tg_table_name = 'business_types' then
    v_target_type := 'business_type';
    v_target_id := coalesce(new.id::text, old.id::text);
    if tg_op = 'INSERT' then
      v_action := 'create_business_type';
      v_before := null;
      v_after := to_jsonb(new);
    elsif tg_op = 'UPDATE' then
      v_action := 'update_business_type';
      v_before := to_jsonb(old);
      v_after := to_jsonb(new);
    elsif tg_op = 'DELETE' then
      v_action := 'delete_business_type';
      v_before := to_jsonb(old);
      v_after := null;
    end if;
  else
    return null;
  end if;

  if v_actor is not null and v_action is not null then
    perform iwish.audit(
      v_actor,
      v_action,
      v_target_type,
      v_target_id,
      v_before,
      v_after,
      null
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    return new;
  end if;
  return old;
end
$$;

-- business_categories: replace updated_at trigger to also fill updated_by

drop trigger if exists set_updated_at_before_update_business_categories on public.business_categories;
drop trigger if exists trg_business_categories_updated_at_and_by on public.business_categories;
create trigger trg_business_categories_updated_at_and_by
before insert or update on public.business_categories
for each row execute function iwish.set_updated_at_and_by();

-- business_types

drop trigger if exists set_updated_at_before_update_business_types on public.business_types;
drop trigger if exists trg_business_types_updated_at_and_by on public.business_types;
create trigger trg_business_types_updated_at_and_by
before insert or update on public.business_types
for each row execute function iwish.set_updated_at_and_by();

-- audit triggers

drop trigger if exists trg_business_categories_audit on public.business_categories;
create trigger trg_business_categories_audit
after insert or update or delete on public.business_categories
for each row execute function iwish.audit_business_taxonomy_change();

drop trigger if exists trg_business_types_audit on public.business_types;
create trigger trg_business_types_audit
after insert or update or delete on public.business_types
for each row execute function iwish.audit_business_taxonomy_change();
