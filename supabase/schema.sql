-- Cybermates Supabase schema v2 — LOCAL-FIRST / MESH architecture.
-- The server stores NO profiles and NO messages. Supabase is used only for:
--   * Realtime presence + broadcast for ephemeral signaling (not persisted),
--   * signed control records (kill switch, app_config min-version),
--   * Stripe purchase receipts (server-signed) + last_seen for the inactivity auto-cancel job,
--   * minimal abuse reports.
-- Migration from v1 (supabase/legacy/schema-v1-central.sql): export anything you must keep, then run the
-- commented DROP block at the bottom. Clients >= this version never read those tables.
create extension if not exists pgcrypto;

-- ===== P2P kill switch (unchanged) =====
-- Single persistent signed control record. Clients read it on startup; only the service role (scripts/kill-switch.mjs) writes.
create table if not exists public.kill_switch (id text primary key default 'current', msg jsonb not null, updated_at timestamptz not null default now());
alter table public.kill_switch enable row level security;
drop policy if exists kill_switch_read on public.kill_switch;
create policy kill_switch_read on public.kill_switch for select to anon, authenticated using (true);
revoke insert, update, delete on public.kill_switch from anon, authenticated;

-- ===== Signed app config (min supported version etc.) =====
-- Rows hold Ed25519-signed messages (src/appconfig.js) under key 'min_version'; clients verify the signature.
create table if not exists public.app_config (key text primary key, value jsonb not null);
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to anon, authenticated using (true);
revoke insert, update, delete on public.app_config from anon, authenticated;

-- ===== P2P consent audit (version + time only) =====
create table if not exists public.p2p_consents (user_id uuid primary key references auth.users on delete cascade, version text not null, consented_at timestamptz not null default now());
alter table public.p2p_consents enable row level security;
drop policy if exists p2p_consents_own on public.p2p_consents;
create policy p2p_consents_own on public.p2p_consents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== Payments (service role only; no client policies) =====
create table if not exists public.app_users (user_code text primary key, last_seen timestamptz not null default now());
create table if not exists public.entitlements (id bigserial primary key, user_code text not null, stripe_ref text unique, status text not null, receipt jsonb not null, updated_at timestamptz default now());
alter table public.app_users enable row level security; alter table public.entitlements enable row level security;

-- ===== Minimal abuse reports =====
-- Reporter attaches only what they choose to share (e.g. the offending message text); no automatic content upload.
create table if not exists public.reports (
  id bigserial primary key, reporter_code text not null, reported_code text not null,
  reason text not null check (char_length(reason) <= 64), excerpt text check (char_length(excerpt) <= 1000),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to anon, authenticated with check (true); -- write-only; rate-limit at the edge
revoke select, update, delete on public.reports from anon, authenticated;

-- Realtime: presence channel 'peers', broadcast 'p2p' + 'control' are ephemeral (not stored).

-- ===== v1 -> v2 migration (DEPRECATED central tables; run manually after backing up) =====
-- drop function if exists public.send_message(uuid, text, boolean);
-- drop function if exists public.inbox(); drop function if exists public.mark_read(uuid);
-- drop function if exists public.get_wallet(); drop function if exists public.credit_wallet(uuid, text, text, boolean);
-- drop function if exists public.mock_purchase(text); drop function if exists public.is_mutual(uuid, uuid);
-- drop table if exists public.messages, public.linked_accounts, public.purchases, public.wallets, public.profiles cascade;

-- ===== Moderation: server-side blocklist + action log (service_role ONLY; RLS on, no policies => anon/authenticated denied) =====
-- Checked by /api/bootstrap (first contact) before handing out peers. Written by /api/ban and scripts/mod.mjs.
create table if not exists public.blocklist (code text primary key, category text not null, reason text, entry jsonb, device_hash text, created_at timestamptz not null default now(), created_by text);
alter table public.blocklist enable row level security;
revoke all on public.blocklist from anon, authenticated;
-- Action log. CSAM bans set preserve_until = +1 year (evidence-preservation hold, docs/trust-safety.md) and get ncmec_report_id filled in by staff.
-- Never store illegal content here: reason is a short label.
create table if not exists public.mod_actions (id bigint generated always as identity primary key, action text not null, code text not null, category text, reason text, actor text, preserve_until timestamptz, ncmec_report_id text, at timestamptz not null default now());
alter table public.mod_actions enable row level security;
revoke all on public.mod_actions from anon, authenticated;
alter table public.blocklist add column if not exists entry jsonb; -- signed targeted-kill message, handed to joiners as the ban list
-- Tiered enforcement (src/tiers.js): level 1-3 warning (no signed entry, delivered via bootstrap check-in), 4 suspension until
-- suspended_until (then reads as level 3), 5 ban (legacy rows default to 5). strikes = offense count; keyed by ID key (code).
alter table public.blocklist add column if not exists level smallint not null default 5 check (level between 1 and 5);
alter table public.blocklist add column if not exists strikes integer not null default 1;
alter table public.blocklist add column if not exists suspended_until timestamptz;
alter table public.mod_actions add column if not exists level smallint;

-- ===== 2026-10-20 Supabase-day additions (READY-TO-CONNECT; verify on the live project) =====
-- US-only travel grace: last time an ID checked in from a US IP (x-vercel-ip-country). service_role only.
create table if not exists public.geo_seen (code text primary key, last_us_at timestamptz not null);
alter table public.geo_seen enable row level security;
revoke all on public.geo_seen from anon, authenticated;

-- Realtime Authorization for the mesh broadcast channel (client joins 'mesh' as a PRIVATE channel, src/net.js).
-- v46: the old policies here let ANON read/write 'mesh' with no gate. The JOIN GATE now lives in
-- supabase/migrations/20261027000013_realtime_gate.sql (+ 000014): only signed-in, age-checked users with a fresh ADMISSION
-- (proof of work, or attestation via the service role) who are not suspended may join/send on 'mesh'; 'control' is read-only
-- for them. Running this legacy file must never re-open the channel, so it only DROPS the old anon policies.
alter table realtime.messages enable row level security;
drop policy if exists "mesh broadcast read" on realtime.messages;
drop policy if exists "mesh broadcast write" on realtime.messages;
drop policy if exists "control read" on realtime.messages;
-- Per-user limits: admission attempts/hour+day, admission lifetime and suspensions in app.mesh_gate_config / mesh_suspensions
-- (v46 migration); per-client event quotas: Supabase dashboard → Realtime settings (max events/sec per client, max concurrent clients).
-- Grok profile Edge Function: enable Anonymous sign-ins (Auth settings) so each phone gets a user JWT for the function.

-- ===== Single-entry server super list (2026-10-20). service_role only; clients reach it ONLY via api/_fn/bootstrap.js =====
-- ID key + owner-signed presence row + mode tags. NO IPs. Rows silent > 3 min are ignored by reads and purged below.
create table if not exists public.presence (code text primary key, row jsonb not null, modes text[] not null default '{}', seen_at timestamptz not null default now());
create index if not exists presence_seen on public.presence (seen_at desc);
create index if not exists presence_modes on public.presence using gin (modes);
alter table public.presence enable row level security;
revoke all on public.presence from anon, authenticated;
-- purge (pg_cron): select cron.schedule('presence-purge', '* * * * *', $$delete from public.presence where seen_at < now() - interval '3 minutes'$$);

-- ===== Device linking (2026-10-20): one shared profile ID, per-device keys; hashed hardware fingerprints; cap 5 =====
create table if not exists public.linked_devices (pid text not null, dev_hash text not null, dev_pub text not null, linked_at timestamptz not null default now(), primary key (pid, dev_hash));
alter table public.linked_devices enable row level security; revoke all on public.linked_devices from anon, authenticated;
-- Boost refund ledger + sealed safety reports (service_role only)
create table if not exists public.boost_ledger (msg_id text primary key, from_code text not null, to_code text not null, at timestamptz not null default now(), receipt boolean not null default false, refunded boolean not null default false);
alter table public.boost_ledger enable row level security; revoke all on public.boost_ledger from anon, authenticated;
create table if not exists public.reports (id bigserial primary key, reporter text, reported text, reason text, sealed jsonb not null, at timestamptz not null default now());
alter table public.reports enable row level security; revoke all on public.reports from anon, authenticated;
