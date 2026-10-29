-- Conversations + messages (7-day hold, delivery status, boosts w/ refunds), reports queue, LFG, events, account deletion.

-- ===== conversations (1:1; band frozen at creation and re-checked on every read) =====
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  band text not null check (band in ('minor','adult')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (user_a, user_b), check (user_a < user_b));
create index conversations_b_idx on public.conversations (user_b);
create index conversations_created_by_idx on public.conversations (created_by);
alter table public.conversations enable row level security;
create function app.conversation_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.band := app.band_of(new.created_by);
  if new.band is null or app.band_of(new.user_a) is distinct from new.band or app.band_of(new.user_b) is distinct from new.band then
    raise exception 'cross-band conversation not allowed' using errcode = '42501'; end if;
  return new;
end $$;
create trigger conversation_guard before insert on public.conversations for each row execute function app.conversation_guard();
create function app.is_member(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations x where x.id = c and (select auth.uid()) in (x.user_a, x.user_b)
                 and x.band = app.my_band() and app.band_of(x.user_a) = x.band and app.band_of(x.user_b) = x.band) $$;
create function app.peer_of(c uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select case when x.user_a = (select auth.uid()) then x.user_b else x.user_a end from public.conversations x where x.id = c $$;
revoke all on public.conversations from anon, authenticated;
grant select, insert (user_a, user_b, created_by) on public.conversations to authenticated;
create policy conversations_select on public.conversations for select to authenticated using (app.is_member(id));
create policy conversations_insert on public.conversations for insert to authenticated with check (
  created_by = (select auth.uid()) and (select auth.uid()) in (user_a, user_b)
  and app.can_interact(case when user_a = (select auth.uid()) then user_b else user_a end)
  and app.feature_ok(user_a, 'messages') and app.feature_ok(user_b, 'messages'));

-- ===== boosts ledger (balance = sum(delta)); grants come from the service role (purchases) =====
create table public.boost_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('grant','purchase','spend','refund','admin')),
  message_id uuid,
  created_at timestamptz not null default now());
create index boost_ledger_user_idx on public.boost_ledger (user_id);
create unique index boost_ledger_refund_once on public.boost_ledger (message_id) where reason = 'refund';
alter table public.boost_ledger enable row level security;
revoke all on public.boost_ledger from anon, authenticated;
grant select on public.boost_ledger to authenticated;
create policy boost_ledger_select on public.boost_ledger for select to authenticated using (user_id = (select auth.uid()));
create function public.boost_balance() returns integer language sql stable security invoker set search_path = '' as
$$ select coalesce(sum(delta), 0)::int from public.boost_ledger where user_id = (select auth.uid()) $$;

-- ===== messages (body = E2E ciphertext from the device-key vault; server never sees plaintext) =====
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 16000),
  nonce text check (char_length(nonce) <= 64),
  boosted boolean not null default false,
  status text not null default 'sent' check (status in ('sent','delivered','read')),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  check (sender_id <> recipient_id));
create index messages_conv_created_idx on public.messages (conversation_id, created_at);
create index messages_sender_idx on public.messages (sender_id);
create index messages_recipient_idx on public.messages (recipient_id);
create index messages_expires_idx on public.messages (expires_at);
alter table public.messages enable row level security;
alter table public.messages replica identity full; -- realtime UPDATE payloads (status) under RLS

create function app.message_insert_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare bal int;
begin
  new.recipient_id := app.peer_of(new.conversation_id);
  new.status := 'sent'; new.delivered_at := null; new.read_at := null;
  new.created_at := now(); new.expires_at := now() + interval '7 days';
  if new.boosted then
    perform pg_advisory_xact_lock(hashtextextended(new.sender_id::text, 0));
    select coalesce(sum(delta), 0) into bal from public.boost_ledger where user_id = new.sender_id;
    if bal < 1 then raise exception 'no boosts left' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create function app.message_after_insert() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.boosted then insert into public.boost_ledger (user_id, delta, reason, message_id) values (new.sender_id, -1, 'spend', new.id); end if;
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end $$;
-- only the recipient advances status; transitions are monotonic sent -> delivered -> read
create function app.message_update_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare rank_old int := array_position(array['sent','delivered','read'], old.status); rank_new int := array_position(array['sent','delivered','read'], new.status);
begin
  if (select auth.uid()) is distinct from old.recipient_id and (select auth.role()) <> 'service_role' then
    raise exception 'only the recipient can update delivery status' using errcode = '42501'; end if;
  if rank_new < rank_old then new.status := old.status; end if;
  if new.status in ('delivered','read') and old.delivered_at is null then new.delivered_at := now(); else new.delivered_at := old.delivered_at; end if;
  if new.status = 'read' and old.read_at is null then new.read_at := now(); else new.read_at := old.read_at; end if;
  return new;
end $$;
create trigger message_insert_guard before insert on public.messages for each row execute function app.message_insert_guard();
create trigger message_after_insert after insert on public.messages for each row execute function app.message_after_insert();
create trigger message_update_guard before update on public.messages for each row execute function app.message_update_guard();

revoke all on public.messages from anon, authenticated;
grant select, insert (conversation_id, sender_id, body, nonce, boosted), update (status) on public.messages to authenticated;
create policy messages_select on public.messages for select to authenticated using (
  expires_at > now() and (select auth.uid()) in (sender_id, recipient_id) and app.is_member(conversation_id)
  and not (recipient_id = (select auth.uid()) and app.is_blocked(sender_id, recipient_id)));
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = (select auth.uid()) and app.is_member(conversation_id)
  and app.can_interact(app.peer_of(conversation_id))
  and app.feature_ok(sender_id, 'messages') and app.feature_ok(app.peer_of(conversation_id), 'messages'));
create policy messages_update on public.messages for update to authenticated
  using (recipient_id = (select auth.uid()) and expires_at > now() and app.is_member(conversation_id))
  with check (recipient_id = (select auth.uid()));

-- Boost refunds: a boosted message that expires unread, or whose recipient blocks the sender, refunds 1 boost (once).
create function app.refund_boost(p_message uuid) returns boolean language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select id, sender_id, boosted, status into m from public.messages where id = p_message;
  if not found or not m.boosted or m.status = 'read' then return false; end if;
  insert into public.boost_ledger (user_id, delta, reason, message_id) values (m.sender_id, 1, 'refund', m.id) on conflict do nothing;
  return true;
end $$;
create function app.blocks_refund() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.refund_boost(m.id) from public.messages m
    where m.sender_id = new.blocked_id and m.recipient_id = new.blocker_id and m.boosted and m.status <> 'read';
  return null;
end $$;
create trigger blocks_refund after insert on public.blocks for each row execute function app.blocks_refund();
-- 7-day hold: purge job (pg_cron, hourly) refunds unread boosts then deletes expired rows
create function app.purge_expired() returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform app.refund_boost(m.id) from public.messages m where m.expires_at <= now() and m.boosted and m.status <> 'read';
  delete from public.messages where expires_at <= now(); get diagnostics n = row_count;
  delete from public.lfg_posts where expires_at <= now();
  return n;
end $$;

-- ===== reports (moderation queue; escalation by reporter, by volume, or for minors) =====
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid references public.profiles(id) on delete set null,
  message_id uuid,
  conversation_id uuid references public.conversations(id) on delete set null,
  reason text not null check (reason in ('harassment','spam/scam','fake profile','underage user','sexual content','threats/violence','illegal content (incl. child abuse)','other')),
  details text check (char_length(details) <= 2000),
  evidence jsonb, -- only what the reporter chooses to share (e.g. decrypted excerpt)
  status text not null default 'open' check (status in ('open','escalated','in_review','actioned','dismissed')),
  priority smallint not null default 3 check (priority between 1 and 5), -- 1 = highest
  escalation_level smallint not null default 0,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  moderator_note text);
create index reports_queue_idx on public.reports (status, priority, created_at);
create index reports_reporter_idx on public.reports (reporter_id);
create index reports_reported_idx on public.reports (reported_id);
create index reports_conversation_idx on public.reports (conversation_id);
alter table public.reports enable row level security;
create function app.report_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  new.status := 'open'; new.escalation_level := 0; new.escalated_at := null; new.resolved_at := null; new.moderator_note := null; new.created_at := now();
  new.priority := case when new.reason in ('illegal content (incl. child abuse)','threats/violence','underage user') then 1
                       when app.band_of(new.reporter_id) = 'minor' or app.band_of(new.reported_id) = 'minor' then 2
                       when new.reason = 'sexual content' then 2 else 3 end;
  if new.priority = 1 then new.status := 'escalated'; new.escalation_level := 1; new.escalated_at := now(); end if;
  select count(*) into n from public.reports r where r.reported_id = new.reported_id and r.status in ('open','escalated','in_review') and r.created_at > now() - interval '7 days';
  if n >= 2 and new.status = 'open' then new.status := 'escalated'; new.escalation_level := 1; new.escalated_at := now(); end if;
  return new;
end $$;
create trigger report_guard before insert on public.reports for each row execute function app.report_guard();
revoke all on public.reports from anon, authenticated;
grant select (id, reporter_id, reported_id, message_id, conversation_id, reason, details, status, priority, escalation_level, escalated_at, created_at, resolved_at)
  on public.reports to authenticated;
grant insert (reporter_id, reported_id, message_id, conversation_id, reason, details, evidence) on public.reports to authenticated;
create policy reports_select on public.reports for select to authenticated using (reporter_id = (select auth.uid()));
-- reporting works across bands (e.g. an adult found in minor space); it reveals nothing about the reported user
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()) and reported_id is distinct from (select auth.uid()));
create function app.escalate_report(p_report uuid, p_note text default null) returns text language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from public.reports where id = p_report and reporter_id = (select auth.uid()) for update;
  if not found then raise exception 'report not found' using errcode = '42501'; end if;
  if r.status in ('actioned','dismissed') and r.escalation_level >= 2 then raise exception 'already escalated to final review' using errcode = '42501'; end if;
  update public.reports set status = 'escalated', escalation_level = least(r.escalation_level + 1, 3), escalated_at = now(),
    priority = greatest(1, r.priority - 1), details = coalesce(details, '') || case when p_note is null then '' else E'\n[escalation] ' || left(p_note, 500) end
    where id = p_report;
  return 'escalated';
end $$;
create function public.escalate_report(p_report uuid, p_note text default null) returns text
  language sql security invoker set search_path = '' as $$ select app.escalate_report(p_report, p_note) $$;

-- ===== LFG posts (band-scoped, expire after 24h) =====
create table public.lfg_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  band text not null check (band in ('minor','adult')),
  game text not null check (char_length(game) between 1 and 64),
  title text not null check (char_length(title) between 1 and 120),
  body text check (char_length(body) <= 1000),
  slots smallint not null default 1 check (slots between 1 and 16),
  voice boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours' check (expires_at <= created_at + interval '7 days'));
create index lfg_band_game_idx on public.lfg_posts (band, game, created_at desc);
create index lfg_author_idx on public.lfg_posts (author_id);
alter table public.lfg_posts enable row level security;
create function app.set_band_from_author() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.band := app.band_of((to_jsonb(new) ->> tg_argv[0])::uuid);
  if new.band is null then raise exception 'complete the age check first' using errcode = '42501'; end if;
  return new;
end $$;
create trigger lfg_band before insert or update on public.lfg_posts for each row execute function app.set_band_from_author('author_id');
revoke all on public.lfg_posts from anon, authenticated;
grant select, insert (author_id, game, title, body, slots, voice, expires_at), update (game, title, body, slots, voice, expires_at), delete on public.lfg_posts to authenticated;
create policy lfg_select on public.lfg_posts for select to authenticated using (
  expires_at > now() and band = (select app.my_band()) and (author_id = (select auth.uid()) or not app.is_blocked((select auth.uid()), author_id)));
create policy lfg_insert on public.lfg_posts for insert to authenticated with check (author_id = (select auth.uid()) and app.feature_ok(author_id, 'lfg'));
create policy lfg_update on public.lfg_posts for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy lfg_delete on public.lfg_posts for delete to authenticated using (author_id = (select auth.uid()));

-- ===== events (band-scoped) + attendees =====
create table public.events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  band text not null check (band in ('minor','adult')),
  title text not null check (char_length(title) between 1 and 120),
  game text check (char_length(game) <= 64),
  description text check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity smallint check (capacity between 2 and 500),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at));
create index events_band_start_idx on public.events (band, starts_at);
create index events_host_idx on public.events (host_id);
alter table public.events enable row level security;
create trigger events_band before insert or update on public.events for each row execute function app.set_band_from_author('host_id');
create table public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id));
create index event_attendees_user_idx on public.event_attendees (user_id);
alter table public.event_attendees enable row level security;
create function app.event_visible(e uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.events x where x.id = e and x.band = app.my_band() and not app.is_blocked((select auth.uid()), x.host_id)) $$;
revoke all on public.events, public.event_attendees from anon, authenticated;
grant select, insert (host_id, title, game, description, starts_at, ends_at, capacity), update (title, game, description, starts_at, ends_at, capacity), delete on public.events to authenticated;
grant select, insert, delete on public.event_attendees to authenticated;
create policy events_select on public.events for select to authenticated using (band = (select app.my_band()) and (host_id = (select auth.uid()) or not app.is_blocked((select auth.uid()), host_id)));
create policy events_insert on public.events for insert to authenticated with check (host_id = (select auth.uid()) and app.feature_ok(host_id, 'events'));
create policy events_update on public.events for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy events_delete on public.events for delete to authenticated using (host_id = (select auth.uid()));
create policy attendees_select on public.event_attendees for select to authenticated using (app.event_visible(event_id) and (user_id = (select auth.uid()) or app.can_interact(user_id)));
create policy attendees_insert on public.event_attendees for insert to authenticated with check (user_id = (select auth.uid()) and app.event_visible(event_id) and app.feature_ok(user_id, 'events'));
create policy attendees_delete on public.event_attendees for delete to authenticated using (user_id = (select auth.uid()));

-- ===== account deletion (GDPR/app-store requirement; also used by the live smoke test to clean up) =====
-- Client should remove its Storage photos first (Storage API); rows cascade from auth.users.
create function app.delete_my_account() returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from auth.users where id = uid; return true;
end $$;
create function public.delete_my_account() returns boolean language sql security invoker set search_path = '' as $$ select app.delete_my_account() $$;

-- ===== matching (same band only; RLS on profiles already enforces it, this adds blocks/prefs/parent filters) =====
create function public.find_matches(p_mode text default 'friends', p_limit int default 50)
returns table (id uuid, handle text, display_name text, mood text, last_seen timestamptz, shared_interests int)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.handle, p.display_name, p.mood, p.last_seen,
         (select count(*)::int from public.interests i join public.interests j on j.tag = i.tag and j.user_id = (select auth.uid()) where i.user_id = p.id)
  from public.profiles p
  join public.match_prefs mp on mp.user_id = p.id and p_mode = any (mp.modes)
  where p.id <> (select auth.uid()) and p.age_band = app.my_band()
    and not app.is_blocked((select auth.uid()), p.id)
    and app.feature_ok((select auth.uid()), 'matching') and app.feature_ok(p.id, 'matching')
    and (p_mode not in ('dating','roulette') or app.my_band() = 'adult')
  order by 6 desc, p.last_seen desc nulls last
  limit least(greatest(p_limit, 1), 200) $$;

-- ===== Realtime: messages via postgres_changes (RLS-filtered); presence/voice via private band-scoped channels =====
alter publication supabase_realtime add table public.messages;
-- Topics: 'presence:<band>' (must equal caller's band), 'conv:<conversation uuid>' (members only, used for typing + voice signaling).
create function app.realtime_topic_ok(topic text) returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if topic like 'presence:%' then return split_part(topic, ':', 2) = app.my_band() and app.feature_ok((select auth.uid()), 'presence'); end if;
  if topic like 'conv:%' then return app.is_member(split_part(topic, ':', 2)::uuid); end if;
  return false;
exception when others then return false;
end $$;
create policy realtime_band_read on realtime.messages for select to authenticated using (app.realtime_topic_ok((select realtime.topic())));
create policy realtime_band_write on realtime.messages for insert to authenticated with check (app.realtime_topic_ok((select realtime.topic())));

-- ===== scheduled purge =====
create extension if not exists pg_cron;
select cron.schedule('cybermates-purge-expired', '17 * * * *', $$select app.purge_expired()$$);

-- ===== lockdown: app.* executable only by authenticated (never anon); purge only by postgres/cron =====
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke execute on function app.purge_expired(), app.refund_boost(uuid) from authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.submit_age_check(date), public.set_parent_controls(text, text[], text), public.clear_parent_controls(text),
  public.boost_balance(), public.escalate_report(uuid, text), public.delete_my_account(), public.find_matches(text, int) to authenticated;
