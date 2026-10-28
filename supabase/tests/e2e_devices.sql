-- v48 live test for the per-device E2E key bundles (migration 20261028000015_e2e_devices.sql). Run as the project owner
-- (SQL editor / MCP execute_sql). ONE transaction ending with RAISE EXCEPTION 'V48RESULT pass=N fail=M ...', so everything
-- rolls back (no users, profiles, devices or blocks are left).
do $t$
declare
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid(); m1 uuid := gen_random_uuid();
  k text := 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; k2 text := 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
  sg text := repeat('S', 86) || '=='; n int; ok boolean; t0 timestamptz; t1 timestamptz; e text;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v48-' || u || '@test.invalid', now(), now()
      from unnest(array[a1, a2, a3, m1]) u;
  insert into public.profiles (id, handle, age_band) values (a1, 'v48a1_' || substr(md5(a1::text),1,6), 'adult'), (a2, 'v48a2_' || substr(md5(a2::text),1,6), 'adult'),
    (a3, 'v48a3_' || substr(md5(a3::text),1,6), 'adult'), (m1, 'v48m1_' || substr(md5(m1::text),1,6), 'minor');

  -- 1. anon has no access at all
  perform set_config('request.jwt.claims', '', true); set local role anon;
  begin perform 1 from public.e2e_devices limit 1; ok := false; exception when insufficient_privilege then ok := true; end;
  reset role; if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL anon select; '; end if;

  -- 2. a1 registers own device; cannot register for someone else
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a1, 'devA1-one', k, k, 'pk000001', k, sg);
  select count(*) into n from public.e2e_devices where user_id = a1; reset role;
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL own insert (' || n || '); '; end if;
  set local role authenticated;
  begin insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a2, 'forged-dev', k, k, 'pk000001', k, sg); ok := false;
  exception when insufficient_privilege then ok := true; end; reset role;
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL insert for other user; '; end if;

  -- 3. format checks
  set local role authenticated;
  begin insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a1, 'bad dev!', k, k, 'pk000001', k, sg); ok := false; exception when check_violation then ok := true; end;
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL bad device id; '; end if;
  begin insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a1, 'devA1-bad', 'short', k, 'pk000001', k, sg); ok := false; exception when check_violation then ok := true; end;
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL bad ik; '; end if;
  begin insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a1, 'devA1-bad', k, k, 'pk000001', k, 'nope'); ok := false; exception when check_violation then ok := true; end;
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL bad sig; '; end if;

  -- 4. at most 5 devices
  insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig)
    select a1, 'devA1-n' || i, k, k, 'pk000001', k, sg from generate_series(2, 5) i;
  begin insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a1, 'devA1-six', k, k, 'pk000001', k, sg); ok := false; exception when check_violation then ok := true; end;
  select count(*) into n from public.e2e_devices where user_id = a1; reset role;
  if ok and n = 5 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL device cap (' || n || '); '; end if;

  -- 5. identity keys immutable; prekey rotation allowed and updated_at = server clock
  set local role authenticated;
  begin update public.e2e_devices set ik = k2 where user_id = a1 and device_id = 'devA1-one'; ok := false; exception when insufficient_privilege then ok := true; end;
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL ik update allowed; '; end if;
  begin update public.e2e_devices set updated_at = now() + interval '1 year' where user_id = a1; ok := false; exception when insufficient_privilege then ok := true; end;
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL updated_at client-writable; '; end if;
  update public.e2e_devices set spk_id = 'pk000002', spk = k2 where user_id = a1 and device_id = 'devA1-one';
  select count(*) into n from public.e2e_devices where user_id = a1 and device_id = 'devA1-one' and spk = k2 and spk_id = 'pk000002'; reset role;
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL spk rotation; '; end if;
  begin update public.e2e_devices set sk_pub = k2 where user_id = a1 and device_id = 'devA1-one'; ok := false; exception when insufficient_privilege then ok := true; end; -- even the owner role: trigger
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL sk_pub change (owner) not refused; '; end if;

  -- 6. visibility: same-band adult sees a1's devices; minor sees none; a2 cannot change/delete them
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.e2e_devices where user_id = a1;
  if n = 5 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL same-band visibility (' || n || '); '; end if;
  update public.e2e_devices set spk = k where user_id = a1; get diagnostics n = row_count;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL other user updated rows; '; end if;
  delete from public.e2e_devices where user_id = a1; get diagnostics n = row_count;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL other user deleted rows; '; end if;
  insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a2, 'devA2-one', k2, k2, 'pk000001', k2, sg); reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.e2e_devices; 
  insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (m1, 'devM1-one', k, k, 'pk000001', k, sg); reset role;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL minor sees adult devices (' || n || '); '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.e2e_devices where user_id = m1; reset role;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL adult sees minor devices; '; end if;

  -- 7. blocks hide devices both ways
  insert into public.blocks (blocker_id, blocked_id) values (a1, a3);
  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.e2e_devices where user_id = a1;
  insert into public.e2e_devices (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) values (a3, 'devA3-one', k, k, 'pk000001', k, sg); reset role;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL blocked user sees devices; '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.e2e_devices where user_id = a3; reset role;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL blocker sees blocked devices; '; end if;

  -- 8. stale devices (> 30 days) are not served to others, still visible to the owner; purge after 45 days
  alter table public.e2e_devices disable trigger e2e_devices_guard;
  update public.e2e_devices set updated_at = now() - interval '31 days' where user_id = a1 and device_id = 'devA1-n2';
  update public.e2e_devices set updated_at = now() - interval '46 days' where user_id = a1 and device_id = 'devA1-n3';
  alter table public.e2e_devices enable trigger e2e_devices_guard;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.e2e_devices where user_id = a1; reset role;
  if n = 3 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL stale filter (' || n || '); '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.e2e_devices where user_id = a1; reset role;
  if n = 5 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL owner sees own stale (' || n || '); '; end if;
  n := app.purge_e2e_devices();
  select count(*) into n from public.e2e_devices where user_id = a1;
  if n = 4 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL purge (' || n || ' left); '; end if;

  -- 9. client cannot call the purge / guard; owner deletes own device
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform app.purge_e2e_devices(); ok := false; exception when insufficient_privilege then ok := true; end;
  if ok then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL client may purge; '; end if;
  delete from public.e2e_devices where user_id = a1 and device_id = 'devA1-n4'; get diagnostics n = row_count; reset role;
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL own delete; '; end if;

  -- 10. account deletion cascades; cron + policies present
  delete from public.profiles where id = a2;
  select count(*) into n from public.e2e_devices where user_id = a2;
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL cascade; '; end if;
  select count(*) into n from cron.job where jobname = 'cybermates-purge-e2e-devices';
  if n = 1 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL cron; '; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'e2e_devices';
  if n = 4 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL policy count (' || n || '); '; end if;
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'e2e_devices' and grantee = 'anon';
  if n = 0 then pass := pass + 1; else fail := fail + 1; out := out || 'FAIL anon grants; '; end if;

  raise exception 'V48RESULT pass=% fail=% %', pass, fail, out;
end $t$;
