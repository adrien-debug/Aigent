-- AIG-AGENT-QUALITY-005 — Lot sécurité (1/2) : classification READ_ONLY_PROVEN.
--
-- Contexte : la migration 0022 a créé `tools.mutates` avec un DEFAULT true, ce qui
-- a marqué les 158 lignes comme mutantes par défaut — un état FAUX, jamais prouvé.
-- Cette migration corrige les seuls outils dont l'implémentation réelle est prouvée
-- read-only. La preuve n'est JAMAIS le nom : c'est le handler.
--
--   * 3 lectures repo GitHub (read_repo_file / list_repo_tree / search_repo) :
--     `fetch(url, { headers: githubHeaders() })` sans method → GET, + filtre
--     isSecretPath. Source : src/langgraph/tool-registry.mjs.
--   * 4 lectures PostgREST (read_project_summary / read_copilot_summary /
--     read_recent_runs / read_tool_permissions) : GET PostgREST, aucun write.
--   * 7 lectures marché (read_market_snapshot / read_volatility_state /
--     read_market_structure / read_multi_timeframe_candles / read_liquidity_snapshot /
--     read_macro_context / read_account_risk_snapshot) : provider HTTP GET public
--     TradeAgent, doctrine read-only + UNAVAILABLE. Source : market/tools.ts.
--
-- Tout le reste (22 noms sans handler + draft_copilot_spec gated) RESTE mutates=true
-- (fail-closed). Aucun outil classé read-only sur la foi de son nom.
-- Appliqué en live le 2026-07-20 (UPDATE 131). Idempotent.

update tools set mutates = false
 where name in (
   'read_repo_file', 'list_repo_tree', 'search_repo',
   'read_project_summary', 'read_copilot_summary', 'read_recent_runs', 'read_tool_permissions',
   'read_market_snapshot', 'read_volatility_state', 'read_market_structure',
   'read_multi_timeframe_candles', 'read_liquidity_snapshot', 'read_macro_context',
   'read_account_risk_snapshot'
 );
