-- Ground-truth log for Feishu callback arrivals, used while stabilising the
-- allocation confirm loop. Service-role writes only.
create table if not exists public.feishu_callback_log (
  id bigint generated always as identity primary key,
  event_type text,
  message_id text,
  operator_open_id text,
  outcome text not null,
  detail text,
  received_at timestamptz not null default now()
);
alter table public.feishu_callback_log enable row level security;
-- No policies: only the service role reads/writes this table.
