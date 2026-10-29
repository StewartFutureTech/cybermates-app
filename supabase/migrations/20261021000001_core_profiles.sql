-- Cybermates central backend v3: core identity, age bands, profiles.
-- Age band separation is THE invariant: every social read/write is gated by app.same_band().
create extension if not exists pgcrypto with schema extensions;
create schema if not exists app;            -- private helpers (NOT exposed via PostgREST)
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique check (handle ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  bio text check (char_length(bio) <= 500),
  age_band text check (age_band in ('minor','adult')),        -- set ONLY by app.submit_age_check / service role
  age_checked_at timestamptz,
  mood text check (char_length(mood) <= 40),
  mood_at timestamptz,
  e2e_pubkey text check (char_length(e2e_pubkey) <= 200),      -- public half of the device-key vault identity
  ack_version integer not null default 0,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---- private helpers (security definer, fixed search_path, schema app is not exposed) ----
create function app.band_of(u uuid) returns text language sql stable security definer set search_path = '' as
$$ select p.age_band from public.profiles p where p.id = u $$;
create function app.my_band() returns text language sql stable security definer set search_path = '' as
$$ select p.age_band from public.profiles p where p.id = (select auth.uid()) $$;
-- true only when BOTH users have a band and they match
create function app.same_band(other uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select coalesce((select a.age_band from public.profiles a where a.id = (select auth.uid()))
                 = (select b.age_band from public.profiles b where b.id = other), false) $$;
create function app.is_blocked(a uuid, b uuid) returns boolean language sql stable security definer set search_path = '' as
$$ select false $$; -- replaced once public.blocks exists (next migration)
create function app.feature_ok(u uuid, feat text) returns boolean language sql stable security definer set search_path = '' as
$$ select true $$;  -- replaced once public.parent_controls exists
grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from public, anon;

create function app.touch_updated_at() returns trigger language plpgsql set search_path = '' as
$$ begin new.updated_at := now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();

-- mood_at follows mood
create function app.profiles_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.mood is distinct from old.mood then new.mood_at := now(); end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function app.profiles_guard();

-- Column-level privileges: age_band / age_checked_at are never client-writable.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, handle, display_name, bio, mood, e2e_pubkey) on public.profiles to authenticated;
grant update (handle, display_name, bio, mood, e2e_pubkey, last_seen) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (app.same_band(id) and not app.is_blocked((select auth.uid()), id)));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_delete on public.profiles for delete to authenticated
  using (id = (select auth.uid()));

-- ---- age check (server-side band assignment; birth date is NOT stored) ----
-- First call wins; changing a band afterwards requires the service role (support/appeal flow).
create function app.submit_age_check(p_birthdate date) returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); band text; cur text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_birthdate is null or p_birthdate > current_date or p_birthdate < date '1900-01-01' then raise exception 'invalid birthdate' using errcode = '22023'; end if;
  if p_birthdate > (current_date - interval '13 years')::date then raise exception 'under 13 not permitted' using errcode = '42501'; end if;
  band := case when p_birthdate <= (current_date - interval '18 years')::date then 'adult' else 'minor' end;
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;
  select age_band into cur from public.profiles where id = uid for update;
  if cur is not null then
    if cur <> band then raise exception 'age band already set; contact support' using errcode = '42501'; end if;
    return cur;
  end if;
  update public.profiles set age_band = band, age_checked_at = now() where id = uid;
  return band;
end $$;
-- public RPC wrapper is SECURITY INVOKER; the privileged work happens in the private schema
create function public.submit_age_check(p_birthdate date) returns text language sql security invoker set search_path = '' as
$$ select app.submit_age_check(p_birthdate) $$;
revoke execute on function public.submit_age_check(date) from public, anon;
grant execute on function public.submit_age_check(date) to authenticated;
revoke execute on function app.submit_age_check(date) from public, anon;
grant execute on function app.submit_age_check(date) to authenticated;
