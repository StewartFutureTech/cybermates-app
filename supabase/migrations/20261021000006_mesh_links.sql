-- Link mesh identities (device ID codes) to Supabase users. A code can belong to one user only (first link wins).
create table if not exists public.mesh_links (
  code text primary key check (code ~ '^[A-Z0-9]{4,16}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.mesh_links enable row level security;
create policy mesh_links_select_own on public.mesh_links for select to authenticated using (user_id = (select auth.uid()));
create policy mesh_links_insert_own on public.mesh_links for insert to authenticated with check (user_id = (select auth.uid()));
create policy mesh_links_delete_own on public.mesh_links for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, delete on public.mesh_links to authenticated;
-- report targets: signed-in users may resolve a code to a user id (no other columns exposed).
create or replace function public.resolve_mesh_code(p_code text) returns uuid language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else (select user_id from public.mesh_links where code = p_code) end $$;
revoke all on function public.resolve_mesh_code(text) from public, anon;
grant execute on function public.resolve_mesh_code(text) to authenticated;
