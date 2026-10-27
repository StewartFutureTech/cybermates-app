-- v43: ID <-> signing-key binding registry (P0 "ID spoofing / identity binding").
-- The public ID code is device-derived (src/identity.js) and therefore guessable/spoofable on the web; before v43 the server
-- super list accepted ANY Ed25519 key for ANY code (and logoff needed no signature at all). Now api/_lib/idbind.js verifies a
-- self-signed proof-of-work claim (src/idbind.js) on every login/heartbeat and asks this registry, atomically:
--   * app.id_bindings: ONE key per ID (code_hash primary key) and ONE ID per key (pub_hash unique). Both columns are
--     HMAC-SHA256 hashes made server-side (salt ID_BIND_SALT / RL_KEY_SALT / service key): no raw IDs or keys stored.
--     Private `app` schema (not exposed via PostgREST), RLS on with NO policies, no grants for anon/authenticated.
--   * app.id_bind_log: append-only audit of rebinds (rotate / attested / idle), hashed ID only, no FKs.
--   * public.id_bind(code, pub, op, old, idle_secs, att) -> {status, why?, since?}. SECURITY DEFINER, search_path = '',
--     EXECUTE for service_role ONLY. Serialized per ID with a transaction-scoped advisory lock (first claim wins under races).
--       op 'claim'    : new -> 'new'; same key -> 'same' (touch last_seen); other key -> 'id-bound'; key on other ID -> 'key-bound'
--       op 'rotate'   : rebind only if p_old is the CURRENT key (the API verified the old key's signature)
--       op 'attested' : rebind when the API verified platform attestation for this ID (hook; not live until attestation is real)
--       op 'idle'     : rebind only if the current key has been silent for >= p_idle_secs (API also demanded the heavier PoW)
--       op 'check'    : read-only 'same' | 'unbound' | 'other' (logoff/delete must come from the bound key)
--       op 'touch'    : like check, and refreshes last_seen for 'same'
-- Signatures and proof of work are verified in the API (Node), never trusted from the DB caller. Nothing existing changes.

create table if not exists app.id_bindings (
  code_hash text primary key check (char_length(code_hash) between 8 and 80),
  pub_hash text not null unique check (char_length(pub_hash) between 8 and 80),
  attested boolean not null default false,
  bound_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  rebinds integer not null default 0 check (rebinds >= 0));
create index if not exists id_bindings_last_seen_idx on app.id_bindings (last_seen);
alter table app.id_bindings enable row level security;
revoke all on app.id_bindings from public, anon, authenticated;

create table if not exists app.id_bind_log (
  id bigint generated always as identity primary key,
  code_hash text not null,
  why text not null check (why in ('rotate', 'attested', 'idle')),
  at timestamptz not null default now());
alter table app.id_bind_log enable row level security;
revoke all on app.id_bind_log from public, anon, authenticated;
create or replace function app.id_bind_log_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'id_bind_log is append-only' using errcode = '42501'; end $$;
drop trigger if exists id_bind_log_no_update on app.id_bind_log;
create trigger id_bind_log_no_update before update or delete on app.id_bind_log for each row execute function app.id_bind_log_append_only();

create or replace function app.id_bind_at(p_code text, p_pub text, p_op text, p_old text, p_idle_secs integer, p_att boolean, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur app.id_bindings%rowtype; has_cur boolean; other text; why text;
begin
  if p_code is null or char_length(p_code) not between 8 and 80 then raise exception 'bad code' using errcode = '22023'; end if;
  if p_pub is null or char_length(p_pub) not between 8 and 80 then raise exception 'bad key' using errcode = '22023'; end if;
  if p_op is null or p_op not in ('claim', 'rotate', 'attested', 'idle', 'check', 'touch') then raise exception 'bad op' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('idbind|' || p_code, 0));
  perform pg_advisory_xact_lock(hashtextextended('idbind-key|' || p_pub, 0));
  select * into cur from app.id_bindings where code_hash = p_code for update; has_cur := found;
  if p_op in ('check', 'touch') then
    if not has_cur then return jsonb_build_object('status', 'unbound'); end if;
    if cur.pub_hash <> p_pub then return jsonb_build_object('status', 'other'); end if;
    if p_op = 'touch' then update app.id_bindings set last_seen = p_at where code_hash = p_code; end if;
    return jsonb_build_object('status', 'same');
  end if;
  if has_cur and cur.pub_hash = p_pub then
    update app.id_bindings set last_seen = p_at, attested = attested or coalesce(p_att, false) where code_hash = p_code;
    return jsonb_build_object('status', 'same', 'since', floor(extract(epoch from cur.bound_at) * 1000)::bigint);
  end if;
  select code_hash into other from app.id_bindings where pub_hash = p_pub;
  if other is not null and other <> p_code then return jsonb_build_object('status', 'key-bound'); end if;
  if not has_cur then
    insert into app.id_bindings (code_hash, pub_hash, attested, bound_at, last_seen) values (p_code, p_pub, coalesce(p_att, false), p_at, p_at);
    return jsonb_build_object('status', 'new', 'since', floor(extract(epoch from p_at) * 1000)::bigint);
  end if;
  why := case
    when p_op = 'rotate' and p_old is not null and p_old = cur.pub_hash then 'rotate'
    when p_op = 'attested' and coalesce(p_att, false) then 'attested'
    when p_op = 'idle' and p_idle_secs is not null and p_idle_secs >= 0 and cur.last_seen <= p_at - make_interval(secs => p_idle_secs) then 'idle'
    else null end;
  if why is null then
    return jsonb_build_object('status', 'id-bound', 'idle_ms', greatest(0, floor(extract(epoch from (p_at - cur.last_seen)) * 1000))::bigint);
  end if;
  update app.id_bindings set pub_hash = p_pub, attested = coalesce(p_att, false), bound_at = p_at, last_seen = p_at, rebinds = rebinds + 1 where code_hash = p_code;
  insert into app.id_bind_log (code_hash, why, at) values (p_code, why, p_at);
  return jsonb_build_object('status', 'rebound', 'why', why, 'since', floor(extract(epoch from p_at) * 1000)::bigint);
end $$;

create or replace function public.id_bind(p_code text, p_pub text, p_op text default 'claim', p_old text default null, p_idle_secs integer default 1209600, p_att boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return app.id_bind_at(p_code, p_pub, p_op, p_old, p_idle_secs, p_att, clock_timestamp());
end $$;

revoke all on function app.id_bind_log_append_only() from public, anon, authenticated;
revoke all on function app.id_bind_at(text, text, text, text, integer, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.id_bind(text, text, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.id_bind(text, text, text, text, integer, boolean) to service_role;
