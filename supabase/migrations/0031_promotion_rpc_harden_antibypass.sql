-- AIGENT-RUNTIME-PROMOTION-001 — close the anti-bypass holes the PR #19 review
-- found in the DB-layer promotion path. All three defeat the migration-0029
-- header guarantee ("a direct service_role write or a raw /rpc call with
-- stale/absent evidence can no longer reach ACTIVE — the database refuses").
-- Each is confirmed against the real code + live gpu1. Additive/idempotent.
--
-- DEFECT #3 (residual ungated overload): 0029 created the hardened function as a
--   NEW 5-arg overload — it did NOT replace the 0027 3-arg
--   promote_copilot_version(text,text,text), which has NO gate check and was
--   still GRANTed to service_role (0028). Via PostgREST a 3-key body now 300s
--   (PGRST203 ambiguous — proven live), but the ungated function is still
--   resident and callable by a direct SQL `select promote_copilot_version(a,b,c)`
--   (unambiguous in SQL). It has no legitimate consumer (the route only ever
--   calls the 5-arg form) — it is pure residual attack surface. DROP it.
--
-- DEFECT #4 (rollback exemption not self-defended): the 5-arg RPC skips the
--   fresh-gate check when p_is_rollback=true, but never checks that the target
--   is actually an already-served (archived) version — that guard lived ONLY in
--   the TS route. A direct `{p_is_rollback:true, p_version_id:<any owned draft>}`
--   flipped an un-gated draft to production+active. Enforce the archived-stage
--   precondition IN the function, so the DB (not just the route) refuses it.
--
-- DEFECT #5/#7 (contradicted/stale-by-content evidence reused): the forward
--   guard did `count(*) > 0` of fresh ready/PASS rows. promotion_gates is
--   append-only, so a later 'blocked' evaluation for the SAME (copilot,candidate)
--   never invalidated an earlier fresh PASS — within the TTL window a raw /rpc
--   call still found count>0 and promoted a candidate the most-recent evaluation
--   had rejected. Require the LATEST evaluation (order by last_evaluated_at desc)
--   to itself be ready+PASS+fresh — a newer 'blocked' row now wins.

-- ── DEFECT #3: remove the ungated 3-arg overload entirely ────────────────────
-- Safe: the app calls only the 5-arg form (promotion/route.ts sends 4 keys).
-- `drop function if exists` is idempotent; the signature is pinned to the 0027
-- overload so the hardened 5-arg function is untouched.
drop function if exists promote_copilot_version(text, text, text);

-- ── DEFECTS #4 + #5/#7: re-harden the 5-arg function body ─────────────────────
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
  v_latest_status text;
  v_latest_result text;
  v_latest_at timestamptz;
  v_candidate_stage text;
begin
  -- Self-defense: the candidate MUST belong to this copilot.
  if not exists (
    select 1 from copilot_versions where id = p_version_id and copilot_id = p_copilot_id
  ) then
    raise exception 'version % does not belong to copilot %', p_version_id, p_copilot_id;
  end if;

  if p_is_rollback then
    -- DEFECT #4 fix: a rollback is exempt from the fresh-gate requirement ONLY
    -- because it restores a version that already served production — proven by
    -- stage='archived' (the stage a promotion transition leaves on the outgoing
    -- production version). Enforce that HERE, at the DB, not only in the route.
    -- Without it, {p_is_rollback:true, p_version_id:<any owned draft>} would push
    -- an un-gated draft straight to production+active.
    select stage into v_candidate_stage from copilot_versions where id = p_version_id;
    if v_candidate_stage is distinct from 'archived' then
      raise exception
        'rollback refused: target version % is not an archived (previously-served) version (stage=%)',
        p_version_id, coalesce(v_candidate_stage, 'unknown')
        using errcode = 'check_violation';
    end if;
  else
    -- DEFECT #5/#7 fix: ANTI-BYPASS on a forward promotion. Read the MOST RECENT
    -- gate evaluation for this exact (copilot, candidate) and require IT to be
    -- ready + PASS + fresh. Using the latest row (not count(*)>0) means a newer
    -- 'blocked' evaluation — one that detected a regression after an earlier PASS
    -- — correctly refuses the promotion, instead of the stale PASS still counting.
    select overall_status, gate_result, last_evaluated_at
      into v_latest_status, v_latest_result, v_latest_at
      from promotion_gates
     where copilot_id = p_copilot_id
       and candidate_version_id = p_version_id
     order by last_evaluated_at desc
     limit 1;

    if v_latest_status is null then
      raise exception
        'promotion refused: no gate evaluation on record for copilot % version %',
        p_copilot_id, p_version_id
        using errcode = 'check_violation';
    end if;
    if v_latest_status is distinct from 'ready'
       or v_latest_result is distinct from 'PASS'
       or v_latest_at < now() - make_interval(secs => p_max_evidence_age_seconds) then
      raise exception
        'promotion refused: latest gate evaluation for copilot % version % is not a fresh PASS (status=%, result=%, evaluated_at=%)',
        p_copilot_id, p_version_id, v_latest_status, coalesce(v_latest_result, 'null'), v_latest_at
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

-- Re-assert the lock-down on the (rebuilt) 5-arg overload: service_role only.
revoke all on function promote_copilot_version(text, text, text, boolean, integer) from public;
grant execute on function promote_copilot_version(text, text, text, boolean, integer) to service_role;

notify pgrst, 'reload schema';
