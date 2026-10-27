-- v39 live RLS test for the team review bucket (migration 20261027000007). Run as the project owner (SQL editor / MCP execute_sql).
-- Creates 5 throwaway users inside ONE transaction and ends with RAISE EXCEPTION 'V39RESULT pass=N fail=M ...', so everything rolls back.
do $t$
declare
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); mo uuid := gen_random_uuid(); ld uuid := gen_random_uuid();
  r3 uuid; r1 uuid; r2 uuid; r4 uuid; n int; s text; out text := ''; pass int := 0; fail int := 0; ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v39-' || u || '@test.invalid', now(), now()
      from unnest(array[a1, a2, m1, mo, ld]) u;
  insert into public.profiles (id, handle, age_band) values (a1, 'v39a1_' || substr(md5(a1::text),1,6), 'adult'), (a2, 'v39a2_' || substr(md5(a2::text),1,6), 'adult'),
    (m1, 'v39m1_' || substr(md5(m1::text),1,6), 'minor'), (mo, 'v39mo_' || substr(md5(mo::text),1,6), 'adult'), (ld, 'v39ld_' || substr(md5(ld::text),1,6), 'adult')
    on conflict (id) do update set age_band = excluded.age_band;
  -- moderator rows via the privileged role (service role / dashboard path)
  begin insert into public.moderators (user_id) values (m1); out := out || 'FAIL minor-moderator-allowed; '; fail := fail + 1;
  exception when others then out := out || 'PASS minor cannot be moderator; '; pass := pass + 1; end;
  insert into public.moderators (user_id, role) values (mo, 'reviewer'), (ld, 'lead');

  -- reporters (authenticated)
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.reports (reporter_id, reported_id, reason, details, evidence) values (a1, a2, 'harassment', 'v39 p3', '{"k":"ev3"}') returning id into r3;
  insert into public.reports (reporter_id, reported_id, reason, details) values (a1, ld, 'sexual content', 'v39 p2') returning id into r2;
  begin perform * from public.mod_queue('serious', 10); out := out || 'FAIL non-mod read queue; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS non-moderator queue denied; '; pass := pass + 1; end;
  begin perform public.mod_resolve(r3, 'dismissed', 'x'); out := out || 'FAIL non-mod resolve; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS non-moderator resolve denied; '; pass := pass + 1; end;
  select count(*) into n from public.moderators; if n = 0 then pass := pass + 1; out := out || 'PASS non-mod sees 0 moderators; '; else fail := fail + 1; out := out || 'FAIL non-mod sees moderators; '; end if;
  begin insert into public.moderators (user_id, role) values (a1, 'lead'); out := out || 'FAIL self-promote; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS client cannot self-promote; '; pass := pass + 1; end;
  begin insert into public.report_actions (report_id, action) values (r3, 'note'); out := out || 'FAIL client wrote audit; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS client cannot write audit; '; pass := pass + 1; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.reports (reporter_id, reported_id, reason) values (m1, a1, 'threats/violence') returning id into r1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', mo, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.reports (reporter_id, reported_id, reason) values (mo, a2, 'spam/scam') returning id into r4;
  -- reviewer
  select public.am_moderator() into s; if s = 'reviewer' then pass := pass + 1; out := out || 'PASS am_moderator=reviewer; '; else fail := fail + 1; out := out || 'FAIL am_moderator ' || coalesce(s,'null') || '; '; end if;
  select count(*) into n from public.mod_queue('serious', 50) q where q.id in (r1, r2, r3, r4);
  if n = 2 then pass := pass + 1; out := out || 'PASS serious bucket has p1+p2 only; '; else fail := fail + 1; out := out || 'FAIL serious n=' || n || '; '; end if;
  select q.id into r1 from public.mod_queue('serious', 50) q where q.id in (r1, r2) order by q.priority limit 1;
  select count(*) into n from public.mod_queue('serious', 50) q where q.id = r1 and q.priority = 1 and q.reporter_band = 'minor' and q.status = 'escalated';
  if n = 1 then pass := pass + 1; out := out || 'PASS p1 first, minor reporter band shown; '; else fail := fail + 1; out := out || 'FAIL p1 order; '; end if;
  select count(*) into n from public.mod_queue('open', 50) q where q.id in (r1, r2, r3, r4); if n = 4 then pass := pass + 1; out := out || 'PASS open bucket 4; '; else fail := fail + 1; out := out || 'FAIL open n=' || n || '; '; end if;
  select count(*) into n from public.mod_queue('open', 50) q where q.id = r3 and q.evidence->>'k' = 'ev3'; if n = 1 then pass := pass + 1; out := out || 'PASS moderator sees evidence; '; else fail := fail + 1; out := out || 'FAIL evidence; '; end if;
  select public.mod_claim(r3) into s; if s = 'in_review' then pass := pass + 1; out := out || 'PASS claim -> in_review; '; else fail := fail + 1; out := out || 'FAIL claim; '; end if;
  begin perform public.mod_resolve(r1, 'dismissed', 'nope'); out := out || 'FAIL reviewer dismissed p1; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS reviewer cannot dismiss p1; '; pass := pass + 1; end;
  begin perform public.mod_resolve(r4, 'dismissed', 'mine'); out := out || 'FAIL conflict of interest allowed; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS own report conflict blocked; '; pass := pass + 1; end;
  select public.mod_resolve(r2, 'actioned', 'warned user') into s;
  select count(*) into n from public.mod_queue('resolved', 50) q where q.id = r2 and q.resolved_at is not null and q.moderator_note like '%warned user%';
  if n = 1 then pass := pass + 1; out := out || 'PASS actioned -> resolved bucket + note; '; else fail := fail + 1; out := out || 'FAIL actioned; '; end if;
  select count(*) into n from public.report_actions where report_id in (r2, r3); if n = 2 then pass := pass + 1; out := out || 'PASS audit rows visible to moderator; '; else fail := fail + 1; out := out || 'FAIL audit n=' || n || '; '; end if;
  begin update public.report_actions set note = 'tamper' where report_id = r2; out := out || 'FAIL audit tamper; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS audit append-only; '; pass := pass + 1; end;
  reset role;
  -- lead (also the reported user of r2: conflict check)
  perform set_config('request.jwt.claims', json_build_object('sub', ld, 'role', 'authenticated')::text, true); set local role authenticated;
  select public.mod_resolve(r1, 'dismissed', 'lead review') into s; if s = 'dismissed' then pass := pass + 1; out := out || 'PASS lead can dismiss p1; '; else fail := fail + 1; out := out || 'FAIL lead dismiss; '; end if;
  begin perform public.mod_resolve(r2, 'in_review', 'reopen own'); out := out || 'FAIL reported-mod resolve; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS reported moderator conflict blocked; '; pass := pass + 1; end;
  reset role;
  -- reporter view: status visible, moderator_note not
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true); set local role authenticated;
  select status into s from public.reports where id = r3; if s = 'in_review' then pass := pass + 1; out := out || 'PASS reporter sees in_review; '; else fail := fail + 1; out := out || 'FAIL reporter status ' || coalesce(s,'null') || '; '; end if;
  begin perform moderator_note from public.reports where id = r3; out := out || 'FAIL note readable; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS moderator_note hidden from reporter; '; pass := pass + 1; end;
  select count(*) into n from public.report_actions; if n = 0 then pass := pass + 1; out := out || 'PASS reporter sees 0 audit rows; '; else fail := fail + 1; out := out || 'FAIL reporter audit; '; end if;
  reset role;
  -- deactivated moderator
  update public.moderators set active = false where user_id = mo;
  perform set_config('request.jwt.claims', json_build_object('sub', mo, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform * from public.mod_queue('open', 5); out := out || 'FAIL inactive mod read; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS inactive moderator denied; '; pass := pass + 1; end;
  reset role;
  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  begin perform * from public.mod_queue('open', 5); out := out || 'FAIL anon read; '; fail := fail + 1;
  exception when insufficient_privilege then out := out || 'PASS anon denied; '; pass := pass + 1; end;
  reset role;
  raise exception 'V39RESULT pass=% fail=% :: %', pass, fail, out;
end $t$;
