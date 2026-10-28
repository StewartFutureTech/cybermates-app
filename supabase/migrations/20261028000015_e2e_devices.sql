-- v48 FORWARD SECRECY + MULTI-DEVICE for the server-relayed chat path (src/backend/supabase-e2e.js fsSealer).
-- Each signed-in DEVICE publishes a public key bundle: its long-term X25519 identity key (ik), an Ed25519 key (sk_pub) and a
-- rotating SIGNED PREKEY (spk_id / spk / spk_sig = Ed25519 over the device bundle). Senders wrap a per-message content key to
-- every fresh device of the recipient (and to their own devices), mixing X25519(per-message ephemeral, spk) into the key. Phones
-- erase prekey secrets 8 days after a newer prekey replaced them (> the 7-day message hold), so a server copy recorded today
-- can't be opened later, not even with a device's long-term key. The server only ever sees PUBLIC keys; it never verifies or
-- decides crypto (clients verify spk_sig and pin ik/sk_pub per device). Visibility follows the same rule as messaging:
-- own rows, or users I can interact with (same age band, not blocked either way), and only devices seen in the last 30 days.
create table public.e2e_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{8,32}$'),
  ik text not null check (ik ~ '^[A-Za-z0-9+/]{43}=$'),            -- X25519 public (base64, 32 bytes)
  sk_pub text not null check (sk_pub ~ '^[A-Za-z0-9+/]{43}=$'),    -- Ed25519 public (base64, 32 bytes)
  spk_id text not null check (spk_id ~ '^[A-Za-z0-9+/_=-]{4,24}$'),
  spk text not null check (spk ~ '^[A-Za-z0-9+/]{43}=$'),          -- current signed prekey (X25519 public)
  spk_sig text not null check (spk_sig ~ '^[A-Za-z0-9+/]{86}==$'), -- Ed25519 signature (64 bytes)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),                   -- server clock; refreshed on every publish
  primary key (user_id, device_id));
alter table public.e2e_devices enable row level security;
create index e2e_devices_updated_idx on public.e2e_devices (updated_at);

-- limits / invariants (private schema)
create function app.e2e_devices_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('e2e_devices:' || new.user_id::text, 0));
    select count(*) into n from public.e2e_devices where user_id = new.user_id;
    if n >= 5 then raise exception 'e2e: at most 5 devices per account (remove one first)' using errcode = '23514'; end if;
    new.created_at := now();
  else
    if new.ik is distinct from old.ik or new.sk_pub is distinct from old.sk_pub or new.user_id is distinct from old.user_id or new.device_id is distinct from old.device_id then
      raise exception 'e2e: a device''s identity keys never change (register a new device id)' using errcode = '42501'; end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger e2e_devices_guard before insert or update on public.e2e_devices for each row execute function app.e2e_devices_guard();

revoke all on public.e2e_devices from public, anon, authenticated;
grant select, delete on public.e2e_devices to authenticated;
grant insert (user_id, device_id, ik, sk_pub, spk_id, spk, spk_sig) on public.e2e_devices to authenticated;
grant update (spk_id, spk, spk_sig) on public.e2e_devices to authenticated;
create policy e2e_devices_select on public.e2e_devices for select to authenticated using (
  user_id = (select auth.uid()) or (updated_at > now() - interval '30 days' and app.can_interact(user_id)));
create policy e2e_devices_insert on public.e2e_devices for insert to authenticated with check (user_id = (select auth.uid()));
create policy e2e_devices_update on public.e2e_devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy e2e_devices_delete on public.e2e_devices for delete to authenticated using (user_id = (select auth.uid()));

-- devices idle for 45 days are removed (their senders would no longer target them anyway after 30 days)
create function app.purge_e2e_devices() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin delete from public.e2e_devices where updated_at < now() - interval '45 days'; get diagnostics n = row_count; return n; end $$;
revoke execute on function app.purge_e2e_devices(), app.e2e_devices_guard() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cybermates-purge-e2e-devices') then perform cron.unschedule('cybermates-purge-e2e-devices'); end if;
  perform cron.schedule('cybermates-purge-e2e-devices', '53 4 * * *', 'select app.purge_e2e_devices()');
end $$;
