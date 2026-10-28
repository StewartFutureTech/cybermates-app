-- v45 live test for CSAM evidence preservation (migrations 20261027000011 + 20261027000012). Run as the project owner (SQL editor / MCP execute_sql).
-- Creates throwaway users, a TEST evidence key, reports, a conversation and evidence INSIDE ONE transaction and ends with
-- RAISE EXCEPTION 'V45RESULT pass=N fail=M ...', so everything rolls back (nothing is left behind, no real key is installed).
do $t$
declare
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); x uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
  mo uuid := gen_random_uuid(); ld uuid := gen_random_uuid();
  r1 uuid; r2 uuid; r6 uuid; r7 uuid; r3 uuid; r4 uuid; r5 uuid; conv uuid; h uuid; h2 uuid; h4 uuid; n int; s text; j jsonb; ts timestamptz; ok boolean;
  c0 text := repeat('QUJD', 40); c1 text := 'REVGRw=='; env jsonb; out text := ''; pass int := 0; fail int := 0;
  procedure_dummy int;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v45-' || u || '@test.invalid', now(), now()
      from unnest(array[a1, a2, x, m1, m2, mo, ld]) u;
  insert into public.profiles (id, handle, age_band) values (a1, 'v45a1_' || substr(md5(a1::text),1,6), 'adult'), (a2, 'v45a2_' || substr(md5(a2::text),1,6), 'adult'),
    (x, 'v45x_' || substr(md5(x::text),1,6), 'adult'), (m1, 'v45m1_' || substr(md5(m1::text),1,6), 'minor'), (m2, 'v45m2_' || substr(md5(m2::text),1,6), 'minor'),
    (mo, 'v45mo_' || substr(md5(mo::text),1,6), 'adult'), (ld, 'v45ld_' || substr(md5(ld::text),1,6), 'adult')
    on conflict (id) do update set age_band = excluded.age_band;
  insert into public.moderators (user_id, role) values (mo, 'reviewer'), (ld, 'lead');
  -- TEST key (rolled back). Any existing active key is deactivated inside this transaction only.
  update app.evidence_keys set active = false where active;
  insert into app.evidence_keys (kid, pub) values ('v45test', repeat('A', 43) || '=');
  -- a conversation a1 <-> a2 with one server message (E2E ciphertext stand-in) from the reported user
  insert into public.conversations (user_a, user_b, band, created_by) values (least(a1, a2), greatest(a1, a2), 'adult', a1) returning id into conv;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true); -- sender context for app.peer_of
  insert into public.messages (conversation_id, sender_id, recipient_id, body, nonce) values (conv, a2, a1, 'CIPHERTEXT-v45', 'n1');
  env := jsonb_build_object('v', 1, 'alg', 'nacl-box', 'kid', 'v45test', 'e', repeat('A', 43) || '=', 'n', repeat('B', 32), 'parts', 2,
    'sha256', encode(sha256(convert_to(c0 || c1, 'UTF8')), 'hex'), 'bytes', octet_length(c0 || c1), 'items', 3, 'media', 1);

  -- minor reporter: a P1 threats report filed FIRST (older), to prove CSAM still sorts ahead of it
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.reports (reporter_id, reported_id, reason) values (m1, m2, 'threats/violence') returning id into r3;
  insert into public.reports (reporter_id, reported_id, reason) values (m1, m2, 'illegal content (incl. child abuse)') returning id into r5;
  select public.evidence_begin(r5, env) into h4; if h4 is not null then pass := pass + 1; out := out || 'PASS minor reporter can upload CSAM evidence; '; else fail := fail + 1; out := out || 'FAIL minor begin; '; end if;
  insert into public.reports (reporter_id, reported_id, reason) values (m1, m2, 'illegal content (incl. child abuse)') returning id into r6;
  insert into public.reports (reporter_id, reported_id, reason) values (m1, a2, 'illegal content (incl. child abuse)') returning id into r7;
  reset role;
  update public.reports set created_at = now() - interval '31 days' where id = r6; update public.reports set created_at = now() - interval '10 days' where id = r7;
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.evidence_begin(r6, env); fail := fail + 1; out := out || 'FAIL 31-day-old upload; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS upload window closes after 30 days; '; end;
  select public.evidence_begin(r7, env) into h4; if h4 is not null then pass := pass + 1; out := out || 'PASS 10-day-old report still accepts its queued evidence; '; else fail := fail + 1; out := out || 'FAIL 10-day; '; end if;
  reset role;
  perform pg_sleep(0.01);

  -- reporter a1
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.reports (reporter_id, reported_id, reason, details) values (a1, a2, 'illegal content (incl. child abuse)', null) returning id into r1;
  insert into public.reports (reporter_id, reported_id, reason, details) values (a1, a2, 'harassment', 'v45 normal') returning id into r2;
  select count(*) into n from public.reports where id = r2 and status = 'open' and priority = 3; if n = 1 then pass := pass + 1; out := out || 'PASS normal report unchanged (open P3, reporter sees it); '; else fail := fail + 1; out := out || 'FAIL normal report; '; end if;
  select count(*) into n from public.reports where id = r1 and status = 'escalated' and priority = 1; if n = 1 then pass := pass + 1; out := out || 'PASS CSAM report auto P1 + escalated; '; else fail := fail + 1; out := out || 'FAIL csam priority; '; end if;
  select kid into s from public.evidence_pubkey(); if s = 'v45test' then pass := pass + 1; out := out || 'PASS reporter gets team PUBLIC key; '; else fail := fail + 1; out := out || 'FAIL pubkey ' || coalesce(s, 'null') || '; '; end if;
  begin perform public.evidence_begin(r2, env); fail := fail + 1; out := out || 'FAIL non-csam upload allowed; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS no evidence upload for non-CSAM reports; '; end;
  begin perform public.evidence_begin(r1, env || '{"alg":"aes"}'); fail := fail + 1; out := out || 'FAIL bad env; ';
  exception when invalid_parameter_value then pass := pass + 1; out := out || 'PASS bad envelope refused; '; end;
  begin perform public.evidence_begin(r1, env || '{"kid":"other"}'); fail := fail + 1; out := out || 'FAIL wrong kid; ';
  exception when invalid_parameter_value then pass := pass + 1; out := out || 'PASS wrong key id refused; '; end;
  select public.evidence_begin(r1, env) into h;
  begin perform public.evidence_put(h, 0, c0, repeat('0', 64)); fail := fail + 1; out := out || 'FAIL bad hash; ';
  exception when invalid_parameter_value then pass := pass + 1; out := out || 'PASS part hash verified server-side; '; end;
  begin perform public.evidence_put(h, 5, c0, encode(sha256(convert_to(c0, 'UTF8')), 'hex')); fail := fail + 1; out := out || 'FAIL bad idx; ';
  exception when invalid_parameter_value then pass := pass + 1; out := out || 'PASS part index bounded; '; end;
  select public.evidence_put(h, 0, c0, encode(sha256(convert_to(c0, 'UTF8')), 'hex')) into j;
  if (j->>'complete')::boolean = false and (j->>'received')::int = 1 then pass := pass + 1; out := out || 'PASS part 1/2 stored; '; else fail := fail + 1; out := out || 'FAIL part0 ' || j::text || '; '; end if;
  begin perform public.mod_evidence_list(r1); fail := fail + 1; out := out || 'FAIL reporter listed holds; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS reporter cannot list evidence; '; end;
  begin perform count(*) from app.evidence_parts; fail := fail + 1; out := out || 'FAIL reporter read parts table; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS evidence tables closed to clients; '; end;
  reset role;
  -- someone else cannot add parts to a1's hold
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.evidence_put(h, 1, c1, encode(sha256(convert_to(c1, 'UTF8')), 'hex')); fail := fail + 1; out := out || 'FAIL stranger put; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS only the reporter can upload to the hold; '; end;
  begin perform public.evidence_begin(r1, env); fail := fail + 1; out := out || 'FAIL stranger begin; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS stranger cannot start evidence on another report; '; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  select public.evidence_put(h, 1, c1, encode(sha256(convert_to(c1, 'UTF8')), 'hex')) into j;
  if (j->>'complete')::boolean then pass := pass + 1; out := out || 'PASS upload complete (whole-bundle SHA-256 verified); '; else fail := fail + 1; out := out || 'FAIL complete ' || j::text || '; '; end if;
  begin perform public.evidence_begin(r1, env); fail := fail + 1; out := out || 'FAIL re-begin after complete; ';
  exception when unique_violation then pass := pass + 1; out := out || 'PASS completed evidence cannot be replaced; '; end;
  reset role;
  -- reported user: nothing
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.mod_evidence_get(h, 0); fail := fail + 1; out := out || 'FAIL reported user read evidence; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS reported user cannot read evidence; '; end;
  select count(*) into n from public.reports where id = r1; if n = 0 then pass := pass + 1; out := out || 'PASS reported user cannot see the report; '; else fail := fail + 1; out := out || 'FAIL reported sees report; '; end if;
  reset role;
  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  begin perform * from public.evidence_pubkey(); fail := fail + 1; out := out || 'FAIL anon pubkey; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS anon denied; '; end;
  reset role;
  -- server copies + purge: the normal 7-day purge still removes server messages; the hold keeps its copy
  select count(*) into n from app.evidence_server_copies where hold_id = h and body = 'CIPHERTEXT-v45'; if n = 1 then pass := pass + 1; out := out || 'PASS server message ciphertext copied into the hold; '; else fail := fail + 1; out := out || 'FAIL server copy n=' || n || '; '; end if;
  set local session_replication_role = replica; -- owner-only test shortcut: age the message past its 7-day expiry without the client update guard
  update public.messages set expires_at = now() - interval '1 minute', created_at = now() - interval '8 days' where conversation_id = conv;
  set local session_replication_role = origin;
  perform app.purge_expired();
  select count(*) into n from public.messages where conversation_id = conv; if n = 0 then pass := pass + 1; out := out || 'PASS normal auto-delete still purges server messages; '; else fail := fail + 1; out := out || 'FAIL purge n=' || n || '; '; end if;
  select count(*) into n from app.evidence_server_copies where hold_id = h; select count(*) + n into n from app.evidence_parts where hold_id = h;
  if n = 3 then pass := pass + 1; out := out || 'PASS evidence hold exempt from the purge; '; else fail := fail + 1; out := out || 'FAIL hold after purge n=' || n || '; '; end if;
  -- moderator (reviewer)
  perform set_config('request.jwt.claims', json_build_object('sub', mo, 'role', 'authenticated')::text, true); set local role authenticated;
  select q.id into s from public.mod_queue('serious', 200) q where q.id in (r1, r3) limit 1;
  if s = r1::text then pass := pass + 1; out := out || 'PASS CSAM first in the Serious bucket (ahead of an older P1); '; else fail := fail + 1; out := out || 'FAIL csam order; '; end if;
  select count(*) into n from public.mod_evidence_list(r1) e where e.complete and e.parts_received = 2 and e.server_copies = 1 and e.items = 3 and e.media = 1;
  if n = 1 then pass := pass + 1; out := out || 'PASS moderator lists the hold (2/2 parts, 1 server copy); '; else fail := fail + 1; out := out || 'FAIL mod list n=' || n || '; '; end if;
  select public.mod_evidence_get(h, 0) into j;
  if j->>'c' = c0 and j->'env'->>'kid' = 'v45test' then pass := pass + 1; out := out || 'PASS moderator gets sealed part + envelope; '; else fail := fail + 1; out := out || 'FAIL mod get; '; end if;
  select count(*) into n from public.report_actions where report_id = r1 and action = 'evidence_view' and moderator_id = mo;
  if n = 1 then pass := pass + 1; out := out || 'PASS view mirrored into report_actions audit; '; else fail := fail + 1; out := out || 'FAIL audit view n=' || n || '; '; end if;
  select count(*) into n from public.mod_evidence_server_copies(h); if n = 1 then pass := pass + 1; out := out || 'PASS moderator reads preserved server copies; '; else fail := fail + 1; out := out || 'FAIL server copies; '; end if;
  select public.mod_cybertip_packet(h) into j;
  if (j->>'sent')::boolean = false and jsonb_array_length(j->'uploaded_files') = 2 and (j->'uploaded_files'->0->>'viewed_by_esp')::boolean
     and j->'reported_person'->>'esp_user_id' = a2::text and j->'reported_person'->>'screen_name' like 'v45a2_%' and j->'bundle'->>'sha256' = env->>'sha256'
     and j->'incident_summary'->>'incident_type' like 'Child Pornography%' and jsonb_array_length(j->'reported_person'->'ip_capture_events') = 0 then
    pass := pass + 1; out := out || 'PASS CyberTip packet assembled (not sent, files + hashes, reported person); '; else fail := fail + 1; out := out || 'FAIL packet ' || left(j::text, 200) || '; '; end if;
  begin perform public.mod_cybertip_recorded(h, 'TIP123'); fail := fail + 1; out := out || 'FAIL reviewer recorded tip; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS only a lead records a CyberTip id; '; end;
  begin perform public.mod_evidence_get(h, 9); fail := fail + 1; out := out || 'FAIL missing part; ';
  exception when no_data_found then pass := pass + 1; out := out || 'PASS missing part -> not found; '; end;
  -- 2703(f) preservation on a NORMAL report (metadata + server-copy hold)
  select public.mod_preserve(r2, null, 'LE-2703F-001', 'Test PD', 90) into ts;
  if ts between now() + interval '89 days' and now() + interval '91 days' then pass := pass + 1; out := out || 'PASS 2703(f) hold 90 days on a normal report; '; else fail := fail + 1; out := out || 'FAIL preserve ' || ts || '; '; end if;
  select e.hold_id into h2 from public.mod_evidence_list(r2) e;
  select public.mod_preserve(null, h2, 'LE-2703F-001-renew', 'Test PD', 90) into ts;
  if ts between now() + interval '179 days' and now() + interval '181 days' then pass := pass + 1; out := out || 'PASS renewal extends from the current end (180 d); '; else fail := fail + 1; out := out || 'FAIL renew ' || ts || '; '; end if;
  begin perform public.mod_preserve(r2, null, 'LE-x', 'PD', 91); fail := fail + 1; out := out || 'FAIL 91 days; ';
  exception when invalid_parameter_value then pass := pass + 1; out := out || 'PASS >90 days per request refused; '; end;
  begin perform public.mod_preserve(r2, null, ' ', 'PD', 30); fail := fail + 1; out := out || 'FAIL empty ref; ';
  exception when invalid_parameter_value then pass := pass + 1; out := out || 'PASS request reference required; '; end;
  reset role;
  -- moderator files their own CSAM report -> cannot touch its evidence (conflict of interest)
  perform set_config('request.jwt.claims', json_build_object('sub', mo, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.reports (reporter_id, reported_id, reason) values (mo, x, 'illegal content (incl. child abuse)') returning id into r4;
  select public.evidence_begin(r4, env) into h4;
  begin perform public.mod_evidence_get(h4, 0); fail := fail + 1; out := out || 'FAIL conflict view; ';
  exception when insufficient_privilege then pass := pass + 1; out := out || 'PASS moderator cannot open evidence of own report; '; end;
  select count(*) into n from public.mod_evidence_list(r4); if n = 0 then pass := pass + 1; out := out || 'PASS own-report hold hidden from that moderator; '; else fail := fail + 1; out := out || 'FAIL conflict list; '; end if;
  reset role;
  -- lead records the CyberTip id -> preserved 1 year from now; only once
  perform set_config('request.jwt.claims', json_build_object('sub', ld, 'role', 'authenticated')::text, true); set local role authenticated;
  select public.mod_cybertip_recorded(h, 'TIP-123') into ts;
  if ts >= now() + interval '364 days' then pass := pass + 1; out := out || 'PASS CyberTip id recorded, preserved 1 year; '; else fail := fail + 1; out := out || 'FAIL tip; '; end if;
  begin perform public.mod_cybertip_recorded(h, 'TIP-999'); fail := fail + 1; out := out || 'FAIL tip overwrite; ';
  exception when unique_violation then pass := pass + 1; out := out || 'PASS CyberTip id cannot be overwritten; '; end;
  reset role;
  select count(*) into n from app.evidence_access_log where hold_id = h and action in ('submit','complete','view','server_copies','packet','cybertip_recorded');
  if n >= 6 then pass := pass + 1; out := out || 'PASS every access logged (' || n || ' rows); '; else fail := fail + 1; out := out || 'FAIL access log n=' || n || '; '; end if;
  -- reporter deletes their account: the report cascades away, the hold (snapshot) stays
  delete from public.profiles where id = a1;
  select count(*) into n from app.evidence_holds where id = h and report_id is null and reason = 'illegal content (incl. child abuse)' and reported_id = a2;
  if n = 1 then pass := pass + 1; out := out || 'PASS hold survives reporter account deletion (snapshot kept); '; else fail := fail + 1; out := out || 'FAIL hold after delete; '; end if;
  -- expiry: only when preservation AND legal hold have both passed
  update app.evidence_holds set preserve_until = now() - interval '1 day' where id in (h, h2);
  perform app.purge_evidence();
  select count(*) into n from app.evidence_holds where id = h2; if n = 1 then pass := pass + 1; out := out || 'PASS legal hold blocks expiry; '; else fail := fail + 1; out := out || 'FAIL legal hold purged; '; end if;
  select count(*) into n from app.evidence_holds where id = h; if n = 0 then pass := pass + 1; out := out || 'PASS expired hold removed by purge_evidence; '; else fail := fail + 1; out := out || 'FAIL expiry; '; end if;
  update app.evidence_holds set legal_hold_until = now() - interval '1 minute' where id = h2; perform app.purge_evidence();
  select count(*) into n from app.evidence_holds where id = h2; select count(*) into procedure_dummy from app.evidence_access_log where hold_id in (h, h2) and action = 'expired';
  if n = 0 and procedure_dummy = 2 then pass := pass + 1; out := out || 'PASS legal hold ended -> removed, expiry logged; '; else fail := fail + 1; out := out || 'FAIL legal expiry n=' || n || ' log=' || procedure_dummy || '; '; end if;
  raise exception 'V45RESULT pass=% fail=% :: %', pass, fail, out;
end $t$;
