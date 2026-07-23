-- AIGENT-SECURITY — lock down the SECURITY DEFINER promotion RPC.
--
-- 0027 created promote_copilot_version(text, text, text) as SECURITY DEFINER but
-- relied on Postgres' DEFAULT execute grant, which is PUBLIC. A SECURITY DEFINER
-- function runs with the OWNER's privileges, so a PUBLIC EXECUTE means ANY role
-- reachable through PostgREST /rpc (anon, authenticated, …) could promote a
-- copilot version with owner-level rights — bypassing RLS and the app's
-- fail-closed promotion route entirely. This is a privilege-escalation surface.
--
-- This migration removes the default PUBLIC grant and re-grants EXECUTE to the
-- single application role, matching this repo's deny-by-default doctrine: every
-- table is service_role-only (0001, 0010, 0012, 0014–0017, 0019), there are zero
-- anon/authenticated/authenticator grants anywhere, and all app DB access flows
-- through service_role (which bypasses RLS). The RPC must follow the same rule.
--
-- Idempotent: REVOKE is a no-op if the grant is already gone; GRANT is a no-op if
-- already present. The signature (three text args) is pinned to 0027 so this
-- targets exactly that overload and not some future same-named function.

-- Strip the implicit PUBLIC EXECUTE that Postgres attaches on function creation.
revoke execute on function public.promote_copilot_version(text, text, text) from public;

-- Grant EXECUTE only to the application role. service_role bypasses RLS and is the
-- sole role the server uses to reach PostgREST /rpc; no anon/authenticated access.
grant execute on function public.promote_copilot_version(text, text, text) to service_role;
