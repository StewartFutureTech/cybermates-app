-- base_schema: missing objects from supabase/schema.sql, applied idempotently. NO DROP statements.
-- Skipped on purpose: public.reports (migration 003 owns a different shape), public.boost_ledger (exists from migrations),
-- realtime.messages block (v46 gate policies from migrations 013/014 own it; old anon policies never existed here).
create extension if not exists pgcrypto;
create table if not exists public.kill_switch (id text primary key default 'current', msg jsonb not null, updated_at timestamptz not null default now());
alter table public.kill_switch enable row level security;
do $$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='kill_switch' and policyname='kill_switch_read') then
  create policy kill_switch_read on public.kill_switch for select to anon, authenticated using (true); end if; end $$;
revoke insert, update, delete on public.kill_switch from anon, authenticated;
create table if not exists public.app_config (key text primary key, value jsonb not null);
alter table public.app_config enable row level security;
do $$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_config' and policyname='app_config_read') then
  create policy app_config_read on public.app_config for select to anon, authenticated using (true); end if; end $$;
revoke insert, update, delete on public.app_config from anon, authenticated;
create table if not exists public.p2p_consents (user_id uuid primary key references auth.users on delete cascade, version text not null, consented_at timestamptz not null default now());
alter table public.p2p_consents enable row level security;
do $$ begin if not exists (select 1 from pg_policies where schemaname='public' and tablename='p2p_consents' and policyname='p2p_consents_own') then
  create policy p2p_consents_own on public.p2p_consents for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid())); end if; end $$;
create table if not exists public.app_users (user_code text primary key, last_seen timestamptz not null default now());
create table if not exists public.entitlements (id bigserial primary key, user_code text not null, stripe_ref text unique, status text not null, receipt jsonb not null, updated_at timestamptz default now());
alter table public.app_users enable row level security; alter table public.entitlements enable row level security;
create table if not exists public.blocklist (code text primary key, category text not null, reason text, entry jsonb, device_hash text, created_at timestamptz not null default now(), created_by text);
alter table public.blocklist enable row level security;
revoke all on public.blocklist from anon, authenticated;
create table if not exists public.mod_actions (id bigint generated always as identity primary key, action text not null, code text not null, category text, reason text, actor text, preserve_until timestamptz, ncmec_report_id text, at timestamptz not null default now());
alter table public.mod_actions enable row level security;
revoke all on public.mod_actions from anon, authenticated;
alter table public.blocklist add column if not exists entry jsonb; -- signed targeted-kill message, handed to joiners as the ban list
alter table public.blocklist add column if not exists level smallint not null default 5 check (level between 1 and 5);
alter table public.blocklist add column if not exists strikes integer not null default 1;
alter table public.blocklist add column if not exists suspended_until timestamptz;
alter table public.mod_actions add column if not exists level smallint;
create table if not exists public.geo_seen (code text primary key, last_us_at timestamptz not null);
alter table public.geo_seen enable row level security;
revoke all on public.geo_seen from anon, authenticated;
create table if not exists public.presence (code text primary key, row jsonb not null, modes text[] not null default '{}', seen_at timestamptz not null default now());
create index if not exists presence_seen on public.presence (seen_at desc);
create index if not exists presence_modes on public.presence using gin (modes);
alter table public.presence enable row level security;
revoke all on public.presence from anon, authenticated;

create table if not exists public.linked_devices (pid text not null, dev_hash text not null, dev_pub text not null, linked_at timestamptz not null default now(), primary key (pid, dev_hash));
alter table public.linked_devices enable row level security; revoke all on public.linked_devices from anon, authenticated;
