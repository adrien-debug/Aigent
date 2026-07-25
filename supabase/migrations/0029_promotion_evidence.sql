-- AIGENT-RUNTIME-PROMOTION-001 — promotion evidence + DB-layer anti-bypass.
--
-- Turns PromotionGate / ShadowExperiment / ReplayComparison from dead seed rows
-- into real, persisted, RE-READ-AT-DECISION-TIME evidence, and makes the atomic
-- promotion RPC REFUSE to flip a copilot to active unless a FRESH, PASSING gate
-- evaluation exists for that exact (copilot, candidate version). A direct
-- service_role write or a raw /rpc call with stale/absent evidence can no longer
-- reach ACTIVE — the guarantee stops being "the route checks" and becomes "the
-- database refuses".
--
-- Additive + idempotent. Ends with a PostgREST schema reload.

-- ── 1) Telemetry: an event_type distinct from the lifecycle `status` ─────────
-- `status` is CHECK-locked to started/completed/failed (migration 0017). The new
-- promotion/shadow/replay events are a different axis, so they get their own
-- nullable column instead of overloading status. NULL = a plain run lifecycle
-- ping (the existing behaviour), unchanged.
alter table runtime_telemetry_events
  add column if not exists event_type text;

comment on column runtime_telemetry_events.event_type is
  'Lifecycle event kind for non-run events (shadow_started, shadow_completed, shadow_blocked_mutation, replay_started, replay_completed, promotion_evaluated, promotion_blocked, promotion_completed). NULL for a normal run lifecycle ping. experiment_id / gate_evaluation_id ride in environment jsonb.';

create index if not exists runtime_telemetry_events_event_type_idx
  on runtime_telemetry_events (event_type) where event_type is not null;

-- ── 2) tool_calls: record a mutating call that shadow BLOCKED (WOULD_MUTATE) ──
-- A shadow run must never execute a mutating tool; it records the attempt. Add
-- 'would-mutate' to the status CHECK + a boolean flag so the attempt is queryable
-- without parsing status. The CHECK is a SUPERSET of every value already present
-- in the live table (verified: 'ok','error' exist today alongside the run-path
-- values), so existing rows keep their status and nothing is invalidated.
alter table tool_calls drop constraint if exists tool_calls_status_check;
alter table tool_calls add constraint tool_calls_status_check
  check (status in ('ok','error','completed','failed','blocked','rejected','needs-confirmation','running','would-mutate'));
alter table tool_calls
  add column if not exists would_mutate boolean not null default false;

-- ── 3) promotion_gates: this is now the persisted GATE EVALUATION ledger ─────
-- It was dead seed. Give it the fields the runtime gate writes, and make the
-- (copilot, candidate) evaluation queryable + freshness-checkable. Keep the
-- existing columns; add what the real evaluator needs.
alter table promotion_gates add column if not exists gate_result text;   -- PASS | FAIL | NOT_CONFIGURED | INSUFFICIENT_EVIDENCE
alter table promotion_gates add column if not exists registry_hash text; -- registry contract fingerprint at eval time
alter table promotion_gates add column if not exists evidence_hash text; -- hash of the pinned evidence ids (tests/benchmark/shadow/replay)
create index if not exists promotion_gates_candidate_idx
  on promotion_gates (copilot_id, candidate_version_id, last_evaluated_at desc);

-- ── 4) shadow_experiments: verdict + blocked-mutation count ──────────────────
alter table shadow_experiments add column if not exists candidate_verdict text; -- PASS | FAIL | INSUFFICIENT_EVIDENCE
alter table shadow_experiments add column if not exists would_mutate_count int not null default 0;

-- ── 5) replay_comparisons: the functional verdict ───────────────────────────
alter table replay_comparisons add column if not exists verdict text; -- BETTER | EQUIVALENT | WORSE | INCONCLUSIVE

-- ── 6) HARDEN the atomic promotion RPC — DB-layer anti-bypass ────────────────
-- The route re-evaluates the gate before calling this, but a direct service_role
-- RPC call must ALSO be refused unless a fresh PASSING gate evaluation is on
-- record for this exact (copilot, candidate). "Fresh" = evaluated within
-- p_max_evidence_age_seconds (default 1h). Rollback is exempt (it restores a
-- version that already served production, proven by the archived-stage check in
-- the route) — signalled by p_is_rollback.
create or replace function promote_copilot_version(
  p_copilot_id text,
  p_version_id text,
  p_previous_prod text,
  p_is_rollback boolean default false,
  p_max_evidence_age_seconds integer default 3600
) returns void
language plpgsql
security definer
as $$
declare
  v_fresh_ready_count integer;
begin
  -- Self-defense: the candidate MUST belong to this copilot.
  if not exists (
    select 1 from copilot_versions where id = p_version_id and copilot_id = p_copilot_id
  ) then
    raise exception 'version % does not belong to copilot %', p_version_id, p_copilot_id;
  end if;

  -- ANTI-BYPASS: a forward promotion requires a FRESH, PASSING gate evaluation
  -- persisted for this exact (copilot, candidate). No row, a stale row, or a
  -- non-ready row → refuse. Rollback is exempt (already-served version).
  if not p_is_rollback then
    select count(*) into v_fresh_ready_count
      from promotion_gates
     where copilot_id = p_copilot_id
       and candidate_version_id = p_version_id
       and overall_status = 'ready'
       and gate_result = 'PASS'
       and last_evaluated_at >= now() - make_interval(secs => p_max_evidence_age_seconds);
    if v_fresh_ready_count = 0 then
      raise exception
        'promotion refused: no fresh passing gate evaluation for copilot % version % (evidence must be re-evaluated within % seconds)',
        p_copilot_id, p_version_id, p_max_evidence_age_seconds
        using errcode = 'check_violation';
    end if;
  end if;

  -- Archive the outgoing production (optimistic concurrency), promote candidate,
  -- repoint the copilot — atomically, exactly as before.
  if p_previous_prod is not null and p_previous_prod <> p_version_id then
    update copilot_versions set stage = 'archived'
     where id = p_previous_prod and stage = 'production';
  end if;

  update copilot_versions set stage = 'production' where id = p_version_id;

  update copilots
     set production_version_id = p_version_id, status = 'active'
   where id = p_copilot_id;
end;
$$;

-- Re-assert grant lock-down (0028 pattern): service_role only.
revoke all on function promote_copilot_version(text, text, text, boolean, integer) from public;

notify pgrst, 'reload schema';
