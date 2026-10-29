-- INSERT ... RETURNING evaluates the SELECT policy against the new row, which a sub-query (app.is_member) cannot see yet.
-- Evaluate membership + band from the row's own columns instead.
drop policy conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated using (
  (select auth.uid()) in (user_a, user_b) and band = (select app.my_band())
  and app.band_of(user_a) = band and app.band_of(user_b) = band);
