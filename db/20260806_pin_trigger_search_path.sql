-- Advisor hygiene, not a vulnerability fix.
--
-- `set_updated_at` and `update_updated_at` (identical two-line trigger functions
-- that set NEW.updated_at = NOW()) had a mutable search_path. Both are SECURITY
-- INVOKER, so this was never exploitable -- the search_path lint matters for
-- SECURITY DEFINER functions, and the ones that are (create_client,
-- add_client_member, remove_client_member, get_client_members) already pin it.
--
-- Pinned anyway so the security advisor reads clean: a list of known-benign
-- warnings is how a real one gets missed.

alter function public.set_updated_at()    set search_path = public, pg_temp;
alter function public.update_updated_at() set search_path = public, pg_temp;
