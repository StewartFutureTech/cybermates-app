-- v46 live test for the Realtime join gate + per-user limits (migration 20261027000013_realtime_gate.sql). Run as the project
-- owner (SQL editor / MCP execute_sql). Everything happens in ONE transaction that ends with
-- RAISE EXCEPTION 'V46RESULT pass=N fail=M ...', so it all rolls back (no users, admissions, config changes are left).
-- The fixed proof vectors were made with src/mesh-admit.js (scripts/smoke-rtgate.mjs re-derives and checks them).
do $t$
declare
  a1 uuid := '46464646-0000-4000-8000-000000000001'; a2 uuid := gen_random_uuid(); nb uuid := gen_random_uuid();
  mo uuid := gen_random_uuid(); ld uuid := gen_random_uuid();
  code text := 'TESTV46A'; pub text := 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; w bigint := 2945000;
  vfull bigint[] := array[8248,234520,105102,10770,200365,17417]; vatt bigint[] := array[1501,15];
  at0 timestamptz := to_timestamp(2945000::bigint * 600 + 5); j jsonb; b boolean; n int; cw bigint; sn bigint[]; x bigint; i int; h bytea; seed bytea;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v46-' || u || '@test.invalid', now(), now()
      from unnest(array[a1, a2, nb, mo, ld]) u on conflict (id) do nothing;
  insert into public.profiles (id, handle, age_band) values (a1, 'v46a1_' || substr(md5(a1::text),1,6), 'adult'), (a2, 'v46a2_' || substr(md5(a2::text),1,6), 'adult'),
    (mo, 'v46mo_' || substr(md5(mo::text),1,6), 'adult'), (ld, 'v46ld_' || substr(md5(ld::text),1,6), 'adult')
    on conflict (id) do update set age_band = excluded.age_band;
  delete from public.profiles where id = nb; -- nb: signed in, no age check yet
  insert into public.moderators (user_id, role) values (mo, 'reviewer'), (ld, 'lead');
  update app.mesh_gate_config set admit_per_hour = 6, admit_per_day = 24, ttl_secs = 43200, pow_b = 16, pow_k = 6, att_pow_b = 12, att_pow_k = 2, enabled = true where id;

  -- 1. PoW verifier = src/mesh-admit.js (JS-made vectors)
  if app.mesh_pow_ok(a1, code, pub, w, 16, 6, vfull) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL js vector; '; end if;
  if not app.mesh_pow_ok(a2, code, pub, w, 16, 6, vfull) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL other uid accepted; '; end if;
  if not app.mesh_pow_ok(a1, 'TESTV46B', pub, w, 16, 6, vfull) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL other code accepted; '; end if;
  if not app.mesh_pow_ok(a1, code, pub, w + 1, 16, 6, vfull) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL other window accepted; '; end if;
  if not app.mesh_pow_ok(a1, code, pub, w, 16, 6, array[8249,234520,105102,10770,200365,17417]::bigint[]) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL tampered nonce; '; end if;
  if not app.mesh_pow_ok(a1, code, pub, w, 16, 5, vfull) and not app.mesh_pow_ok(a1, code, pub, w, 16, 6, null) and not app.mesh_pow_ok(a1, code, pub, w, 16, 2, array[4294967296, 1]::bigint[])
     and not app.mesh_pow_ok(a1, code, pub, w, 25, 2, vatt) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL shape checks; '; end if;
  if app.mesh_pow_ok(a1, code, pub, w, 12, 2, vatt) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL attested vector; '; end if;

  -- 2. not signed in / anon
  perform set_config('request.jwt.claims', '', true);
  begin perform app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0); fail := fail + 1; out := out || 'FAIL no-uid admitted; ';
  exception when insufficient_privilege then pass := pass + 1; end;
  set local role anon;
  begin perform public.mesh_admit(code, pub, w, 16, 6, vfull); fail := fail + 1; out := out || 'FAIL anon can call mesh_admit; ';
  exception when insufficient_privilege then pass := pass + 1; end;
  reset role;
  select count(*) into n from pg_policies where schemaname = 'realtime' and tablename = 'messages' and ('anon' = any (roles) or 'public' = any (roles));
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL a realtime policy still includes anon/public; '; end if;

  -- 3. a1 admitted with the full web PoW (server clock pinned to the vector window)
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0);
  if (j->>'ok')::boolean and (j->>'ttl_secs')::int = 43200 and not (j->>'att')::boolean then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL a1 admit ' || j::text || '; '; end if;
  select count(*) into n from app.mesh_admissions where user_id = a1 and code_hash = app.mesh_hash('code', code) and via = 'pow' and expires_at = at0 + interval '12 hours';
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL admission row; '; end if;
  -- (the vector window is in the past, so the admission is already expired vs now(): the gate must say NO)
  set local role authenticated;
  if not app.mesh_topic_ok('mesh', 'broadcast', false) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL expired admission allowed; '; end if;
  reset role;
  update app.mesh_admissions set expires_at = now() + interval '12 hours' where user_id = a1; -- as if admitted just now
  set local role authenticated;
  if app.mesh_topic_ok('mesh', 'broadcast', false) and app.mesh_topic_ok('mesh', 'broadcast', true) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL admitted read/write mesh; '; end if;
  if app.mesh_topic_ok('control', 'broadcast', false) and not app.mesh_topic_ok('control', 'broadcast', true) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL control read-only; '; end if;
  if not app.mesh_topic_ok('mesh', 'presence', false) and not app.mesh_topic_ok('mesh', null, false) and not app.mesh_topic_ok('mesh2', 'broadcast', false) and not app.mesh_topic_ok('presence:adult', 'broadcast', false)
    then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL other topics/extensions; '; end if;
  -- the Realtime policy definitions themselves (this dev project has no realtime.messages day partitions yet - Realtime
  -- creates them - and the owner role may not create one, so the policies are checked by definition + the function above)
  reset role;
  select count(*) into n from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'realtime_mesh_read' and cmd = 'SELECT'
    and roles = '{authenticated}' and qual like '%app.mesh_topic_ok(%realtime.topic()%extension, false)%';
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL read policy definition; '; end if;
  select count(*) into n from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'realtime_mesh_write' and cmd = 'INSERT'
    and roles = '{authenticated}' and with_check like '%app.mesh_topic_ok(%realtime.topic()%extension, true)%';
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL write policy definition; '; end if;
  set local role authenticated;
  begin perform public.mesh_admit_service(a1, code, 'test', 7); fail := fail + 1; out := out || 'FAIL client called mesh_admit_service; ';
  exception when insufficient_privilege then pass := pass + 1; end;
  begin perform app.mesh_admitted(a2); fail := fail + 1; out := out || 'FAIL client can probe others; ';
  exception when insufficient_privilege then pass := pass + 1; end;
  reset role;

  -- 4. a2: no admission -> refused at the policy; a1's proof does not work for a2; failures are logged and count
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not app.mesh_topic_ok('mesh', 'broadcast', false) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL unadmitted allowed; '; end if;
  reset role;
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0);
  if j->>'error' = 'bad-proof' and (j->'need'->>'b')::int = 16 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL replay by a2 ' || j::text || '; '; end if;
  j := app.mesh_admit_at(code, pub, w, 8, 1, array[1]::bigint[], at0);
  if j->>'error' = 'bad-proof' then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL too little work accepted; '; end if;
  -- stale window (30 min later, same w) for a1
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0 + interval '30 minutes');
  if j->>'error' = 'bad-proof' then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL stale window accepted; '; end if;
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0 + interval '11 minutes'); -- previous window still accepted
  if (j->>'ok')::boolean then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL previous window ' || j::text || '; '; end if;
  select count(*) into n from app.mesh_admit_log where user_id = a1 and why = 'stale-window';
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL stale not logged; '; end if;

  -- 5. per-user hourly limit: a2 has 2 failed attempts; 4 more -> 6 = limit, the 7th is 'rate' (even with a valid proof)
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  for i in 1 .. 4 loop j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0 + interval '1 minute'); end loop;
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0 + interval '2 minutes');
  if j->>'error' = 'rate' and (j->>'retry_after_secs')::int = 3600 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL hourly limit ' || j::text || '; '; end if;
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0 + interval '61 minutes 30 seconds'); -- next hour: allowed to try again (proof stale -> bad-proof, not rate)
  if j->>'error' = 'bad-proof' then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL hour rollover ' || j::text || '; '; end if;
  -- daily limit: 24 attempts in the last 24 h
  insert into app.mesh_admit_log (user_id, at, ok, why) select a2, at0 + interval '3 hours' + make_interval(mins => g), false, 'bad-pow' from generate_series(1, 17) g;
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0 + interval '5 hours');
  if j->>'error' = 'rate' and (j->>'retry_after_secs')::int = 86400 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL daily limit ' || j::text || '; '; end if;

  -- 6. no age check -> refused + mesh_gate_info says so
  perform set_config('request.jwt.claims', json_build_object('sub', nb, 'role', 'authenticated')::text, true);
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, at0);
  if j->>'error' = 'age-check-required' then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL no-age admit ' || j::text || '; '; end if;
  set local role authenticated; j := public.mesh_gate_info(); reset role;
  if (j->>'age_checked')::boolean = false and (j->>'admitted')::boolean = false and (j->'pow'->>'b')::int = 16 and (j->'pow'->>'k')::int = 6 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL gate_info nb ' || j::text || '; '; end if;

  -- 7. the public wrapper with the real clock: tunables lowered inside this txn so SQL can solve it here (b=8,k=2)
  update app.mesh_gate_config set pow_b = 8, pow_k = 2 where id;
  perform set_config('request.jwt.claims', json_build_object('sub', mo, 'role', 'authenticated')::text, true);
  cw := floor(extract(epoch from now()) / 600)::bigint; sn := array[]::bigint[];
  for i in 0 .. 1 loop x := 0;
    seed := sha256(convert_to(format('cm-mesh-admit-v1|%s|%s|%s|%s|%s|%s', mo, code, pub, cw, 8, 2), 'UTF8'));
    loop h := sha256(seed || int4send(i) || substring(int8send(x) from 5 for 4)); exit when get_byte(h, 0) = 0; x := x + 1; end loop;
    sn := sn || x; end loop;
  set local role authenticated;
  j := public.mesh_admit(code, pub, cw, 8, 2, sn);
  if (j->>'ok')::boolean and (j->>'left_hour')::int = 5 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL public mesh_admit ' || j::text || '; '; end if;
  if app.mesh_topic_ok('mesh', 'broadcast', true) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL mo not admitted; '; end if;
  j := public.mesh_gate_info();
  if (j->>'admitted')::boolean and (j->>'w')::bigint = cw and j->>'expires_at' is not null then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL gate_info mo ' || j::text || '; '; end if;

  -- 8. per-user suspension by moderators
  begin perform public.mod_mesh_suspend(mo, 10, 'self'); fail := fail + 1; out := out || 'FAIL self-suspend; '; exception when insufficient_privilege then pass := pass + 1; end;
  begin perform public.mod_mesh_suspend(a1, 10081, 'too long'); fail := fail + 1; out := out || 'FAIL reviewer > 7 d; '; exception when invalid_parameter_value then pass := pass + 1; end;
  begin perform public.mod_mesh_suspend(a1, 60, ''); fail := fail + 1; out := out || 'FAIL empty reason; '; exception when invalid_parameter_value then pass := pass + 1; end;
  j := public.mod_mesh_suspend(a1, 60, 'flooding the mesh');
  if (j->>'ok')::boolean then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL suspend; '; end if;
  reset role;
  select count(*) into n from app.mesh_admissions where user_id = a1;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL admission kept after suspend; '; end if;
  update app.mesh_admissions set expires_at = now() + interval '1 hour' where user_id = a1; -- even a stray admission row:
  insert into app.mesh_admissions (user_id, code_hash, pub_hash, via, expires_at) values (a1, app.mesh_hash('code', code), app.mesh_hash('key', pub), 'pow', now() + interval '1 hour') on conflict (user_id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not app.mesh_topic_ok('mesh', 'broadcast', false) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL suspended still allowed; '; end if;
  begin perform public.mod_mesh_suspend(a2, 10, 'x'); fail := fail + 1; out := out || 'FAIL non-mod suspend; '; exception when insufficient_privilege then pass := pass + 1; end;
  j := public.mesh_gate_info();
  if j->>'suspended_until' is not null and not (j->>'admitted')::boolean then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL gate_info suspended; '; end if;
  reset role;
  j := app.mesh_admit_at(code, pub, w, 16, 6, vfull, now());
  if j->>'error' = 'suspended' then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL suspended admit ' || j::text || '; '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ld, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.mod_mesh_suspend(a2, 43200, 'lead 30 days'); if (j->>'ok')::boolean then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL lead 30 d; '; end if;
  begin perform public.mod_mesh_suspend(a2, 43201, 'x'); fail := fail + 1; out := out || 'FAIL lead > 30 d; '; exception when invalid_parameter_value then pass := pass + 1; end;
  j := public.mod_mesh_lift(a1); reset role;
  select count(*) into n from app.mesh_suspensions where user_id = a1;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL lift; '; end if;

  -- 9. attestation hook (service role only) -> admitted + lighter PoW for later re-admissions
  set local role service_role;
  j := public.mesh_admit_service(a1, code, 'play-integrity-test', 7);
  reset role;
  if (j->>'ok')::boolean then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL service admit ' || j::text || '; '; end if;
  select count(*) into n from app.mesh_admissions where user_id = a1 and via = 'service' and att and expires_at > now();
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL service admission row; '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if app.mesh_topic_ok('mesh', 'broadcast', false) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL attested not admitted; '; end if;
  j := public.mesh_gate_info(); reset role;
  if (j->'pow'->>'b')::int = 12 and (j->'pow'->>'k')::int = 2 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL attested pow in info ' || j::text || '; '; end if;
  j := app.mesh_admit_at(code, pub, w, 12, 2, vatt, at0 + interval '1 minute');
  if (j->>'ok')::boolean and (j->>'att')::boolean then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL attested light pow ' || j::text || '; '; end if;
  set local role service_role;
  j := public.mesh_suspend_service(a1, 5, 'service lever'); reset role;
  if (j->>'ok')::boolean and not exists (select 1 from app.mesh_admissions where user_id = a1) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL service suspend; '; end if;
  j := public.mesh_admit_service(a1, code, 'x', 7);
  if j->>'error' = 'suspended' then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL service admit while suspended; '; end if;

  -- 10. kill lever: gate disabled -> nobody admitted
  perform set_config('request.jwt.claims', json_build_object('sub', mo, 'role', 'authenticated')::text, true);
  update app.mesh_gate_config set enabled = false where id;
  set local role authenticated;
  if not app.mesh_topic_ok('mesh', 'broadcast', false) then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL disabled gate allowed; '; end if;
  reset role;
  update app.mesh_gate_config set enabled = true where id;

  -- 11. purge + grants + cron
  update app.mesh_admissions set expires_at = now() - interval '2 hours' where user_id = mo;
  insert into app.mesh_admit_log (user_id, at, ok, why) values (mo, now() - interval '8 days', false, 'old');
  n := app.purge_mesh_gate();
  if not exists (select 1 from app.mesh_admissions where user_id = mo) and not exists (select 1 from app.mesh_admit_log where user_id = mo and why = 'old') then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL purge; '; end if;
  if exists (select 1 from cron.job where jobname = 'cybermates-purge-mesh-gate') then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL cron; '; end if;
  if not has_function_privilege('authenticated', 'app.mesh_admit_at(text,text,bigint,integer,integer,bigint[],timestamptz)', 'execute')
     and not has_function_privilege('authenticated', 'app.purge_mesh_gate()', 'execute')
     and not has_function_privilege('anon', 'public.mesh_gate_info()', 'execute')
     and not has_function_privilege('authenticated', 'public.mesh_suspend_service(uuid,integer,text)', 'execute')
     and has_function_privilege('authenticated', 'app.mesh_topic_ok(text,text,boolean)', 'execute')
     and not has_table_privilege('authenticated', 'app.mesh_admissions', 'select') then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL grants; '; end if;
  -- existing presence/conv policies untouched
  select count(*) into n from pg_policies where schemaname = 'realtime' and policyname in ('realtime_band_read', 'realtime_band_write', 'realtime_mesh_read', 'realtime_mesh_write');
  if n = 4 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL policy set (' || n || '); '; end if;

  raise exception 'V46RESULT pass=% fail=% %', pass, fail, out;
end $t$;
