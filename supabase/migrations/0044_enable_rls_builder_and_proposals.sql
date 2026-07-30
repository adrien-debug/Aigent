-- Agent Mission Control — close a real, measured read leak.
--
-- FOUR tables carried `relrowsecurity = false` while holding an explicit
-- `GRANT SELECT ... TO anon`: `improvement_proposals` (0010),
-- `project_builder_conversations` + `project_builder_messages` (0012), and
-- `agent_drafts` (created directly on the server, see 0042's own note).
--
-- PostgREST (aigent-db.hearst.app) answers the public internet as the `anon`
-- role, so the network is not the boundary — RLS is. Measured 2026-07-30 with an
-- unauthenticated request: `project_builder_messages` returned all 269 rows and
-- `project_builder_conversations` all 25, while every RLS-enabled table returned
-- nothing. `improvement_proposals` and `agent_drafts` were empty, so they leaked
-- nothing yet — they would have, on their first row.
--
-- Reads only: keyless INSERT/DELETE already failed, `anon` holds SELECT alone.
--
-- Two independent fixes, deliberately. RLS is the boundary the rest of this
-- schema relies on; the anon GRANT is separately revoked because it was never
-- in any migration — it came from a blanket grant applied outside version
-- control, and leaving it would keep the hole one `disable row level security`
-- away from reopening. `service_role` (which the server uses, and which bypasses
-- RLS) is re-granted defensively, matching the pattern used since 0014.
--
-- No policy is added on purpose: deny-by-default is the point.

alter table improvement_proposals enable row level security;
alter table project_builder_conversations enable row level security;
alter table project_builder_messages enable row level security;
alter table agent_drafts enable row level security;

revoke select on improvement_proposals from anon;
revoke select on project_builder_conversations from anon;
revoke select on project_builder_messages from anon;
revoke select on agent_drafts from anon;

grant select, insert, update, delete on improvement_proposals to service_role;
grant select, insert, update, delete on project_builder_conversations to service_role;
grant select, insert, update, delete on project_builder_messages to service_role;
grant select, insert, update, delete on agent_drafts to service_role;

notify pgrst, 'reload schema';
