-- AIGENT-RUNTIME-PROMOTION-001 — post-review fixes (found in the PR #19 review).
--
-- Two REAL defects, both confirmed live against gpu1, both additive+idempotent:
--
-- DEFECT #2 (BLOCKING): migration 0029 replaced promote_copilot_version with a
-- NEW 5-argument overload (…, p_is_rollback boolean, p_max_evidence_age_seconds
-- integer) and did `revoke all … from public` on it, but never GRANTed EXECUTE
-- to service_role on that new signature. 0028's grant targets only the OLD
-- 3-arg overload (text,text,text). Net effect: the app's ONLY promotion RPC
-- (called with 5 args by the promotion route) returns `42501 permission denied
-- for function promote_copilot_version` — the entire official promotion path is
-- dead. No copilot can reach production. Proven live:
--   POST /rpc/promote_copilot_version {5 args} -> 403 {code:42501}.
-- Fix: re-assert the same lock-down 0028 applied to the 3-arg overload, on the
-- 5-arg overload — strip PUBLIC, grant EXECUTE to service_role ONLY. Same
-- deny-by-default doctrine (every table/function is service_role-only).
--
-- DEFECT #1 (HIGH): the promotion gate's replay check
-- (promotion-gate.ts `evaluatePromotionGate`) reads the LATEST replay_comparisons
-- row for the copilot and cannot filter by the candidate version — because
-- replay_comparisons has NO candidate_version_id column (schema 0001 never had
-- one, 0029 added only `verdict`). So a replay BETTER/EQUIVALENT produced for
-- version A can satisfy a REQUIRED replay for the promotion of version B on the
-- same copilot: the evidence↔candidate link is broken for replay (shadow is
-- correctly linked — shadow_experiments.candidate_version_id exists since 0001).
-- Proven live: `select candidate_version_id from replay_comparisons` -> 42703.
-- Fix: add the column + a (copilot, candidate, created_at desc) index so the
-- gate can bind a replay to the exact candidate. The code side (persist writes
-- it, gate filters on it) lands in the same PR.

-- ── DEFECT #2: grant EXECUTE on the 5-arg promotion RPC to service_role ──────
-- Pinned to the exact 0029 signature so this targets that overload only. REVOKE
-- is a no-op if already stripped; GRANT is a no-op if already present.
revoke all on function public.promote_copilot_version(text, text, text, boolean, integer) from public;
grant execute on function public.promote_copilot_version(text, text, text, boolean, integer) to service_role;

-- ── DEFECT #1: bind a replay comparison to its candidate version ─────────────
alter table replay_comparisons
  add column if not exists candidate_version_id text;

create index if not exists replay_comparisons_candidate_idx
  on replay_comparisons (copilot_id, candidate_version_id, created_at desc);

notify pgrst, 'reload schema';
