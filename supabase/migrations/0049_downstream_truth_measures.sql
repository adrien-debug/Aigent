-- 0049_downstream_truth_measures.sql
-- AIGENT-SUPERVISED-CONVERGENCE-001 — downstream truth measures.
--
-- AGENTS.md forbids measurement columns from being `NOT NULL DEFAULT 0`: such a
-- constraint structurally coerces an unmeasured absence into a measured zero.
-- Audits A1/A2 found three remaining columns:
--   - shadow_experiments.would_mutate_count      (added in 0029_promotion_evidence.sql)
--   - benchmark_suites.accuracy                  (seeded in 0001_agent_mission_control.sql)
--   - benchmark_suites.avg_cost_per_task_usd     (seeded in 0001_agent_mission_control.sql)
--
-- This migration makes them nullable and drops their default so writers that have
-- nothing to report persist NULL, and readers can tell "not measured" from "zero".
--
-- Additive, idempotent, no data loss. No tables are dropped.

-- Guard: this migration must be applied immediately after 0048.
-- If the migrations tracking table is not present (local tools, one-off restores),
-- the guard is skipped; otherwise it asserts the previous applied version.
do $$
declare
  v_last_version text;
  v_last_name text;
  v_last_num text;
begin
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    select version, name
      into v_last_version, v_last_name
      from supabase_migrations.schema_migrations
      order by version desc
      limit 1;

    v_last_num := coalesce(
      substring(v_last_version from '^([0-9]+)'),
      substring(v_last_name from '^([0-9]+)')
    );

    if v_last_num is null or v_last_num <> '0048' then
      raise exception 'migration 0049 requires the previous applied migration to be 0048; found % (%)', v_last_version, v_last_name;
    end if;
  end if;
end $$;

-- shadow_experiments: would_mutate_count is a safety counter measured by a shadow run.
-- Unmeasured must stay NULL, never 0 (which would read as "proven clean").
alter table shadow_experiments alter column would_mutate_count drop not null;
alter table shadow_experiments alter column would_mutate_count drop default;

-- benchmark_suites: accuracy is a suite-level measurement. It is not known at
-- suite creation time and must not default to 0.
alter table benchmark_suites alter column accuracy drop not null;
alter table benchmark_suites alter column accuracy drop default;

-- benchmark_suites: avg_cost_per_task_usd is likewise measured by runs, not seeded.
alter table benchmark_suites alter column avg_cost_per_task_usd drop not null;
alter table benchmark_suites alter column avg_cost_per_task_usd drop default;

notify pgrst, 'reload schema';
