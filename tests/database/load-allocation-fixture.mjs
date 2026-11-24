import { readdir, readFile } from "node:fs/promises"

export async function loadAllocationFixture(db, beforeMigration) {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;" +
    "create schema auth; create schema storage;" +
    "create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);" +
    "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;" +
    "create function auth.role() returns text language sql stable as $$select current_user::text$$;" +
    "create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;" +
    "grant usage on schema auth to public;" +
    "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);" +
    "create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);" +
    "alter table storage.objects enable row level security;" +
    "grant usage on schema storage to authenticated;" +
    "grant select,insert,update,delete on storage.objects to authenticated;" +
    "grant usage on schema public to anon,authenticated;" +
    "alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;"
  )
  const root = new URL("../../supabase/migrations/", import.meta.url)
  const filenames = (await readdir(root)).filter(name => name.endsWith(".sql")).sort()
  for (const name of filenames) {
    // Older migrations expect these columns to exist in the original hosted baseline.
    if (name.startsWith("023_")) await db.exec("alter table public.leads add column if not exists wechat text")
    if (name.startsWith("045_")) {
      await db.exec("alter table public.leads add column if not exists first_contact_at timestamptz, " +
        "add column if not exists locked_by uuid, add column if not exists locked_until timestamptz, " +
        "add column if not exists protected_until timestamptz")
      await db.exec("drop view public.leads_secure_view cascade")
    }
    if (name.startsWith("20260604000100_")) {
      await db.exec("alter table public.leads add column if not exists is_deleted boolean default false, " +
        "add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid")
    }
    if (name.endsWith("_crm_department_allocation_phase_one.sql")) {
      await db.exec("insert into public.ops_departments(feishu_department_id,name,is_active) values " +
        "('test-ad2','效果营销二部',true),('test-ad3','效果营销三部',true),('test-ad4','效果营销四部',true)," +
        "('test-ad5','效果营销五部',false),('test-center','效果营销中心',true),('test-brand','品牌营销部',true)," +
        "('test-seo','SEO营销部',true),('test-tech','技术部',true),('test-creative','创意部',true)")
    }
    await beforeMigration?.(name)
    const sql = (await readFile(new URL(name, root), "utf8")).replace(/^\uFEFF/, "").replace(/create extension if not exists "pgcrypto";/i, "")
    await db.exec(sql)
  }
}
