-- v43 live test for the ID <-> key binding registry (migration 20261027000010). Run as the project owner (SQL editor / MCP
-- execute_sql). ONE transaction ending with RAISE EXCEPTION 'V43RESULT pass=N fail=M ...', so everything rolls back.
do $t$
declare
  u text := replace(gen_random_uuid()::text, '-', ''); cA text := 'b1codeA' || u; cB text := 'b1codeB' || u; cC text := 'b1codeC' || u;
  k1 text := 'b1key1' || u; k2 text := 'b1key2' || u; k3 text := 'b1key3' || u; k4 text := 'b1key4' || u; k5 text := 'b1key5' || u;
  t0 timestamptz := '2026-10-27 12:00:00+00'; r jsonb; n int; out text := ''; pass int := 0; fail int := 0; ok boolean;
begin
  r := app.id_bind_at(cA, k1, 'claim', null, 1209600, false, t0); ok := r->>'status' = 'new'; out := out || case when ok then 'PASS' else 'FAIL' end || ' first claim new; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cA, k1, 'claim', null, 1209600, false, t0 + interval '1 minute'); ok := r->>'status' = 'same'; out := out || case when ok then 'PASS' else 'FAIL' end || ' same key same; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from app.id_bindings where code_hash = cA and last_seen = t0 + interval '1 minute'; ok := n = 1; out := out || case when ok then 'PASS' else 'FAIL' end || ' same touches last_seen; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cA, k2, 'claim', null, 1209600, false, t0 + interval '2 minutes'); ok := r->>'status' = 'id-bound'; out := out || case when ok then 'PASS' else 'FAIL' end || ' other key for bound ID refused; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cB, k1, 'claim', null, 1209600, false, t0); ok := r->>'status' = 'key-bound'; out := out || case when ok then 'PASS' else 'FAIL' end || ' key bound to another ID refused; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from app.id_bindings where code_hash = cB; ok := n = 0; out := out || case when ok then 'PASS' else 'FAIL' end || ' refused claim wrote nothing; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- rotation: only with the CURRENT key as p_old
  r := app.id_bind_at(cA, k2, 'rotate', k3, 1209600, false, t0 + interval '3 minutes'); ok := r->>'status' = 'id-bound'; out := out || case when ok then 'PASS' else 'FAIL' end || ' rotate with wrong old key refused; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cA, k2, 'rotate', k1, 1209600, false, t0 + interval '4 minutes'); ok := r->>'status' = 'rebound' and r->>'why' = 'rotate'; out := out || case when ok then 'PASS' else 'FAIL' end || ' rotate by current key rebinds; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cB, k1, 'claim', null, 1209600, false, t0 + interval '5 minutes'); ok := r->>'status' = 'new'; out := out || case when ok then 'PASS' else 'FAIL' end || ' old key freed after rotation; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- idle rebind: refused while recent, allowed after p_idle_secs of silence
  r := app.id_bind_at(cA, k3, 'idle', null, 1209600, false, t0 + interval '1 day'); ok := r->>'status' = 'id-bound' and (r->>'idle_ms')::bigint > 0; out := out || case when ok then 'PASS' else 'FAIL' end || ' idle rebind refused before 14 days; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cA, k3, 'idle', null, 1209600, false, t0 + interval '15 days'); ok := r->>'status' = 'rebound' and r->>'why' = 'idle'; out := out || case when ok then 'PASS' else 'FAIL' end || ' idle rebind after 15 days; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- attested rebind (hook): p_att must be true
  r := app.id_bind_at(cA, k4, 'attested', null, 1209600, false, t0 + interval '15 days 1 minute'); ok := r->>'status' = 'id-bound'; out := out || case when ok then 'PASS' else 'FAIL' end || ' attested op without att refused; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cA, k4, 'attested', null, 1209600, true, t0 + interval '15 days 2 minutes'); ok := r->>'status' = 'rebound' and r->>'why' = 'attested'; out := out || case when ok then 'PASS' else 'FAIL' end || ' attested rebind; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select rebinds into n from app.id_bindings where code_hash = cA; ok := n = 3; out := out || case when ok then 'PASS' else 'FAIL' end || ' rebinds counted (3); '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from app.id_bind_log where code_hash = cA; ok := n = 3; out := out || case when ok then 'PASS' else 'FAIL' end || ' 3 audit rows; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  begin update app.id_bind_log set why = 'idle' where code_hash = cA; out := out || 'FAIL audit update allowed; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS audit append-only (update); '; pass := pass + 1; end;
  begin delete from app.id_bind_log where code_hash = cA; out := out || 'FAIL audit delete allowed; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS audit append-only (delete); '; pass := pass + 1; end;
  -- check / touch (logoff / delete gate)
  r := app.id_bind_at(cA, k4, 'check', null, 0, false, t0); ok := r->>'status' = 'same'; out := out || case when ok then 'PASS' else 'FAIL' end || ' check same; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cA, k1, 'check', null, 0, false, t0); ok := r->>'status' = 'other'; out := out || case when ok then 'PASS' else 'FAIL' end || ' check other; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.id_bind_at(cC, k5, 'check', null, 0, false, t0); ok := r->>'status' = 'unbound'; out := out || case when ok then 'PASS' else 'FAIL' end || ' check unbound; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from app.id_bindings where code_hash = cC; ok := n = 0; out := out || case when ok then 'PASS' else 'FAIL' end || ' check writes nothing; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := public.id_bind(cC, k5); ok := r->>'status' = 'new'; out := out || case when ok then 'PASS' else 'FAIL' end || ' public wrapper defaults (claim); '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- validation
  begin perform app.id_bind_at('short', k5, 'claim', null, 0, false, t0); out := out || 'FAIL short code accepted; '; fail := fail + 1; exception when invalid_parameter_value then out := out || 'PASS short code rejected; '; pass := pass + 1; end;
  begin perform app.id_bind_at(cC, k5, 'steal', null, 0, false, t0); out := out || 'FAIL bad op accepted; '; fail := fail + 1; exception when invalid_parameter_value then out := out || 'PASS bad op rejected; '; pass := pass + 1; end;
  begin perform app.id_bind_at(cC, repeat('k', 81), 'claim', null, 0, false, t0); out := out || 'FAIL long key accepted; '; fail := fail + 1; exception when invalid_parameter_value then out := out || 'PASS long key rejected; '; pass := pass + 1; end;
  -- privileges: service role only
  ok := not has_function_privilege('anon', 'public.id_bind(text, text, text, text, integer, boolean)', 'execute') and not has_function_privilege('authenticated', 'public.id_bind(text, text, text, text, integer, boolean)', 'execute') and has_function_privilege('service_role', 'public.id_bind(text, text, text, text, integer, boolean)', 'execute');
  out := out || case when ok then 'PASS' else 'FAIL' end || ' EXECUTE service_role only; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  ok := not has_function_privilege('anon', 'app.id_bind_at(text, text, text, text, integer, boolean, timestamptz)', 'execute') and not has_function_privilege('authenticated', 'app.id_bind_at(text, text, text, text, integer, boolean, timestamptz)', 'execute');
  out := out || case when ok then 'PASS' else 'FAIL' end || ' core fn not client-callable; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  ok := not has_table_privilege('anon', 'app.id_bindings', 'select') and not has_table_privilege('authenticated', 'app.id_bindings', 'select') and not has_table_privilege('anon', 'app.id_bind_log', 'select');
  out := out || case when ok then 'PASS' else 'FAIL' end || ' tables not client-readable; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'app' and c.relname in ('id_bindings', 'id_bind_log') and c.relrowsecurity; ok := n = 2;
  out := out || case when ok then 'PASS' else 'FAIL' end || ' RLS on both tables; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  raise exception 'V43RESULT pass=% fail=% :: %', pass, fail, out;
end $t$;
