-- v40: GLOBAL rate limits (shared by every Vercel serverless instance, not per instance).
-- Before v40 api/_lib/guard.js (and kill/ban/help/bootstrap?recent) only counted hits in an in-memory Map per instance, so N warm
-- instances allowed N x the limit. Now each api/ route ALSO counts in this table through one atomic RPC:
--   * app.rate_limit_buckets: fixed-window counters (key, window_start) -> count. Lives in the private `app` schema (NOT exposed
--     via PostgREST), RLS on with NO policies, and no grants for anon or authenticated: clients can never read or write it.
--     Keys are HMAC-SHA256 hashes made server-side (api/_lib/globalrl.js), so no raw IPs or IDs are stored.
--   * public.rl_hit(key, limit, window_secs): ONE statement INSERT .. ON CONFLICT DO UPDATE count = count + 1 RETURNING count,
--     so concurrent calls from different instances serialize on the row lock and never lose an increment. Fixed window
--     (window_start = floor(epoch / window) * window). Returns {allowed, count, limit, reset_ms}.
--     SECURITY DEFINER, search_path = '', EXECUTE granted to service_role ONLY (anon/authenticated get 42501).
--   * Auto-cleanup: about 1 in 50 calls (and app.rl_cleanup() on demand) deletes windows that ended over a minute ago.
-- The API fails SAFE: if this RPC is slow (>350 ms) or unreachable, or the server env is missing, the per-instance in-memory
-- limiter (always applied first) still enforces the limit. Nothing existing is dropped or changed.

create table if not exists app.rate_limit_buckets (
  key text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  expires_at timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (key, window_start));
create index if not exists rate_limit_buckets_expires_idx on app.rate_limit_buckets (expires_at);
alter table app.rate_limit_buckets enable row level security;
revoke all on app.rate_limit_buckets from public, anon, authenticated;

create or replace function app.rl_cleanup() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from app.rate_limit_buckets where expires_at < now() - interval '1 minute';
  get diagnostics n = row_count; return n;
end $$;

-- Core (explicit timestamp so rollover is testable). Not callable by clients.
create or replace function app.rl_hit_at(p_key text, p_limit integer, p_window_secs integer, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ws timestamptz; n integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 then raise exception 'bad key' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 1000000 then raise exception 'bad limit' using errcode = '22023'; end if;
  if p_window_secs is null or p_window_secs not between 1 and 86400 then raise exception 'bad window' using errcode = '22023'; end if;
  ws := to_timestamp(floor(extract(epoch from p_at) / p_window_secs) * p_window_secs);
  insert into app.rate_limit_buckets as b (key, window_start, expires_at, count)
    values (p_key, ws, ws + make_interval(secs => p_window_secs), 1)
    on conflict (key, window_start) do update set count = least(b.count + 1, 2000000000)
    returning b.count into n;
  return jsonb_build_object('allowed', n <= p_limit, 'count', n, 'limit', p_limit,
    'reset_ms', greatest(0, floor(extract(epoch from (ws + make_interval(secs => p_window_secs) - p_at)) * 1000))::bigint);
end $$;

create or replace function public.rl_hit(p_key text, p_limit integer, p_window_secs integer default 60)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r := app.rl_hit_at(p_key, p_limit, p_window_secs, clock_timestamp());
  if random() < 0.02 then perform app.rl_cleanup(); end if;
  return r;
end $$;

revoke all on function app.rl_cleanup() from public, anon, authenticated;
revoke all on function app.rl_hit_at(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.rl_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rl_hit(text, integer, integer) to service_role;
comment on function public.rl_hit(text, integer, integer) is 'v40 global fixed-window rate limit hit (service role only). Returns {allowed,count,limit,reset_ms}.';
