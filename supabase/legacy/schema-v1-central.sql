-- Cybermates Supabase schema. Run in the SQL editor (or `supabase db push`).
-- Enable Anonymous sign-ins (Auth > Providers) for the prototype, or wire email/OAuth auth.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  lat double precision, lng double precision,
  city text, region text, country_code char(2),          -- global location (v2)
  updated_at timestamptz not null default now()
);
-- v2 migration for existing projects (modes are dating/friends/gaming only; per-mode distance prefs live in data->'distPrefs')
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists region text;
alter table public.profiles add column if not exists country_code char(2);
alter table public.profiles drop column if exists hookup_verified;
update public.profiles set data = jsonb_set(data - 'hookupVerified', '{lookingFor}',
  coalesce((select jsonb_agg(m) from jsonb_array_elements_text(data->'lookingFor') m where m in ('dating','friends','gaming')), '[]'::jsonb))
  where data ? 'lookingFor';
create index if not exists profiles_geo_idx on public.profiles (country_code, region, city);

-- Linked accounts (gamer tags / socials / Discord invite) are NOT stored in profiles.data, so privacy is enforced by RLS.
-- reveal: public = everyone, match = only after both users have messaged each other, hidden = owner only.
create table if not exists public.linked_accounts (
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('gamertags','socials','discordInvite')),
  platform text not null, handle text not null,
  reveal text not null default 'match' check (reveal in ('public','match','hidden')),
  primary key (user_id, kind, platform)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles on delete cascade,
  recipient uuid not null references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  boosted boolean not null default false,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index if not exists messages_recipient_idx on public.messages (recipient, read, boosted desc, created_at desc);
create index if not exists messages_pair_idx on public.messages (least(sender, recipient), greatest(sender, recipient));

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles on delete cascade,
  day date not null default current_date,
  starters_used int not null default 0 check (starters_used >= 0),
  extra_starters int not null default 0 check (extra_starters >= 0),
  boosts int not null default 0 check (boosts >= 0)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  item text not null,
  mock boolean not null default false,
  stripe_session_id text unique,          -- idempotency key for Stripe webhooks
  created_at timestamptz not null default now()
);

-- Feature flag: allow mock purchases (dev only). Set to false in production.
create table if not exists public.app_config (key text primary key, value jsonb not null);
insert into public.app_config values ('allow_mock_purchases', 'true') on conflict do nothing;

-- ---------- RLS ----------
alter table public.profiles  enable row level security;
alter table public.messages  enable row level security;
alter table public.wallets   enable row level security;
alter table public.purchases enable row level security;
alter table public.app_config enable row level security;

drop policy if exists "profiles readable by authed" on public.profiles;
create policy "profiles readable by authed" on public.profiles for select to authenticated using (true);
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "delete own profile" on public.profiles;
create policy "delete own profile" on public.profiles for delete to authenticated using (auth.uid() = id);

drop policy if exists "read my messages" on public.messages;
create policy "read my messages" on public.messages for select to authenticated using (auth.uid() in (sender, recipient));
-- No insert policy: messages are only created via send_message().
-- Recipient may only flip read=true (column-level grant below).
drop policy if exists "recipient marks read" on public.messages;
create policy "recipient marks read" on public.messages for update to authenticated using (auth.uid() = recipient) with check (auth.uid() = recipient);
revoke update on public.messages from authenticated, anon;
grant update (read) on public.messages to authenticated;

drop policy if exists "read own wallet" on public.wallets;
create policy "read own wallet" on public.wallets for select to authenticated using (auth.uid() = user_id);
drop policy if exists "read own purchases" on public.purchases;
create policy "read own purchases" on public.purchases for select to authenticated using (auth.uid() = user_id);
-- wallets/purchases/app_config: no client write policies at all.

-- ---------- Functions ----------
-- Returns the caller's wallet, creating it and rolling the daily counter over as needed.
create or replace function public.get_wallet()
returns public.wallets language plpgsql security definer set search_path = public as $$
declare w public.wallets; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into wallets(user_id) values (uid) on conflict do nothing;
  update wallets set day = current_date, starters_used = 0
    where user_id = uid and day < current_date;
  select * into w from wallets where user_id = uid;
  return w;
end $$;

-- Sends a message. Replies in an existing conversation always deliver.
-- A NEW conversation consumes 1 of 5 free daily starters, then a purchased starter.
-- boost=true consumes a boost; boosted unread messages sort first in inbox().
create or replace function public.send_message(to_user uuid, body text, boost boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); w public.wallets; existing boolean; used_starter boolean := false; m public.messages;
  daily_limit int := 5;   -- 15 for Cybermates+
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if to_user = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if not exists (select 1 from profiles where id = to_user) then return jsonb_build_object('ok', false, 'reason', 'no-recipient'); end if;
  if coalesce(char_length(body), 0) = 0 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;

  perform get_wallet();
  select * into w from wallets where user_id = uid for update;   -- serialize concurrent sends
  if w.plus then daily_limit := 15; end if;

  select exists (select 1 from messages where (sender = uid and recipient = to_user) or (sender = to_user and recipient = uid)) into existing;
  if not existing then
    if w.starters_used < daily_limit then w.starters_used := w.starters_used + 1;
    elsif w.extra_starters > 0 then w.extra_starters := w.extra_starters - 1;
    else return jsonb_build_object('ok', false, 'reason', 'no-starters'); end if;
    used_starter := true;
  end if;
  if boost then
    if w.boosts <= 0 then return jsonb_build_object('ok', false, 'reason', 'no-boosts'); end if;
    w.boosts := w.boosts - 1;
  end if;

  update wallets set starters_used = w.starters_used, extra_starters = w.extra_starters, boosts = w.boosts where user_id = uid;
  insert into messages(sender, recipient, body, boosted) values (uid, to_user, body, coalesce(boost, false)) returning * into m;
  return jsonb_build_object('ok', true, 'used_starter', used_starter, 'msg', to_jsonb(m));
end $$;

-- Inbox ordering: boosted+unread first, then unread, then newest.
create or replace function public.inbox()
returns setof public.messages language sql stable security invoker set search_path = public as $$
  select * from messages where auth.uid() in (sender, recipient)
  order by (boosted and not read and recipient = auth.uid()) desc,
           (not read and recipient = auth.uid()) desc, created_at desc;
$$;

create or replace function public.mark_read(other uuid)
returns void language sql security definer set search_path = public as $$
  update messages set read = true where recipient = auth.uid() and sender = other and not read;
$$;

-- Mutual match = both have sent each other a message.
create or replace function public.is_mutual(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from messages where sender = a and recipient = b) and exists (select 1 from messages where sender = b and recipient = a)
$$;
alter table public.linked_accounts enable row level security;
drop policy if exists "owner manages accounts" on public.linked_accounts;
create policy "owner manages accounts" on public.linked_accounts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "revealed accounts" on public.linked_accounts;
create policy "revealed accounts" on public.linked_accounts for select to authenticated
  using (reveal = 'public' or (reveal = 'match' and public.is_mutual(auth.uid(), user_id)));

-- Cybermates+ (mock until Stripe subscriptions land): 15 starters/day.
alter table public.wallets add column if not exists plus boolean not null default false;

-- Credits a wallet. Called by the Stripe webhook (service role) — never by clients.
create or replace function public.credit_wallet(p_user uuid, p_item text, p_session text default null, p_mock boolean default false)
returns public.wallets language plpgsql security definer set search_path = public as $$
declare w public.wallets;
begin
  if p_session is not null and exists (select 1 from purchases where stripe_session_id = p_session) then
    select * into w from wallets where user_id = p_user; return w;   -- idempotent replay
  end if;
  insert into wallets(user_id) values (p_user) on conflict do nothing;
  update wallets set
    plus = case when p_item in ('plus1m','plus6m','plus12m') then true when p_item = 'plus_cancel' then false else plus end,
    extra_starters = extra_starters + case p_item when 'starters5' then 5 when 'starters15' then 15 when 'starters40' then 40 else 0 end,
    boosts = boosts + case p_item when 'boost1' then 1 when 'boost5' then 5 when 'boost15' then 15 when 'plus1m' then 5 when 'plus6m' then 5 when 'plus12m' then 5 else 0 end
  where user_id = p_user returning * into w;
  insert into purchases(user_id, item, mock, stripe_session_id) values (p_user, p_item, p_mock, p_session);
  return w;
end $$;
revoke execute on function public.credit_wallet(uuid, text, text, boolean) from public, anon, authenticated;

-- Dev-only mock purchase (disabled when app_config.allow_mock_purchases = false).
create or replace function public.mock_purchase(item text)
returns public.wallets language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce((select value::text::boolean from app_config where key = 'allow_mock_purchases'), false) is not true then
    raise exception 'mock purchases disabled';
  end if;
  return credit_wallet(auth.uid(), item, null, true);
end $$;

revoke execute on function public.send_message(uuid, text, boolean), public.get_wallet(), public.mark_read(uuid), public.mock_purchase(text), public.inbox() from public, anon;
grant execute on function public.send_message(uuid, text, boolean), public.get_wallet(), public.mark_read(uuid), public.mock_purchase(text), public.inbox() to authenticated;

-- Realtime inbox updates
do $$ begin alter publication supabase_realtime add table public.messages; exception when others then null; end $$;

-- ===== P2P kill switch =====
-- Single persistent signed control record. Clients read it on startup; only the service role (scripts/kill-switch.mjs) writes.
-- The row content is an Ed25519-signed message verified client-side, so even a DB compromise can't forge a kill/clear.
create table if not exists public.kill_switch (id text primary key default 'current', msg jsonb not null, updated_at timestamptz not null default now());
alter table public.kill_switch enable row level security;
drop policy if exists kill_switch_read on public.kill_switch;
create policy kill_switch_read on public.kill_switch for select to anon, authenticated using (true);
-- no insert/update/delete policies => only service_role (bypasses RLS) can write
revoke insert, update, delete on public.kill_switch from anon, authenticated;
-- P2P consent records (server-side audit of the in-app consent)
create table if not exists public.p2p_consents (user_id uuid primary key references auth.users on delete cascade, version text not null, consented_at timestamptz not null default now());
alter table public.p2p_consents enable row level security;
drop policy if exists p2p_consents_own on public.p2p_consents;
create policy p2p_consents_own on public.p2p_consents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Realtime: 'control' broadcast channel is sent via the service-role REST broadcast API. If you enable private
-- channels (Realtime Authorization), add a realtime.messages policy allowing authenticated SELECT on topic 'control' only.

-- Payments / entitlements (written only by server functions with the service role; no client policies).
create table if not exists app_users (user_code text primary key, last_seen timestamptz not null default now());
create table if not exists entitlements (id bigserial primary key, user_code text not null, stripe_ref text unique, status text not null, receipt jsonb not null, updated_at timestamptz default now());
alter table app_users enable row level security; alter table entitlements enable row level security;
-- Signed min-version config (item 10), same signing style as kill_switch.
create table if not exists app_config (id text primary key default 'current', msg jsonb not null);
alter table app_config enable row level security;
create policy "app_config readable" on app_config for select using (true);
