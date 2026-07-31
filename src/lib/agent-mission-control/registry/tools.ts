/**
 * Canonical Tool Registry — the single descriptor authority for every tool the
 * platform can mount.
 *
 * AIGENT-CORE-FACTORY-035, Phase 4. Before this module the platform kept FIVE
 * parallel tool lists (langgraph REGISTRY, copilot-behavior REGISTRY_IDS,
 * TOOL_HANDLERS, RUNNABLE_TOOL_NAMES, agent-builder DEFAULT_TOOL_IDS), only ONE
 * pair of which was gate-enforced. Adding a tool meant editing several of them
 * by hand and hoping they stayed in sync; they didn't (tool-handlers.ts was
 * missing the realestate handlers).
 *
 * This module is the ONE place that says, per tool: its id, version, what it
 * does, whether it mutates state, its risk, whether it needs confirmation, which
 * SECRET references it reads (by name — never a value), where it comes from
 * (provenance), which runtimes can mount it, and its certification state.
 *
 * The executable factory still lives in src/langgraph/tool-registry.mjs (it
 * pulls @langchain + live PostgREST, which must not leak into an isomorphic
 * module). This registry is the CONTRACT that factory realises. The integrity
 * gate (check-registry-integrity.mjs) asserts the two agree exactly — so the
 * executable side can never drift from the declared contract, and the TS unions
 * / handler maps are DERIVED from here instead of hand-copied.
 *
 * PURE + ISOMORPHIC: no server-only import. Safe everywhere.
 *
 * Classification provenance: `mutates` values mirror the live DB truth asserted
 * by migration 0023 (read-only proven by handler, never by name). Fail-closed —
 * a tool whose handler was not proven read-only stays `mutates: true`.
 */

import type { AgentRuntime } from '../types'

/** How a tool is realised — its integration shape. */
export type ToolKind =
  | 'local-deterministic' // pure/local compute, no external IO (e.g. draft_copilot_spec)
  | 'http-get' // read-only outbound HTTP, allowlist-gated
  | 'db-read' // read-only against the PostgREST perimeter
  | 'repo-read' // read-only GitHub repo access

export type ToolRisk = 'low' | 'medium' | 'high'

/** Lifecycle of a tool DEFINITION in the registry (distinct from runtime call state). */
export type ToolCertification = 'certified' | 'draft' | 'deprecated'

export interface ToolDefinition {
  /** Stable id — exactly a key of REGISTRY in tool-registry.mjs (gate-asserted). */
  id: string
  /** Semver of the tool CONTRACT. Bumped when schema/behaviour changes. */
  version: string
  /** Short human label. */
  label: string
  /** One-line description of what it does (the model gets the .mjs description). */
  summary: string
  kind: ToolKind
  /**
   * True when the tool writes/sends/publishes/spends anything. Fail-closed:
   * a tool is mutating unless its handler is PROVEN read-only (migration 0023).
   */
  mutates: boolean
  risk: ToolRisk
  /** Whether a run must confirm before this tool fires (HITL). */
  requiresConfirmation: boolean
  /**
   * Secret references this tool reads, BY ENV VAR NAME — never a value. Empty
   * for a tool that needs no secret. The gate checks each name is a plausible
   * reference (UPPER_SNAKE), never that a value exists here.
   */
  secretRefs: ReadonlyArray<string>
  /** Where the tool's capability originates (for provenance/audit). */
  provenance: 'platform' | 'trading' | 'realestate' | 'repo' | 'http' | 'builder'
  /** Runtimes that can mount this tool. Today every tool is langgraph-mountable. */
  runtimes: ReadonlyArray<AgentRuntime>
  certification: ToolCertification
}

/** Every tool is currently mountable by the LangGraph runtime (the only engine). */
const LG: ReadonlyArray<AgentRuntime> = ['langgraph']

function def(d: ToolDefinition): ToolDefinition {
  return d
}

/**
 * THE tools. Keys MUST equal the executable REGISTRY keys in
 * tool-registry.mjs — the integrity gate fails the build otherwise. Ordered:
 * repo reads, http, platform reads, the builder, market reads, realestate reads.
 */
export const TOOL_REGISTRY: Readonly<Record<string, ToolDefinition>> = {
  // ── Repo reads (GitHub, GET, secret-path filtered) ────────────────────────
  read_repo_file: def({
    id: 'read_repo_file', version: '1.0.0', label: 'Read repo file',
    summary: 'Read one file from a scoped GitHub repo (secret paths filtered).',
    kind: 'repo-read', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: ['GITHUB_TOKEN'], provenance: 'repo', runtimes: LG, certification: 'certified',
  }),
  list_repo_tree: def({
    id: 'list_repo_tree', version: '1.0.0', label: 'List repo tree',
    summary: 'List the file tree of a scoped GitHub repo (secret paths filtered).',
    kind: 'repo-read', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: ['GITHUB_TOKEN'], provenance: 'repo', runtimes: LG, certification: 'certified',
  }),
  search_repo: def({
    id: 'search_repo', version: '1.0.0', label: 'Search repo',
    summary: 'Search code in a scoped GitHub repo (secret paths filtered).',
    kind: 'repo-read', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: ['GITHUB_TOKEN'], provenance: 'repo', runtimes: LG, certification: 'certified',
  }),

  // ── HTTP (read-only, allowlist-gated) ─────────────────────────────────────
  http_get: def({
    id: 'http_get', version: '1.0.0', label: 'HTTP GET',
    summary: 'Read-only outbound GET against an allowlisted host.',
    kind: 'http-get', mutates: false, risk: 'medium', requiresConfirmation: false,
    secretRefs: [], provenance: 'http', runtimes: LG, certification: 'certified',
  }),

  // ── Platform reads (PostgREST perimeter, GET) ─────────────────────────────
  read_project_summary: def({
    id: 'read_project_summary', version: '1.0.0', label: 'Read project summary',
    summary: 'Read a project overview from the platform perimeter.',
    kind: 'db-read', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'platform', runtimes: LG, certification: 'certified',
  }),
  read_copilot_summary: def({
    id: 'read_copilot_summary', version: '1.0.0', label: 'Read copilot summary',
    summary: 'Read an agent overview from the platform perimeter.',
    kind: 'db-read', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'platform', runtimes: LG, certification: 'certified',
  }),
  read_recent_runs: def({
    id: 'read_recent_runs', version: '1.0.0', label: 'Read recent runs',
    summary: 'Read recent run history from the platform perimeter.',
    kind: 'db-read', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'platform', runtimes: LG, certification: 'certified',
  }),
  read_tool_permissions: def({
    id: 'read_tool_permissions', version: '1.0.0', label: 'Read tool permissions',
    summary: "Read an agent's declared tool permissions.",
    kind: 'db-read', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'platform', runtimes: LG, certification: 'certified',
  }),

  // ── The builder tool (pure, confirmation-gated) ───────────────────────────
  draft_copilot_spec: def({
    id: 'draft_copilot_spec', version: '1.0.0', label: 'Draft copilot spec',
    summary: 'Compose a copilot spec draft from a brief (pure, local).',
    kind: 'local-deterministic', mutates: false, risk: 'medium', requiresConfirmation: true,
    secretRefs: [], provenance: 'platform', runtimes: LG, certification: 'certified',
  }),

  // ── Tools created by the Tool Builder (provenance: 'builder') ─────────────
  // count_words is the proof tool: authored via the Tool Builder pipeline
  // (tool-builder/mission.ts), pure/local/deterministic, and CERTIFIED only
  // because its sandbox tests passed — not because the literal was typed.
  count_words: def({
    id: 'count_words', version: '1.0.0', label: 'Count words',
    summary: 'Count words, characters and the longest token in a text (pure, local, deterministic).',
    kind: 'local-deterministic', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'builder', runtimes: LG, certification: 'certified',
  }),

  // ── Market reads (TradeAgent public routes, GET, UNAVAILABLE-aware) ────────
  read_market_snapshot: def({
    id: 'read_market_snapshot', version: '1.0.0', label: 'Read market snapshot',
    summary: 'Read a normalised market snapshot (read-only, provenance-tagged).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_volatility_state: def({
    id: 'read_volatility_state', version: '1.0.0', label: 'Read volatility state',
    summary: 'Read volatility/ATR state (read-only).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_market_structure: def({
    id: 'read_market_structure', version: '1.0.0', label: 'Read market structure',
    summary: 'Read market regime/structure (read-only).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_multi_timeframe_candles: def({
    id: 'read_multi_timeframe_candles', version: '1.0.0', label: 'Read multi-timeframe candles',
    summary: 'Read OHLC candles across timeframes (read-only).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_liquidity_snapshot: def({
    id: 'read_liquidity_snapshot', version: '1.0.0', label: 'Read liquidity snapshot',
    summary: 'Read order-book/liquidity snapshot (read-only).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_derivatives_snapshot: def({
    id: 'read_derivatives_snapshot', version: '1.0.0', label: 'Read derivatives snapshot',
    // The description IS the input contract (AGENTS.md): the runner ships it to
    // the model without a JSON schema, so an unstated coverage limit becomes a
    // wrong-instrument answer. BTCUSDT-only is stated here, not just enforced.
    summary:
      'Read funding/open-interest/derivatives snapshot (read-only). Covers BTCUSDT ONLY — ' +
      'Args JSON: {"pair":"BTCUSDT"}. Any other instrument returns UNAVAILABLE; it is never ' +
      'substituted with BTC data.',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_macro_context: def({
    id: 'read_macro_context', version: '1.0.0', label: 'Read macro context',
    summary: 'Read macro context (read-only).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_funding_open_interest: def({
    id: 'read_funding_open_interest', version: '1.0.0', label: 'Read funding & open interest',
    summary: 'Read perp funding rate and open interest for a pair (read-only; often UNAVAILABLE).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),
  read_account_risk_snapshot: def({
    id: 'read_account_risk_snapshot', version: '1.0.0', label: 'Read account risk snapshot',
    summary: 'Read account risk (read-only; always UNAVAILABLE without a connected account).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'trading', runtimes: LG, certification: 'certified',
  }),

  // ── Realestate reads (official public sources, GET, UNAVAILABLE-aware) ─────
  resolve_address_to_section: def({
    id: 'resolve_address_to_section', version: '1.0.0', label: 'Resolve address → section',
    summary: 'Resolve a French address to INSEE code + cadastral section (public sources).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'realestate', runtimes: LG, certification: 'certified',
  }),
  read_dvf_comparables: def({
    id: 'read_dvf_comparables', version: '1.0.0', label: 'Read DVF comparables',
    summary: 'Read official French real-estate sales (DVF) for a cadastral section (HISTORICAL).',
    kind: 'http-get', mutates: false, risk: 'low', requiresConfirmation: false,
    secretRefs: [], provenance: 'realestate', runtimes: LG, certification: 'certified',
  }),
  read_market_listings: def({
    id: 'read_market_listings', version: '1.0.0', label: 'Read market listings',
    summary: 'Read current real-estate portal listings (read-only).',
    kind: 'http-get', mutates: false, risk: 'medium', requiresConfirmation: false,
    secretRefs: [], provenance: 'realestate', runtimes: LG, certification: 'certified',
  }),
}

/** Every tool id the registry knows, derived (never hand-listed). */
export const TOOL_IDS: ReadonlyArray<string> = Object.keys(TOOL_REGISTRY)

/** Look up a tool descriptor, or `undefined` for an unknown id. */
export function getTool(id: string): ToolDefinition | undefined {
  return (TOOL_REGISTRY as Record<string, ToolDefinition>)[id]
}

/** True iff the id names a real, certified tool the registry can mount. */
export function isToolCertified(id: string): boolean {
  const t = getTool(id)
  return !!t?.certification && t.certification === 'certified'
}
