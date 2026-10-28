-- v45: CSAM reporting duty + evidence preservation (TECHNICAL side only; counsel review, the real safety contact and any
-- actual NCMEC CyberTipline account/submission stay with the owner). Reconciles "media only on phones / auto-delete" with
-- report evidence preservation:
--   * Everything else keeps the phones-only / auto-delete model: app.purge_expired() is NOT changed (server message
--     ciphertext still expires after 7 days, LFG posts after 24 h) and normal reports keep working exactly as in v39.
--   * Only for a report filed under the child-exploitation category ('illegal content (incl. child abuse)') may the
--     REPORTER's phone upload what it holds locally from the reported person (messages, attachments/media, profile view),
--     SEALED on the phone to the safety team's PUBLIC key (nacl.box, X25519-XSalsa20-Poly1305). The server stores
--     ciphertext only and verifies it with SHA-256 (parts + whole); it can never read the evidence.
--   * app.evidence_holds / evidence_parts / evidence_server_copies live in the private `app` schema: RLS on, NO policies,
--     NO grants for anon/authenticated. They are NOT touched by app.purge_expired(); a separate app.purge_evidence() only
--     removes a hold once BOTH its preservation period (1 year, extended to 1 year after a recorded CyberTip) AND any
--     legal hold (18 U.S.C. 2703(f) preservation request: 90 days, renewable) have passed.
--   * Holds keep a snapshot of the report and the reported account (no FKs that cascade), so they survive the reporter
--     or the reported user deleting their account, and the server's own copies of the reported conversation's message
--     ciphertext are copied into the hold before the 7-day purge removes them.
--   * Moderator-only access (public.moderators, adults only, active) through SECURITY DEFINER RPCs; conflict of interest
--     refused; EVERY access (list, view, server copies, packet, preservation, CyberTip record) is written to the append-only
--     app.evidence_access_log AND mirrored into public.report_actions (the v39 audit the team already reads).
--   * CSAM reports are auto-routed to the Serious bucket at top priority (P1 + escalated by app.report_guard since v39;
--     now also ordered FIRST inside the bucket, ahead of other P1s).
--   * public.mod_cybertip_packet() assembles a CyberTipline-ready packet (jsonb) and sends NOTHING anywhere.
-- Nothing is dropped; no existing table, policy or grant is loosened.

-- ===== team evidence key (public half only; the secret half is generated offline: scripts/evidence-key.mjs) =====
create table if not exists app.evidence_keys (
  kid text primary key check (kid ~ '^[A-Za-z0-9_-]{4,32}$'),
  pub text not null check (pub ~ '^[A-Za-z0-9+/]{43}=$'),
  active boolean not null default true,
  created_at timestamptz not null default now());
create unique index if not exists evidence_keys_one_active on app.evidence_keys ((true)) where active;
alter table app.evidence_keys enable row level security;
revoke all on app.evidence_keys from public, anon, authenticated;

-- ===== evidence holds =====
create table if not exists app.evidence_holds (
  id uuid primary key default gen_random_uuid(),
  report_id uuid unique references public.reports(id) on delete set null,
  kind text not null default 'csam' check (kind in ('csam','legal')),     -- 'legal' = metadata/server-copy hold made by a 2703(f) request
  reporter_id uuid, reported_id uuid,                                      -- plain uuids on purpose: no cascade on account deletion
  reporter_band text, reported_band text,
  reason text, details text, report_created_at timestamptz,
  reported_profile jsonb, reporter_codes jsonb,
  env jsonb,                                                               -- {v, alg, kid, e, n, parts, sha256, items, media, bytes}
  parts_expected smallint not null default 0 check (parts_expected between 0 and 12),
  parts_received smallint not null default 0,
  bytes bigint not null default 0,
  complete_at timestamptz,
  created_at timestamptz not null default now(),
  preserve_until timestamptz not null default now() + interval '365 days',
  legal_hold_until timestamptz,
  legal_refs jsonb not null default '[]'::jsonb,
  cybertip_report_id text check (char_length(cybertip_report_id) <= 64),
  cybertip_submitted_at timestamptz,
  first_viewed_at timestamptz);
create index if not exists evidence_holds_expiry_idx on app.evidence_holds (preserve_until, legal_hold_until);
alter table app.evidence_holds enable row level security;
revoke all on app.evidence_holds from public, anon, authenticated;

create table if not exists app.evidence_parts (
  hold_id uuid not null references app.evidence_holds(id) on delete cascade,
  idx smallint not null check (idx between 0 and 11),
  c text not null check (char_length(c) between 4 and 1048576 and c ~ '^[A-Za-z0-9+/]+={0,2}$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null,
  created_at timestamptz not null default now(),
  primary key (hold_id, idx));
alter table app.evidence_parts enable row level security;
revoke all on app.evidence_parts from public, anon, authenticated;

-- server-side records we already hold for the reported conversation (still E2E ciphertext: the server cannot read them)
create table if not exists app.evidence_server_copies (
  hold_id uuid not null references app.evidence_holds(id) on delete cascade,
  message_id uuid not null,
  conversation_id uuid, sender_id uuid, recipient_id uuid,
  body text, nonce text, created_at timestamptz, copied_at timestamptz not null default now(),
  primary key (hold_id, message_id));
alter table app.evidence_server_copies enable row level security;
revoke all on app.evidence_server_copies from public, anon, authenticated;

-- append-only access log (no FKs: survives hold expiry, report/account deletion)
create table if not exists app.evidence_access_log (
  id bigint generated always as identity primary key,
  hold_id uuid, report_id uuid, actor uuid,
  action text not null check (action in ('submit','part','complete','list','view','server_copies','packet','preserve','cybertip_recorded','expired')),
  detail text check (char_length(detail) <= 500),
  at timestamptz not null default now());
create index if not exists evidence_access_log_hold_idx on app.evidence_access_log (hold_id, at);
alter table app.evidence_access_log enable row level security;
revoke all on app.evidence_access_log from public, anon, authenticated;

-- mirror evidence access into the v39 audit (extend its allowed actions; nothing removed)
alter table public.report_actions drop constraint if exists report_actions_action_check;
alter table public.report_actions add constraint report_actions_action_check check (action in
  ('claim','in_review','escalated','actioned','dismissed','note',
   'evidence_received','evidence_list','evidence_view','evidence_server_copies','cybertip_packet','preservation','cybertip_recorded'));

create or replace function app.is_csam_reason(p_reason text) returns boolean language sql immutable set search_path = '' as
$$ select p_reason = 'illegal content (incl. child abuse)' $$;

create or replace function app.evidence_log(p_hold uuid, p_report uuid, p_action text, p_detail text default null, p_mirror text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into app.evidence_access_log (hold_id, report_id, actor, action, detail) values (p_hold, p_report, (select auth.uid()), p_action, left(p_detail, 500));
  if p_mirror is not null and p_report is not null and exists (select 1 from public.reports where id = p_report) then
    insert into public.report_actions (report_id, moderator_id, action, note)
         values (p_report, case when app.is_moderator() then (select auth.uid()) else null end, p_mirror, left(coalesce(p_detail, ''), 1000));
  end if;
end $$;

-- snapshot the report + reported account + our own server copies of the reported conversation into a hold (idempotent)
create or replace function app.evidence_snapshot(p_report uuid, p_kind text) returns uuid language plpgsql security definer set search_path = '' as $$
declare r record; h uuid; conv uuid;
begin
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
  select id into h from app.evidence_holds where report_id = p_report;
  if h is null then
    insert into app.evidence_holds (report_id, kind, reporter_id, reported_id, reporter_band, reported_band, reason, details, report_created_at, reported_profile, reporter_codes)
    values (p_report, p_kind, r.reporter_id, r.reported_id, app.band_of(r.reporter_id), app.band_of(r.reported_id), r.reason, r.details, r.created_at,
            (select jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'age_band', p.age_band, 'created_at', p.created_at,
                                       'last_seen', p.last_seen, 'e2e_pubkey', p.e2e_pubkey) from public.profiles p where p.id = r.reported_id),
            r.evidence - 'excerpt')
    returning id into h;
  end if;
  conv := coalesce(r.conversation_id, (select c.id from public.conversations c
           where (c.user_a = least(r.reporter_id, r.reported_id) and c.user_b = greatest(r.reporter_id, r.reported_id)) limit 1));
  if conv is not null then
    insert into app.evidence_server_copies (hold_id, message_id, conversation_id, sender_id, recipient_id, body, nonce, created_at)
      select h, m.id, m.conversation_id, m.sender_id, m.recipient_id, m.body, m.nonce, m.created_at
        from public.messages m where m.conversation_id = conv order by m.created_at desc limit 500
      on conflict do nothing;
  end if;
  return h;
end $$;

-- ===== reporter side =====
create or replace function app.evidence_pubkey() returns table (kid text, pub text) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return query select k.kid, k.pub from app.evidence_keys k where k.active limit 1;
end $$;

create or replace function app.evidence_begin(p_report uuid, p_env jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare r record; h uuid; hk record; k text; nparts int;
begin
  select * into r from public.reports where id = p_report and reporter_id = (select auth.uid());
  if not found then raise exception 'report not found' using errcode = '42501'; end if;
  if not app.is_csam_reason(r.reason) then raise exception 'evidence upload is only for child-safety reports' using errcode = '42501'; end if;
  if r.created_at < now() - interval '72 hours' then raise exception 'report too old for evidence upload' using errcode = '42501'; end if;
  select ek.kid into k from app.evidence_keys ek where ek.active limit 1;
  if k is null then raise exception 'no evidence key configured' using errcode = '55000'; end if;
  nparts := (p_env->>'parts')::int;
  if jsonb_typeof(p_env) <> 'object' or p_env->>'v' <> '1' or p_env->>'alg' <> 'nacl-box' or p_env->>'kid' <> k
     or coalesce(p_env->>'e', '') !~ '^[A-Za-z0-9+/]{43}=$' or coalesce(p_env->>'n', '') !~ '^[A-Za-z0-9+/]{32}$'
     or coalesce(p_env->>'sha256', '') !~ '^[0-9a-f]{64}$' or nparts is null or nparts not between 1 and 12
     or (p_env->>'bytes')::bigint not between 4 and 12582912 or length(p_env::text) > 2000 then
    raise exception 'bad evidence envelope' using errcode = '22023'; end if;
  select * into hk from app.evidence_holds where report_id = p_report;
  if found and hk.complete_at is not null then raise exception 'evidence already received' using errcode = '23505'; end if;
  if found and hk.env is not null and hk.env->>'sha256' <> p_env->>'sha256' then
    delete from app.evidence_parts where hold_id = hk.id; -- a fresh upload of a different bundle restarts the incomplete one
  end if;
  h := app.evidence_snapshot(p_report, 'csam');
  update app.evidence_holds set kind = 'csam', env = jsonb_build_object('v', 1, 'alg', 'nacl-box', 'kid', k, 'e', p_env->>'e', 'n', p_env->>'n',
           'parts', nparts, 'sha256', p_env->>'sha256', 'bytes', (p_env->>'bytes')::bigint,
           'items', least(greatest(coalesce((p_env->>'items')::int, 0), 0), 100000), 'media', least(greatest(coalesce((p_env->>'media')::int, 0), 0), 100000)),
         parts_expected = nparts, parts_received = (select count(*) from app.evidence_parts where hold_id = h), bytes = (select coalesce(sum(bytes), 0) from app.evidence_parts where hold_id = h)
   where id = h;
  -- top priority, Serious bucket (already P1 + escalated by app.report_guard; re-asserted in case it was lowered)
  update public.reports set priority = 1, status = case when status = 'open' then 'escalated' else status end,
         escalation_level = greatest(escalation_level, 1), escalated_at = coalesce(escalated_at, now()) where id = p_report;
  perform app.evidence_log(h, p_report, 'submit', 'parts=' || nparts || ' bytes=' || (p_env->>'bytes'), null);
  return h;
end $$;

create or replace function app.evidence_put(p_hold uuid, p_idx int, p_c text, p_sha256 text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare hk record; got text; n int; tot bigint; whole text;
begin
  select * into hk from app.evidence_holds where id = p_hold and reporter_id = (select auth.uid()) and kind = 'csam' for update;
  if not found or hk.env is null then raise exception 'evidence hold not found' using errcode = '42501'; end if;
  if hk.complete_at is not null then return jsonb_build_object('complete', true, 'received', hk.parts_received); end if;
  if p_idx is null or p_idx < 0 or p_idx >= hk.parts_expected then raise exception 'bad part index' using errcode = '22023'; end if;
  if p_c is null or char_length(p_c) not between 4 and 1048576 or p_c !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception 'bad part' using errcode = '22023'; end if;
  got := encode(sha256(convert_to(p_c, 'UTF8')), 'hex');
  if got <> p_sha256 then raise exception 'part hash mismatch' using errcode = '22023'; end if;
  insert into app.evidence_parts (hold_id, idx, c, sha256, bytes) values (p_hold, p_idx, p_c, got, octet_length(p_c))
    on conflict (hold_id, idx) do update set c = excluded.c, sha256 = excluded.sha256, bytes = excluded.bytes, created_at = now();
  select count(*), coalesce(sum(bytes), 0) into n, tot from app.evidence_parts where hold_id = p_hold;
  if tot > 12582912 then raise exception 'evidence too large' using errcode = '22023'; end if;
  update app.evidence_holds set parts_received = n, bytes = tot where id = p_hold;
  if n = hk.parts_expected then
    select string_agg(c, '' order by idx) into whole from app.evidence_parts where hold_id = p_hold;
    if encode(sha256(convert_to(whole, 'UTF8')), 'hex') <> hk.env->>'sha256' or octet_length(whole) <> (hk.env->>'bytes')::bigint then
      raise exception 'evidence hash mismatch' using errcode = '22023'; end if;
    update app.evidence_holds set complete_at = now() where id = p_hold;
    perform app.evidence_log(p_hold, hk.report_id, 'complete', 'sha256=' || (hk.env->>'sha256'), 'evidence_received');
    return jsonb_build_object('complete', true, 'received', n);
  end if;
  return jsonb_build_object('complete', false, 'received', n);
end $$;

-- ===== moderator side =====
create or replace function app.evidence_guard(p_hold uuid, out hk app.evidence_holds) language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_moderator() then raise exception 'moderators only' using errcode = '42501'; end if;
  select * into hk from app.evidence_holds where id = p_hold;
  if not found then raise exception 'evidence hold not found' using errcode = 'P0002'; end if;
  if hk.reporter_id = (select auth.uid()) or hk.reported_id = (select auth.uid()) then
    raise exception 'conflict of interest: you are part of this report' using errcode = '42501'; end if;
end $$;

create or replace function app.mod_evidence_list(p_report uuid default null)
returns table (hold_id uuid, report_id uuid, kind text, reason text, reporter_band text, reported_band text, parts_expected smallint,
               parts_received smallint, bytes bigint, items int, media int, complete boolean, created_at timestamptz, preserve_until timestamptz,
               legal_hold_until timestamptz, cybertip_report_id text, cybertip_submitted_at timestamptz, server_copies int, views int)
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if not app.is_moderator() then raise exception 'moderators only' using errcode = '42501'; end if;
  perform app.evidence_log(null, p_report, 'list', null, null);
  return query select h.id, h.report_id, h.kind, h.reason, h.reporter_band, h.reported_band, h.parts_expected, h.parts_received, h.bytes,
      coalesce((h.env->>'items')::int, 0), coalesce((h.env->>'media')::int, 0), h.complete_at is not null, h.created_at, h.preserve_until,
      h.legal_hold_until, h.cybertip_report_id, h.cybertip_submitted_at,
      (select count(*)::int from app.evidence_server_copies s where s.hold_id = h.id),
      (select count(*)::int from app.evidence_access_log l where l.hold_id = h.id and l.action = 'view')
    from app.evidence_holds h
   where (p_report is null or h.report_id = p_report) and h.reporter_id is distinct from me and h.reported_id is distinct from me
   order by (h.kind = 'csam') desc, h.created_at desc limit 200;
end $$;

create or replace function app.mod_evidence_get(p_hold uuid, p_idx int) returns jsonb language plpgsql security definer set search_path = '' as $$
declare hk app.evidence_holds; p record;
begin
  hk := app.evidence_guard(p_hold);
  if hk.complete_at is null then raise exception 'evidence upload not complete' using errcode = '55000'; end if;
  select * into p from app.evidence_parts where hold_id = p_hold and idx = p_idx;
  if not found then raise exception 'part not found' using errcode = 'P0002'; end if;
  update app.evidence_holds set first_viewed_at = coalesce(first_viewed_at, now()) where id = p_hold;
  perform app.evidence_log(p_hold, hk.report_id, 'view', 'part ' || p_idx, 'evidence_view');
  return jsonb_build_object('env', hk.env, 'idx', p.idx, 'c', p.c, 'sha256', p.sha256);
end $$;

create or replace function app.mod_evidence_server_copies(p_hold uuid)
returns table (message_id uuid, conversation_id uuid, sender_id uuid, recipient_id uuid, body text, nonce text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare hk app.evidence_holds;
begin
  hk := app.evidence_guard(p_hold);
  perform app.evidence_log(p_hold, hk.report_id, 'server_copies', null, 'evidence_server_copies');
  return query select s.message_id, s.conversation_id, s.sender_id, s.recipient_id, s.body, s.nonce, s.created_at
    from app.evidence_server_copies s where s.hold_id = p_hold order by s.created_at;
end $$;

-- 18 U.S.C. 2703(f) preservation request (or internal legal hold): 1..90 days per request, renewable (extends from the
-- current end). Works for ANY report: without an uploaded bundle it makes a metadata + server-copy hold.
create or replace function app.mod_preserve(p_report uuid, p_hold uuid, p_ref text, p_agency text, p_days int default 90) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare hk app.evidence_holds; h uuid := p_hold; rr record; until_ts timestamptz;
begin
  if not app.is_moderator() then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_ref is null or char_length(trim(p_ref)) < 3 or char_length(p_ref) > 200 or char_length(coalesce(p_agency, '')) > 200 then
    raise exception 'request reference required' using errcode = '22023'; end if;
  if p_days is null or p_days not between 1 and 90 then raise exception 'days must be 1..90 per request (renew for more)' using errcode = '22023'; end if;
  if h is null then
    select * into rr from public.reports where id = p_report;
    if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
    if rr.reporter_id = (select auth.uid()) or rr.reported_id = (select auth.uid()) then
      raise exception 'conflict of interest: you are part of this report' using errcode = '42501'; end if;
    h := app.evidence_snapshot(p_report, 'legal');
  end if;
  hk := app.evidence_guard(h);
  if hk.report_id is not null then perform app.evidence_snapshot(hk.report_id, hk.kind); end if; -- refresh server copies
  until_ts := greatest(coalesce(hk.legal_hold_until, now()), now()) + make_interval(days => p_days);
  update app.evidence_holds set legal_hold_until = until_ts,
         legal_refs = legal_refs || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'ref', left(p_ref, 200), 'agency', left(p_agency, 200), 'days', p_days, 'until', until_ts))
   where id = h;
  perform app.evidence_log(h, hk.report_id, 'preserve', '2703(f) ' || left(p_ref, 120) || ' until ' || until_ts::date, 'preservation');
  return until_ts;
end $$;

-- CyberTipline-ready packet. Assembles the fields NCMEC's CyberTipline report asks for from what we hold. SENDS NOTHING.
create or replace function app.mod_cybertip_packet(p_hold uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare hk app.evidence_holds; rr record; pk jsonb;
begin
  hk := app.evidence_guard(p_hold);
  select r.status, r.priority, r.moderator_note, r.message_id, r.conversation_id into rr from public.reports r where r.id = hk.report_id;
  pk := jsonb_build_object(
    'packet_version', 1, 'generated_at', now(), 'generated_by', (select auth.uid()), 'sent', false,
    'notice', 'NOT SUBMITTED. Review with counsel, then submit manually through the NCMEC CyberTipline (report.cybertip.org or the ESP reporting API). Do not attach decrypted material outside that channel.',
    'reporting_esp', jsonb_build_object('company', 'Cybermates (legal entity: PLACEHOLDER)', 'point_of_contact', 'safety contact: PLACEHOLDER', 'esp_case_id', hk.id),
    'incident_summary', jsonb_build_object('incident_type', 'Child Pornography (possession, manufacture, and distribution)',
       'incident_datetime_utc', to_char(coalesce(hk.report_created_at, hk.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'report_received_utc', to_char(hk.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'child_in_imminent_danger', null, 'escalate_to_high_priority', null),
    'internet_details', jsonb_build_object('type', 'chat / instant messaging (peer-to-peer app)', 'service', 'Cybermates in-app chat',
       'conversation_id', rr.conversation_id, 'message_id', rr.message_id),
    'reported_person', jsonb_build_object('esp_user_id', hk.reported_id, 'screen_name', hk.reported_profile->>'handle',
       'display_name', hk.reported_profile->>'display_name', 'account_created_utc', hk.reported_profile->>'created_at',
       'last_seen_utc', hk.reported_profile->>'last_seen', 'age_band', hk.reported_band, 'public_key', hk.reported_profile->>'e2e_pubkey',
       'app_code', hk.reporter_codes->>'reported_code', 'email', null, 'phone', null,
       'ip_capture_events', '[]'::jsonb, 'ip_note', 'Cybermates does not log IP addresses (by design); none held.'),
    'reporter', jsonb_build_object('reporter_is_minor', hk.reporter_band = 'minor', 'note', 'internal reporter identity withheld from the packet; available to counsel on request'),
    'uploaded_files', (select coalesce(jsonb_agg(jsonb_build_object('file_name', 'cm-evidence-' || hk.id || '-part' || p.idx || '.sealed',
         'sha256', p.sha256, 'bytes', p.bytes, 'viewed_by_esp', hk.first_viewed_at is not null, 'publicly_available', false,
         'note', 'sealed bundle part (X25519-XSalsa20-Poly1305 to the safety-team key); per-file hashes come from the decrypted bundle') order by p.idx), '[]'::jsonb)
         from app.evidence_parts p where p.hold_id = hk.id),
    'bundle', jsonb_build_object('sha256', hk.env->>'sha256', 'bytes', hk.bytes, 'items', hk.env->'items', 'media', hk.env->'media', 'complete', hk.complete_at is not null,
         'first_viewed_utc', hk.first_viewed_at),
    'server_records', jsonb_build_object('message_copies', (select count(*) from app.evidence_server_copies s where s.hold_id = hk.id),
         'note', 'end-to-end encrypted ciphertext; the server cannot read it'),
    'additional_info', jsonb_build_object('reason', hk.reason, 'reporter_details', hk.details, 'moderator_note', rr.moderator_note, 'report_status', rr.status,
         'timeline', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'note', a.note) order by a.at), '[]'::jsonb)
                        from public.report_actions a where a.report_id = hk.report_id)),
    'preservation', jsonb_build_object('preserve_until', hk.preserve_until, 'legal_hold_until', hk.legal_hold_until, 'requests', hk.legal_refs),
    'cybertip', jsonb_build_object('report_id', hk.cybertip_report_id, 'submitted_at', hk.cybertip_submitted_at));
  perform app.evidence_log(p_hold, hk.report_id, 'packet', 'cybertip packet assembled (not sent)', 'cybertip_packet');
  return pk;
end $$;

-- after a person submitted the CyberTip manually: record its ID (lead only, once) and keep everything 1 year from now
create or replace function app.mod_cybertip_recorded(p_hold uuid, p_tip_id text) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare hk app.evidence_holds; until_ts timestamptz;
begin
  hk := app.evidence_guard(p_hold);
  if app.mod_role() <> 'lead' then raise exception 'only a lead can record a CyberTip report' using errcode = '42501'; end if;
  if p_tip_id is null or p_tip_id !~ '^[A-Za-z0-9_-]{3,64}$' then raise exception 'bad CyberTip report id' using errcode = '22023'; end if;
  if hk.cybertip_report_id is not null then raise exception 'CyberTip already recorded' using errcode = '23505'; end if;
  until_ts := greatest(hk.preserve_until, now() + interval '365 days');
  update app.evidence_holds set cybertip_report_id = p_tip_id, cybertip_submitted_at = now(), preserve_until = until_ts where id = p_hold;
  perform app.evidence_log(p_hold, hk.report_id, 'cybertip_recorded', 'CyberTip ' || p_tip_id || '; preserved until ' || until_ts::date, 'cybertip_recorded');
  return until_ts;
end $$;

-- expiry: ONLY holds whose preservation period AND legal hold have both passed (daily cron; owner-only)
create or replace function app.purge_evidence() returns integer language plpgsql security definer set search_path = '' as $$
declare n int := 0; h record;
begin
  for h in select id, report_id from app.evidence_holds where preserve_until < now() and (legal_hold_until is null or legal_hold_until < now()) loop
    insert into app.evidence_access_log (hold_id, report_id, actor, action, detail) values (h.id, h.report_id, null, 'expired', 'preservation + legal hold ended');
    delete from app.evidence_holds where id = h.id; n := n + 1;
  end loop;
  return n;
end $$;

-- CSAM first inside the Serious bucket (same signature/return type as v39; only the ORDER BY changes)
create or replace function app.mod_queue(p_bucket text default 'serious', p_limit int default 50)
returns table (id uuid, reporter_id uuid, reported_id uuid, message_id uuid, conversation_id uuid, reason text, details text,
               evidence jsonb, status text, priority smallint, escalation_level smallint, escalated_at timestamptz,
               created_at timestamptz, resolved_at timestamptz, moderator_note text, reporter_band text, reported_band text,
               reports_on_target int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_moderator() then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_bucket not in ('serious','open','resolved','all') then raise exception 'bad bucket' using errcode = '22023'; end if;
  return query
    select r.id, r.reporter_id, r.reported_id, r.message_id, r.conversation_id, r.reason, r.details, r.evidence, r.status,
           r.priority, r.escalation_level, r.escalated_at, r.created_at, r.resolved_at, r.moderator_note,
           app.band_of(r.reporter_id), app.band_of(r.reported_id),
           (select count(*)::int from public.reports x where x.reported_id = r.reported_id)
      from public.reports r
     where case p_bucket
             when 'serious'  then r.status in ('open','escalated','in_review') and (r.priority <= 2 or r.escalation_level >= 1 or r.status = 'escalated')
             when 'open'     then r.status in ('open','escalated','in_review')
             when 'resolved' then r.status in ('actioned','dismissed')
             else true end
     order by r.priority, app.is_csam_reason(r.reason) desc, r.escalation_level desc, r.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

-- ===== public wrappers (security invoker -> app.* does the checks), same pattern as v39 =====
create or replace function public.evidence_pubkey() returns table (kid text, pub text) language sql stable security invoker set search_path = '' as $$ select * from app.evidence_pubkey() $$;
create or replace function public.evidence_begin(p_report uuid, p_env jsonb) returns uuid language sql security invoker set search_path = '' as $$ select app.evidence_begin(p_report, p_env) $$;
create or replace function public.evidence_put(p_hold uuid, p_idx int, p_c text, p_sha256 text) returns jsonb language sql security invoker set search_path = '' as $$ select app.evidence_put(p_hold, p_idx, p_c, p_sha256) $$;
create or replace function public.mod_evidence_list(p_report uuid default null)
returns table (hold_id uuid, report_id uuid, kind text, reason text, reporter_band text, reported_band text, parts_expected smallint,
               parts_received smallint, bytes bigint, items int, media int, complete boolean, created_at timestamptz, preserve_until timestamptz,
               legal_hold_until timestamptz, cybertip_report_id text, cybertip_submitted_at timestamptz, server_copies int, views int)
language sql security invoker set search_path = '' as $$ select * from app.mod_evidence_list(p_report) $$;
create or replace function public.mod_evidence_get(p_hold uuid, p_idx int) returns jsonb language sql security invoker set search_path = '' as $$ select app.mod_evidence_get(p_hold, p_idx) $$;
create or replace function public.mod_evidence_server_copies(p_hold uuid)
returns table (message_id uuid, conversation_id uuid, sender_id uuid, recipient_id uuid, body text, nonce text, created_at timestamptz)
language sql security invoker set search_path = '' as $$ select * from app.mod_evidence_server_copies(p_hold) $$;
create or replace function public.mod_preserve(p_report uuid, p_hold uuid, p_ref text, p_agency text, p_days int default 90) returns timestamptz
  language sql security invoker set search_path = '' as $$ select app.mod_preserve(p_report, p_hold, p_ref, p_agency, p_days) $$;
create or replace function public.mod_cybertip_packet(p_hold uuid) returns jsonb language sql security invoker set search_path = '' as $$ select app.mod_cybertip_packet(p_hold) $$;
create or replace function public.mod_cybertip_recorded(p_hold uuid, p_tip_id text) returns timestamptz language sql security invoker set search_path = '' as $$ select app.mod_cybertip_recorded(p_hold, p_tip_id) $$;

-- ===== lockdown: never anon/public; internal helpers not even for authenticated =====
revoke execute on function app.is_csam_reason(text), app.evidence_log(uuid, uuid, text, text, text), app.evidence_snapshot(uuid, text),
  app.evidence_pubkey(), app.evidence_begin(uuid, jsonb), app.evidence_put(uuid, int, text, text), app.evidence_guard(uuid),
  app.mod_evidence_list(uuid), app.mod_evidence_get(uuid, int), app.mod_evidence_server_copies(uuid), app.mod_preserve(uuid, uuid, text, text, int),
  app.mod_cybertip_packet(uuid), app.mod_cybertip_recorded(uuid, text), app.purge_evidence() from public, anon;
revoke execute on function app.evidence_log(uuid, uuid, text, text, text), app.evidence_snapshot(uuid, text), app.evidence_guard(uuid), app.purge_evidence() from authenticated;
grant execute on function app.is_csam_reason(text), app.evidence_pubkey(), app.evidence_begin(uuid, jsonb), app.evidence_put(uuid, int, text, text),
  app.mod_evidence_list(uuid), app.mod_evidence_get(uuid, int), app.mod_evidence_server_copies(uuid), app.mod_preserve(uuid, uuid, text, text, int),
  app.mod_cybertip_packet(uuid), app.mod_cybertip_recorded(uuid, text) to authenticated;
revoke execute on function public.evidence_pubkey(), public.evidence_begin(uuid, jsonb), public.evidence_put(uuid, int, text, text),
  public.mod_evidence_list(uuid), public.mod_evidence_get(uuid, int), public.mod_evidence_server_copies(uuid), public.mod_preserve(uuid, uuid, text, text, int),
  public.mod_cybertip_packet(uuid), public.mod_cybertip_recorded(uuid, text) from public, anon;
grant execute on function public.evidence_pubkey(), public.evidence_begin(uuid, jsonb), public.evidence_put(uuid, int, text, text),
  public.mod_evidence_list(uuid), public.mod_evidence_get(uuid, int), public.mod_evidence_server_copies(uuid), public.mod_preserve(uuid, uuid, text, text, int),
  public.mod_cybertip_packet(uuid), public.mod_cybertip_recorded(uuid, text) to authenticated;

-- daily expiry of holds that are past BOTH preservation and legal hold
select cron.schedule('cybermates-purge-evidence', '41 3 * * *', $$select app.purge_evidence()$$);
