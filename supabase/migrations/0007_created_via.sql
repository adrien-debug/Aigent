-- Regularise the `created_via` column, added directly on the running DB (gpu1)
-- but never captured in a migration — a schema drift. The authoring flow writes
-- created_via='authoring' on every insert into agent_runs (runner.ts) and copilots
-- (authoring-writes.ts); a DB rebuilt purely from these migrations would lack the
-- column, so those POSTs would fail (PGRST 400, unknown column). This migration is
-- additive and non-destructive: it only adds the column where it is missing.

alter table agent_runs add column if not exists created_via text;
alter table copilots add column if not exists created_via text;
