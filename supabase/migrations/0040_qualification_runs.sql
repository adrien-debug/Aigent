-- AIGENT-AUTONOMOUS-FACTORY-001 — qualification orchestration state.
--
-- The single, version-scoped record of a candidate's qualification WORKFLOW:
-- the ordered walk tests → benchmark → shadow → replay → gate, its cursor, and
-- the honest per-step status. This table is the WORKFLOW LEDGER only — it never
-- duplicates proof. The proof itself stays in its owning tables (test_runs,
-- benchmark_runs, promotion_gates, shadow_experiments, replay_comparisons); a
-- step row here carries at most an `evidenceRef` pointing back at the row the
-- engine persisted. So `promotion_gates` remains THE authority the promote RPC
-- re-reads (migration 0033); this table can never make a version promotable on
-- its own.
--
-- Design invariants this schema enforces at the DB layer:
--   * IDEMPOTENT START — a caller-supplied client_run_id is unique per copilot
--     (mirrors agent_runs.client_run_id, migration 0027), so a double-submitted
--     "start qualification" collapses to one row (23505 → the app returns the
--     existing run).
--   * ONE ACTIVE RUN PER VERSION — a partial unique index on (copilot_version_id)
--     WHERE status='running' makes two concurrent in-flight runs for the same
--     candidate impossible; the loser 23505s and resumes the existing run. A
--     terminal run (blocked/promotable/superseded/aborted) leaves the index, so a
--     later re-qualification of the same version can start a fresh run.
--   * VERSION-SCOPED — copilot_version_id FK + a NOT NULL copilot_id, both ON
--     DELETE CASCADE, so deleting the copilot or its version removes the run (a
--     candidate archived/deleted mid-workflow can never leave a dangling run).
--   * CANDIDATE-MUTATION RESISTANT — candidate_fingerprint pins the manifest +
--     tool_ids + model observed when the run started; the orchestrator recomputes
--     it before each step and marks the run 'superseded' on drift (the app guard;
--     the column is what makes that check possible).
--
-- No ownership column: this repo has a single admin identity gated in
-- src/proxy.ts (there is no per-resource owner). Scope is by the copilot_version
-- FK; IDOR is prevented in the route/service by verifying the version belongs to
-- the copilot before any read/write.
--
-- Additive + idempotent. Ends with a PostgREST schema reload.

create table if not exists qualification_runs (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  copilot_version_id text not null references copilot_versions(id) on delete cascade,
  -- Optional caller idempotency key (mirrors agent_runs.client_run_id, 0027).
  client_run_id text,
  -- Hash of {manifest system prompt/forbidden/output contract/confirmation/step+
  -- cost budgets, manifest tool_ids, version model+provider} at start. Drift →
  -- the candidate changed under the running workflow → run is superseded.
  candidate_fingerprint text not null,
  -- running | blocked | promotable | superseded | aborted
  status text not null default 'running',
  -- next step to execute: tests | benchmark | shadow | replay | gate | done
  step_cursor text not null default 'tests',
  -- append-only array of {step, status, reason, evidenceRef, sourceOfTruth, at}.
  steps jsonb not null default '[]',
  -- {requireShadow, requireReplay} — the promotion policy this run qualifies under.
  policy jsonb not null default '{"requireShadow":false,"requireReplay":false}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent start: a client_run_id is unique per copilot; NULLs stay distinct
-- so keyless starts are unaffected (same shape as agent_runs, migration 0027).
create unique index if not exists qualification_runs_copilot_client_run_id_key
  on qualification_runs (copilot_id, client_run_id)
  where client_run_id is not null;

-- At most ONE in-flight run per candidate version. A concurrent second start
-- 23505s and the app resumes the existing run instead of forking the workflow.
create unique index if not exists qualification_runs_one_active_per_version
  on qualification_runs (copilot_version_id)
  where status = 'running';

-- Read the latest run for a (copilot, version) fast — the observability query.
create index if not exists qualification_runs_version_created_idx
  on qualification_runs (copilot_id, copilot_version_id, created_at desc);

-- RLS enabled with no policies: service_role reaches the table via BYPASSRLS,
-- exactly like every other agent-ops table (mission_runs, promotion_gates…).
-- New tables are NOT covered by 0001's blanket grant — grant explicitly.
alter table qualification_runs enable row level security;
grant select, insert, update, delete on qualification_runs to service_role;

notify pgrst, 'reload schema';
