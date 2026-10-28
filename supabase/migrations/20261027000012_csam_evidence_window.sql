-- v45 follow-up: the reporter's phone may hold a child-safety evidence bundle while it waits for an account, a network or the
-- team evidence key (src/evidence.js keeps it up to 30 days in the encrypted vault). 72 hours after the report was too short
-- for that, so evidence for a report may now be uploaded for 30 days after it was filed. Nothing else changes.
create or replace function app.evidence_begin(p_report uuid, p_env jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare r record; h uuid; hk record; k text; nparts int;
begin
  select * into r from public.reports where id = p_report and reporter_id = (select auth.uid());
  if not found then raise exception 'report not found' using errcode = '42501'; end if;
  if not app.is_csam_reason(r.reason) then raise exception 'evidence upload is only for child-safety reports' using errcode = '42501'; end if;
  if r.created_at < now() - interval '30 days' then raise exception 'report too old for evidence upload' using errcode = '42501'; end if;
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
