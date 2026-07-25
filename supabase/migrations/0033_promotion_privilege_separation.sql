-- AIGENT-RUNTIME-PROMOTION-001 — replace the FORGEABLE GUC marker (0032) with a
-- real privilege boundary that service_role cannot simulate.
--
-- THE DEFECT (confirmed live vs gpu1, as the real app role service_role):
--   0032's trigger allowed a transition when current_setting('app.promotion')='rpc'.
--   But service_role can set that value itself:
--     set role service_role;
--     select set_config('app.promotion','rpc',true);
--     update copilot_versions set stage='production' ...;   -- UPDATE 1
--     update copilots set status='active', ...;             -- UPDATE 1
--   → copilot reached active/production WITHOUT the RPC. A session GUC is a
--   declarative value the caller controls, not an authority.
--
-- THE FIX — privilege separation the trigger can trust:
--   * A dedicated NOLOGIN NOINHERIT NOBYPASSRLS role `aigent_promotion_executor`
--     that service_role is NOT a member of (so service_role cannot SET ROLE to
--     it — a non-superuser cannot SET ROLE to a role it is not a member of).
--   * The RPC promote_copilot_version is OWNED by that role and is SECURITY
--     DEFINER, so INSIDE the RPC `current_user` = aigent_promotion_executor.
--   * The transition guard trigger is SECURITY INVOKER (the default — NOT
--     security definer, which would make current_user the trigger's owner), so
--     it observes the REAL effective role doing the UPDATE:
--       - via the RPC  → current_user = aigent_promotion_executor → allowed
--       - direct write → current_user = service_role             → refused
--     No session-controlled value is consulted. The GUC is gone.
--   * Defence in depth: REVOKE column UPDATE on the critical columns from
--     service_role, so even a trigger-less future table change cannot flip them
--     directly. The executor role holds those column grants; service_role keeps
--     UPDATE on every OTHER column (updated_at, assistant_id, latest_version_id…).
--
-- The only runtime writer of active/production is the RPC (verified: the promote
-- route calls it; createCopilotFromManifest/provisioning insert draft/null;
-- seed-fixtures run as postgres via seed-amc.ts, not service_role). Legacy
-- provision-tradeagent-roster.mjs (direct status=active PATCH) must move to the
-- RPC — it already failed under 0032 and is documented.
--
-- Additive/idempotent. Does NOT rewrite the already-applied 0032; it supersedes
-- 0032's GUC logic by recreating the trigger function on the privilege check and
-- re-owning the RPC.

-- ── 1) The protected executor role ───────────────────────────────────────────
-- NOLOGIN: never a connection role. NOINHERIT: does not auto-assume other roles.
-- NOBYPASSRLS: no RLS bypass. service_role is deliberately NOT granted membership.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aigent_promotion_executor') then
    create role aigent_promotion_executor nologin noinherit nobypassrls;
  end if;
end $$;

-- The executor needs to actually perform the transition writes.
grant usage on schema public to aigent_promotion_executor;
grant select on copilots, copilot_versions, promotion_gates to aigent_promotion_executor;
grant update (status, production_version_id) on copilots to aigent_promotion_executor;
grant update (stage) on copilot_versions to aigent_promotion_executor;
-- It must NOT own or create objects in public (anti-shadowing of the RPC's
-- resolved tables/functions): grant only usage, never create.
revoke create on schema public from aigent_promotion_executor;

-- RLS is ENABLED (not forced) on these tables with NO policies — so service_role
-- only reaches them via its BYPASSRLS. The executor has NO BYPASSRLS (by design:
-- the mission forbids relying on BYPASSRLS as the boundary). Give it precise
-- policies so the RPC's reads/writes work, and ONLY those. These policies name
-- the executor role explicitly, so they never widen access for anyone else.
drop policy if exists promo_exec_select_copilots on copilots;
create policy promo_exec_select_copilots on copilots for select to aigent_promotion_executor using (true);
drop policy if exists promo_exec_update_copilots on copilots;
create policy promo_exec_update_copilots on copilots for update to aigent_promotion_executor using (true) with check (true);

drop policy if exists promo_exec_select_versions on copilot_versions;
create policy promo_exec_select_versions on copilot_versions for select to aigent_promotion_executor using (true);
drop policy if exists promo_exec_update_versions on copilot_versions;
create policy promo_exec_update_versions on copilot_versions for update to aigent_promotion_executor using (true) with check (true);

drop policy if exists promo_exec_select_gates on promotion_gates;
create policy promo_exec_select_gates on promotion_gates for select to aigent_promotion_executor using (true);

-- ── 2) Column-level lockdown of service_role on the critical columns ──────────
-- service_role keeps UPDATE on all OTHER columns; only the transition columns
-- are removed. Postgres column privileges: revoking a column UPDATE while a
-- table-level UPDATE grant exists requires revoking the table-level UPDATE and
-- re-granting per-column for the allowed columns. Do exactly that.
-- Re-grant UPDATE on EVERY copilots column EXCEPT status + production_version_id
-- (the two transition columns the RPC owns). Immutable columns (id/created_at/
-- created_via) are included for completeness — an UPDATE never touches them, but
-- the grant then mirrors "everything but the two critical columns" exactly.
revoke update on copilots from service_role;
grant update (
  id, project_id, name, slug, description, runtime, latest_version_id,
  model, model_provider, owner, tags, created_at, updated_at, health,
  target_project_ids, created_via, last_push_status, last_pushed_at,
  last_push_commit_url, assistant_id
) on copilots to service_role;

-- Re-grant UPDATE on EVERY copilot_versions column EXCEPT stage.
revoke update on copilot_versions from service_role;
grant update (
  id, copilot_id, label, manifest_id, model, model_provider, changelog,
  created_at, created_by, scores
) on copilot_versions to service_role;

-- ── 3) Recreate the guard trigger function on the PRIVILEGE, not the GUC ──────
-- SECURITY INVOKER (default): current_user is the REAL effective role of the
-- UPDATE. Only the RPC (running as aigent_promotion_executor) may transition
-- into active/production. Everything else (including service_role, even with a
-- forged app.promotion GUC) is refused.
create or replace function enforce_promotion_via_rpc()
returns trigger
language plpgsql
-- NOTE: intentionally NOT `security definer` — we need current_user to be the
-- invoker, not this function's owner.
set search_path = pg_catalog, public
as $$
begin
  -- The single authority: the effective role must be the protected executor.
  if current_user = 'aigent_promotion_executor' then
    return new;
  end if;

  if tg_table_name = 'copilots' then
    if new.status = 'active' and old.status is distinct from 'active' then
      raise exception
        'direct transition to status=active is forbidden — promote via promote_copilot_version() (copilot %)', new.id
        using errcode = 'insufficient_privilege';
    end if;
    if new.production_version_id is distinct from old.production_version_id
       and new.production_version_id is not null then
      raise exception
        'direct change of production_version_id is forbidden — promote via promote_copilot_version() (copilot %)', new.id
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'copilot_versions' then
    if new.stage = 'production' and old.stage is distinct from 'production' then
      raise exception
        'direct transition to stage=production is forbidden — promote via promote_copilot_version() (version %)', new.id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

-- Triggers already exist from 0032; recreate to be safe/idempotent.
drop trigger if exists trg_copilots_promotion_guard on copilots;
create trigger trg_copilots_promotion_guard
  before update on copilots
  for each row execute function enforce_promotion_via_rpc();

drop trigger if exists trg_versions_promotion_guard on copilot_versions;
create trigger trg_versions_promotion_guard
  before update on copilot_versions
  for each row execute function enforce_promotion_via_rpc();

-- ── 4) Recreate the RPC: owned by the executor, strict TTL, no GUC ───────────
-- SECURITY DEFINER + owner=aigent_promotion_executor ⇒ current_user inside the
-- function (and the UPDATEs it issues) is aigent_promotion_executor ⇒ the guard
-- trigger allows it. No set_config / GUC anywhere.
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
  c_max_ttl_seconds constant integer := 3600;
  v_ttl_seconds integer;
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
    select stage into v_candidate_stage from copilot_versions where id = p_version_id;
    if v_candidate_stage is distinct from 'archived' then
      raise exception
        'rollback refused: target version % is not an archived (previously-served) version (stage=%)',
        p_version_id, coalesce(v_candidate_stage, 'unknown')
        using errcode = 'check_violation';
    end if;
  else
    -- TTL semantics (single source of truth, matches docs + tests):
    --   NULL / 0 / negative → HARD ERROR (fail-closed, no silent fallback).
    --   1..3600             → used verbatim.
    --   > 3600              → clamped DOWN to 3600 (caller can only shorten).
    if p_max_evidence_age_seconds is null or p_max_evidence_age_seconds <= 0 then
      raise exception
        'invalid p_max_evidence_age_seconds=% — must be a positive integer (1..%)',
        coalesce(p_max_evidence_age_seconds::text, 'null'), c_max_ttl_seconds
        using errcode = 'check_violation';
    end if;
    v_ttl_seconds := least(p_max_evidence_age_seconds, c_max_ttl_seconds);

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

  -- The transition writes. These run as aigent_promotion_executor (the definer
  -- owner), so the guard trigger's current_user check passes.
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

-- Own the RPC with the protected executor so SECURITY DEFINER runs as it.
alter function promote_copilot_version(text, text, text, boolean, integer)
  owner to aigent_promotion_executor;

-- Only the app role may CALL it; the executor role is never a login/callable
-- surface itself. Re-assert the grant lockdown.
revoke all on function promote_copilot_version(text, text, text, boolean, integer) from public;
grant execute on function promote_copilot_version(text, text, text, boolean, integer) to service_role;

notify pgrst, 'reload schema';
