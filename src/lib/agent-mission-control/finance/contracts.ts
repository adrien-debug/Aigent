/**
 * AIG-FIN-001 — versioned output contracts (Accounting Agent Factory).
 *
 * The six structured reports the accounting copilots must produce. Each is a
 * Zod schema, validated at runtime; a critical field missing → the report is
 * REJECTED (never silently coerced). Every contract enforces the spec's hard
 * invariants:
 *
 *   - amounts are lossless decimal strings, NEVER floats;
 *   - provenance + freshness carried on every report
 *     (LIVE/SNAPSHOT/HISTORICAL/FIXTURE/FALLBACK/UNAVAILABLE);
 *   - unavailability is representable and must be stated, not hidden;
 *   - scores/confidence bounded to [0,1];
 *   - the journal entry proposal is the PIVOT FORMAT (spec §32): balanced
 *     debit/credit lines + journal + period + dimensions + evidence +
 *     mandatory approval — every business agent produces it, every connector
 *     consumes it;
 *   - NOTHING here executes: a payment batch is a proposal
 *     (`executed: false`), an entry always `requiresApproval: true`
 *     (separation of duties §47 — self-approval is impossible);
 *   - blocking gates are terminal: a supplier-security BLOCKED or a
 *     controller REJECTED can never be downgraded downstream.
 *
 * Contracts are versioned (`CONTRACT_VERSION`) so a delivered agent and a
 * consumer (connector, Execution Gateway) can pin a shape. SELF-CONTAINED on
 * purpose — pure Zod, no import from truth/snapshot/server code — so the
 * schemas are reusable verbatim in any consumer.
 */

import { z } from 'zod'

export const CONTRACT_VERSION = 'v1.0.0'

// Shared primitives -----------------------------------------------------------

/**
 * Provenance statuses, restated locally (self-contained contract — no import
 * from finance/truth). Must stay in sync with the factory-wide truth model.
 */
const truthStatus = z.enum([
  'LIVE',
  'SNAPSHOT',
  'HISTORICAL',
  'FIXTURE',
  'FALLBACK',
  'UNAVAILABLE',
])

const confidence = z
  .number()
  .min(0)
  .max(1)
  .describe('Calibrated confidence in [0,1]. 1 = certain.')

/** Signed lossless decimal string — money is NEVER a float. */
const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a lossless decimal string, not a float')

/** Non-negative decimal string (journal amounts, payment amounts). */
const nonNegativeDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative lossless decimal string')

/** Accounting period, e.g. "2026-06". */
const accountingPeriod = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be an accounting period YYYY-MM')

/** Calendar date, e.g. "2026-06-30". */
const isoDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'must be an ISO date YYYY-MM-DD')

/** ISO 4217 currency code, e.g. "EUR". */
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 currency code')

/** Evidence document ids — every claim links back to its source pieces. */
const evidenceIds = z.array(z.string().min(1))

/** Provenance every report must carry so nothing is presented as LIVE falsely. */
export const freshnessMetaSchema = z.object({
  truth: truthStatus,
  asOf: z.number().int(),
  /** Sources actually consulted, each with its own truth. */
  sources: z
    .array(
      z.object({
        block: z.string().min(1),
        truth: truthStatus,
        source: z.string().min(1),
      }),
    )
    .min(1),
  /** Blocks that were UNAVAILABLE — explicitly listed, never hidden. */
  unavailable: z.array(z.string()),
})

const commonBase = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  freshness: freshnessMetaSchema,
})

// Decimal comparison helpers (string-based, no float ever) --------------------

/** Scale a non-negative decimal string to a BigInt with `scale` fractional digits. */
function toScaledBigInt(value: string, scale: number): bigint {
  const [int, frac = ''] = value.split('.')
  return BigInt(int + frac.padEnd(scale, '0'))
}

function fractionDigits(value: string): number {
  return (value.split('.')[1] ?? '').length
}

/** Exact decimal equality between two sums of decimal strings. */
function decimalSumsEqual(a: readonly string[], b: readonly string[]): boolean {
  const scale = Math.max(0, ...a.map(fractionDigits), ...b.map(fractionDigits))
  const sum = (xs: readonly string[]): bigint =>
    xs.reduce((acc, v) => acc + toScaledBigInt(v, scale), BigInt(0))
  return sum(a) === sum(b)
}

/** True when a decimal string is exactly zero ("0", "0.00", …). */
function isDecimalZero(value: string): boolean {
  return /^0+(\.0+)?$/.test(value)
}

// 1. JournalEntryProposal — the PIVOT FORMAT (spec §32) -----------------------

/**
 * One line of a proposed entry. Exactly one side (debit XOR credit) must be
 * strictly positive — a line that moves both sides, or neither, is invalid.
 */
export const journalEntryLineSchema = z
  .object({
    accountCode: z.string().min(1).describe('Chart-of-accounts code, e.g. "401000".'),
    accountLabel: z.string().min(1),
    debit: nonNegativeDecimalString,
    credit: nonNegativeDecimalString,
    /** Analytic dimensions (cost center, project, entity…) — free keys, string values. */
    dimensions: z.record(z.string(), z.string()),
    description: z.string().min(1),
  })
  .refine(
    (line) => isDecimalZero(line.debit) !== isDecimalZero(line.credit),
    'a line must carry exactly one side: debit XOR credit strictly positive',
  )

export const journalEntryProposalSchema = commonBase
  .extend({
    kind: z.literal('JournalEntryProposal'),
    proposalId: z.string().min(1),
    journal: z.string().min(1).describe('Journal code, e.g. "ACH", "VTE", "OD".'),
    period: accountingPeriod,
    entryDate: isoDate,
    currency: currencyCode,
    /** At least two lines — a single-line entry can never balance. */
    lines: z.array(journalEntryLineSchema).min(2),
    /** Evidence documents backing the entry — an entry without proof is rejected. */
    evidenceIds: evidenceIds.min(1),
    rationale: z.string().min(1),
    /**
     * ALWAYS true — no agent-produced entry is ever auto-approved
     * (separation of duties §47). The Execution Gateway enforces it again.
     */
    requiresApproval: z.literal(true),
  })
  .refine(
    (entry) =>
      decimalSumsEqual(
        entry.lines.map((l) => l.debit),
        entry.lines.map((l) => l.credit),
      ),
    'entry is unbalanced: sum of debits must equal sum of credits exactly (decimal comparison)',
  )

// 2. InvoiceControlVerdict — 3-way match (controle-factures) ------------------

export const invoiceDiscrepancySchema = z.object({
  type: z.enum(['price', 'quantity', 'discount', 'missing_mention']),
  description: z.string().min(1),
  /** Expected vs observed amounts when quantifiable; null = not applicable/UNAVAILABLE. */
  expected: decimalString.nullable(),
  observed: decimalString.nullable(),
  evidenceIds,
})

export const invoiceControlVerdictSchema = commonBase
  .extend({
    kind: z.literal('InvoiceControlVerdict'),
    invoiceId: z.string().min(1),
    /** null = document not available for the match — stated, never invented. */
    purchaseOrderId: z.string().min(1).nullable(),
    receiptId: z.string().min(1).nullable(),
    verdict: z.enum(['PASS', 'DISCREPANCY', 'BLOCKED']),
    discrepancies: z.array(invoiceDiscrepancySchema),
    justification: z.string().min(1),
    confidence,
  })
  .refine(
    (r) => (r.verdict === 'PASS' ? r.discrepancies.length === 0 : r.discrepancies.length > 0),
    'PASS requires zero discrepancies; DISCREPANCY/BLOCKED require at least one',
  )

// 3. SupplierSecurityAlert — anti-fraud gate (securite-fournisseurs) ----------

export const supplierSecurityReasonSchema = z.object({
  type: z.enum([
    'iban_change',
    'duplicate_bank_account',
    'suspicious_email_domain',
    'unusual_change',
  ]),
  detail: z.string().min(1),
  evidenceIds,
})

export const supplierSecurityAlertSchema = commonBase
  .extend({
    kind: z.literal('SupplierSecurityAlert'),
    supplierId: z.string().min(1),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    reasons: z.array(supplierSecurityReasonSchema),
    /**
     * BLOCKED is TERMINAL (blocking gate, like Sentinel in the trading
     * council): no downstream agent, mission or human shortcut may downgrade
     * it inside the pipeline — only a new, fully re-evaluated alert can clear
     * the supplier.
     */
    decision: z.enum(['CLEARED', 'ENHANCED_VALIDATION', 'BLOCKED']),
    justification: z.string().min(1),
  })
  .refine(
    (r) => (r.decision === 'CLEARED' ? true : r.reasons.length > 0),
    'ENHANCED_VALIDATION/BLOCKED require at least one typed reason',
  )

// 4. DocumentExtraction — invoice fields with per-field truth (documents) -----

/** An extracted field: value + provenance + confidence. UNAVAILABLE ⇔ null value. */
const extractedField = (valueSchema: z.ZodType<string>) =>
  z
    .object({
      value: valueSchema.nullable(),
      truth: truthStatus,
      confidence,
    })
    .refine(
      (f) => (f.truth === 'UNAVAILABLE') === (f.value === null),
      'value must be null if and only if truth is UNAVAILABLE — never invented, never hidden',
    )

export const documentExtractionSchema = commonBase.extend({
  kind: z.literal('DocumentExtraction'),
  documentId: z.string().min(1),
  documentKind: z.enum(['invoice', 'credit_note', 'receipt', 'statement', 'unknown']),
  fields: z.object({
    supplierName: extractedField(z.string().min(1)),
    invoiceNumber: extractedField(z.string().min(1)),
    issueDate: extractedField(isoDate),
    dueDate: extractedField(isoDate),
    currency: extractedField(currencyCode),
    totalExclTax: extractedField(decimalString),
    totalTax: extractedField(decimalString),
    totalInclTax: extractedField(decimalString),
  }),
  /** Extra fields found on the document, same per-field truth discipline. */
  extraFields: z.array(
    z.object({
      field: z.string().min(1),
      extraction: extractedField(z.string().min(1)),
    }),
  ),
  /** Fields that were UNAVAILABLE — explicitly listed, never hidden. */
  unavailableFields: z.array(z.string()),
  /** Quality flags the reader must surface (missing pages, unreadable zones…). */
  qualityIssues: z.array(z.string()),
})

// 5. PaymentBatchProposal — prepared, NEVER executed (paiements-fournisseurs) -

export const paymentProposalSchema = z.object({
  paymentId: z.string().min(1),
  supplierId: z.string().min(1),
  invoiceIds: z.array(z.string().min(1)).min(1),
  amount: nonNegativeDecimalString,
  dueDate: isoDate,
  priority: z.enum(['critical', 'high', 'normal', 'low']),
  /** Bank details status — UNVERIFIED/UNAVAILABLE must block execution downstream. */
  bankDetailsCheck: z.enum(['VERIFIED', 'UNVERIFIED', 'UNAVAILABLE']),
  evidenceIds,
})

export const paymentBatchProposalSchema = commonBase
  .extend({
    kind: z.literal('PaymentBatchProposal'),
    batchId: z.string().min(1),
    currency: currencyCode,
    payments: z.array(paymentProposalSchema).min(1),
    totalAmount: nonNegativeDecimalString,
    /** Human/system validations required before any transmission. Never empty. */
    requiredValidations: z.array(z.string().min(1)).min(1),
    /**
     * ALWAYS false — this factory never executes a payment. Execution belongs
     * to the authorized payment system, after the required validations.
     */
    executed: z.literal(false),
    requiresApproval: z.literal(true),
  })
  .refine(
    (batch) =>
      decimalSumsEqual(
        [batch.totalAmount],
        batch.payments.map((p) => p.amount),
      ),
    'totalAmount must equal the exact decimal sum of the payment amounts',
  )

// 6. ControllerVerdict — independent re-verification (controleur-general) -----

export const redoneControlSchema = z.object({
  control: z.string().min(1).describe('Which control was independently redone.'),
  result: z.enum(['CONFIRMED', 'DIVERGENT', 'UNAVAILABLE']),
  detail: z.string().min(1),
  evidenceIds,
})

export const controllerVerdictSchema = commonBase
  .extend({
    kind: z.literal('ControllerVerdict'),
    /** What was reviewed — a proposal, an entry, a mission output… */
    subjectKind: z.string().min(1),
    subjectId: z.string().min(1),
    /**
     * REJECTED is TERMINAL (blocking gate): the reviewed action must not
     * proceed; only a corrected resubmission re-enters the pipeline.
     */
    verdict: z.enum(['ACCEPTED', 'NEEDS_REVIEW', 'REJECTED']),
    /** Controls independently redone — a verdict without re-verification is invalid. */
    controlsRedone: z.array(redoneControlSchema).min(1),
    contradictions: z.array(
      z.object({
        description: z.string().min(1),
        evidenceIds,
      }),
    ),
    justification: z.string().min(1),
    confidence,
  })
  .refine(
    (r) =>
      r.verdict === 'ACCEPTED'
        ? r.contradictions.length === 0 &&
          r.controlsRedone.every((c) => c.result === 'CONFIRMED')
        : true,
    'ACCEPTED requires zero contradictions and every redone control CONFIRMED',
  )

// Registry -------------------------------------------------------------------

export const CONTRACTS = {
  JournalEntryProposal: journalEntryProposalSchema,
  InvoiceControlVerdict: invoiceControlVerdictSchema,
  SupplierSecurityAlert: supplierSecurityAlertSchema,
  DocumentExtraction: documentExtractionSchema,
  PaymentBatchProposal: paymentBatchProposalSchema,
  ControllerVerdict: controllerVerdictSchema,
} as const

export type FinanceContractName = keyof typeof CONTRACTS

export type JournalEntryLine = z.infer<typeof journalEntryLineSchema>
export type JournalEntryProposal = z.infer<typeof journalEntryProposalSchema>
export type InvoiceControlVerdict = z.infer<typeof invoiceControlVerdictSchema>
export type SupplierSecurityAlert = z.infer<typeof supplierSecurityAlertSchema>
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>
export type PaymentBatchProposal = z.infer<typeof paymentBatchProposalSchema>
export type ControllerVerdict = z.infer<typeof controllerVerdictSchema>

export interface ContractValidation {
  ok: boolean
  errors: string[]
}

/** Validate an unknown payload against a named contract. Never throws. */
export function validateContract(
  name: FinanceContractName,
  payload: unknown,
): ContractValidation {
  const schema = CONTRACTS[name] as z.ZodType
  const r = schema.safeParse(payload)
  if (r.success) return { ok: true, errors: [] }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  }
}
