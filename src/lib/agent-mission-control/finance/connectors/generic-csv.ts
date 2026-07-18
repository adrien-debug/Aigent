/**
 * AIG-FIN-001 — generic CSV connector (spec §60, P1).
 *
 * The lowest common denominator of the Integration Platform: it maps validated
 * `JournalEntryProposal`s (pivot format §32) to CANONICAL CSV rows — one row
 * per journal line — that any accounting software able to import CSV can
 * consume. Deterministic code, zero network, zero LLM, zero secret.
 *
 * READ-ONLY / DRY-RUN (spec: "LECTURE SEULE si l'écriture n'est pas sûre" —
 * and for a generic target, writing is never provably safe):
 *   - `exportJournalEntries` RETURNS the CSV text; it never writes to disk,
 *     network or any ERP (`writePerformed` is the literal false);
 *   - the read path is NOT implemented (`readJournalEntries` absent) — stated
 *     in capabilities + limitations instead of faking an empty ledger.
 *
 * DETERMINISM (same discipline as the AIG-PACK-015 export):
 *   - stable header set (`GENERIC_CSV_HEADERS`), fixed column order;
 *   - LF line endings, trailing LF, RFC 4180 escaping (quote when a field
 *     contains a quote, comma, CR or LF; inner quotes doubled);
 *   - dimensions serialized with SORTED keys, evidence ids in given order;
 *   - two exports of the same proposals are byte-identical (no runtime
 *     timestamp, no randomness).
 *
 * FAIL-CLOSED: every proposal is re-validated against the Zod contract here
 * (the connector never trusts its caller). One invalid or duplicated proposal
 * → the WHOLE export aborts (`ok: false`, `content: null`) with per-item
 * reasons — a partial accounting export is a wrong accounting export. Amounts
 * transit as lossless decimal strings from contract to CSV cell: no float ever
 * touches a monetary value. Never throws.
 */

import { journalEntryProposalSchema, type JournalEntryProposal } from '../contracts'
import {
  CONNECTOR_EXECUTION_MODE,
  type ConnectorExportReport,
  type ConnectorRejection,
  type FinanceConnector,
} from './types'

export const GENERIC_CSV_CONNECTOR_ID = 'generic-csv'

/**
 * Canonical column set — STABLE, one row per journal LINE. Proposal-level
 * fields are repeated on each of its lines so every row is self-sufficient
 * for a target-side import.
 */
export const GENERIC_CSV_HEADERS = [
  'proposal_id',
  'journal',
  'period',
  'entry_date',
  'currency',
  'line_index',
  'account_code',
  'account_label',
  'debit',
  'credit',
  'dimensions',
  'line_description',
  'evidence_ids',
  'requires_approval',
] as const

/**
 * Honest limitations report (spec §60: "rapport des limitations"). Restated on
 * every export so no consumer can miss what this connector does NOT guarantee.
 */
export const GENERIC_CSV_LIMITATIONS: readonly string[] = [
  'read path not implemented: the connector cannot see what the target system already contains',
  'no ERP semantics: account codes, journals and dimensions are passed through verbatim, never checked against a target chart of accounts',
  'no tax logic: tax lines are ordinary lines, no jurisdiction pack is applied',
  'no attachment transport: evidence is referenced by id only, source documents are not embedded',
  'no target-side idempotency: importing the same CSV twice in an external tool can create duplicates — deduplication belongs to the Execution Gateway',
  'write disabled: exportJournalEntries is a dry-run returning the CSV content; nothing is written to disk, network or any ERP',
]

// CSV serialization (RFC 4180, LF) --------------------------------------------

/** Quote a field when needed; double inner quotes. Deterministic, lossless. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvField).join(',')
}

/** Serialize analytic dimensions with SORTED keys: "cost_center=CC-01;project=P-9". */
function serializeDimensions(dimensions: Readonly<Record<string, string>>): string {
  return Object.keys(dimensions)
    .sort()
    .map((k) => `${k}=${dimensions[k]}`)
    .join(';')
}

/** The canonical CSV rows of one validated proposal (one row per line). */
function rowsOfProposal(proposal: JournalEntryProposal): string[] {
  return proposal.lines.map((line, lineIndex) =>
    csvRow([
      proposal.proposalId,
      proposal.journal,
      proposal.period,
      proposal.entryDate,
      proposal.currency,
      String(lineIndex),
      line.accountCode,
      line.accountLabel,
      line.debit,
      line.credit,
      serializeDimensions(line.dimensions),
      line.description,
      proposal.evidenceIds.join(';'),
      'true',
    ]),
  )
}

// Export (dry-run only) -------------------------------------------------------

/** Extract a proposalId for error reporting without trusting the shape. */
function proposalIdOf(raw: unknown): string | null {
  if (typeof raw === 'object' && raw !== null && 'proposalId' in raw) {
    const id = (raw as { proposalId: unknown }).proposalId
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
}

/**
 * DRY-RUN export: validates every proposal against the pivot contract, then
 * serializes the batch to canonical CSV. Fail-closed on any invalid or
 * duplicated proposal. Returns the report — never throws, never writes.
 */
export function exportJournalEntriesToCsv(
  proposals: readonly unknown[],
): ConnectorExportReport {
  const accepted: JournalEntryProposal[] = []
  const rejected: ConnectorRejection[] = []
  const seenIds = new Set<string>()

  proposals.forEach((raw, index) => {
    const r = journalEntryProposalSchema.safeParse(raw)
    if (!r.success) {
      rejected.push({
        index,
        proposalId: proposalIdOf(raw),
        errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      })
      return
    }
    if (seenIds.has(r.data.proposalId)) {
      rejected.push({
        index,
        proposalId: r.data.proposalId,
        errors: [`duplicate proposalId "${r.data.proposalId}" in the same batch`],
      })
      return
    }
    seenIds.add(r.data.proposalId)
    accepted.push(r.data)
  })

  if (proposals.length === 0) {
    rejected.push({ index: 0, proposalId: null, errors: ['empty batch: nothing to export'] })
  }

  const ok = rejected.length === 0
  const dataRows = ok ? accepted.flatMap(rowsOfProposal) : []
  const content = ok
    ? [csvRow(GENERIC_CSV_HEADERS), ...dataRows].join('\n') + '\n'
    : null

  return {
    connectorId: GENERIC_CSV_CONNECTOR_ID,
    mode: CONNECTOR_EXECUTION_MODE,
    writePerformed: false,
    format: 'csv',
    ok,
    content,
    entryCount: ok ? accepted.length : 0,
    lineCount: dataRows.length,
    rejected,
    limitations: GENERIC_CSV_LIMITATIONS,
  }
}

/** The connector instance the Execution Gateway registers. */
export const genericCsvConnector: FinanceConnector = {
  id: GENERIC_CSV_CONNECTOR_ID,
  label: 'Generic CSV (read-only dry-run export of the pivot format)',
  writeEnabled: false,
  capabilities: {
    readJournalEntries: false,
    exportJournalEntries: true,
    formats: ['csv'],
  },
  limitations: GENERIC_CSV_LIMITATIONS,
  exportJournalEntries: exportJournalEntriesToCsv,
}
