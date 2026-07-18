/**
 * AIG-FIN-001 — labeled Accounts Payable fixtures (lab-only).
 *
 * Hand-authored, DETERMINISTIC AP dataset — the finance mirror of
 * `market/fixtures/scenarios.ts`. Everything is FROZEN at a fixed base instant
 * (no Date.now(), no Math.random()), so the same fixture always yields
 * byte-identical data, and it is ALWAYS served with truth: 'FIXTURE' — it can
 * never be mistaken for a LIVE ERP read. No network, no LLM, no secret, no
 * ERP write path: pure data.
 *
 * The set is small but adversarial by design, so the P1 AP agents have real
 * work to do:
 *   - one HEALTHY supplier (stable IBAN since 2019) and one supplier whose
 *     IBAN was RECENTLY CHANGED to a foreign account (fraud-agent red flag);
 *   - one invoice that 3-way matches its PO + goods receipt exactly;
 *   - one invoice with a +10% unit-price variance vs its PO;
 *   - one DUPLICATE invoice (same supplier + same invoice number + same
 *     amounts as the matched one, re-received later);
 *   - one already-paid invoice tied to a matched bank transaction, plus an
 *     unmatched credit and a suspense debit hitting the changed-IBAN supplier;
 *   - a matching chart of accounts (French PCG), tax codes, open missions and
 *     dry-run payment statuses.
 */

import type { Provenance } from '../truth'
import { makeProvenance } from '../truth'
import type {
  AccountRef,
  NormalizedBankTransaction,
  NormalizedGoodsReceipt,
  NormalizedInvoice,
  NormalizedPurchaseOrder,
  NormalizedSupplier,
  TaxCode,
} from '../snapshot'
import type { CurrencyCode, DecimalString, IsoDateString } from '../truth'

/** Frozen instant the whole fixture set answers for: 2026-07-01T00:00:00Z. */
export const AP_FIXTURE_AS_OF = 1_782_864_000_000

/** Legal entity all fixtures belong to. */
export const AP_FIXTURE_ENTITY_ID = 'entity-fr-main'

/** Source id prefix carried by every fixture provenance. */
export const AP_FIXTURE_SOURCE = 'fixture:ap-baseline'

/**
 * Provenance for one fixture block. Truth is ALWAYS 'FIXTURE' and asOf is
 * pinned to the set's own frozen instant — a fixture answers for its own
 * moment, never for "now" (no temporal leak).
 */
export function apFixtureProvenance(block: string): Provenance {
  return makeProvenance({
    source: `${AP_FIXTURE_SOURCE}:${block}`,
    sourceType: 'fixture',
    truth: 'FIXTURE',
    dataTimestamp: AP_FIXTURE_AS_OF,
    asOf: AP_FIXTURE_AS_OF,
    maxAgeMs: null,
    confidence: 1,
  })
}

// Open missions ---------------------------------------------------------------

export type ApMissionKind =
  | '3-way-match'
  | 'iban-verification'
  | 'duplicate-review'
  | 'entry-preparation'
  | 'payment-preparation'

export const AP_MISSION_KINDS: readonly ApMissionKind[] = [
  '3-way-match',
  'iban-verification',
  'duplicate-review',
  'entry-preparation',
  'payment-preparation',
]

export type ApMissionStatus = 'open' | 'in-progress' | 'blocked' | 'done'

export const AP_MISSION_STATUSES: readonly ApMissionStatus[] = [
  'open',
  'in-progress',
  'blocked',
  'done',
]

export type ApMissionSubjectKind =
  | 'invoice'
  | 'supplier'
  | 'purchase-order'
  | 'payment-batch'

/** One mission on the AP work queue (created by Finance Command, read-only here). */
export interface ApMission {
  id: string
  kind: ApMissionKind
  /** The object the mission is about. */
  subject: { kind: ApMissionSubjectKind; id: string }
  status: ApMissionStatus
  /** Agent slug the mission is assigned to; null when unassigned. */
  assignedAgent: string | null
  createdDate: IsoDateString
  dueDate: IsoDateString | null
  /** Only set when status === 'blocked': why. */
  blockedReason: string | null
  description: string
}

// Payment statuses ------------------------------------------------------------

/**
 * Dry-run payment lifecycle. Nothing in this factory can EXECUTE a payment —
 * 'sent-for-execution'/'executed' states can only be OBSERVED (read back from
 * an authorized external system), never produced here.
 */
export type PaymentState =
  | 'not-scheduled'
  | 'on-hold'
  | 'scheduled'
  | 'sent-for-execution'
  | 'executed'

export const PAYMENT_STATES: readonly PaymentState[] = [
  'not-scheduled',
  'on-hold',
  'scheduled',
  'sent-for-execution',
  'executed',
]

/** Read-only payment status of one invoice. */
export interface PaymentStatusRecord {
  invoiceId: string
  state: PaymentState
  /** Planned execution date; null unless scheduled. */
  scheduledDate: IsoDateString | null
  /** Observed execution date; null unless executed. */
  executedDate: IsoDateString | null
  amount: DecimalString
  currency: CurrencyCode
  /** Payment batch the invoice belongs to; null when not batched. */
  batchRef: string | null
  /** Matched bank transaction id once executed; null before. */
  bankTransactionRef: string | null
  note: string | null
}

// The fixture set -------------------------------------------------------------

export interface ApFixtureSet {
  entityId: string
  /** Frozen epoch ms the set answers for. */
  asOf: number
  suppliers: NormalizedSupplier[]
  invoices: NormalizedInvoice[]
  purchaseOrders: NormalizedPurchaseOrder[]
  goodsReceipts: NormalizedGoodsReceipt[]
  bankTransactions: NormalizedBankTransaction[]
  chartOfAccounts: AccountRef[]
  taxCodes: TaxCode[]
  openMissions: ApMission[]
  paymentStatuses: PaymentStatusRecord[]
}

const SUPPLIERS: NormalizedSupplier[] = [
  {
    // Healthy supplier: one stable IBAN since 2019, active, nothing to flag.
    id: 'sup-nordic-office',
    name: 'Nordic Office Supplies',
    ibans: [
      {
        iban: 'FR7630006000011234567890189',
        validFrom: '2019-03-11',
        validTo: null,
        current: true,
      },
    ],
    email: 'billing@nordicoffice.fr',
    emailDomain: 'nordicoffice.fr',
    vatNumber: 'FR32123456789',
    status: 'active',
  },
  {
    // Fraud-agent case: IBAN changed 7 days before asOf, from a French account
    // held since 2020 to a FOREIGN (LT) account — pending reinforced validation.
    id: 'sup-helios-cloud',
    name: 'Helios Cloud Services',
    ibans: [
      {
        iban: 'LT601010012345678901',
        validFrom: '2026-06-24',
        validTo: null,
        current: true,
      },
      {
        iban: 'FR7630004000031234567890143',
        validFrom: '2020-01-15',
        validTo: '2026-06-24',
        current: false,
      },
    ],
    email: 'accounts@helios-cloud.io',
    emailDomain: 'helios-cloud.io',
    vatNumber: 'FR45987654321',
    status: 'pending-validation',
  },
]

const PURCHASE_ORDERS: NormalizedPurchaseOrder[] = [
  {
    id: 'po-2026-051',
    supplierId: 'sup-nordic-office',
    orderNumber: 'PO-2026-051',
    orderDate: '2026-06-02',
    currency: 'EUR',
    lines: [
      {
        description: 'Chaise de bureau ergonomique — modèle K2',
        quantityOrdered: '10',
        unitPrice: '245.00',
        netAmount: '2450.00',
      },
    ],
    totalNet: '2450.00',
    status: 'received',
  },
  {
    id: 'po-2026-052',
    supplierId: 'sup-helios-cloud',
    orderNumber: 'PO-2026-052',
    orderDate: '2026-05-20',
    currency: 'EUR',
    lines: [
      {
        description: 'Licences suite collaborative — 500 sièges, abonnement annuel',
        quantityOrdered: '500',
        unitPrice: '36.00',
        netAmount: '18000.00',
      },
    ],
    totalNet: '18000.00',
    status: 'received',
  },
]

const GOODS_RECEIPTS: NormalizedGoodsReceipt[] = [
  {
    id: 'gr-2026-091',
    purchaseOrderRef: 'PO-2026-051',
    receiptNumber: 'GR-2026-091',
    receiptDate: '2026-06-12',
    lines: [
      {
        purchaseOrderLineIndex: 0,
        description: 'Chaise de bureau ergonomique — modèle K2',
        quantityReceived: '10',
      },
    ],
    status: 'confirmed',
  },
  {
    id: 'gr-2026-092',
    purchaseOrderRef: 'PO-2026-052',
    receiptNumber: 'GR-2026-092',
    receiptDate: '2026-06-01',
    lines: [
      {
        purchaseOrderLineIndex: 0,
        description: 'Activation licences suite collaborative — 500 sièges',
        quantityReceived: '500',
      },
    ],
    status: 'confirmed',
  },
]

const INVOICES: NormalizedInvoice[] = [
  {
    // 3-way CONFORMANT: quantities, unit price and totals match PO + receipt.
    id: 'inv-2026-0107',
    supplierId: 'sup-nordic-office',
    invoiceNumber: 'NO-2026-0417',
    issueDate: '2026-06-15',
    dueDate: '2026-07-15',
    receivedDate: '2026-06-16',
    lines: [
      {
        description: 'Chaise de bureau ergonomique — modèle K2',
        quantity: '10',
        unitPrice: '245.00',
        netAmount: '2450.00',
        taxCode: 'FR20',
        taxAmount: '490.00',
        grossAmount: '2940.00',
        accountCode: '606300',
        dimensions: { costCenter: 'CC-OPS' },
      },
    ],
    currency: 'EUR',
    totalNet: '2450.00',
    totalTax: '490.00',
    totalGross: '2940.00',
    purchaseOrderRefs: ['PO-2026-051'],
    goodsReceiptRefs: ['GR-2026-091'],
    status: 'matched',
  },
  {
    // PRICE VARIANCE: billed at 39.60 vs 36.00 ordered (+10% per unit).
    id: 'inv-2026-0108',
    supplierId: 'sup-helios-cloud',
    invoiceNumber: 'HC-88412',
    issueDate: '2026-06-20',
    dueDate: '2026-07-20',
    receivedDate: '2026-06-21',
    lines: [
      {
        description: 'Licences suite collaborative — 500 sièges, abonnement annuel',
        quantity: '500',
        unitPrice: '39.60',
        netAmount: '19800.00',
        taxCode: 'FR20',
        taxAmount: '3960.00',
        grossAmount: '23760.00',
        accountCode: '651100',
        dimensions: { costCenter: 'CC-IT' },
      },
    ],
    currency: 'EUR',
    totalNet: '19800.00',
    totalTax: '3960.00',
    totalGross: '23760.00',
    purchaseOrderRefs: ['PO-2026-052'],
    goodsReceiptRefs: ['GR-2026-092'],
    status: 'extracted',
  },
  {
    // DUPLICATE of inv-2026-0107: same supplier, same invoice number, same
    // amounts — re-received 12 days later as a fresh document.
    id: 'inv-2026-0109',
    supplierId: 'sup-nordic-office',
    invoiceNumber: 'NO-2026-0417',
    issueDate: '2026-06-15',
    dueDate: '2026-07-15',
    receivedDate: '2026-06-28',
    lines: [
      {
        description: 'Chaise de bureau ergonomique — modèle K2',
        quantity: '10',
        unitPrice: '245.00',
        netAmount: '2450.00',
        taxCode: 'FR20',
        taxAmount: '490.00',
        grossAmount: '2940.00',
        accountCode: null,
        dimensions: {},
      },
    ],
    currency: 'EUR',
    totalNet: '2450.00',
    totalTax: '490.00',
    totalGross: '2940.00',
    purchaseOrderRefs: ['PO-2026-051'],
    goodsReceiptRefs: [],
    status: 'received',
  },
  {
    // Already PAID: ties the payment-status fixture to a matched bank txn.
    id: 'inv-2026-0071',
    supplierId: 'sup-nordic-office',
    invoiceNumber: 'NO-2026-0301',
    issueDate: '2026-05-05',
    dueDate: '2026-06-05',
    receivedDate: '2026-05-06',
    lines: [
      {
        description: 'Papier et fournitures administratives — mai 2026',
        quantity: null,
        unitPrice: null,
        netAmount: '620.00',
        taxCode: 'FR20',
        taxAmount: '124.00',
        grossAmount: '744.00',
        accountCode: '606400',
        dimensions: { costCenter: 'CC-OPS' },
      },
    ],
    currency: 'EUR',
    totalNet: '620.00',
    totalTax: '124.00',
    totalGross: '744.00',
    purchaseOrderRefs: [],
    goodsReceiptRefs: [],
    status: 'paid',
  },
]

const BANK_TRANSACTIONS: NormalizedBankTransaction[] = [
  {
    // Matched outgoing payment of inv-2026-0071.
    id: 'btx-2026-1001',
    accountIban: 'FR7630001007941234567890185',
    bookingDate: '2026-06-08',
    valueDate: '2026-06-08',
    amount: '-744.00',
    currency: 'EUR',
    rawDescription: 'VIR SEPA NORDIC OFFICE SUPPLIES NO-2026-0301',
    normalizedDescription: 'Virement Nordic Office Supplies — NO-2026-0301',
    counterpartyName: 'Nordic Office Supplies',
    counterpartyIban: 'FR7630006000011234567890189',
    reference: 'NO-2026-0301',
    matchStatus: 'matched',
  },
  {
    // Unmatched incoming credit — not an AP item, honest noise for matching.
    id: 'btx-2026-1002',
    accountIban: 'FR7630001007941234567890185',
    bookingDate: '2026-06-27',
    valueDate: '2026-06-27',
    amount: '1500.00',
    currency: 'EUR',
    rawDescription: 'VIR RECU ACME INDUSTRIES SARL',
    normalizedDescription: null,
    counterpartyName: 'Acme Industries SARL',
    counterpartyIban: null,
    reference: null,
    matchStatus: 'unmatched',
  },
  {
    // Suspense debit to the changed-IBAN supplier's OLD account, no reference.
    id: 'btx-2026-1003',
    accountIban: 'FR7630001007941234567890185',
    bookingDate: '2026-06-29',
    valueDate: '2026-06-29',
    amount: '-980.00',
    currency: 'EUR',
    rawDescription: 'PRLV HELIOS CLOUD SERVICES',
    normalizedDescription: 'Prélèvement Helios Cloud Services',
    counterpartyName: 'Helios Cloud Services',
    counterpartyIban: 'FR7630004000031234567890143',
    reference: null,
    matchStatus: 'suspense',
  },
]

const CHART_OF_ACCOUNTS: AccountRef[] = [
  { code: '401000', label: 'Fournisseurs', kind: 'liability' },
  { code: '411000', label: 'Clients', kind: 'asset' },
  {
    code: '445660',
    label: 'TVA déductible sur autres biens et services',
    kind: 'asset',
  },
  { code: '471000', label: "Compte d'attente", kind: 'asset' },
  { code: '512000', label: 'Banque', kind: 'asset' },
  {
    code: '606300',
    label: "Fournitures d'entretien et de petit équipement",
    kind: 'expense',
  },
  { code: '606400', label: 'Fournitures administratives', kind: 'expense' },
  {
    code: '651100',
    label: 'Redevances pour licences logicielles',
    kind: 'expense',
  },
]

const TAX_CODES: TaxCode[] = [
  {
    code: 'FR20',
    label: 'TVA déductible 20 %',
    ratePct: '20',
    jurisdiction: 'FR',
    kind: 'input',
  },
  {
    code: 'FR055',
    label: 'TVA déductible 5,5 %',
    ratePct: '5.5',
    jurisdiction: 'FR',
    kind: 'input',
  },
  {
    code: 'FR00',
    label: 'Exonéré de TVA',
    ratePct: '0',
    jurisdiction: 'FR',
    kind: 'exempt',
  },
  {
    code: 'FRAE',
    label: 'Autoliquidation (reverse charge)',
    ratePct: '0',
    jurisdiction: 'FR',
    kind: 'reverse-charge',
  },
  {
    code: 'UK20',
    label: 'UK VAT 20 %',
    ratePct: '20',
    jurisdiction: 'UK',
    kind: 'input',
  },
]

const OPEN_MISSIONS: ApMission[] = [
  {
    id: 'mis-2026-201',
    kind: '3-way-match',
    subject: { kind: 'invoice', id: 'inv-2026-0108' },
    status: 'in-progress',
    assignedAgent: 'agent-controle-factures',
    createdDate: '2026-06-21',
    dueDate: '2026-07-03',
    blockedReason: null,
    description:
      'Verify invoice HC-88412 against PO-2026-052 + GR-2026-092 — unit price variance suspected.',
  },
  {
    id: 'mis-2026-202',
    kind: 'iban-verification',
    subject: { kind: 'supplier', id: 'sup-helios-cloud' },
    status: 'blocked',
    assignedAgent: 'agent-securite-fournisseurs',
    createdDate: '2026-06-24',
    dueDate: '2026-07-01',
    blockedReason:
      'IBAN changed on 2026-06-24 from a FR account held since 2020 to a foreign (LT) account — reinforced validation required before any payment.',
    description:
      'Reinforced validation of Helios Cloud Services bank coordinates after recent IBAN change.',
  },
  {
    id: 'mis-2026-203',
    kind: 'duplicate-review',
    subject: { kind: 'invoice', id: 'inv-2026-0109' },
    status: 'open',
    assignedAgent: 'agent-fournisseurs',
    createdDate: '2026-06-28',
    dueDate: '2026-07-05',
    blockedReason: null,
    description:
      'Invoice NO-2026-0417 received twice (inv-2026-0107 already matched) — confirm duplicate and reject.',
  },
  {
    id: 'mis-2026-204',
    kind: 'entry-preparation',
    subject: { kind: 'invoice', id: 'inv-2026-0107' },
    status: 'open',
    assignedAgent: 'agent-ecritures',
    createdDate: '2026-06-17',
    dueDate: '2026-07-02',
    blockedReason: null,
    description:
      'Prepare the balanced journal entry draft for matched invoice NO-2026-0417.',
  },
  {
    id: 'mis-2026-205',
    kind: 'payment-preparation',
    subject: { kind: 'payment-batch', id: 'LOT-2026-07A' },
    status: 'in-progress',
    assignedAgent: 'agent-paiements-fournisseurs',
    createdDate: '2026-06-30',
    dueDate: '2026-07-10',
    blockedReason: null,
    description:
      'Prepare (WITHOUT executing) payment batch LOT-2026-07A for approved invoices due mid-July.',
  },
]

const PAYMENT_STATUSES: PaymentStatusRecord[] = [
  {
    invoiceId: 'inv-2026-0071',
    state: 'executed',
    scheduledDate: '2026-06-08',
    executedDate: '2026-06-08',
    amount: '744.00',
    currency: 'EUR',
    batchRef: 'LOT-2026-06B',
    bankTransactionRef: 'btx-2026-1001',
    note: null,
  },
  {
    invoiceId: 'inv-2026-0107',
    state: 'scheduled',
    scheduledDate: '2026-07-15',
    executedDate: null,
    amount: '2940.00',
    currency: 'EUR',
    batchRef: 'LOT-2026-07A',
    bankTransactionRef: null,
    note: 'Batch LOT-2026-07A pending approval — prepared, not executed.',
  },
  {
    invoiceId: 'inv-2026-0108',
    state: 'on-hold',
    scheduledDate: null,
    executedDate: null,
    amount: '23760.00',
    currency: 'EUR',
    batchRef: null,
    bankTransactionRef: null,
    note: 'On hold: +10% unit-price variance vs PO-2026-052 under review (mis-2026-201).',
  },
  {
    invoiceId: 'inv-2026-0109',
    state: 'not-scheduled',
    scheduledDate: null,
    executedDate: null,
    amount: '2940.00',
    currency: 'EUR',
    batchRef: null,
    bankTransactionRef: null,
    note: 'Suspected duplicate of inv-2026-0107 (mis-2026-203) — never schedule.',
  },
]

/** The frozen AP baseline fixture set. */
export const AP_FIXTURE: ApFixtureSet = {
  entityId: AP_FIXTURE_ENTITY_ID,
  asOf: AP_FIXTURE_AS_OF,
  suppliers: SUPPLIERS,
  invoices: INVOICES,
  purchaseOrders: PURCHASE_ORDERS,
  goodsReceipts: GOODS_RECEIPTS,
  bankTransactions: BANK_TRANSACTIONS,
  chartOfAccounts: CHART_OF_ACCOUNTS,
  taxCodes: TAX_CODES,
  openMissions: OPEN_MISSIONS,
  paymentStatuses: PAYMENT_STATUSES,
}
