-- v41: server-side CONSERVATIVE boost refunds (boost credits only; no Stripe / real-money calls).
-- Boost balances on the Supabase path already live in public.boost_ledger (balance = sum(delta)); a boosted message spends 1 via
-- the message_after_insert trigger. Before v41 app.refund_boost() refunded any boosted, unread message once, with no audit,
-- no cap, no check that a matching spend exists, and nothing happened when the recipient deleted their account (the messages
-- cascade away -> the boost was silently lost). v41 replaces it with ONE decision function used by every path:
--   * app.boost_refund_decide(message, cause, actor, note): DB-enforced rules, in this order
--       1. idempotent: a message is refunded at most once (existing unique index boost_ledger_refund_once) -> 'duplicate'
--       2. spend-bound: there must be a 'spend' row (-1) for this message AND this sender, so a refund can never exceed a spend
--       3. read = delivered value: a message the recipient READ is never refunded
--       4. the message row must still exist (once purged its read state is unknown); the cause must really hold: 'expired' = expires_at passed; 'blocked' = the recipient blocks the sender;
--          'recipient_deleted' = the recipient's profile is being deleted; 'admin' = service role / support only
--       5. per-sender cap: at most app.boost_refund_daily_cap() (10) automatic refunds per rolling 24 h; above that the refund
--          is HELD (logged, no credit) for manual review -> public.boost_refund_release(log_id) (service role)
--       6. on a 'blocked' refund the message is un-pinned (boosted = false) so the sender can't keep the pin AND get the credit
--     Serialized per sender with the same advisory lock the spend path uses, so concurrent refunds can't race past the cap.
--   * app.boost_refund_log: append-only audit of every decision (refunded / held / released / denied_*). Private schema, RLS on,
--     no policies, no client grants, UPDATE/DELETE blocked by trigger. No FKs, so the audit survives account deletion
--     (recipient_id is nulled for 'recipient_deleted').
--   * public.my_boost_refunds(limit): the signed-in sender's OWN refund decisions (transparency; read only).
--   * public.boost_refund_admin(message, note) / public.boost_refund_release(log_id): service role ONLY (support tools);
--     still spend-bound + idempotent + logged, but bypass the daily cap.
--   * public.mesh_refund(op, msg, from_h, to_h): service-role-only shared ledger for the mesh path (api/_fn/refund.js), so
--     register/receipt/claim work across Vercel instances; codes arrive HMAC-hashed from the server; 10 refunds / 24 h per
--     sender, 300 registrations / 24 h per sender; rows auto-expire after 8 days.
-- Real-money refunds (Stripe charge.refunded / disputes) stay OUT of scope: manual in the Stripe dashboard until live keys exist.

-- ===== audit log =====
create table if not exists app.boost_refund_log (
  id bigint generated always as identity primary key,
  message_id uuid not null,
  sender_id uuid,
  recipient_id uuid,
  cause text not null check (cause in ('expired','blocked','recipient_deleted','admin','release')),
  outcome text not null check (outcome in ('refunded','held','released','denied_read','denied_no_spend','denied_not_eligible','denied_unknown')),
  actor text not null default 'system' check (actor in ('system','cron','trigger','service')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now());
create index if not exists boost_refund_log_sender_idx on app.boost_refund_log (sender_id, created_at desc);
create index if not exists boost_refund_log_message_idx on app.boost_refund_log (message_id);
alter table app.boost_refund_log enable row level security;
revoke all on app.boost_refund_log from public, anon, authenticated;
create or replace function app.boost_refund_log_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'boost_refund_log is append-only' using errcode = '42501'; end $$;
drop trigger if exists boost_refund_log_immutable on app.boost_refund_log;
create trigger boost_refund_log_immutable before update or delete on app.boost_refund_log for each row execute function app.boost_refund_log_immutable();

create or replace function app.boost_refund_daily_cap() returns integer language sql immutable set search_path = '' as $$ select 10 $$;

-- ===== the one decision function =====
create or replace function app.boost_refund_decide(p_message uuid, p_cause text, p_actor text default 'system', p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare m record; spender uuid; n int; outcome text; rid uuid;
begin
  if p_message is null or p_cause not in ('expired','blocked','recipient_deleted','admin') then raise exception 'bad refund request' using errcode = '22023'; end if;
  if exists (select 1 from public.boost_ledger where message_id = p_message and reason = 'refund') then return 'duplicate'; end if;
  select l.user_id into spender from public.boost_ledger l where l.message_id = p_message and l.reason = 'spend' and l.delta = -1 limit 1;
  select id, sender_id, recipient_id, boosted, status, expires_at into m from public.messages where id = p_message;
  if not found and spender is null then
    insert into app.boost_refund_log (message_id, cause, outcome, actor, note) values (p_message, p_cause, 'denied_unknown', p_actor, left(p_note, 500));
    return 'denied_unknown'; end if;
  rid := case when p_cause = 'recipient_deleted' then null else m.recipient_id end;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(spender, m.sender_id)::text, 0)); -- same lock as the spend path
  if exists (select 1 from public.boost_ledger where message_id = p_message and reason = 'refund') then return 'duplicate'; end if;
  if spender is null or (m.sender_id is not null and spender <> m.sender_id) then outcome := 'denied_no_spend';
  elsif m.id is null then outcome := 'denied_not_eligible'; -- message gone (purged/deleted): read state unknown -> never auto/support refund
  elsif m.status = 'read' then outcome := 'denied_read';
  elsif p_cause = 'expired' and not (m.expires_at <= now()) then outcome := 'denied_not_eligible';
  elsif p_cause = 'blocked' and not exists (select 1 from public.blocks b where b.blocker_id = m.recipient_id and b.blocked_id = m.sender_id) then outcome := 'denied_not_eligible';
  elsif p_cause = 'admin' and coalesce((select auth.role()), '') <> 'service_role' and p_actor <> 'service' then outcome := 'denied_not_eligible';
  else
    if p_cause <> 'admin' then
      select count(*) into n from public.boost_ledger where user_id = spender and reason = 'refund' and created_at > now() - interval '24 hours';
      if n >= app.boost_refund_daily_cap() then outcome := 'held'; end if;
    end if;
    if outcome is null then
      insert into public.boost_ledger (user_id, delta, reason, message_id) values (spender, 1, 'refund', p_message) on conflict do nothing;
      if not found then return 'duplicate'; end if;
      outcome := 'refunded';
      if p_cause = 'blocked' and m.id is not null then
        begin update public.messages set boosted = false where id = m.id; exception when others then null; end; -- un-pin (best effort)
      end if;
    end if;
  end if;
  insert into app.boost_refund_log (message_id, sender_id, recipient_id, cause, outcome, actor, note)
    values (p_message, coalesce(spender, m.sender_id), rid, p_cause, outcome, p_actor, left(p_note, 500));
  return outcome;
end $$;

-- legacy entry point (kept for compatibility): now goes through the conservative rules
create or replace function app.refund_boost(p_message uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin return app.boost_refund_decide(p_message, 'expired', 'system', 'legacy refund_boost') = 'refunded'; end $$;

create or replace function app.blocks_refund() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.boost_refund_decide(m.id, 'blocked', 'trigger') from public.messages m
    where m.sender_id = new.blocked_id and m.recipient_id = new.blocker_id and m.boosted and m.status <> 'read';
  return null;
end $$;

create or replace function app.purge_expired() returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform app.boost_refund_decide(m.id, 'expired', 'cron') from public.messages m where m.expires_at <= now() and m.boosted and m.status <> 'read';
  delete from public.messages where expires_at <= now(); get diagnostics n = row_count;
  delete from public.lfg_posts where expires_at <= now();
  delete from app.mesh_boost_refunds where registered_at < now() - interval '8 days';
  return n;
end $$;

-- recipient deletes their account: their unread boosted inbox would cascade away -> refund the senders first
create or replace function app.profile_delete_refunds() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.boost_refund_decide(m.id, 'recipient_deleted', 'trigger') from public.messages m
    where m.recipient_id = old.id and m.sender_id <> old.id and m.boosted and m.status <> 'read';
  return old;
end $$;
drop trigger if exists profile_delete_refunds on public.profiles;
create trigger profile_delete_refunds before delete on public.profiles for each row execute function app.profile_delete_refunds();

-- ===== owner view + support tools =====
create or replace function public.my_boost_refunds(p_limit integer default 50)
returns table (message_id uuid, cause text, outcome text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.message_id, l.cause, l.outcome, l.created_at from app.boost_refund_log l
  where l.sender_id = (select auth.uid()) and (select auth.uid()) is not null
  order by l.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) $$;

create or replace function public.boost_refund_admin(p_message uuid, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_note is null or char_length(trim(p_note)) < 3 then raise exception 'a note is required' using errcode = '22023'; end if;
  return app.boost_refund_decide(p_message, 'admin', 'service', p_note);
end $$;

create or replace function public.boost_refund_release(p_log bigint, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  select * into h from app.boost_refund_log where id = p_log and outcome = 'held';
  if not found then return 'not_held'; end if;
  perform pg_advisory_xact_lock(hashtextextended(h.sender_id::text, 0));
  if not exists (select 1 from public.boost_ledger where message_id = h.message_id and reason = 'spend' and delta = -1 and user_id = h.sender_id) then return 'denied_no_spend'; end if;
  insert into public.boost_ledger (user_id, delta, reason, message_id) values (h.sender_id, 1, 'refund', h.message_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  insert into app.boost_refund_log (message_id, sender_id, cause, outcome, actor, note) values (h.message_id, h.sender_id, 'release', 'released', 'service', left(coalesce(p_note, 'released held #' || p_log), 500));
  return 'released';
end $$;

-- ===== mesh path shared ledger (api/_fn/refund.js; codes are HMAC hashes made server-side) =====
create table if not exists app.mesh_boost_refunds (
  msg_id text primary key check (msg_id ~ '^[A-Za-z0-9+/=_-]{6,40}$'),
  from_h text not null check (char_length(from_h) between 8 and 64),
  to_h text not null check (char_length(to_h) between 8 and 64),
  registered_at timestamptz not null default now(),
  receipt_at timestamptz,
  refunded_at timestamptz);
create index if not exists mesh_boost_refunds_from_idx on app.mesh_boost_refunds (from_h, registered_at desc);
create index if not exists mesh_boost_refunds_refunded_idx on app.mesh_boost_refunds (from_h, refunded_at) where refunded_at is not null;
alter table app.mesh_boost_refunds enable row level security;
revoke all on app.mesh_boost_refunds from public, anon, authenticated;

create or replace function public.mesh_refund(p_op text, p_msg text, p_from text, p_to text default null, p_min_age_ms integer default 8000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; n int;
begin
  if p_msg is null or p_msg !~ '^[A-Za-z0-9+/=_-]{6,40}$' or p_from is null or char_length(p_from) not between 8 and 64 then
    return jsonb_build_object('ok', false, 'reason', 'bad request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('mesh:' || p_from, 0));
  if p_op = 'register' then
    if p_to is null or char_length(p_to) not between 8 and 64 or p_to = p_from then return jsonb_build_object('ok', false, 'reason', 'bad request'); end if;
    select count(*) into n from app.mesh_boost_refunds where from_h = p_from and registered_at > now() - interval '24 hours';
    if n >= 300 then return jsonb_build_object('ok', false, 'reason', 'register cap'); end if;
    insert into app.mesh_boost_refunds (msg_id, from_h, to_h) values (p_msg, p_from, p_to) on conflict do nothing;
    if not found then return jsonb_build_object('ok', false, 'reason', 'dup'); end if;
    return jsonb_build_object('ok', true);
  end if;
  select * into e from app.mesh_boost_refunds where msg_id = p_msg;
  if not found or e.from_h <> p_from or (p_op = 'receipt' and e.to_h is distinct from p_to) then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if p_op = 'receipt' then -- the Ed25519 receipt signature is verified by the API before this call
    update app.mesh_boost_refunds set receipt_at = coalesce(receipt_at, now()) where msg_id = p_msg; return jsonb_build_object('ok', true); end if;
  if p_op <> 'claim' then return jsonb_build_object('ok', false, 'reason', 'bad op'); end if;
  if e.refunded_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if e.receipt_at is not null then return jsonb_build_object('ok', false, 'reason', 'delivered'); end if;
  if now() - e.registered_at < make_interval(secs => greatest(coalesce(p_min_age_ms, 8000), 1000) / 1000.0) then return jsonb_build_object('ok', false, 'reason', 'too early'); end if;
  select count(*) into n from app.mesh_boost_refunds where from_h = p_from and refunded_at > now() - interval '24 hours';
  if n >= app.boost_refund_daily_cap() then return jsonb_build_object('ok', false, 'reason', 'capped'); end if;
  update app.mesh_boost_refunds set refunded_at = now() where msg_id = p_msg;
  return jsonb_build_object('ok', true, 'refunded', true);
end $$;

-- ===== lockdown =====
revoke all on function app.boost_refund_log_immutable(), app.boost_refund_daily_cap(), app.boost_refund_decide(uuid, text, text, text),
  app.refund_boost(uuid), app.blocks_refund(), app.purge_expired(), app.profile_delete_refunds() from public, anon, authenticated;
revoke all on function public.my_boost_refunds(integer), public.boost_refund_admin(uuid, text), public.boost_refund_release(bigint, text),
  public.mesh_refund(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.my_boost_refunds(integer) to authenticated;
grant execute on function public.boost_refund_admin(uuid, text), public.boost_refund_release(bigint, text), public.mesh_refund(text, text, text, text, integer) to service_role;
comment on function public.mesh_refund(text, text, text, text, integer) is 'v41 mesh boost refund ledger (service role only): register/receipt/claim, capped, idempotent.';
comment on function public.boost_refund_admin(uuid, text) is 'v41 support refund of one boost (service role only): spend-bound, idempotent, audited, bypasses the daily cap.';
