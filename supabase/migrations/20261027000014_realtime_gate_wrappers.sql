-- v46 follow-up: same pattern as v39/v45 - the logic lives in SECURITY DEFINER functions in the private `app` schema (not
-- exposed by PostgREST); the public RPCs are thin SECURITY INVOKER wrappers. Clears the 4 new "authenticated can execute
-- SECURITY DEFINER" advisor warnings from 20261027000013. Behaviour is unchanged.
create or replace function app.mesh_admit_now(p_code text, p_pub text, p_w bigint, p_b integer, p_k integer, p_n bigint[])
returns jsonb language sql security definer set search_path = '' as $$ select app.mesh_admit_at(p_code, p_pub, p_w, p_b, p_k, p_n, now()) $$; -- the clock is never client-chosen

do $$ declare src text; begin
  -- move the bodies of the three client-facing definer functions into app.* (copy, then turn public.* into invoker wrappers)
  select replace(pg_get_functiondef('public.mesh_gate_info()'::regprocedure), 'FUNCTION public.mesh_gate_info()', 'FUNCTION app.mesh_gate_info()') into src; execute src;
  select replace(pg_get_functiondef('public.mod_mesh_suspend(uuid,integer,text)'::regprocedure), 'FUNCTION public.mod_mesh_suspend(', 'FUNCTION app.mod_mesh_suspend(') into src; execute src;
  select replace(pg_get_functiondef('public.mod_mesh_lift(uuid)'::regprocedure), 'FUNCTION public.mod_mesh_lift(', 'FUNCTION app.mod_mesh_lift(') into src; execute src;
end $$;

drop function if exists public.mesh_admit(text, text, bigint, integer, integer, bigint[]);
drop function if exists public.mesh_gate_info();
drop function if exists public.mod_mesh_suspend(uuid, integer, text);
drop function if exists public.mod_mesh_lift(uuid);
create function public.mesh_admit(p_code text, p_pub text, p_w bigint, p_b integer, p_k integer, p_n bigint[]) returns jsonb
  language sql security invoker set search_path = '' as $$ select app.mesh_admit_now(p_code, p_pub, p_w, p_b, p_k, p_n) $$;
create function public.mesh_gate_info() returns jsonb language sql stable security invoker set search_path = '' as $$ select app.mesh_gate_info() $$;
create function public.mod_mesh_suspend(p_user uuid, p_minutes integer, p_reason text) returns jsonb
  language sql security invoker set search_path = '' as $$ select app.mod_mesh_suspend(p_user, p_minutes, p_reason) $$;
create function public.mod_mesh_lift(p_user uuid) returns jsonb language sql security invoker set search_path = '' as $$ select app.mod_mesh_lift(p_user) $$;

revoke execute on function app.mesh_admit_now(text, text, bigint, integer, integer, bigint[]), app.mesh_gate_info(),
  app.mod_mesh_suspend(uuid, integer, text), app.mod_mesh_lift(uuid) from public, anon;
grant execute on function app.mesh_admit_now(text, text, bigint, integer, integer, bigint[]), app.mesh_gate_info(),
  app.mod_mesh_suspend(uuid, integer, text), app.mod_mesh_lift(uuid) to authenticated;
revoke execute on function public.mesh_admit(text, text, bigint, integer, integer, bigint[]), public.mesh_gate_info(),
  public.mod_mesh_suspend(uuid, integer, text), public.mod_mesh_lift(uuid) from public, anon;
grant execute on function public.mesh_admit(text, text, bigint, integer, integer, bigint[]), public.mesh_gate_info(),
  public.mod_mesh_suspend(uuid, integer, text), public.mod_mesh_lift(uuid) to authenticated;
