-- AIGENT-DEEP-FORENSIC-029 — re-assert the read-only tool classification.
--
-- Migration 0023 classified the proven read-only tools as `mutates = false`,
-- but `scripts/provision-tradeagent-roster.mjs` (AIGENT-RESET-022, 2026-07-22)
-- re-created the roster's tool rows WITHOUT setting `mutates`, so every read
-- tool reverted to the column DEFAULT `true` (migration 0022, fail-closed).
-- Effect: the strictly read-only market copilots rendered as write-capable
-- (readOnly=false, "Can write" badges) across the admin surface and both
-- catalog APIs — a truth inversion.
--
-- The durable fix is in code: the provisioner and materializer now set
-- `mutates: false` explicitly, and the /projects/:id/copilots + /runtime/v1
-- catalogs share one nature-based `deriveToolNatureReadOnly`. This migration
-- re-asserts the classification on any DB that was provisioned in between.
-- Idempotent — same UPDATE as 0023, extended with the tools that exist today.

update tools set mutates = false
 where name in (
   'read_repo_file', 'list_repo_tree', 'search_repo',
   'read_project_summary', 'read_copilot_summary', 'read_recent_runs', 'read_tool_permissions',
   'read_market_snapshot', 'read_volatility_state', 'read_market_structure',
   'read_multi_timeframe_candles', 'read_liquidity_snapshot', 'read_macro_context',
   'read_account_risk_snapshot', 'read_derivatives_snapshot', 'read_funding_open_interest'
 );
