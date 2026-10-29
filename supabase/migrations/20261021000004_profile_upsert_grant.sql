-- PostgREST upsert (ON CONFLICT DO UPDATE) also SETs the conflict column; RLS check (id = auth.uid()) keeps it a no-op.
grant update (id) on public.profiles to authenticated;
