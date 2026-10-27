-- v40 live test for global rate limits (migration 20261027000008). Run as the project owner (SQL editor / MCP execute_sql).
-- Everything happens inside ONE transaction that ends with RAISE EXCEPTION 'V40RESULT pass=N fail=M ...', so it all rolls back.
-- Real cross-session concurrency is checked separately (parallel execute_sql sessions on one throwaway key, then deleted).
do $t$
declare
  k text := 'v40test|' || gen_random_uuid(); k2 text := k || '|other'; t0 timestamptz := '2026-10-27 12:00:10+00';
  r jsonb; n int; out text := ''; pass int := 0; fail int := 0; ok boolean; i int; allowed text := '';
begin
  -- fixed window: limit 3 -> hits 1..3 allowed, 4..5 refused, count keeps rising
  for i in 1..5 loop r := app.rl_hit_at(k, 3, 60, t0 + make_interval(secs => i)); allowed := allowed || case when (r->>'allowed')::boolean then 'T' else 'F' end || (r->>'count'); end loop;
  ok := allowed = 'T1T2T3F4F5'; out := out || case when ok then 'PASS' else 'FAIL' end || ' fixed window limit 3 (' || allowed || '); '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from app.rate_limit_buckets where key = k; ok := n = 1; out := out || case when ok then 'PASS' else 'FAIL' end || ' one row per key+window (upsert); '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  ok := (r->>'reset_ms')::bigint = 45000; out := out || case when ok then 'PASS' else 'FAIL' end || ' reset_ms=' || (r->>'reset_ms') || '; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  r := app.rl_hit_at(k2, 3, 60, t0); ok := (r->>'count')::int = 1 and (r->>'allowed')::boolean; out := out || case when ok then 'PASS' else 'FAIL' end || ' other key independent; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- rollover: next minute starts a fresh window
  r := app.rl_hit_at(k, 3, 60, t0 + interval '50 seconds'); ok := (r->>'count')::int = 1 and (r->>'allowed')::boolean; out := out || case when ok then 'PASS' else 'FAIL' end || ' window rollover resets; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- day window (help: 60/day) spans the minute rollover
  r := app.rl_hit_at(k || '|d', 2, 86400, t0); r := app.rl_hit_at(k || '|d', 2, 86400, t0 + interval '2 hours'); r := app.rl_hit_at(k || '|d', 2, 86400, t0 + interval '5 hours');
  ok := (r->>'count')::int = 3 and not (r->>'allowed')::boolean; out := out || case when ok then 'PASS' else 'FAIL' end || ' 86400 s window; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- many sequential hits in one session: no lost increments
  for i in 1..200 loop r := app.rl_hit_at(k || '|seq', 1000, 60, t0); end loop; ok := (r->>'count')::int = 200; out := out || case when ok then 'PASS' else 'FAIL' end || ' 200 hits -> count 200; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- argument validation
  begin perform app.rl_hit_at('', 3, 60, t0); out := out || 'FAIL empty key accepted; '; fail := fail + 1; exception when invalid_parameter_value then out := out || 'PASS empty key rejected; '; pass := pass + 1; end;
  begin perform app.rl_hit_at(repeat('x', 201), 3, 60, t0); out := out || 'FAIL long key accepted; '; fail := fail + 1; exception when invalid_parameter_value then out := out || 'PASS long key rejected; '; pass := pass + 1; end;
  begin perform app.rl_hit_at(k, 0, 60, t0); out := out || 'FAIL limit 0 accepted; '; fail := fail + 1; exception when invalid_parameter_value then out := out || 'PASS limit 0 rejected; '; pass := pass + 1; end;
  begin perform app.rl_hit_at(k, 3, 86401, t0); out := out || 'FAIL window > 1 day accepted; '; fail := fail + 1; exception when invalid_parameter_value then out := out || 'PASS window > 1 day rejected; '; pass := pass + 1; end;
  -- cleanup: removes windows that ended > 1 min ago, keeps current ones
  insert into app.rate_limit_buckets (key, window_start, expires_at, count) values (k || '|old', now() - interval '10 minutes', now() - interval '9 minutes', 7);
  r := public.rl_hit(k || '|live', 5, 60);
  perform app.rl_cleanup();
  select count(*) into n from app.rate_limit_buckets where key = k || '|old'; ok := n = 0; out := out || case when ok then 'PASS' else 'FAIL' end || ' cleanup removes expired; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from app.rate_limit_buckets where key = k || '|live'; ok := n = 1; out := out || case when ok then 'PASS' else 'FAIL' end || ' cleanup keeps current; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- service role may call the RPC
  set local role service_role;
  r := public.rl_hit(k || '|svc', 2, 60); r := public.rl_hit(k || '|svc', 2, 60); r := public.rl_hit(k || '|svc', 2, 60);
  ok := (r->>'count')::int = 3 and not (r->>'allowed')::boolean; out := out || case when ok then 'PASS' else 'FAIL' end || ' service_role rl_hit works + limits; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  begin perform count(*) from app.rate_limit_buckets; out := out || 'FAIL service_role reads table directly; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS service_role no direct table access; '; pass := pass + 1; end;
  reset role;
  -- anon + authenticated: denied everywhere
  set local role anon;
  begin perform public.rl_hit(k, 3, 60); out := out || 'FAIL anon rl_hit; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS anon rl_hit denied; '; pass := pass + 1; end;
  begin perform app.rl_hit_at(k, 3, 60, t0); out := out || 'FAIL anon rl_hit_at; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS anon rl_hit_at denied; '; pass := pass + 1; end;
  begin perform count(*) from app.rate_limit_buckets; out := out || 'FAIL anon reads table; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS anon table denied; '; pass := pass + 1; end;
  begin perform app.rl_cleanup(); out := out || 'FAIL anon cleanup; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS anon cleanup denied; '; pass := pass + 1; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.rl_hit(k, 3, 60); out := out || 'FAIL authenticated rl_hit; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS authenticated rl_hit denied; '; pass := pass + 1; end;
  begin perform app.rl_hit_at(k, 3, 60, t0); out := out || 'FAIL authenticated rl_hit_at; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS authenticated rl_hit_at denied; '; pass := pass + 1; end;
  begin perform count(*) from app.rate_limit_buckets; out := out || 'FAIL authenticated reads table; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS authenticated table denied; '; pass := pass + 1; end;
  begin insert into app.rate_limit_buckets (key, window_start, expires_at, count) values (k, now(), now(), 0); out := out || 'FAIL authenticated insert; '; fail := fail + 1; exception when insufficient_privilege then out := out || 'PASS authenticated insert denied; '; pass := pass + 1; end;
  reset role;
  -- catalog checks: RLS on, definer, search_path pinned, execute ACL
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'app' and c.relname = 'rate_limit_buckets' and c.relrowsecurity; ok := n = 1; out := out || case when ok then 'PASS' else 'FAIL' end || ' RLS on; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  ok := not has_function_privilege('anon', 'public.rl_hit(text,integer,integer)', 'execute') and not has_function_privilege('authenticated', 'public.rl_hit(text,integer,integer)', 'execute') and has_function_privilege('service_role', 'public.rl_hit(text,integer,integer)', 'execute');
  out := out || case when ok then 'PASS' else 'FAIL' end || ' execute ACL service_role only; '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from pg_proc p where p.oid in ('public.rl_hit(text,integer,integer)'::regprocedure, 'app.rl_hit_at(text,integer,integer,timestamptz)'::regprocedure, 'app.rl_cleanup()'::regprocedure) and p.prosecdef and p.proconfig @> array['search_path=""'];
  ok := n = 3; out := out || case when ok then 'PASS' else 'FAIL' end || ' definer + search_path pinned (' || n || '/3); '; if ok then pass := pass + 1; else fail := fail + 1; end if;
  raise exception 'V40RESULT pass=% fail=% :: %', pass, fail, out;
end $t$;
