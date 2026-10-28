-- v46: Realtime JOIN GATE (attestation / proof of work) + PER-USER Realtime limits for the shared mesh channel.
-- Before v46: src/net.js SupabaseBus joins the PRIVATE broadcast topic 'mesh' (and reads 'control'), but live only
-- 'presence:<band>' / 'conv:<id>' were authorized (app.realtime_topic_ok), and the legacy supabase/schema.sql policies let
-- ANON read/write 'mesh' with no gate at all. Now joining (and sending on) 'mesh' needs ALL of:
--   * a signed-in Supabase user (role authenticated; anon is never allowed) whose profile has an age band (age check done);
--   * an ADMISSION: public.mesh_admit(...) with a FRESH proof of work bound to that user id (+ mesh ID code + signing key +
--     a 10-minute window), verified here in SQL with SHA-256 (same puzzle as v43 src/idbind.js, own domain string), OR a
--     service-role admission (public.mesh_admit_service) - the ATTESTATION HOOK: once Play Integrity / App Attest is verified
--     server-side (api/_fn/attest.js, David's Google/Apple accounts) the server admits attested users with the lighter cost;
--   * not suspended (moderators: public.mod_mesh_suspend / mod_mesh_lift; service role: mesh_suspend_service).
-- Per-user limits (one row of tunables in app.mesh_gate_config, service role / dashboard only):
--   admission attempts per user per hour / per day, admission lifetime (re-checked by Realtime on every join and on every
--   access-token refresh), minimum PoW (web) and attested PoW. Attempts (good or bad) are logged, so failed proofs count too.
-- 'control' (kill/ban broadcasts, written by the service role only) is READ-only for admitted users. Nothing else changes:
-- presence:/conv: policies, every other table and function are untouched. Realtime itself still needs "Private channels
-- only" + per-client event quotas in the dashboard (David; docs/SUPABASE-DAY-CHECKLIST.md section 4).

create table if not exists app.mesh_gate_config (
  id boolean primary key default true check (id),
  admit_per_hour integer not null default 6 check (admit_per_hour between 1 and 1000),
  admit_per_day integer not null default 24 check (admit_per_day between 1 and 10000),
  ttl_secs integer not null default 43200 check (ttl_secs between 300 and 604800),
  pow_b integer not null default 16 check (pow_b between 8 and 24),
  pow_k integer not null default 6 check (pow_k between 1 and 32),
  att_pow_b integer not null default 12 check (att_pow_b between 0 and 24),
  att_pow_k integer not null default 2 check (att_pow_k between 1 and 32),
  enabled boolean not null default true,
  updated_at timestamptz not null default now());
insert into app.mesh_gate_config (id) values (true) on conflict (id) do nothing;

create table if not exists app.mesh_admissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null check (char_length(code_hash) = 64),
  pub_hash text not null check (char_length(pub_hash) = 64),
  via text not null check (via in ('pow', 'service')),
  att boolean not null default false,
  admitted_at timestamptz not null default now(),
  expires_at timestamptz not null);
create index if not exists mesh_admissions_expires_idx on app.mesh_admissions (expires_at);

create table if not exists app.mesh_attest (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until timestamptz not null,
  provider text not null check (char_length(provider) between 1 and 40));

create table if not exists app.mesh_suspensions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 300),
  by_user uuid,
  created_at timestamptz not null default now());

-- append-only attempt log (counts for the per-user limits; no IPs, codes hashed)
create table if not exists app.mesh_admit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null,
  why text not null check (char_length(why) between 1 and 60));
create index if not exists mesh_admit_log_user_at_idx on app.mesh_admit_log (user_id, at desc);
create index if not exists mesh_admit_log_at_idx on app.mesh_admit_log (at);

alter table app.mesh_gate_config enable row level security;
alter table app.mesh_admissions enable row level security;
alter table app.mesh_attest enable row level security;
alter table app.mesh_suspensions enable row level security;
alter table app.mesh_admit_log enable row level security;
revoke all on app.mesh_gate_config, app.mesh_admissions, app.mesh_attest, app.mesh_suspensions, app.mesh_admit_log from public, anon, authenticated;

-- ---- proof of work (byte-identical to src/mesh-admit.js): seed = SHA-256(utf8 'cm-mesh-admit-v1|uid|code|pub|w|b|k'),
-- sub-puzzle i: SHA-256(seed(32) | u32be i | u32be n_i) has >= b leading zero bits. w = floor(epoch_secs / 600).
create or replace function app.mesh_pow_ok(p_uid uuid, p_code text, p_pub text, p_w bigint, p_b integer, p_k integer, p_n bigint[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare seed bytea; h bytea; i integer; full_bytes integer; rest integer;
begin
  if p_n is null or p_b is null or p_k is null or p_b < 0 or p_b > 24 or p_k < 1 or p_k > 32 then return false; end if;
  if coalesce(array_length(p_n, 1), 0) <> p_k then return false; end if;
  seed := sha256(convert_to(format('cm-mesh-admit-v1|%s|%s|%s|%s|%s|%s', p_uid, p_code, p_pub, p_w, p_b, p_k), 'UTF8'));
  full_bytes := p_b / 8; rest := p_b % 8;
  for i in 0 .. p_k - 1 loop
    if p_n[i + 1] is null or p_n[i + 1] < 0 or p_n[i + 1] > 4294967295 then return false; end if;
    h := sha256(seed || int4send(i) || substring(int8send(p_n[i + 1]) from 5 for 4));
    for j in 0 .. full_bytes - 1 loop if get_byte(h, j) <> 0 then return false; end if; end loop;
    if rest > 0 and (get_byte(h, full_bytes) >> (8 - rest)) <> 0 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function app.mesh_hash(p_kind text, p_v text) returns text language sql immutable set search_path = '' as
$$ select encode(sha256(convert_to('cm-mesh|' || p_kind || '|' || coalesce(p_v, ''), 'UTF8')), 'hex') $$;

-- the gate used by the Realtime policies (fast: two primary-key lookups + one profile lookup)
create or replace function app.mesh_admitted(p_uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null
     and coalesce((select c.enabled from app.mesh_gate_config c where c.id), true)
     and exists (select 1 from app.mesh_admissions a where a.user_id = p_uid and a.expires_at > now())
     and not exists (select 1 from app.mesh_suspensions s where s.user_id = p_uid and s.until > now())
     and (select p.age_band from public.profiles p where p.id = p_uid) is not null $$;

create or replace function app.mesh_topic_ok(p_topic text, p_ext text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ext is distinct from 'broadcast' then return false; end if;
  if p_topic = 'mesh' then return app.mesh_admitted((select auth.uid())); end if;
  if p_topic = 'control' then return not p_write and app.mesh_admitted((select auth.uid())); end if;
  return false;
exception when others then return false;
end $$;

drop policy if exists "mesh broadcast read" on realtime.messages;
drop policy if exists "mesh broadcast write" on realtime.messages;
drop policy if exists "control read" on realtime.messages;
drop policy if exists realtime_mesh_read on realtime.messages;
drop policy if exists realtime_mesh_write on realtime.messages;
create policy realtime_mesh_read on realtime.messages for select to authenticated
  using (app.mesh_topic_ok((select realtime.topic()), realtime.messages.extension, false));
create policy realtime_mesh_write on realtime.messages for insert to authenticated
  with check (app.mesh_topic_ok((select realtime.topic()), realtime.messages.extension, true));

-- ---- client RPC: admit me (fresh PoW). Returns jsonb; refusals are RETURNED (not raised) so the attempt log row is kept.
create or replace function app.mesh_admit_at(p_code text, p_pub text, p_w bigint, p_b integer, p_k integer, p_n bigint[], p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); cfg app.mesh_gate_config; nh integer; nd integer; cw bigint; att boolean; mb integer; mk integer;
        susp timestamptz; exp timestamptz;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into cfg from app.mesh_gate_config where id;
  perform pg_advisory_xact_lock(hashtextextended('mesh_admit|' || uid::text, 0)); -- serialize one user's attempts
  select count(*) filter (where l.at > p_at - interval '1 hour'), count(*) into nh, nd
    from app.mesh_admit_log l where l.user_id = uid and l.at > p_at - interval '1 day'
     and l.why not like 'suspended-by-%' and l.why not like 'lifted-%' and l.why not like 'service:%'; -- only the user's own attempts count
  if nh >= cfg.admit_per_hour or nd >= cfg.admit_per_day then
    return jsonb_build_object('ok', false, 'error', 'rate', 'retry_after_secs', case when nh >= cfg.admit_per_hour then 3600 else 86400 end);
  end if;
  select s.until into susp from app.mesh_suspensions s where s.user_id = uid and s.until > p_at;
  if susp is not null then insert into app.mesh_admit_log (user_id, at, ok, why) values (uid, p_at, false, 'suspended');
    return jsonb_build_object('ok', false, 'error', 'suspended', 'until', susp); end if;
  if not cfg.enabled then insert into app.mesh_admit_log (user_id, at, ok, why) values (uid, p_at, false, 'gate-off');
    return jsonb_build_object('ok', false, 'error', 'gate-off'); end if;
  if (select p.age_band from public.profiles p where p.id = uid) is null then
    insert into app.mesh_admit_log (user_id, at, ok, why) values (uid, p_at, false, 'no-age-check');
    return jsonb_build_object('ok', false, 'error', 'age-check-required'); end if;
  if p_code is null or p_code !~ '^[A-Z0-9]{4,16}$' or p_pub is null or char_length(p_pub) not between 40 and 64 then
    insert into app.mesh_admit_log (user_id, at, ok, why) values (uid, p_at, false, 'bad-shape');
    return jsonb_build_object('ok', false, 'error', 'bad-proof'); end if;
  cw := floor(extract(epoch from p_at) / 600)::bigint;
  att := exists (select 1 from app.mesh_attest t where t.user_id = uid and t.until > p_at);
  mb := case when att then cfg.att_pow_b else cfg.pow_b end; mk := case when att then cfg.att_pow_k else cfg.pow_k end;
  -- required work: same rule as src/idbind.js meets(): total expected hashes >= minimum and b >= min(minimum b, 12)
  if p_w is null or p_w not in (cw, cw - 1) or p_b is null or p_k is null or p_b > 24 or p_k > 32
     or (p_k::numeric * power(2::numeric, p_b)) < (mk::numeric * power(2::numeric, mb)) or p_b < least(mb, 12)
     or not app.mesh_pow_ok(uid, p_code, p_pub, p_w, p_b, p_k, p_n) then
    insert into app.mesh_admit_log (user_id, at, ok, why) values (uid, p_at, false, case when p_w is null or p_w not in (cw, cw - 1) then 'stale-window' else 'bad-pow' end);
    return jsonb_build_object('ok', false, 'error', 'bad-proof', 'need', jsonb_build_object('b', mb, 'k', mk), 'w', cw);
  end if;
  exp := p_at + make_interval(secs => cfg.ttl_secs);
  insert into app.mesh_admissions as a (user_id, code_hash, pub_hash, via, att, admitted_at, expires_at)
    values (uid, app.mesh_hash('code', p_code), app.mesh_hash('key', p_pub), 'pow', att, p_at, exp)
    on conflict (user_id) do update set code_hash = excluded.code_hash, pub_hash = excluded.pub_hash, via = 'pow', att = excluded.att,
      admitted_at = excluded.admitted_at, expires_at = greatest(a.expires_at, excluded.expires_at);
  insert into app.mesh_admit_log (user_id, at, ok, why) values (uid, p_at, true, case when att then 'pow-attested' else 'pow' end);
  return jsonb_build_object('ok', true, 'expires_at', exp, 'ttl_secs', cfg.ttl_secs, 'att', att,
    'left_hour', cfg.admit_per_hour - nh - 1, 'left_day', cfg.admit_per_day - nd - 1);
end $$;

create or replace function public.mesh_admit(p_code text, p_pub text, p_w bigint, p_b integer, p_k integer, p_n bigint[])
returns jsonb language sql security definer set search_path = '' as $$ select app.mesh_admit_at(p_code, p_pub, p_w, p_b, p_k, p_n, now()) $$; -- definer: the clock (p_at) is never client-chosen

-- what the phone needs to solve (and its own status); no other user's data
create or replace function public.mesh_gate_info() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'w', floor(extract(epoch from now()) / 600)::bigint,
    'pow', case when exists (select 1 from app.mesh_attest t where t.user_id = (select auth.uid()) and t.until > now())
                then jsonb_build_object('b', c.att_pow_b, 'k', c.att_pow_k) else jsonb_build_object('b', c.pow_b, 'k', c.pow_k) end,
    'enabled', c.enabled, 'ttl_secs', c.ttl_secs, 'limits', jsonb_build_object('per_hour', c.admit_per_hour, 'per_day', c.admit_per_day),
    'admitted', app.mesh_admitted((select auth.uid())),
    'expires_at', (select a.expires_at from app.mesh_admissions a where a.user_id = (select auth.uid()) and a.expires_at > now()),
    'suspended_until', (select s.until from app.mesh_suspensions s where s.user_id = (select auth.uid()) and s.until > now()),
    'age_checked', (select p.age_band from public.profiles p where p.id = (select auth.uid())) is not null)
  from app.mesh_gate_config c where c.id and (select auth.uid()) is not null $$;

-- ---- ATTESTATION HOOK (service role only): the server, after verifying Play Integrity / App Attest for this user, admits
-- them directly and marks them attested for p_days (their own later re-admissions then pay only the attested PoW).
create or replace function public.mesh_admit_service(p_user uuid, p_code text, p_provider text, p_days integer default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg app.mesh_gate_config; exp timestamptz;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  if p_provider is null or char_length(p_provider) not between 1 and 40 or p_days is null or p_days not between 1 and 30 then raise exception 'bad args' using errcode = '22023'; end if;
  if exists (select 1 from app.mesh_suspensions s where s.user_id = p_user and s.until > now()) then return jsonb_build_object('ok', false, 'error', 'suspended'); end if;
  select * into cfg from app.mesh_gate_config where id; exp := now() + make_interval(secs => cfg.ttl_secs);
  insert into app.mesh_attest as t (user_id, until, provider) values (p_user, now() + make_interval(days => p_days), p_provider)
    on conflict (user_id) do update set until = excluded.until, provider = excluded.provider;
  insert into app.mesh_admissions as a (user_id, code_hash, pub_hash, via, att, admitted_at, expires_at)
    values (p_user, app.mesh_hash('code', p_code), app.mesh_hash('key', 'service'), 'service', true, now(), exp)
    on conflict (user_id) do update set via = 'service', att = true, admitted_at = now(), expires_at = greatest(a.expires_at, excluded.expires_at);
  insert into app.mesh_admit_log (user_id, ok, why) values (p_user, true, 'service:' || left(p_provider, 40));
  return jsonb_build_object('ok', true, 'expires_at', exp);
end $$;

-- ---- per-user suspension (the Realtime per-user kill lever). Removes the admission at once; Realtime refuses the next join
-- and the next access-token refresh. Moderators: adult moderators only, never themselves, reviewer <= 7 days, lead <= 30 days.
create or replace function app.mesh_suspend_core(p_user uuid, p_minutes integer, p_reason text, p_by uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u timestamptz := now() + make_interval(mins => p_minutes);
begin
  if p_user is null or not exists (select 1 from auth.users x where x.id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 300 then raise exception 'reason required' using errcode = '22023'; end if;
  insert into app.mesh_suspensions as s (user_id, until, reason, by_user) values (p_user, u, btrim(p_reason), p_by)
    on conflict (user_id) do update set until = greatest(s.until, excluded.until), reason = excluded.reason, by_user = excluded.by_user, created_at = now();
  delete from app.mesh_admissions where user_id = p_user;
  insert into app.mesh_admit_log (user_id, ok, why) values (p_user, false, 'suspended-by-' || case when p_by is null then 'service' else 'mod' end);
  return jsonb_build_object('ok', true, 'until', (select s.until from app.mesh_suspensions s where s.user_id = p_user));
end $$;

create or replace function public.mod_mesh_suspend(p_user uuid, p_minutes integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare role text := app.mod_role(); maxm integer;
begin
  if role is null then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'not on yourself' using errcode = '42501'; end if;
  maxm := case when role = 'lead' then 43200 else 10080 end; -- lead 30 days, reviewer 7 days
  if p_minutes is null or p_minutes < 1 or p_minutes > maxm then raise exception 'bad duration' using errcode = '22023'; end if;
  return app.mesh_suspend_core(p_user, p_minutes, p_reason, (select auth.uid()));
end $$;

create or replace function public.mod_mesh_lift(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if app.mod_role() is null then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'not on yourself' using errcode = '42501'; end if;
  delete from app.mesh_suspensions where user_id = p_user;
  insert into app.mesh_admit_log (user_id, ok, why) values (p_user, false, 'lifted-by-mod');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mesh_suspend_service(p_user uuid, p_minutes integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_minutes is null or p_minutes not between 1 and 525600 then raise exception 'bad duration' using errcode = '22023'; end if;
  return app.mesh_suspend_core(p_user, p_minutes, p_reason, null);
end $$;

-- ---- cleanup (daily cron): expired admissions / attestations / suspensions, attempt log older than 7 days
create or replace function app.purge_mesh_gate() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; m integer;
begin
  delete from app.mesh_admissions where expires_at < now() - interval '1 hour'; get diagnostics m = row_count; n := n + m;
  delete from app.mesh_attest where until < now(); get diagnostics m = row_count; n := n + m;
  delete from app.mesh_suspensions where until < now(); get diagnostics m = row_count; n := n + m;
  delete from app.mesh_admit_log where at < now() - interval '7 days'; get diagnostics m = row_count; n := n + m;
  return n;
end $$;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cybermates-purge-mesh-gate') then perform cron.unschedule('cybermates-purge-mesh-gate'); end if;
  perform cron.schedule('cybermates-purge-mesh-gate', '29 4 * * *', 'select app.purge_mesh_gate()');
end $$;

-- ---- grants: app.* internals are NOT callable by clients (the Realtime policy functions run for role authenticated, so
-- mesh_topic_ok keeps EXECUTE for authenticated; it only answers for the caller's own uid).
revoke execute on function app.mesh_pow_ok(uuid, text, text, bigint, integer, integer, bigint[]), app.mesh_hash(text, text),
  app.mesh_admit_at(text, text, bigint, integer, integer, bigint[], timestamptz), app.mesh_suspend_core(uuid, integer, text, uuid),
  app.purge_mesh_gate() from public, anon, authenticated;
revoke execute on function app.mesh_admitted(uuid), app.mesh_topic_ok(text, text, boolean) from public, anon, authenticated;
grant execute on function app.mesh_topic_ok(text, text, boolean) to authenticated; -- the Realtime policy function (answers for auth.uid() only)
revoke execute on function public.mesh_admit(text, text, bigint, integer, integer, bigint[]), public.mesh_gate_info(),
  public.mod_mesh_suspend(uuid, integer, text), public.mod_mesh_lift(uuid) from public, anon;
grant execute on function public.mesh_admit(text, text, bigint, integer, integer, bigint[]), public.mesh_gate_info(),
  public.mod_mesh_suspend(uuid, integer, text), public.mod_mesh_lift(uuid) to authenticated;
revoke execute on function public.mesh_admit_service(uuid, text, text, integer), public.mesh_suspend_service(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.mesh_admit_service(uuid, text, text, integer), public.mesh_suspend_service(uuid, integer, text) to service_role;
