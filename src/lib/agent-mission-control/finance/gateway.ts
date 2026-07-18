/**
 * AIG-FIN-001 — Execution Gateway (spec §63, P1 stub, READ-ONLY).
 *
 * The UNIQUE write door of the accounting factory. Nothing — no agent, no
 * mission, no human shortcut — reaches a connector except through
 * `ExecutionGateway.executeIntent`, which unrolls the WHOLE §63 chain on every
 * intent:
 *
 *   validation → permissions (separation of duties §47, self-approval
 *   impossible) → mandate (the agent has the right to this action type) →
 *   approvals (requiresApproval ⇒ a human approval is present, or REJECTED) →
 *   idempotency (same key never executes twice) → intent journal (structured
 *   in-memory log, exportable) → connector call in DRY-RUN ONLY → result
 *   verification (any doubt ⇒ rejected).
 *
 * HARD RULES ENCODED IN THE TYPES:
 *
 *   1. `executionMode` is the LITERAL type 'dry-run' — the only mode. A real
 *      write is UNREPRESENTABLE without changing this file: `GatewayResult`
 *      carries `mode: 'dry-run'` and `writePerformed: false` as literals, and
 *      every registered connector's `writeEnabled` is the literal false.
 *   2. Fail-closed everywhere: unknown agent → REJECTED, unknown connector →
 *      REJECTED, missing approval → REJECTED, approver = preparer → REJECTED,
 *      connector report not ok → REJECTED. Doubt never passes (spec §63:
 *      "blocage au doute").
 *   3. Typed results, NEVER a throw (mirrors the tool-handlers SAFETY
 *      CONTRACT): a malformed intent yields a REJECTED result, not an
 *      exception.
 *   4. Deterministic apart from the clock, and the clock is injectable
 *      (`opts.now`) so tests and benchmarks replay identically.
 */

import { z } from 'zod'
import type { ConnectorExportReport, FinanceConnector } from './connectors/types'

// Action types & execution mode ----------------------------------------------

/**
 * The action types the gateway understands. P1 exposes exactly one: dry-run
 * exporting journal entry proposals (pivot format §32) through a connector.
 * Adding an action type = adding it here + to the mandates = a code change.
 */
export const FINANCE_ACTION_TYPES = ['export_journal_entries'] as const

export type FinanceActionType = (typeof FINANCE_ACTION_TYPES)[number]

/** The one and only execution mode. Widening this union is a reviewed code change. */
export type ExecutionMode = 'dry-run'

export const EXECUTION_MODE: ExecutionMode = 'dry-run'

// Intent envelope (Zod-validated, never trusted) ------------------------------

/**
 * A human approval. `kind` is the literal 'human': an agent-produced approval
 * is not representable, so requiresApproval can only be satisfied by a person.
 */
const approvalSchema = z.object({
  kind: z.literal('human'),
  /** Identity of the approving human, e.g. 'user:daf@corp'. */
  approvedBy: z.string().min(1),
  /** Epoch ms of the approval. */
  approvedAt: z.number().int(),
  note: z.string().optional(),
})

/**
 * The intent envelope every caller must produce. `requiresApproval` is the
 * literal true: in this factory NO action is approval-exempt (§47) — an intent
 * claiming otherwise fails validation before any check runs.
 */
const executionIntentSchema = z.object({
  intentId: z.string().min(1),
  /** Deduplication key — the same key never executes twice. */
  idempotencyKey: z.string().min(1),
  /** The agent on whose behalf the action runs, e.g. 'agent-ecritures'. */
  agentId: z.string().min(1),
  /** The identity that PREPARED the intent (agent or human operator). */
  preparedBy: z.string().min(1),
  actionType: z.enum(FINANCE_ACTION_TYPES),
  connectorId: z.string().min(1),
  requiresApproval: z.literal(true),
  approvals: z.array(approvalSchema),
  /** Action payload: the proposals to export. Re-validated by the connector. */
  payload: z.object({
    proposals: z.array(z.unknown()).min(1),
  }),
})

export type ExecutionIntent = z.infer<typeof executionIntentSchema>
export type IntentApproval = z.infer<typeof approvalSchema>

// Results ---------------------------------------------------------------------

/** Where in the §63 chain the intent stopped (or 'completed' if it ran through). */
export type GatewayStage =
  | 'validation'
  | 'permissions'
  | 'mandate'
  | 'approvals'
  | 'idempotency'
  | 'connector'
  | 'verification'
  | 'completed'

export type GatewayDecision = 'EXECUTED_DRY_RUN' | 'REJECTED' | 'DUPLICATE'

/**
 * The gateway's typed outcome. `mode`/`writePerformed` are literals: even a
 * fully successful run only ever attests a dry-run with zero real writes.
 */
export interface GatewayResult {
  readonly decision: GatewayDecision
  readonly mode: ExecutionMode
  /** ALWAYS false — the gateway has no real write path in this phase. */
  readonly writePerformed: false
  /** Null when the envelope was too malformed to extract an id. */
  readonly intentId: string | null
  readonly idempotencyKey: string | null
  readonly stage: GatewayStage
  /** Why the decision was taken — always populated, never a silent verdict. */
  readonly reasons: readonly string[]
  /** The connector's dry-run report when the chain reached it, else null. */
  readonly connectorReport: ConnectorExportReport | null
  /** On DUPLICATE: the original execution's result. Null otherwise. */
  readonly original: GatewayResult | null
  /** Epoch ms of the decision (injectable clock). */
  readonly at: number
}

/** One structured line of the intent journal — exportable, append-only. */
export interface IntentJournalRecord {
  readonly seq: number
  readonly at: number
  readonly intentId: string | null
  readonly idempotencyKey: string | null
  readonly agentId: string | null
  readonly preparedBy: string | null
  readonly actionType: FinanceActionType | null
  readonly connectorId: string | null
  readonly decision: GatewayDecision
  readonly stage: GatewayStage
  readonly reasons: readonly string[]
}

// Gateway ---------------------------------------------------------------------

export interface ExecutionGatewayConfig {
  /** The connectors the gateway may call. All `writeEnabled: false` by type. */
  readonly connectors: readonly FinanceConnector[]
  /**
   * Agent mandates: which action types each agent id may request. FAIL-CLOSED:
   * an agent absent from this map has NO mandate and every intent it prepares
   * is rejected at the mandate stage.
   */
  readonly mandates: Readonly<Record<string, readonly FinanceActionType[]>>
}

export class ExecutionGateway {
  private readonly connectors: Map<string, FinanceConnector>
  private readonly mandates: Map<string, ReadonlySet<FinanceActionType>>
  /** idempotencyKey → the result of its (unique) successful dry-run execution. */
  private readonly executed: Map<string, GatewayResult>
  private readonly journal: IntentJournalRecord[]
  private seq: number

  constructor(config: ExecutionGatewayConfig) {
    this.connectors = new Map(config.connectors.map((c) => [c.id, c]))
    this.mandates = new Map(
      Object.entries(config.mandates).map(([agentId, actions]) => [
        agentId,
        new Set(actions),
      ]),
    )
    this.executed = new Map()
    this.journal = []
    this.seq = 0
  }

  /**
   * Unroll the full §63 chain on one intent. Synchronous, deterministic (the
   * clock is injectable via `opts.now`), and it NEVER throws: every outcome —
   * including a malformed envelope — is a typed `GatewayResult`.
   */
  executeIntent(rawIntent: unknown, opts?: { now?: number }): GatewayResult {
    const now = opts?.now ?? Date.now()

    // 1. Validation — the envelope is never trusted.
    const parsed = executionIntentSchema.safeParse(rawIntent)
    if (!parsed.success) {
      return this.record(
        {
          decision: 'REJECTED',
          stage: 'validation',
          reasons: parsed.error.issues.map(
            (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
          ),
          connectorReport: null,
          original: null,
        },
        partialEnvelope(rawIntent),
        now,
      )
    }
    const intent = parsed.data

    // 2. Permissions — separation of duties (§47): self-approval impossible.
    const selfApprovals = intent.approvals.filter(
      (a) => a.approvedBy === intent.preparedBy || a.approvedBy === intent.agentId,
    )
    if (selfApprovals.length > 0) {
      return this.record(
        {
          decision: 'REJECTED',
          stage: 'permissions',
          reasons: selfApprovals.map(
            (a) =>
              `self-approval forbidden: "${a.approvedBy}" prepared or owns this intent and cannot approve it (§47)`,
          ),
          connectorReport: null,
          original: null,
        },
        intent,
        now,
      )
    }

    // 3. Mandate — the agent must hold the right to this action type. Fail-closed.
    const mandate = this.mandates.get(intent.agentId)
    if (!mandate || !mandate.has(intent.actionType)) {
      return this.record(
        {
          decision: 'REJECTED',
          stage: 'mandate',
          reasons: [
            mandate
              ? `agent "${intent.agentId}" has no mandate for action "${intent.actionType}"`
              : `agent "${intent.agentId}" is unknown to the gateway — no mandate, fail-closed`,
          ],
          connectorReport: null,
          original: null,
        },
        intent,
        now,
      )
    }

    // 4. Approvals — requiresApproval (always true here) ⇒ a human approval exists.
    if (intent.approvals.length === 0) {
      return this.record(
        {
          decision: 'REJECTED',
          stage: 'approvals',
          reasons: [
            'requiresApproval is true but no human approval is present — REJECTED (§47)',
          ],
          connectorReport: null,
          original: null,
        },
        intent,
        now,
      )
    }

    // 5. Idempotency — the same key never executes twice; the original result
    //    is returned instead (anti-doublon). Rejections do NOT consume a key:
    //    a corrected resubmission may retry.
    const prior = this.executed.get(intent.idempotencyKey)
    if (prior) {
      return this.record(
        {
          decision: 'DUPLICATE',
          stage: 'idempotency',
          reasons: [
            `idempotencyKey "${intent.idempotencyKey}" already executed (intent "${prior.intentId}") — returning the original result, not re-executing`,
          ],
          connectorReport: prior.connectorReport,
          original: prior,
        },
        intent,
        now,
      )
    }

    // 6. Connector resolution + DRY-RUN call — the only mode that exists.
    const connector = this.connectors.get(intent.connectorId)
    if (!connector) {
      return this.record(
        {
          decision: 'REJECTED',
          stage: 'connector',
          reasons: [`connector "${intent.connectorId}" is not registered — fail-closed`],
          connectorReport: null,
          original: null,
        },
        intent,
        now,
      )
    }
    const report = connector.exportJournalEntries(intent.payload.proposals)

    // 7. Result verification — any doubt rejects (spec §63: "blocage au doute").
    const anomalies: string[] = []
    if (!report.ok) {
      anomalies.push(
        `connector "${connector.id}" refused the batch: ${report.rejected
          .map((r) => `#${r.index}${r.proposalId ? ` (${r.proposalId})` : ''}: ${r.errors.join('; ')}`)
          .join(' | ')}`,
      )
    }
    // Defensive runtime re-checks of what the types already guarantee — the
    // gateway verifies, it does not assume.
    if ((report.mode as string) !== EXECUTION_MODE) {
      anomalies.push(`connector reported mode "${report.mode}" — only "dry-run" is legal`)
    }
    if ((report.writePerformed as boolean) !== false) {
      anomalies.push('connector reported a performed write — forbidden in this phase')
    }
    if (report.ok && report.content === null) {
      anomalies.push('connector reported ok without any content — inconsistent report')
    }
    if (anomalies.length > 0) {
      return this.record(
        {
          decision: 'REJECTED',
          stage: 'verification',
          reasons: anomalies,
          connectorReport: report,
          original: null,
        },
        intent,
        now,
      )
    }

    // 8. Completed — a dry-run, and nothing but a dry-run, happened.
    const result = this.record(
      {
        decision: 'EXECUTED_DRY_RUN',
        stage: 'completed',
        reasons: [
          `dry-run export of ${report.entryCount} proposal(s) (${report.lineCount} line(s)) through connector "${connector.id}" — no real write occurred`,
        ],
        connectorReport: report,
        original: null,
      },
      intent,
      now,
    )
    this.executed.set(intent.idempotencyKey, result)
    return result
  }

  /** Export the structured intent journal (defensive copy, append-only source). */
  exportIntentJournal(): readonly IntentJournalRecord[] {
    return [...this.journal]
  }

  /** Build the result AND append the matching journal record — every decision is logged. */
  private record(
    outcome: {
      decision: GatewayDecision
      stage: GatewayStage
      reasons: readonly string[]
      connectorReport: ConnectorExportReport | null
      original: GatewayResult | null
    },
    envelope: PartialEnvelope,
    now: number,
  ): GatewayResult {
    this.seq += 1
    this.journal.push({
      seq: this.seq,
      at: now,
      intentId: envelope.intentId,
      idempotencyKey: envelope.idempotencyKey,
      agentId: envelope.agentId,
      preparedBy: envelope.preparedBy,
      actionType: envelope.actionType,
      connectorId: envelope.connectorId,
      decision: outcome.decision,
      stage: outcome.stage,
      reasons: outcome.reasons,
    })
    return {
      decision: outcome.decision,
      mode: EXECUTION_MODE,
      writePerformed: false,
      intentId: envelope.intentId,
      idempotencyKey: envelope.idempotencyKey,
      stage: outcome.stage,
      reasons: outcome.reasons,
      connectorReport: outcome.connectorReport,
      original: outcome.original,
      at: now,
    }
  }
}

// Envelope extraction for journaling malformed intents ------------------------

interface PartialEnvelope {
  readonly intentId: string | null
  readonly idempotencyKey: string | null
  readonly agentId: string | null
  readonly preparedBy: string | null
  readonly actionType: FinanceActionType | null
  readonly connectorId: string | null
}

/** Best-effort field extraction so even a rejected malformed intent is journaled. */
function partialEnvelope(raw: unknown): PartialEnvelope {
  const pick = (field: string): string | null => {
    if (typeof raw === 'object' && raw !== null && field in raw) {
      const v = (raw as Record<string, unknown>)[field]
      if (typeof v === 'string' && v.length > 0) return v
    }
    return null
  }
  const action = pick('actionType')
  return {
    intentId: pick('intentId'),
    idempotencyKey: pick('idempotencyKey'),
    agentId: pick('agentId'),
    preparedBy: pick('preparedBy'),
    actionType:
      action && (FINANCE_ACTION_TYPES as readonly string[]).includes(action)
        ? (action as FinanceActionType)
        : null,
    connectorId: pick('connectorId'),
  }
}
