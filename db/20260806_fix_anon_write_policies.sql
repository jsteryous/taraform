-- Remove anonymous write access to the blog/marketing tables.
--
-- image_library, insights and used_topics each carried two policies named for
-- service_role -- "service role full access" and "service_rw" -- but declared
-- TO public with USING (true) and WITH CHECK (true). `public` includes `anon`,
-- and the anon key ships in the public JS bundle, so the effective grant was
-- "anyone on the internet may INSERT, UPDATE and DELETE these tables."
--
-- Proven 2026-08-06 as role `anon`, no login, rolled back:
--   delete from image_library -> 183 rows
--   delete from used_topics   ->  13 rows
--   insert into used_topics   -> ALLOWED
--
-- The policies were also pointless for their stated purpose: service_role
-- BYPASSES RLS, so it never needed a policy. They only ever granted access to
-- the roles they were meant to exclude.
--
-- Public SELECT is preserved: this repo (the CRM) never reads these tables --
-- they belong to the separate blog/marketing project, which may well read them
-- with the anon key. Writes are what get removed.

begin;

drop policy if exists "service role full access" on image_library;
drop policy if exists "service_rw"              on image_library;
drop policy if exists "service role full access" on insights;
drop policy if exists "service_rw"              on insights;
drop policy if exists "service role full access" on used_topics;
drop policy if exists "service_rw"              on used_topics;

create policy "public read" on image_library
  for select to anon, authenticated using (true);
create policy "public read" on insights
  for select to anon, authenticated using (true);
create policy "public read" on used_topics
  for select to anon, authenticated using (true);

commit;
