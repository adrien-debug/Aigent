/**
 * AIG-FIN-001 — normalized FinanceSnapshot model (Accounting Agent Factory).
 *
 * The single shape every accounting tool returns — the finance mirror of
 * `market/snapshot.ts`. Every block is provenance-tagged through `Provenance`
 * (truth.ts); amounts are lossless decimal strings, never floats. A snapshot
 * NEVER invents a value: a missing block is `null` with an `UNAVAILABLE`
 * provenance recorded in `sources`.
 *
 * The pivot of the whole factory is `JournalEntryDraft` (spec §32): balanced
 * debit/credit lines + journal + period + dimensions + evidence + approval.
 * Every business agent produces this format; every connector consumes it. It
 * is a DRAFT by construction — nothing here can reach an ERP: no write path,
 * no client, no side effect. The Execution Gateway (separate lot) is the only
 * door, and it is a read-only stub in this pass.
 */

import type {
  CurrencyCode,
  DecimalString,
  IsoDateString,
  Period,
  Provenance,
  TruthStatus,
} from './truth'
import { compareDecimal, sumDecimal } from './truth'

// Suppliers -------------------------------------------------------------------

export type SupplierStatus = 'active' | 'pending-validation' | 'blocked' | 'inactive'

export const SUPPLIER_STATUSES: readonly SupplierStatus[] = [
  'active',
  'pending-validation',
  'blocked',
  'inactive',
]

/**
 * One bank-coordinate record in a supplier's IBAN history. The FULL trail is
 * kept (not just the current IBAN): the fraud agent (sécurité-fournisseurs)
 * reasons on changes — a new IBAN with no history is a red flag, not a fact.
 */
export interface SupplierIbanRecord {
  iban: string
  /** Calendar date the IBAN became effective; null when unknown. */
  validFrom: IsoDateString | null
  /** Calendar date the IBAN stopped being used; null while in force. */
  validTo: IsoDateString | null
  /** True for the coordinates currently in force. */
  current: boolean
}

export interface NormalizedSupplier {
  id: string
  name: string
  /** Full IBAN history, most recent first. Empty = no known bank coordinates. */
  ibans: SupplierIbanRecord[]
  email: string | null
  /** Lower-cased domain of `email` ("acme.com") — fraud checks compare domains. */
  emailDomain: string | null
  vatNumber: string | null
  status: SupplierStatus
}

// Invoices --------------------------------------------------------------------

export type InvoiceStatus =
  | 'received'
  | 'extracted'
  | 'matched'
  | 'pending-approval'
  | 'approved'
  | 'posted'
  | 'paid'
  | 'disputed'
  | 'rejected'

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'received',
  'extracted',
  'matched',
  'pending-approval',
  'approved',
  'posted',
  'paid',
  'disputed',
  'rejected',
]

/** One invoice line. All amounts are lossless decimal strings. */
export interface InvoiceLine {
  description: string
  /** Quantity, decimal string; null when the line has no quantity notion. */
  quantity: DecimalString | null
  /** Unit price excluding tax, decimal string; null when not itemised. */
  unitPrice: DecimalString | null
  /** Net amount (HT) of the line. */
  netAmount: DecimalString
  /** Tax code applied to the line; null when unknown. */
  taxCode: string | null
  /** Tax amount (TVA) of the line; null when unknown. */
  taxAmount: DecimalString | null
  /** Gross amount (TTC) of the line; null when unknown. */
  grossAmount: DecimalString | null
  /** Proposed chart-of-accounts code; null before mapping. */
  accountCode: string | null
  /** Analytic dimensions (cost center, project…), key → value. */
  dimensions: Record<string, string>
}

export interface NormalizedInvoice {
  id: string
  /** Resolved supplier id; null when the supplier is not yet identified. */
  supplierId: string | null
  /** Supplier-issued invoice number, as printed on the document. */
  invoiceNumber: string
  issueDate: IsoDateString | null
  dueDate: IsoDateString | null
  receivedDate: IsoDateString | null
  lines: InvoiceLine[]
  currency: CurrencyCode
  /** Total excluding tax (HT). */
  totalNet: DecimalString
  /** Total tax (TVA). */
  totalTax: DecimalString
  /** Total including tax (TTC). */
  totalGross: DecimalString
  /** Purchase orders this invoice claims to bill (3-way match input). */
  purchaseOrderRefs: string[]
  /** Goods receipts this invoice claims to bill (3-way match input). */
  goodsReceiptRefs: string[]
  status: InvoiceStatus
}

// Purchase orders -------------------------------------------------------------

export type PurchaseOrderStatus =
  | 'open'
  | 'partially-received'
  | 'received'
  | 'closed'
  | 'cancelled'

export const PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  'open',
  'partially-received',
  'received',
  'closed',
  'cancelled',
]

export interface PurchaseOrderLine {
  description: string
  quantityOrdered: DecimalString
  /** Unit price excluding tax; null when the PO is amount-only. */
  unitPrice: DecimalString | null
  /** Net amount (HT) of the line. */
  netAmount: DecimalString
}

export interface NormalizedPurchaseOrder {
  id: string
  supplierId: string | null
  orderNumber: string
  orderDate: IsoDateString | null
  currency: CurrencyCode
  lines: PurchaseOrderLine[]
  /** Total excluding tax (HT). */
  totalNet: DecimalString
  status: PurchaseOrderStatus
}

// Goods receipts --------------------------------------------------------------

export type GoodsReceiptStatus = 'draft' | 'confirmed' | 'cancelled'

export const GOODS_RECEIPT_STATUSES: readonly GoodsReceiptStatus[] = [
  'draft',
  'confirmed',
  'cancelled',
]

export interface GoodsReceiptLine {
  /** 0-based index of the matching PO line; null when unmatched. */
  purchaseOrderLineIndex: number | null
  description: string
  quantityReceived: DecimalString
}

export interface NormalizedGoodsReceipt {
  id: string
  /** The purchase order this receipt fulfils; null when unmatched. */
  purchaseOrderRef: string | null
  receiptNumber: string
  receiptDate: IsoDateString | null
  lines: GoodsReceiptLine[]
  status: GoodsReceiptStatus
}

// Bank transactions -----------------------------------------------------------

export type BankTransactionMatchStatus = 'unmatched' | 'matched' | 'suspense'

export const BANK_TRANSACTION_MATCH_STATUSES: readonly BankTransactionMatchStatus[] = [
  'unmatched',
  'matched',
  'suspense',
]

export interface NormalizedBankTransaction {
  id: string
  /** IBAN of OUR bank account the transaction hit; null when unknown. */
  accountIban: string | null
  bookingDate: IsoDateString
  valueDate: IsoDateString | null
  /** Signed amount, decimal string: negative = money out, positive = money in. */
  amount: DecimalString
  currency: CurrencyCode
  /** Raw bank statement label, untouched. */
  rawDescription: string
  /** Normalized label after cleanup; null before normalization. */
  normalizedDescription: string | null
  counterpartyName: string | null
  counterpartyIban: string | null
  /** Payment reference / end-to-end id; null when absent. */
  reference: string | null
  matchStatus: BankTransactionMatchStatus
}

// Chart of accounts & tax codes -----------------------------------------------

export type AccountKind = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export const ACCOUNT_KINDS: readonly AccountKind[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
]

/** A reference into the entity's chart of accounts. */
export interface AccountRef {
  /** Account code in the entity's chart ("401000", "606100"…). */
  code: string
  label: string
  kind: AccountKind
}

export type TaxKind = 'input' | 'output' | 'exempt' | 'reverse-charge'

export const TAX_KINDS: readonly TaxKind[] = [
  'input',
  'output',
  'exempt',
  'reverse-charge',
]

export interface TaxCode {
  code: string
  label: string
  /** Rate percent as a decimal string ("20", "5.5", "0"). */
  ratePct: DecimalString
  /** Jurisdiction the code belongs to ("FR", "UK", "AE"…). */
  jurisdiction: string
  kind: TaxKind
}

// Journal entry draft — the PIVOT format (spec §32) ---------------------------

export type ApprovalStatus = 'draft' | 'pending-approval' | 'approved' | 'rejected'

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'draft',
  'pending-approval',
  'approved',
  'rejected',
]

/**
 * One debit/credit line of a journal entry. Exactly ONE of `debit`/`credit`
 * is set (the other is null) and the set amount is >= 0 — `isBalanced` treats
 * any other shape as invalid.
 */
export interface JournalLine {
  accountCode: string
  debit: DecimalString | null
  credit: DecimalString | null
  description: string | null
  /** Analytic dimensions (cost center, project…), key → value. */
  dimensions: Record<string, string>
  taxCode: string | null
}

/**
 * Approval state of a draft. Separation of duties (spec §47) is structural:
 * the preparer can never be the approver — `violatesSeparationOfDuties`
 * detects the breach, and no agent in this factory can approve at all (the
 * whole layer is read-only / dry-run).
 */
export interface EntryApproval {
  status: ApprovalStatus
  /** Id of the agent/human that prepared the draft. */
  preparedBy: string
  /** Id of the approver; null until approved. NEVER equal to `preparedBy`. */
  approvedBy: string | null
}

export type EvidenceKind =
  | 'invoice'
  | 'purchase-order'
  | 'goods-receipt'
  | 'bank-transaction'
  | 'document'
  | 'other'

/** A link from an entry to the source piece that justifies it. */
export interface EvidenceRef {
  kind: EvidenceKind
  id: string
}

/**
 * The pivot format every business agent produces and every connector consumes:
 * balanced debit/credit lines + journal + period + dimensions + evidence +
 * approval. A DRAFT only — posting is the Execution Gateway's exclusive door,
 * stubbed read-only in this pass.
 */
export interface JournalEntryDraft {
  id: string
  /** Journal code ("AC", "BQ", "OD"…). */
  journal: string
  period: Period
  entryDate: IsoDateString
  description: string
  currency: CurrencyCode
  lines: JournalLine[]
  /** Source pieces justifying the entry (invoice, receipt, bank txn…). */
  evidence: EvidenceRef[]
  approval: EntryApproval
}

/** Lossless debit/credit totals of an entry. Invalid lines make it unbalanced. */
export function entryTotals(entry: JournalEntryDraft): {
  debit: DecimalString
  credit: DecimalString
} {
  return {
    debit: sumDecimal(
      entry.lines.map((l) => l.debit).filter((d): d is DecimalString => d !== null)
    ),
    credit: sumDecimal(
      entry.lines.map((l) => l.credit).filter((c): c is DecimalString => c !== null)
    ),
  }
}

/**
 * True when the entry is well-formed AND balanced: at least one line, every
 * line carries exactly one side with a non-negative amount, and total debit
 * equals total credit — all compared losslessly on strings, never on floats.
 */
export function isBalanced(entry: JournalEntryDraft): boolean {
  if (entry.lines.length === 0) return false
  for (const line of entry.lines) {
    const hasDebit = line.debit !== null
    const hasCredit = line.credit !== null
    if (hasDebit === hasCredit) return false
    const amount = hasDebit ? line.debit : line.credit
    if (amount === null || compareDecimal(amount, '0') < 0) return false
  }
  const totals = entryTotals(entry)
  return compareDecimal(totals.debit, totals.credit) === 0
}

/** True when the preparer approved their own entry (§47 breach — always a block). */
export function violatesSeparationOfDuties(entry: JournalEntryDraft): boolean {
  return (
    entry.approval.approvedBy !== null &&
    entry.approval.approvedBy === entry.approval.preparedBy
  )
}

// Aggregated snapshot ---------------------------------------------------------

/**
 * A per-block provenance record: each populated block of the snapshot points to
 * the provenance that produced it, so a consumer can see EXACTLY which parts
 * are LIVE/SNAPSHOT/UNAVAILABLE. `block` is the snapshot field name.
 */
export interface SnapshotSource {
  block: string
  provenance: Provenance
}

/**
 * The normalized snapshot. Any block may be `null` (UNAVAILABLE) — the matching
 * `sources[]` entry then carries `truth: 'UNAVAILABLE'` and a reason. The
 * top-level `truth` is the WORST truth across populated blocks (a snapshot is
 * only as trustworthy as its least-fresh datum).
 */
export interface FinanceSnapshot {
  /** Legal entity the snapshot answers for. */
  entityId: string
  /** Accounting period in scope; null when the snapshot is not period-bound. */
  period: Period | null
  /** Point-in-time this snapshot answers for (epoch ms). */
  asOf: number
  /** Worst truth status across all populated blocks. */
  truth: TruthStatus
  suppliers: NormalizedSupplier[] | null
  invoices: NormalizedInvoice[] | null
  purchaseOrders: NormalizedPurchaseOrder[] | null
  goodsReceipts: NormalizedGoodsReceipt[] | null
  bankTransactions: NormalizedBankTransaction[] | null
  chartOfAccounts: AccountRef[] | null
  taxCodes: TaxCode[] | null
  journalEntryDrafts: JournalEntryDraft[] | null
  /** Per-block provenance, one entry per attempted block. */
  sources: SnapshotSource[]
  /** Overall data completeness in [0,1]: populated blocks / attempted blocks. */
  completeness: number
}

/** Compute the worst (least trustworthy) truth across provenances. */
export function worstTruth(sources: SnapshotSource[]): TruthStatus {
  const order: TruthStatus[] = [
    'LIVE',
    'SNAPSHOT',
    'HISTORICAL',
    'FALLBACK',
    'FIXTURE',
    'UNAVAILABLE',
  ]
  let worst: TruthStatus = 'LIVE'
  let worstRank = -1
  for (const s of sources) {
    const rank = order.indexOf(s.provenance.truth)
    if (rank > worstRank) {
      worstRank = rank
      worst = s.provenance.truth
    }
  }
  return worst
}
