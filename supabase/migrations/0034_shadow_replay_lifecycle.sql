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

-- ── PROVENANCE — fail-closed, REQUIRED at write time (PR #22 review rework) ──
-- The review found the actual bypass: the API routes persist fixture-driven
-- runs with the SAME status/verdict vocabulary a genuine LangGraph run would
-- get (`status='completed'`, `candidate_verdict='PASS'`, `verdict='BETTER'`),
-- and evaluatePromotionGate's shadowCheck/replayCheck read ONLY that
-- status/verdict — never asking "who actually produced this evidence". A $0
-- deterministic fixture run and a real, billed LangGraph run were
-- INDISTINGUISHABLE to the gate. That is a live promotion-gate bypass, not a
-- cosmetic gap: a required shadow/replay check could be satisfied by a
-- simulation with zero external effect.
--
-- Fix: every row now carries WHO produced it, in a closed vocabulary:
--   'live_langgraph'        — a real run through the LangGraph Agent Server,
--                             using the candidate's OWN provisioned manifest.
--                             The ONLY value a REQUIRED check may accept.
--   'deterministic_fixture' — the $0, zero-network scripted fixture
--                             (makeFixtureShadowAgent / the replay
--                             fixtureOutcome helper). Real code, real gate
--                             logic, zero external effect, but NOT a
--                             production-grade proof of the candidate's real
--                             behavior — it proves the MACHINERY, not the
--                             CANDIDATE.
--   'legacy_unknown'        — a pre-existing row written before this column
--                             existed, or a row whose provenance cannot be
--                             determined. Treated identically to a fixture:
--                             NEVER accepted for a required check. This is
--                             the fail-closed backstop — an ambiguous row
--                             must never be interpreted as evidence.
--
-- NOT NULL with a DEFAULT: every existing row (all fixture-backed, from this
-- same feature's proof scripts and offline tests — nothing in this repo has
-- ever written a live LangGraph shadow/replay row) backfills to
-- 'legacy_unknown' rather than silently becoming 'live_langgraph' by
-- omission. A caller that forgets to pass execution_mode gets the SAFEST
-- value, never the one that would satisfy a gate.
alter table shadow_experiments add column if not exists execution_mode text;
update shadow_experiments set execution_mode = 'legacy_unknown' where execution_mode is null;
alter table shadow_experiments alter column execution_mode set default 'legacy_unknown';
alter table shadow_experiments alter column execution_mode set not null;
alter table shadow_experiments drop constraint if exists shadow_experiments_execution_mode_check;
alter table shadow_experiments add constraint shadow_experiments_execution_mode_check
  check (execution_mode in ('live_langgraph', 'deterministic_fixture', 'legacy_unknown'));

alter table replay_comparisons add column if not exists execution_mode text;
update replay_comparisons set execution_mode = 'legacy_unknown' where execution_mode is null;
alter table replay_comparisons alter column execution_mode set default 'legacy_unknown';
alter table replay_comparisons alter column execution_mode set not null;
alter table replay_comparisons drop constraint if exists replay_comparisons_execution_mode_check;
alter table replay_comparisons add constraint replay_comparisons_execution_mode_check
  check (execution_mode in ('live_langgraph', 'deterministic_fixture', 'legacy_unknown'));

comment on column shadow_experiments.execution_mode is
  'Provenance of this evidence — live_langgraph | deterministic_fixture | legacy_unknown. Only live_langgraph may satisfy a REQUIRED promotion-gate check (see promotion-gate.ts shadowCheck). Fail-closed default legacy_unknown.';
comment on column replay_comparisons.execution_mode is
  'Provenance of this evidence — live_langgraph | deterministic_fixture | legacy_unknown. Only live_langgraph may satisfy a REQUIRED promotion-gate check (see promotion-gate.ts replayCheck). Fail-closed default legacy_unknown.';

notify pgrst, 'reload schema';
