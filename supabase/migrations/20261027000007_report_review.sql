-- v39: team review bucket for reports (moderation). Reports already land in public.reports (reporter-only RLS, auto-priority,
-- auto-escalation). This adds the TEAM side, enforced by the database:
--   * public.moderators: staff allow-list. Rows are written ONLY by the service role / dashboard (no client grants).
--     A moderator must be an ADULT account (trigger) - minors can never see the queue.
--   * public.report_actions: append-only audit trail of every moderator action (no client insert/update/delete).
--   * public.mod_queue(bucket, limit): the review buckets. 'serious' = unresolved AND (priority <= 2 OR escalated), i.e. child
--     safety, threats, underage, sexual content, anything involving a minor, repeat targets and reporter escalations.
--     Returns evidence + moderator_note, which stay hidden from ordinary clients (column grants unchanged).
--   * public.mod_claim / public.mod_resolve: status changes, logged. A priority-1 report can only be dismissed by a 'lead'.
-- Non-moderators get errcode 42501 from every RPC and see zero rows in moderators/report_actions.
-- Nothing is dropped or rewritten; existing reports rows/policies are untouched.

create table if not exists public.moderators (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'reviewer' check (role in ('reviewer','lead')),
  active boolean not null default true,
  added_at timestamptz not null default now());
alter table public.moderators enable row level security;
revoke all on public.moderators from anon, authenticated;
grant select on public.moderators to authenticated;
create policy moderators_select_own on public.moderators for select to authenticated using (user_id = (select auth.uid()));

create or replace function app.moderator_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(app.band_of(new.user_id), '') <> 'adult' then
    raise exception 'moderators must be adult accounts' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists moderator_guard on public.moderators;
create trigger moderator_guard before insert or update on public.moderators for each row execute function app.moderator_guard();

create or replace function app.mod_role() returns text language sql stable security definer set search_path = '' as
$$ select m.role from public.moderators m where m.user_id = (select auth.uid()) and m.active
     and (select p.age_band from public.profiles p where p.id = m.user_id) = 'adult' $$;
create or replace function app.is_moderator() returns boolean language sql stable security definer set search_path = '' as
$$ select app.mod_role() is not null $$;

create table if not exists public.report_actions (
  id bigint generated always as identity primary key,
  report_id uuid references public.reports(id) on delete set null,
  moderator_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('claim','in_review','escalated','actioned','dismissed','note')),
  from_status text,
  to_status text,
  note text check (char_length(note) <= 1000),
  at timestamptz not null default now());
create index if not exists report_actions_report_idx on public.report_actions (report_id, at);
alter table public.report_actions enable row level security;
revoke all on public.report_actions from anon, authenticated;
grant select on public.report_actions to authenticated;
create policy report_actions_mod_select on public.report_actions for select to authenticated using (app.is_moderator());

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
     order by r.priority, r.escalation_level desc, r.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

create or replace function app.mod_resolve(p_report uuid, p_status text, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r record; role text := app.mod_role();
begin
  if role is null then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_status not in ('in_review','escalated','actioned','dismissed') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.reporter_id = (select auth.uid()) or r.reported_id = (select auth.uid()) then
    raise exception 'conflict of interest: you are part of this report' using errcode = '42501'; end if;
  if p_status = 'dismissed' and r.priority = 1 and role <> 'lead' then
    raise exception 'priority-1 reports can only be dismissed by a lead' using errcode = '42501'; end if;
  update public.reports set status = p_status,
         escalation_level = case when p_status = 'escalated' then least(r.escalation_level + 1, 3) else r.escalation_level end,
         escalated_at = case when p_status = 'escalated' then now() else r.escalated_at end,
         resolved_at = case when p_status in ('actioned','dismissed') then now() else null end,
         moderator_note = case when p_note is null then r.moderator_note
                               else left(coalesce(r.moderator_note || E'\n', '') || left(p_note, 1000), 4000) end
   where id = p_report;
  insert into public.report_actions (report_id, moderator_id, action, from_status, to_status, note)
       values (p_report, (select auth.uid()), p_status, r.status, p_status, left(p_note, 1000));
  return p_status;
end $$;
create or replace function app.mod_claim(p_report uuid) returns text language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_moderator() then raise exception 'moderators only' using errcode = '42501'; end if;
  return app.mod_resolve(p_report, 'in_review', null);
end $$;

-- public wrappers (security invoker -> app.* does the checks), same pattern as escalate_report
create or replace function public.am_moderator() returns text language sql stable security invoker set search_path = '' as $$ select app.mod_role() $$;
create or replace function public.mod_queue(p_bucket text default 'serious', p_limit int default 50)
returns table (id uuid, reporter_id uuid, reported_id uuid, message_id uuid, conversation_id uuid, reason text, details text,
               evidence jsonb, status text, priority smallint, escalation_level smallint, escalated_at timestamptz,
               created_at timestamptz, resolved_at timestamptz, moderator_note text, reporter_band text, reported_band text,
               reports_on_target int)
language sql stable security invoker set search_path = '' as $$ select * from app.mod_queue(p_bucket, p_limit) $$;
create or replace function public.mod_claim(p_report uuid) returns text language sql security invoker set search_path = '' as $$ select app.mod_claim(p_report) $$;
create or replace function public.mod_resolve(p_report uuid, p_status text, p_note text default null) returns text
  language sql security invoker set search_path = '' as $$ select app.mod_resolve(p_report, p_status, p_note) $$;

-- lockdown (same as earlier migrations): never anon/public; authenticated only, checks live inside app.*
revoke execute on function app.moderator_guard(), app.mod_role(), app.is_moderator(), app.mod_queue(text, int),
  app.mod_resolve(uuid, text, text), app.mod_claim(uuid) from public, anon;
grant execute on function app.mod_role(), app.is_moderator(), app.mod_queue(text, int), app.mod_resolve(uuid, text, text),
  app.mod_claim(uuid) to authenticated;
revoke execute on function app.moderator_guard() from authenticated;
revoke execute on function public.am_moderator(), public.mod_queue(text, int), public.mod_claim(uuid), public.mod_resolve(uuid, text, text) from public, anon;
grant execute on function public.am_moderator(), public.mod_queue(text, int), public.mod_claim(uuid), public.mod_resolve(uuid, text, text) to authenticated;
