-- AIGENT-DETERMINISTIC-EVIDENCE-001 — provenance of test/benchmark evidence.
--
-- Until now a `test_runs` / `benchmark_runs` row carried no signal about HOW its
-- evidence was produced. A real billed LLM run and a $0 deterministic-fixture run
-- (the offline proof path introduced by this chantier) persisted byte-identical
-- rows through the SAME official runners — good for gate fidelity, but it left no
-- way to tell a paid proof from a fixture proof after the fact.
--
-- This adds an explicit, un-foolable provenance label on the RUN row (not the
-- result row): `execution_mode`.
--   'live'                 → a real run whose agent + judge legs were billed LLM
--                            calls (the DEFAULT, so every existing row backfills
--                            to 'live' — which is exactly what they were).
--   'deterministic-fixture'→ produced by the injected deterministic executor: no
--                            billed LLM call, reproducible outputs, real certified
--                            tool execution. NEVER writable in production (the
--                            fail-closed guard blocks the executor's construction
--                            there — see evidence/guard.ts), so this value can only
--                            appear from a test / CI / proof-script / explicit-local
--                            context.
--
-- Additive + idempotent + safe: NOT NULL with a DEFAULT so no existing row breaks
-- and no runner insert is forced to change on the live path. The CHECK bounds the
-- domain to exactly the two known modes — a typo or an unlabelled third mode is
-- refused by the database, not silently accepted.
--
-- NOTE: this is provenance, not access control. The lockdown that keeps a
-- deterministic run out of production is the application guard; the DB column only
-- records, honestly and durably, which path a row came from.

alter table test_runs
  add column if not exists execution_mode text not null default 'live';

alter table benchmark_runs
  add column if not exists execution_mode text not null default 'live';

-- Bound the domain. Dropped-then-added so re-running the migration re-asserts the
-- exact predicate rather than failing on a pre-existing constraint of the same name.
alter table test_runs drop constraint if exists test_runs_execution_mode_check;
alter table test_runs
  add constraint test_runs_execution_mode_check
  check (execution_mode in ('live', 'deterministic-fixture'));

alter table benchmark_runs drop constraint if exists benchmark_runs_execution_mode_check;
alter table benchmark_runs
  add constraint benchmark_runs_execution_mode_check
  check (execution_mode in ('live', 'deterministic-fixture'));

comment on column test_runs.execution_mode is
  'Provenance of this run: live (billed LLM run) or deterministic-fixture (injected deterministic executor, $0, never writable in production). Default live so historical rows are truthfully labelled.';
comment on column benchmark_runs.execution_mode is
  'Provenance of this run: live (billed LLM run) or deterministic-fixture (injected deterministic executor, $0, never writable in production). Default live so historical rows are truthfully labelled.';

-- Ask PostgREST to reload its schema cache so the new column is selectable/insertable immediately.
notify pgrst, 'reload schema';
