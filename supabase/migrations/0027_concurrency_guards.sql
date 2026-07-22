-- AIGENT-STABILITY — DB-level concurrency guards (idempotency, single-production,
-- atomic promotion).
--
-- Three proven concurrency hazards get a database backstop so the app can no
-- longer create inconsistent state under a race, regardless of app-instance
-- count. All additive and safe on the current data (0 production rows, no
-- client_run_id yet). Idempotent.
--
-- 1) DUPLICATE RUN INGESTION. POST .../runs/ingest minted a fresh runId per call
--    with no dedup, so a retried delivery double-counted cost & volume KPIs
--    (proven: two concurrent identical POSTs -> two rows). Add an optional
--    caller-supplied `client_run_id` + a UNIQUE index scoped to the copilot;
--    NULLs stay distinct, so keyless runs are unaffected and the route can
--    upsert-on-conflict to be idempotent.
alter table agent_runs add column if not exists client_run_id text;

create unique index if not exists agent_runs_copilot_client_run_id_key
  on agent_runs (copilot_id, client_run_id)
  where client_run_id is not null;

-- 2) TWO PRODUCTION VERSIONS. A partial UNIQUE index makes "two production rows
--    for one copilot" impossible; a losing concurrent promote fails 23505, which
--    the route maps to 409 instead of leaving a lying production pointer.
create unique index if not exists copilot_versions_one_production_per_copilot
  on copilot_versions (copilot_id)
  where stage = 'production';

-- 3) NON-ATOMIC PROMOTION. The promote/rollback transition was 3 independent
--    PostgREST PATCHes with no transaction — a mid-sequence failure or a
--    concurrent promote could leave partial/inconsistent state. Move all three
--    writes into ONE transaction (a plpgsql function = one transaction): archive
--    the outgoing production, promote the candidate, repoint the copilot. If the
--    candidate promote violates the single-production index (a concurrent
--    winner), the WHOLE function rolls back — including the archive — so the
--    copilot is never left with zero or two production versions. The app calls
--    it once via PostgREST /rpc.
create or replace function promote_copilot_version(
  p_copilot_id text,
  p_version_id text,
  p_previous_prod text
) returns void
language plpgsql
security definer
as $$
begin
  -- Archive the version currently serving production (if distinct), conditioned
  -- on it still being production (optimistic concurrency).
  if p_previous_prod is not null and p_previous_prod <> p_version_id then
    update copilot_versions
       set stage = 'archived'
     where id = p_previous_prod and stage = 'production';
  end if;

  -- Promote the candidate. The partial-unique index rejects this (23505) if a
  -- concurrent promote already claimed production — rolling back the archive too.
  update copilot_versions
     set stage = 'production'
   where id = p_version_id;

  -- Point the copilot at the new production version + align stored status.
  update copilots
     set production_version_id = p_version_id,
         status = 'active'
   where id = p_copilot_id;
end;
$$;
