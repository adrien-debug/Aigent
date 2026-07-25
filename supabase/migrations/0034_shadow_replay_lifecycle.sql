-- AIGENT-FACTORY-SHADOW-REPLAY-001 — async trigger→poll lifecycle for shadow
-- and replay evidence, plus the real DB-layer concurrency control the routes
-- rely on.
--
-- WHY A NEW STATUS AT ALL: today shadow_experiments.status is
-- running|completed|stopped and replay_comparisons.status is
-- draft|ready|diverged|matched (the latter mapped from the FUNCTIONAL VERDICT
-- by replay.ts's verdictToStatus, not from a lifecycle state at all — there is
-- no status value in either table meaning "a shadow/replay is currently being
-- computed for this candidate, do not start a second one"). The new API routes
-- launch shadow/replay ASYNC-shaped (insert a placeholder row, run the engine,
-- update the row) so a client can poll instead of holding the HTTP request
-- open for the full corpus run. That needs a real "in progress" state:
--   shadow_experiments:  add 'queued' — the row exists, the engine has not
--     started/finished executing the corpus yet. ('running' already exists in
--     the original CHECK and continues to mean "in progress", so 'queued' only
--     covers the brief pre-execution window; both are treated as "in progress"
--     by the partial unique index below.)
--   replay_comparisons:  add 'queued' and 'running' — this table had NO
--     in-progress state before ('draft' is closest but is never emitted by
--     replay.ts today), so both are added: 'queued' before the engine starts,
--     'running' while the corpus is being replayed. Terminal states remain
--     ready|diverged|matched (written by persistReplayComparison via
--     verdictToStatus) plus 'draft' (kept for backward compatibility with any
--     existing seed/UI reference).
--
-- Both CHECK replacements are strict supersets of the existing allowed values
-- — no existing row's status is invalidated.
--
-- Additive + idempotent. Never touches 0001-0033. Ends with a schema reload.

alter table shadow_experiments drop constraint if exists shadow_experiments_status_check;
alter table shadow_experiments add constraint shadow_experiments_status_check
  check (status in ('queued', 'running', 'completed', 'stopped', 'failed'));

alter table replay_comparisons drop constraint if exists replay_comparisons_status_check;
alter table replay_comparisons add constraint replay_comparisons_status_check
  check (status in ('draft', 'queued', 'running', 'ready', 'diverged', 'matched', 'failed'));

-- ── REAL concurrency control ─────────────────────────────────────────────────
-- A partial UNIQUE index, not an application check-then-act: two concurrent
-- POSTs racing to insert a queued/running row for the SAME (copilot, candidate)
-- collide at the DATABASE, and the loser gets a real 23505 the route surfaces
-- as a structured 409. An app-level "read then insert" guard has a race window
-- between the read and the insert; this index has none.
create unique index if not exists shadow_experiments_one_inflight_per_candidate
  on shadow_experiments (copilot_id, candidate_version_id)
  where status in ('queued', 'running');

create unique index if not exists replay_comparisons_one_inflight_per_candidate
  on replay_comparisons (copilot_id, candidate_version_id)
  where status in ('queued', 'running');

-- ── Minimal audit column, mirroring the established `triggered_by` pattern ───
-- test_runs.triggered_by (migration 0001) is the existing precedent for "who/
-- what kicked this evidence run off" — a free-text label, not a user/session
-- table (this repo has no such concept yet; do not invent one). Nullable so
-- existing rows and any caller that doesn't pass it are unaffected.
alter table shadow_experiments add column if not exists triggered_by text;
alter table replay_comparisons add column if not exists triggered_by text;

notify pgrst, 'reload schema';
