-- 0047_measurement_columns_nullable
--
-- Purpose:
-- Stop the schema from turning an ABSENCE OF MEASUREMENT into a measured zero.
--
-- `AGENTS.md` states the invariant plainly: "Une colonne de mesure est
-- nullable. `NOT NULL DEFAULT 0` sur une métrique transforme structurellement
-- une absence en zéro." It is stricter still for safety counters: "Un compteur
-- de sécurité non mesuré ne vaut jamais 0. Zéro signifie « mesuré, et propre »
-- — l'affirmation la plus forte du système."
--
-- 23 measurement columns across 9 tables violated that invariant. A run that
-- never completed, a benchmark that never scored, a shadow that never sampled
-- all persisted `0` — indistinguishable from "measured, and clean". Five of
-- them are safety counters, where the false zero reads as a proof of innocence:
--   agent_runs.unsafe_attempt_count
--   benchmark_results.unsafe_action_count
--   benchmark_results.unauthorized_route_count
--   benchmark_results.confirmation_mistake_count
--   shadow_experiments.unsafe_proposal_count
--
-- After this migration a writer that has nothing to report writes NULL, and a
-- reader can tell "not measured" from "measured zero".
--
-- NOT touched, deliberately: `benchmark_suites.task_count` is DEFINITIONAL, not
-- a measurement — it is how many tasks the suite declares, written at suite
-- creation and read as the cap for a run. It stays NOT NULL.
--
-- HONEST LIMIT — read this before trusting old rows:
-- This migration CANNOT retroactively separate a measured 0 from a defaulted 0.
-- Every row written before it keeps an ambiguous 0. The distinction only holds
-- for rows written from here on. Backfilling to NULL was rejected: it would
-- destroy real measurements to fix presentation of fake ones.
--
-- Additive, non-destructive, idempotent. No data is read, rewritten or dropped:
-- DROP NOT NULL and DROP DEFAULT only relax a constraint. Re-running is a no-op.

-- ── Safety counters — the most severe of the family ──────────────────────────

alter table agent_runs            alter column unsafe_attempt_count       drop not null;
alter table agent_runs            alter column unsafe_attempt_count       drop default;

alter table benchmark_results     alter column unsafe_action_count        drop not null;
alter table benchmark_results     alter column unsafe_action_count        drop default;

alter table benchmark_results     alter column unauthorized_route_count   drop not null;
alter table benchmark_results     alter column unauthorized_route_count   drop default;

alter table benchmark_results     alter column confirmation_mistake_count drop not null;
alter table benchmark_results     alter column confirmation_mistake_count drop default;

alter table shadow_experiments    alter column unsafe_proposal_count      drop not null;
alter table shadow_experiments    alter column unsafe_proposal_count      drop default;

-- ── Cost ─────────────────────────────────────────────────────────────────────

alter table agent_runs            alter column cost_usd                   drop not null;
alter table agent_runs            alter column cost_usd                   drop default;

alter table test_results          alter column cost_usd                   drop not null;
alter table test_results          alter column cost_usd                   drop default;

alter table test_runs             alter column total_cost_usd             drop not null;
alter table test_runs             alter column total_cost_usd             drop default;

alter table benchmark_results     alter column total_cost_usd             drop not null;
alter table benchmark_results     alter column total_cost_usd             drop default;

alter table improvement_proposals alter column cost_usd                   drop not null;
alter table improvement_proposals alter column cost_usd                   drop default;

-- ── Latency and duration ─────────────────────────────────────────────────────

alter table agent_runs            alter column latency_ms                 drop not null;
alter table agent_runs            alter column latency_ms                 drop default;

alter table test_results          alter column latency_ms                 drop not null;
alter table test_results          alter column latency_ms                 drop default;

alter table tool_calls            alter column latency_ms                 drop not null;
alter table tool_calls            alter column latency_ms                 drop default;

alter table agent_run_steps       alter column duration_ms                drop not null;
alter table agent_run_steps       alter column duration_ms                drop default;

alter table benchmark_results     alter column avg_latency_ms             drop not null;
alter table benchmark_results     alter column avg_latency_ms             drop default;

alter table benchmark_results     alter column p95_latency_ms             drop not null;
alter table benchmark_results     alter column p95_latency_ms             drop default;

-- ── Rates and scores ─────────────────────────────────────────────────────────

alter table test_runs             alter column pass_rate                  drop not null;
alter table test_runs             alter column pass_rate                  drop default;

alter table benchmark_results     alter column task_success_rate          drop not null;
alter table benchmark_results     alter column task_success_rate          drop default;

alter table benchmark_results     alter column score                      drop not null;
alter table benchmark_results     alter column score                      drop default;

alter table shadow_experiments    alter column agreement_rate             drop not null;
alter table shadow_experiments    alter column agreement_rate             drop default;

-- ── Sample and case counts ───────────────────────────────────────────────────

alter table agent_runs            alter column tool_call_count            drop not null;
alter table agent_runs            alter column tool_call_count            drop default;

alter table shadow_experiments    alter column sampled_run_count          drop not null;
alter table shadow_experiments    alter column sampled_run_count          drop default;

alter table replay_comparisons    alter column case_count                 drop not null;
alter table replay_comparisons    alter column case_count                 drop default;
