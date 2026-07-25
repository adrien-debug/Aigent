-- AIGENT-RUNTIME-PROMOTION-001 — close the two DB bypasses the 74257ea review
-- found. Confirmed live against gpu1 BEFORE this migration:
--
--   REWORK 2 (P0 direct write): the app's DB role `service_role` (rolbypassrls=t,
--     full UPDATE grant on copilots/copilot_versions) can flip a copilot to
--     status='active' + set a version to stage='production' DIRECTLY — via raw
--     SQL AND via PostgREST PATCH (proven: PATCH /copilots?... {status:active} →
--     200, row became active). RLS is useless (BYPASSRLS). So 0029's claim "a
--     direct service_role write can no longer reach ACTIVE" was FALSE.
--
--   REWORK 1 (caller-controlled TTL): promote_copilot_version took
--     p_max_evidence_age_seconds and used it verbatim, so a direct caller could
--     pass 999999999 and reuse an hours-old PASS. Security freshness must never
--     be loosened by the caller.
--
-- FIX MODEL (works despite BYPASSRLS — a trigger is NOT bypassed by BYPASSRLS):
--   * A BEFORE-UPDATE trigger on copilots/copilot_versions REFUSES a transition
--     INTO status='active' / stage='production' UNLESS the statement runs inside
--     the official RPC, signalled by a transaction-local GUC `app.promotion='rpc'`
--     that ONLY the SECURITY DEFINER RPC sets (SET LOCAL, invisible outside its
--     own transaction; a direct caller cannot pre-set it because SET LOCAL is
--     scoped to the RPC's own transaction and reset on commit/rollback).
--   * The RPC now clamps the TTL to a hard server maximum and fail-closes on a
--     non-positive value; the caller can only ever SHORTEN the window.
--   * Both functions pin a safe search_path (SECURITY DEFINER hardening).
--   * The forward-gate read gets a deterministic tie-break (last_evaluated_at
--     desc, id desc) so equal timestamps never make "the latest" ambiguous.
--
-- The RPC keeps working (SECURITY DEFINER, owner=postgres, sets the GUC). The
-- direct path is refused at the DB for the real app role. Additive/idempotent.

-- ── 1) The transition guard trigger function ─────────────────────────────────
-- Refuses an UPDATE that MOVES a row INTO the live state (active / production)
-- unless the official RPC set the transaction-local marker. Any other column
-- change (assistant_id, latest_version_id, last_push_*, a NON-live status/stage,
-- an archive during rollback made BY the rpc) passes untouched. Rows that are
-- already active/production and stay so are not re-guarded (idempotent updates
-- like `updated_at` on an active copilot keep working).
create or replace function enforce_promotion_via_rpc()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Only the official RPC sets this transaction-local marker.
  if coalesce(current_setting('app.promotion', true), '') = 'rpc' then
    return new;
  end if;

  if tg_table_name = 'copilots' then
    -- Block a transition INTO active. Leaving/keeping any other status is fine.
    if new.status = 'active' and old.status is distinct from 'active' then
      raise exception
        'direct transition to status=active is forbidden — promote via promote_copilot_version() (copilot %)', new.id
        using errcode = 'insufficient_privilege';
    end if;
    -- Block a direct repoint of production_version_id (the pointer that makes a
    -- version "the served one") unless via the RPC.
    if new.production_version_id is distinct from old.production_version_id
       and new.production_version_id is not null then
      raise exception
        'direct change of production_version_id is forbidden — promote via promote_copilot_version() (copilot %)', new.id
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'copilot_versions' then
    -- Block a transition INTO production stage.
    if new.stage = 'production' and old.stage is distinct from 'production' then
      raise exception
        'direct transition to stage=production is forbidden — promote via promote_copilot_version() (version %)', new.id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_copilots_promotion_guard on copilots;
create trigger trg_copilots_promotion_guard
  before update on copilots
  for each row execute function enforce_promotion_via_rpc();

drop trigger if exists trg_versions_promotion_guard on copilot_versions;
create trigger trg_versions_promotion_guard
  before update on copilot_versions
  for each row execute function enforce_promotion_via_rpc();

-- ── 2) Re-harden the RPC: set the GUC, clamp the TTL, pin search_path, tie-break ─
create or replace function promote_copilot_version(
  p_copilot_id text,
  p_version_id text,
  p_previous_prod text,
  p_is_rollback boolean default false,
  p_max_evidence_age_seconds integer default 3600
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  -- HARD server maximum freshness window. The caller can only SHORTEN it.
  c_max_ttl_seconds constant integer := 3600;
  v_ttl_seconds integer;
  v_latest_status text;
  v_latest_result text;
  v_latest_at timestamptz;
  v_candidate_stage text;
begin
  -- Authorize the transition guard for THIS transaction only. SET LOCAL is reset
  -- at commit/rollback and is invisible to any other session/transaction, so a
  -- direct caller cannot pre-set it to sneak a raw UPDATE past the trigger.
  perform set_config('app.promotion', 'rpc', true);

  -- Self-defense: the candidate MUST belong to this copilot.
  if not exists (
    select 1 from copilot_versions where id = p_version_id and copilot_id = p_copilot_id
  ) then
    raise exception 'version % does not belong to copilot %', p_version_id, p_copilot_id;
  end if;

  if p_is_rollback then
    -- Rollback is exempt from the fresh-gate check ONLY for an already-served
    -- (archived) version; enforce the archived precondition at the DB.
    select stage into v_candidate_stage from copilot_versions where id = p_version_id;
    if v_candidate_stage is distinct from 'archived' then
      raise exception
        'rollback refused: target version % is not an archived (previously-served) version (stage=%)',
        p_version_id, coalesce(v_candidate_stage, 'unknown')
        using errcode = 'check_violation';
    end if;
  else
    -- REWORK 1: the effective freshness window is server-authoritative. A NULL or
    -- non-positive request falls back to the max; anything larger is clamped DOWN
    -- to the max. The caller can never widen the window beyond c_max_ttl_seconds.
    if p_max_evidence_age_seconds is null or p_max_evidence_age_seconds <= 0 then
      v_ttl_seconds := c_max_ttl_seconds;
    else
      v_ttl_seconds := least(p_max_evidence_age_seconds, c_max_ttl_seconds);
    end if;

    -- Read the MOST RECENT gate evaluation for this exact (copilot, candidate).
    -- Deterministic tie-break on id so equal last_evaluated_at is never ambiguous.
    -- now() is the DB clock; the freshness comparison never trusts a client date.
    select overall_status, gate_result, last_evaluated_at
      into v_latest_status, v_latest_result, v_latest_at
      from promotion_gates
     where copilot_id = p_copilot_id
       and candidate_version_id = p_version_id
     order by last_evaluated_at desc, id desc
     limit 1;

    if v_latest_status is null then
      raise exception
        'promotion refused: no gate evaluation on record for copilot % version %',
        p_copilot_id, p_version_id
        using errcode = 'check_violation';
    end if;
    if v_latest_status is distinct from 'ready'
       or v_latest_result is distinct from 'PASS'
       or v_latest_at < now() - make_interval(secs => v_ttl_seconds) then
      raise exception
        'promotion refused: latest gate evaluation for copilot % version % is not a fresh PASS within % s (status=%, result=%, evaluated_at=%)',
        p_copilot_id, p_version_id, v_ttl_seconds, v_latest_status, coalesce(v_latest_result, 'null'), v_latest_at
        using errcode = 'check_violation';
    end if;
  end if;

  -- Atomic transition (guarded trigger lets these through because the GUC is set).
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

-- Lock the RPC down to service_role (unchanged intent, re-asserted).
revoke all on function promote_copilot_version(text, text, text, boolean, integer) from public;
grant execute on function promote_copilot_version(text, text, text, boolean, integer) to service_role;

notify pgrst, 'reload schema';
