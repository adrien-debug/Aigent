/**
 * AIG-FIN-001 — connector contract (Integration Platform, spec §11/§60).
 *
 * A `FinanceConnector` is the ONLY kind of component that speaks an ERP's
 * language (Xero, Sage, NetSuite, QuickBooks, Dynamics, Cegid, generic CSV…).
 * It is deterministic CODE, never an LLM (spec: `kind: 'connector'`), and it
 * consumes the PIVOT FORMAT (spec §32, `JournalEntryProposal` from
 * finance/contracts.ts) — the business agents never know which ERP sits behind.
 *
 * HARD RULES ENCODED IN THE TYPES (not just in prose):
 *
 *   1. `writeEnabled` is the LITERAL type `false` — no connector in this phase
 *      can declare itself writable without a code change to this interface.
 *      A doubtful connector works read-only (spec §11); in P0/P1 ALL of them do.
 *   2. `exportJournalEntries` is a DRY-RUN: it returns the payload the target
 *      system WOULD receive (e.g. CSV text) and a limitations report. It never
 *      writes to disk, network or any ERP — `writePerformed` is the literal
 *      `false` on the report, so a "real write happened" result is
 *      unrepresentable.
 *   3. Typed results, NEVER a throw (mirrors the tool-handlers SAFETY
 *      CONTRACT). Invalid input → `ok: false` + per-item errors.
 *   4. Amounts stay lossless decimal STRINGS end to end — a read result only
 *      carries string fields, so no float can sneak in through a connector.
 *   5. Absent data is UNAVAILABLE with provenance (`TruthStatus`), never
 *      invented: a connector that cannot read reports it in `capabilities`
 *      and `limitations` instead of returning an empty "success".
 */

import type { Period, TruthStatus } from '../truth'

/** The one and only execution mode of this phase. Widening it = code change. */
export type ConnectorExecutionMode = 'dry-run'

export const CONNECTOR_EXECUTION_MODE: ConnectorExecutionMode = 'dry-run'

/** What a connector can actually do — declared, so callers never guess. */
export interface ConnectorCapabilities {
  /** True only when `readJournalEntries` is implemented. */
  readonly readJournalEntries: boolean
  /** True when the connector can dry-run-export the pivot format. */
  readonly exportJournalEntries: boolean
  /** Serialization formats the connector produces, e.g. ['csv']. */
  readonly formats: readonly string[]
}

/** Query for the optional read path. `asOf` is the instant the answer is for. */
export interface ConnectorReadQuery {
  readonly period?: Period
  /** Epoch ms the read answers for (provenance discipline, see finance/truth). */
  readonly asOf: number
}

/**
 * Read result. Rows are string-only maps (amounts remain decimal strings) and
 * `truth` states the provenance of what was read — a connector with no
 * trustworthy source answers `ok: false` + `truth: 'UNAVAILABLE'`, never an
 * invented empty ledger presented as fact.
 */
export interface ConnectorReadResult {
  readonly ok: boolean
  readonly truth: TruthStatus
  /** Human source id, e.g. 'csv-import:supplier-ledger'. */
  readonly source: string
  readonly entries: readonly Readonly<Record<string, string>>[]
  readonly errors: readonly string[]
}

/** One rejected input proposal, with the exact reasons (never silent). */
export interface ConnectorRejection {
  /** Index of the proposal in the submitted batch. */
  readonly index: number
  /** proposalId when parseable, null when the shape was too broken to tell. */
  readonly proposalId: string | null
  readonly errors: readonly string[]
}

/**
 * Dry-run export report — the ONLY outcome an export can produce.
 * `mode`/`writePerformed` are literal types: there is no representable state
 * in which a connector claims to have written anywhere.
 */
export interface ConnectorExportReport {
  readonly connectorId: string
  readonly mode: ConnectorExecutionMode
  /** ALWAYS false — nothing was written to disk, network or any ERP. */
  readonly writePerformed: false
  /** Serialization format of `content`, e.g. 'csv'. */
  readonly format: string
  /**
   * Fail-closed: true only when EVERY submitted proposal validated. A single
   * invalid proposal aborts the whole export (`content: null`) — a partial
   * accounting export is a wrong accounting export.
   */
  readonly ok: boolean
  /** The exact payload the target would receive; null when `ok` is false. */
  readonly content: string | null
  /** Proposals accepted into `content`. */
  readonly entryCount: number
  /** Data rows serialized (journal LINES for a CSV connector). */
  readonly lineCount: number
  readonly rejected: readonly ConnectorRejection[]
  /** The connector's standing limitations, restated on every report. */
  readonly limitations: readonly string[]
}

/**
 * The connector contract. Everything is synchronous and deterministic in this
 * phase (no network, no LLM, no secret): a connector is a pure translator
 * between the pivot format and one target system's dialect.
 */
export interface FinanceConnector {
  /** Stable connector id, e.g. 'generic-csv', 'xero', 'sage'. */
  readonly id: string
  readonly label: string
  /**
   * LITERAL false — the write path does not exist in this phase. Enabling a
   * real write requires changing this type, i.e. a reviewed code change, not
   * a config flip (spec §63: the Execution Gateway blocks at the least doubt).
   */
  readonly writeEnabled: false
  readonly capabilities: ConnectorCapabilities
  /** Honest, exhaustive list of what this connector CANNOT do. Never empty-washed. */
  readonly limitations: readonly string[]
  /**
   * Optional read path. Absent ⇒ `capabilities.readJournalEntries` is false
   * and the limitation is stated — absence is declared, never faked.
   */
  readonly readJournalEntries?: (query: ConnectorReadQuery) => ConnectorReadResult
  /**
   * DRY-RUN export of validated `JournalEntryProposal`s (pivot format §32).
   * Takes `unknown[]` on purpose: the connector re-validates every proposal
   * against the Zod contract itself — it never trusts the caller. Never throws.
   */
  readonly exportJournalEntries: (proposals: readonly unknown[]) => ConnectorExportReport
}
