-- Blocks/mutes, parent controls, interests, match prefs, favorite games, photos, friends, acknowledgements.

-- ===== blocks & mutes =====
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id));
create index blocks_blocked_idx on public.blocks (blocked_id);
create table public.mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  until timestamptz,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id), check (muter_id <> muted_id));
create index mutes_muted_idx on public.mutes (muted_id);
alter table public.blocks enable row level security; alter table public.mutes enable row level security;
revoke all on public.blocks, public.mutes from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select, insert, update, delete on public.mutes to authenticated;
-- you may block anyone (even cross-band, e.g. after a report), but only see your own rows
create policy blocks_own on public.blocks for all to authenticated
  using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));
create policy mutes_own on public.mutes for all to authenticated
  using (muter_id = (select auth.uid())) with check (muter_id = (select auth.uid()));

create or replace function app.is_blocked(a uuid, b uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.blocks x where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a)) $$;
-- "can I interact with other": same band, not blocked either way
create function app.can_interact(other uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select app.same_band(other) and not app.is_blocked((select auth.uid()), other) $$;

-- ===== parent controls (minors) =====
-- code_hash is bcrypt; never selectable by clients (column privileges). Features listed in disabled_features are blocked server-side.
create table public.parent_controls (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code_hash text not null,
  disabled_features text[] not null default '{}' check (disabled_features <@ array['messages','friends','voice','lfg','events','photos','matching','presence']::text[]),
  updated_at timestamptz not null default now());
alter table public.parent_controls enable row level security;
revoke all on public.parent_controls from anon, authenticated;
grant select (user_id, disabled_features, updated_at) on public.parent_controls to authenticated;
create policy parent_controls_select on public.parent_controls for select to authenticated using (user_id = (select auth.uid()));

create or replace function app.feature_ok(u uuid, feat text) returns boolean language sql stable security definer set search_path = '' as
$$ select not exists (select 1 from public.parent_controls c where c.user_id = u and feat = any (c.disabled_features)) $$;

create function app.set_parent_controls(p_code text, p_disabled text[], p_old_code text default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); h text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_code is null or p_code !~ '^[0-9]{4,8}$' then raise exception 'parent code must be 4-8 digits' using errcode = '22023'; end if;
  select code_hash into h from public.parent_controls where user_id = uid for update;
  if h is not null and (p_old_code is null or extensions.crypt(p_old_code, h) <> h) then
    perform pg_sleep(1); raise exception 'wrong parent code' using errcode = '42501'; end if;
  insert into public.parent_controls (user_id, code_hash, disabled_features, updated_at)
    values (uid, extensions.crypt(p_code, extensions.gen_salt('bf', 10)), coalesce(p_disabled, '{}'), now())
    on conflict (user_id) do update set code_hash = excluded.code_hash, disabled_features = excluded.disabled_features, updated_at = now();
  return coalesce(p_disabled, '{}');
end $$;
create function app.clear_parent_controls(p_code text) returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); h text;
begin
  select code_hash into h from public.parent_controls where user_id = uid for update;
  if h is null then return true; end if;
  if p_code is null or extensions.crypt(p_code, h) <> h then perform pg_sleep(1); raise exception 'wrong parent code' using errcode = '42501'; end if;
  delete from public.parent_controls where user_id = uid; return true;
end $$;
create function public.set_parent_controls(p_code text, p_disabled text[], p_old_code text default null) returns text[]
  language sql security invoker set search_path = '' as $$ select app.set_parent_controls(p_code, p_disabled, p_old_code) $$;
create function public.clear_parent_controls(p_code text) returns boolean
  language sql security invoker set search_path = '' as $$ select app.clear_parent_controls(p_code) $$;

-- ===== interests (cap 20), favorite games =====
create table public.interests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 32),
  primary key (user_id, tag));
create table public.favorite_games (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null check (char_length(game) between 1 and 64),
  rank smallint,
  primary key (user_id, game));
alter table public.interests enable row level security; alter table public.favorite_games enable row level security;
create function app.cap_rows() returns trigger language plpgsql set search_path = '' as $$
declare n int; lim int := tg_argv[0]::int;
begin
  execute format('select count(*) from %I.%I where %I = $1', tg_table_schema, tg_table_name, tg_argv[1]) into n using (to_jsonb(new) ->> tg_argv[1])::uuid;
  if n >= lim then raise exception '% limit reached (max %)', tg_table_name, lim using errcode = '23514'; end if;
  return new;
end $$;
create trigger interests_cap before insert on public.interests for each row execute function app.cap_rows('20', 'user_id');
create trigger favorite_games_cap before insert on public.favorite_games for each row execute function app.cap_rows('20', 'user_id');
revoke all on public.interests, public.favorite_games from anon, authenticated;
grant select, insert, delete on public.interests to authenticated;
grant select, insert, update, delete on public.favorite_games to authenticated;
create policy interests_select on public.interests for select to authenticated using (user_id = (select auth.uid()) or app.can_interact(user_id));
create policy interests_insert on public.interests for insert to authenticated with check (user_id = (select auth.uid()));
create policy interests_delete on public.interests for delete to authenticated using (user_id = (select auth.uid()));
create policy favorite_games_select on public.favorite_games for select to authenticated using (user_id = (select auth.uid()) or app.can_interact(user_id));
create policy favorite_games_insert on public.favorite_games for insert to authenticated with check (user_id = (select auth.uid()));
create policy favorite_games_update on public.favorite_games for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy favorite_games_delete on public.favorite_games for delete to authenticated using (user_id = (select auth.uid()));

-- ===== match prefs (minors: no dating/roulette — enforced by trigger + check) =====
create table public.match_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  modes text[] not null default array['friends']::text[] check (modes <@ array['friends','duo','squad','dating','roulette']::text[]),
  max_distance_km integer check (max_distance_km between 1 and 20000),
  voice_ok boolean not null default true,
  region text check (char_length(region) <= 64),
  dating_prefs jsonb,
  updated_at timestamptz not null default now());
alter table public.match_prefs enable row level security;
create function app.match_prefs_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if app.band_of(new.user_id) is distinct from 'adult' and (new.modes && array['dating','roulette']::text[] or new.dating_prefs is not null) then
    raise exception 'dating/roulette are adult-only' using errcode = '42501'; end if;
  new.updated_at := now(); return new;
end $$;
create trigger match_prefs_guard before insert or update on public.match_prefs for each row execute function app.match_prefs_guard();
revoke all on public.match_prefs from anon, authenticated;
grant select, insert, update, delete on public.match_prefs to authenticated;
create policy match_prefs_select on public.match_prefs for select to authenticated using (user_id = (select auth.uid()) or app.can_interact(user_id));
create policy match_prefs_insert on public.match_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy match_prefs_update on public.match_prefs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy match_prefs_delete on public.match_prefs for delete to authenticated using (user_id = (select auth.uid()));

-- roulette queue: adults only, same-band pairing
create table public.roulette_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mode text not null default 'roulette' check (mode in ('roulette','dating')),
  created_at timestamptz not null default now());
alter table public.roulette_queue enable row level security;
revoke all on public.roulette_queue from anon, authenticated;
grant select, insert, delete on public.roulette_queue to authenticated;
create policy roulette_select on public.roulette_queue for select to authenticated
  using ((select app.my_band()) = 'adult' and (user_id = (select auth.uid()) or app.can_interact(user_id)));
create policy roulette_insert on public.roulette_queue for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.my_band()) = 'adult' and app.feature_ok(user_id, 'matching'));
create policy roulette_delete on public.roulette_queue for delete to authenticated using (user_id = (select auth.uid()));

-- ===== photos (max 4 per user; files live in the private 'photos' bucket under <uid>/...) =====
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  path text not null unique check (split_part(path, '/', 1) = owner_id::text),
  position smallint not null default 0 check (position between 0 and 3),
  created_at timestamptz not null default now(),
  unique (owner_id, position));
alter table public.photos enable row level security;
create trigger photos_cap before insert on public.photos for each row execute function app.cap_rows('4', 'owner_id');
revoke all on public.photos from anon, authenticated;
grant select, insert, update (position), delete on public.photos to authenticated;
create policy photos_select on public.photos for select to authenticated using (owner_id = (select auth.uid()) or app.can_interact(owner_id));
create policy photos_insert on public.photos for insert to authenticated with check (owner_id = (select auth.uid()) and app.feature_ok(owner_id, 'photos'));
create policy photos_update on public.photos for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy photos_delete on public.photos for delete to authenticated using (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create function app.storage_owner(name text) returns uuid language plpgsql immutable set search_path = '' as $$
begin return split_part(name, '/', 1)::uuid; exception when others then return null; end $$;
create function app.photo_count(u uuid) returns int language sql stable security definer set search_path = '' as
$$ select count(*)::int from storage.objects o where o.bucket_id = 'photos' and app.storage_owner(o.name) = u $$;
create policy photos_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (app.storage_owner(name) = (select auth.uid()) or app.can_interact(app.storage_owner(name))));
create policy photos_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and app.storage_owner(name) = (select auth.uid()) and app.photo_count((select auth.uid())) < 4
              and app.feature_ok((select auth.uid()), 'photos'));
create policy photos_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and app.storage_owner(name) = (select auth.uid())) with check (bucket_id = 'photos' and app.storage_owner(name) = (select auth.uid()));
create policy photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and app.storage_owner(name) = (select auth.uid()));

-- ===== friends =====
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id));
create unique index friend_requests_pending_uq on public.friend_requests (least(from_id, to_id), greatest(from_id, to_id)) where status = 'pending';
create index friend_requests_to_idx on public.friend_requests (to_id);
create index friend_requests_from_idx on public.friend_requests (from_id);
create table public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b), check (user_a < user_b));
create index friendships_b_idx on public.friendships (user_b);
alter table public.friend_requests enable row level security; alter table public.friendships enable row level security;
revoke all on public.friend_requests, public.friendships from anon, authenticated;
grant select, insert, update (status) on public.friend_requests to authenticated;
grant select, delete on public.friendships to authenticated;
create policy friend_requests_select on public.friend_requests for select to authenticated
  using ((from_id = (select auth.uid()) or to_id = (select auth.uid())) and app.same_band(case when from_id = (select auth.uid()) then to_id else from_id end));
create policy friend_requests_insert on public.friend_requests for insert to authenticated
  with check (from_id = (select auth.uid()) and status = 'pending' and app.can_interact(to_id)
              and app.feature_ok(from_id, 'friends') and app.feature_ok(to_id, 'friends'));
create policy friend_requests_update on public.friend_requests for update to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()))
  with check (app.same_band(case when from_id = (select auth.uid()) then to_id else from_id end));
create function app.friend_request_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if old.status <> 'pending' then raise exception 'request already resolved' using errcode = '42501'; end if;
  if me = new.to_id and new.status not in ('accepted','declined') then raise exception 'recipient may accept or decline' using errcode = '42501'; end if;
  if me = new.from_id and new.status <> 'cancelled' then raise exception 'sender may only cancel' using errcode = '42501'; end if;
  new.responded_at := now();
  if new.status = 'accepted' then
    insert into public.friendships (user_a, user_b) values (least(new.from_id, new.to_id), greatest(new.from_id, new.to_id)) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger friend_request_guard before update on public.friend_requests for each row execute function app.friend_request_guard();
create policy friendships_select on public.friendships for select to authenticated
  using (((select auth.uid()) in (user_a, user_b)) and app.same_band(case when user_a = (select auth.uid()) then user_b else user_a end));
create policy friendships_delete on public.friendships for delete to authenticated using ((select auth.uid()) in (user_a, user_b));

-- ===== app acknowledgement (terms/safety) versions =====
create table public.app_acknowledgements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null check (version > 0),
  acked_at timestamptz not null default now(),
  primary key (user_id, version));
alter table public.app_acknowledgements enable row level security;
revoke all on public.app_acknowledgements from anon, authenticated;
grant select, insert on public.app_acknowledgements to authenticated;
create policy acks_select on public.app_acknowledgements for select to authenticated using (user_id = (select auth.uid()));
create policy acks_insert on public.app_acknowledgements for insert to authenticated with check (user_id = (select auth.uid()));
create function app.ack_sync() returns trigger language plpgsql security definer set search_path = '' as
$$ begin update public.profiles set ack_version = greatest(ack_version, new.version) where id = new.user_id; return new; end $$;
create trigger ack_sync after insert on public.app_acknowledgements for each row execute function app.ack_sync();
