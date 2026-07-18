/**
 * AIG-FIN-001 — accounting tool handlers (server only, read-only).
 *
 * The AP-data tools the accounting copilots call — the finance mirror of
 * `market/tools.ts`. Each handler:
 *   - validates args with Zod (strict types, bounds, enums) → error result on
 *     bad input, NEVER a throw (mirrors tool-handlers.ts SAFETY CONTRACT);
 *   - reads the frozen FIXTURE-provenance AP dataset (no real ERP backend is
 *     wired in this pass — every datum is honestly tagged truth: 'FIXTURE');
 *   - returns a compact, JSON-serializable `{ ok, data, summary }`;
 *   - NEVER writes anywhere, NEVER touches an ERP/payment-mutating path
 *     (spec règles dures), NEVER fabricates a value (missing → UNAVAILABLE).
 *
 * Handlers are keyed by MANIFEST TOOL NAME in FINANCE_TOOL_HANDLERS so they
 * plug into the same registry shape as TRADING_TOOL_HANDLERS.
 */

import 'server-only'

import { z } from 'zod'
import { unavailableProvenance, type Provenance } from './truth'
import {
  ACCOUNT_KINDS,
  BANK_TRANSACTION_MATCH_STATUSES,
  PURCHASE_ORDER_STATUSES,
  TAX_KINDS,
  type AccountKind,
  type BankTransactionMatchStatus,
  type PurchaseOrderStatus,
  type TaxKind,
} from './snapshot'
import {
  AP_FIXTURE,
  AP_FIXTURE_AS_OF,
  AP_FIXTURE_SOURCE,
  AP_MISSION_KINDS,
  AP_MISSION_STATUSES,
  PAYMENT_STATES,
  apFixtureProvenance,
  type ApMissionKind,
  type ApMissionStatus,
  type PaymentState,
} from './fixtures/ap-fixtures'

export interface FinanceToolResult {
  ok: boolean
  data: unknown
  summary: string
}

const accountKindSchema = z.enum(
  ACCOUNT_KINDS as unknown as [AccountKind, ...AccountKind[]],
)
const taxKindSchema = z.enum(TAX_KINDS as unknown as [TaxKind, ...TaxKind[]])
const matchStatusSchema = z.enum(
  BANK_TRANSACTION_MATCH_STATUSES as unknown as [
    BankTransactionMatchStatus,
    ...BankTransactionMatchStatus[],
  ],
)
const poStatusSchema = z.enum(
  PURCHASE_ORDER_STATUSES as unknown as [
    PurchaseOrderStatus,
    ...PurchaseOrderStatus[],
  ],
)
const missionKindSchema = z.enum(
  AP_MISSION_KINDS as unknown as [ApMissionKind, ...ApMissionKind[]],
)
const missionStatusSchema = z.enum(
  AP_MISSION_STATUSES as unknown as [ApMissionStatus, ...ApMissionStatus[]],
)
const paymentStateSchema = z.enum(
  PAYMENT_STATES as unknown as [PaymentState, ...PaymentState[]],
)

function parse<T>(schema: z.ZodType<T>, argsJson: string): T | { __err: string } {
  let raw: unknown
  try {
    raw = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return { __err: 'invalid JSON args' }
  }
  const r = schema.safeParse(raw)
  if (!r.success) return { __err: r.error.issues.map((i) => i.message).join('; ') }
  return r.data
}

function err(tool: string, message: string): FinanceToolResult {
  return { ok: false, data: { error: message }, summary: `${tool} failed: ${message}` }
}

/** UNAVAILABLE provenance for a fixture block that has no matching datum. */
function notFound(block: string, reason: string): Provenance {
  return unavailableProvenance({
    source: `${AP_FIXTURE_SOURCE}:${block}`,
    sourceType: 'fixture',
    asOf: AP_FIXTURE_AS_OF,
    reason,
  })
}

/** Compact provenance echo attached to every successful result. */
function provOf(block: string): { truth: string; source: string; asOf: number } {
  const p = apFixtureProvenance(block)
  return { truth: p.truth, source: p.source, asOf: p.asOf }
}

// ---------------------------------------------------------------------------
// read_invoice_document
// ---------------------------------------------------------------------------

const invoiceArgs = z.object({
  invoiceId: z.string().min(1).optional(),
  invoiceNumber: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
})

export async function readInvoiceDocument(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(invoiceArgs, argsJson)
  if ('__err' in a) return err('read_invoice_document', a.__err)

  if (a.invoiceId) {
    const invoice = AP_FIXTURE.invoices.find((i) => i.id === a.invoiceId) ?? null
    if (!invoice) {
      const prov = notFound('invoices', `invoice "${a.invoiceId}" not found in the AP dataset`)
      return {
        ok: false,
        data: { invoice: null, truth: prov.truth, reason: prov.unavailableReason },
        summary: `invoice ${a.invoiceId} UNAVAILABLE (not found)`,
      }
    }
    return {
      ok: true,
      data: { invoice, provenance: provOf('invoices') },
      summary: `invoice ${invoice.id} (${invoice.invoiceNumber}) status=${invoice.status} gross=${invoice.totalGross} ${invoice.currency}`,
    }
  }

  let invoices = AP_FIXTURE.invoices
  if (a.invoiceNumber) invoices = invoices.filter((i) => i.invoiceNumber === a.invoiceNumber)
  if (a.supplierId) invoices = invoices.filter((i) => i.supplierId === a.supplierId)
  return {
    ok: true,
    data: { invoices, count: invoices.length, provenance: provOf('invoices') },
    summary: `${invoices.length} invoice(s) in the AP dataset${a.invoiceNumber ? ` numbered ${a.invoiceNumber}` : ''}${a.supplierId ? ` for ${a.supplierId}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// read_supplier_master — full IBAN history included (fraud checks need it)
// ---------------------------------------------------------------------------

const supplierArgs = z.object({
  supplierId: z.string().min(1).optional(),
})

export async function readSupplierMaster(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(supplierArgs, argsJson)
  if ('__err' in a) return err('read_supplier_master', a.__err)

  if (a.supplierId) {
    const supplier = AP_FIXTURE.suppliers.find((s) => s.id === a.supplierId) ?? null
    if (!supplier) {
      const prov = notFound('suppliers', `supplier "${a.supplierId}" not found in the AP dataset`)
      return {
        ok: false,
        data: { supplier: null, truth: prov.truth, reason: prov.unavailableReason },
        summary: `supplier ${a.supplierId} UNAVAILABLE (not found)`,
      }
    }
    return {
      ok: true,
      data: { supplier, provenance: provOf('suppliers') },
      summary: `supplier ${supplier.id} (${supplier.name}) status=${supplier.status} ibans=${supplier.ibans.length}`,
    }
  }

  return {
    ok: true,
    data: {
      suppliers: AP_FIXTURE.suppliers,
      count: AP_FIXTURE.suppliers.length,
      provenance: provOf('suppliers'),
    },
    summary: `${AP_FIXTURE.suppliers.length} supplier(s) in the AP dataset (full IBAN history included)`,
  }
}

// ---------------------------------------------------------------------------
// read_purchase_orders
// ---------------------------------------------------------------------------

const poArgs = z.object({
  purchaseOrderRef: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  status: poStatusSchema.optional(),
})

export async function readPurchaseOrders(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(poArgs, argsJson)
  if ('__err' in a) return err('read_purchase_orders', a.__err)

  if (a.purchaseOrderRef) {
    const po =
      AP_FIXTURE.purchaseOrders.find(
        (p) => p.id === a.purchaseOrderRef || p.orderNumber === a.purchaseOrderRef,
      ) ?? null
    if (!po) {
      const prov = notFound(
        'purchaseOrders',
        `purchase order "${a.purchaseOrderRef}" not found in the AP dataset`,
      )
      return {
        ok: false,
        data: { purchaseOrder: null, truth: prov.truth, reason: prov.unavailableReason },
        summary: `purchase order ${a.purchaseOrderRef} UNAVAILABLE (not found)`,
      }
    }
    return {
      ok: true,
      data: { purchaseOrder: po, provenance: provOf('purchaseOrders') },
      summary: `PO ${po.orderNumber} status=${po.status} totalNet=${po.totalNet} ${po.currency}`,
    }
  }

  let pos = AP_FIXTURE.purchaseOrders
  if (a.supplierId) pos = pos.filter((p) => p.supplierId === a.supplierId)
  if (a.status) pos = pos.filter((p) => p.status === a.status)
  return {
    ok: true,
    data: { purchaseOrders: pos, count: pos.length, provenance: provOf('purchaseOrders') },
    summary: `${pos.length} purchase order(s) in the AP dataset`,
  }
}

// ---------------------------------------------------------------------------
// read_goods_receipts
// ---------------------------------------------------------------------------

const grArgs = z.object({
  goodsReceiptRef: z.string().min(1).optional(),
  purchaseOrderRef: z.string().min(1).optional(),
})

export async function readGoodsReceipts(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(grArgs, argsJson)
  if ('__err' in a) return err('read_goods_receipts', a.__err)

  if (a.goodsReceiptRef) {
    const gr =
      AP_FIXTURE.goodsReceipts.find(
        (g) => g.id === a.goodsReceiptRef || g.receiptNumber === a.goodsReceiptRef,
      ) ?? null
    if (!gr) {
      const prov = notFound(
        'goodsReceipts',
        `goods receipt "${a.goodsReceiptRef}" not found in the AP dataset`,
      )
      return {
        ok: false,
        data: { goodsReceipt: null, truth: prov.truth, reason: prov.unavailableReason },
        summary: `goods receipt ${a.goodsReceiptRef} UNAVAILABLE (not found)`,
      }
    }
    return {
      ok: true,
      data: { goodsReceipt: gr, provenance: provOf('goodsReceipts') },
      summary: `goods receipt ${gr.receiptNumber} status=${gr.status} po=${gr.purchaseOrderRef ?? 'unmatched'}`,
    }
  }

  let grs = AP_FIXTURE.goodsReceipts
  if (a.purchaseOrderRef) grs = grs.filter((g) => g.purchaseOrderRef === a.purchaseOrderRef)
  return {
    ok: true,
    data: { goodsReceipts: grs, count: grs.length, provenance: provOf('goodsReceipts') },
    summary: `${grs.length} goods receipt(s) in the AP dataset`,
  }
}

// ---------------------------------------------------------------------------
// read_bank_transactions
// ---------------------------------------------------------------------------

const bankArgs = z.object({
  matchStatus: matchStatusSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

export async function readBankTransactions(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(bankArgs, argsJson)
  if ('__err' in a) return err('read_bank_transactions', a.__err)

  let txns = AP_FIXTURE.bankTransactions
  if (a.matchStatus) txns = txns.filter((t) => t.matchStatus === a.matchStatus)
  txns = txns.slice(0, a.limit ?? 100)
  return {
    ok: true,
    data: { bankTransactions: txns, count: txns.length, provenance: provOf('bankTransactions') },
    summary: `${txns.length} bank transaction(s)${a.matchStatus ? ` with matchStatus=${a.matchStatus}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// read_chart_of_accounts
// ---------------------------------------------------------------------------

const coaArgs = z.object({
  kind: accountKindSchema.optional(),
})

export async function readChartOfAccounts(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(coaArgs, argsJson)
  if ('__err' in a) return err('read_chart_of_accounts', a.__err)

  let accounts = AP_FIXTURE.chartOfAccounts
  if (a.kind) accounts = accounts.filter((acc) => acc.kind === a.kind)
  return {
    ok: true,
    data: { accounts, count: accounts.length, provenance: provOf('chartOfAccounts') },
    summary: `${accounts.length} account(s) in the chart${a.kind ? ` of kind=${a.kind}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// read_tax_codes
// ---------------------------------------------------------------------------

const taxArgs = z.object({
  jurisdiction: z.string().min(1).max(8).optional(),
  kind: taxKindSchema.optional(),
})

export async function readTaxCodes(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(taxArgs, argsJson)
  if ('__err' in a) return err('read_tax_codes', a.__err)

  let codes = AP_FIXTURE.taxCodes
  if (a.jurisdiction) codes = codes.filter((c) => c.jurisdiction === a.jurisdiction)
  if (a.kind) codes = codes.filter((c) => c.kind === a.kind)
  if (codes.length === 0 && a.jurisdiction) {
    const prov = notFound(
      'taxCodes',
      `no tax code for jurisdiction "${a.jurisdiction}" in the AP dataset`,
    )
    return {
      ok: false,
      data: { taxCodes: [], truth: prov.truth, reason: prov.unavailableReason },
      summary: `tax codes for ${a.jurisdiction} UNAVAILABLE (none in dataset)`,
    }
  }
  return {
    ok: true,
    data: { taxCodes: codes, count: codes.length, provenance: provOf('taxCodes') },
    summary: `${codes.length} tax code(s)${a.jurisdiction ? ` for ${a.jurisdiction}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// read_open_missions
// ---------------------------------------------------------------------------

const missionArgs = z.object({
  status: missionStatusSchema.optional(),
  kind: missionKindSchema.optional(),
  assignedAgent: z.string().min(1).optional(),
})

export async function readOpenMissions(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(missionArgs, argsJson)
  if ('__err' in a) return err('read_open_missions', a.__err)

  let missions = AP_FIXTURE.openMissions
  if (a.status) missions = missions.filter((m) => m.status === a.status)
  if (a.kind) missions = missions.filter((m) => m.kind === a.kind)
  if (a.assignedAgent) missions = missions.filter((m) => m.assignedAgent === a.assignedAgent)
  const blocked = missions.filter((m) => m.status === 'blocked').length
  return {
    ok: true,
    data: { missions, count: missions.length, provenance: provOf('openMissions') },
    summary: `${missions.length} mission(s) on the AP queue (${blocked} blocked)`,
  }
}

// ---------------------------------------------------------------------------
// read_payment_status — OBSERVATION only; nothing here can execute a payment
// ---------------------------------------------------------------------------

const paymentArgs = z.object({
  invoiceId: z.string().min(1).optional(),
  state: paymentStateSchema.optional(),
})

export async function readPaymentStatus(argsJson: string): Promise<FinanceToolResult> {
  const a = parse(paymentArgs, argsJson)
  if ('__err' in a) return err('read_payment_status', a.__err)

  if (a.invoiceId) {
    const status =
      AP_FIXTURE.paymentStatuses.find((p) => p.invoiceId === a.invoiceId) ?? null
    if (!status) {
      const prov = notFound(
        'paymentStatuses',
        `no payment status for invoice "${a.invoiceId}" in the AP dataset`,
      )
      return {
        ok: false,
        data: { paymentStatus: null, truth: prov.truth, reason: prov.unavailableReason },
        summary: `payment status for ${a.invoiceId} UNAVAILABLE (not found)`,
      }
    }
    return {
      ok: true,
      data: { paymentStatus: status, provenance: provOf('paymentStatuses') },
      summary: `payment for ${status.invoiceId} state=${status.state} amount=${status.amount} ${status.currency}`,
    }
  }

  let statuses = AP_FIXTURE.paymentStatuses
  if (a.state) statuses = statuses.filter((p) => p.state === a.state)
  return {
    ok: true,
    data: { paymentStatuses: statuses, count: statuses.length, provenance: provOf('paymentStatuses') },
    summary: `${statuses.length} payment status(es)${a.state ? ` in state=${a.state}` : ''} — read-only, nothing executed here`,
  }
}

// ---------------------------------------------------------------------------
// Registry — keyed by manifest tool name.
// ---------------------------------------------------------------------------

export type FinanceToolHandler = (argsJson: string) => Promise<FinanceToolResult>

export const FINANCE_TOOL_HANDLERS: Readonly<Record<string, FinanceToolHandler>> = {
  read_invoice_document: readInvoiceDocument,
  read_supplier_master: readSupplierMaster,
  read_purchase_orders: readPurchaseOrders,
  read_goods_receipts: readGoodsReceipts,
  read_bank_transactions: readBankTransactions,
  read_chart_of_accounts: readChartOfAccounts,
  read_tax_codes: readTaxCodes,
  read_open_missions: readOpenMissions,
  read_payment_status: readPaymentStatus,
}

export const FINANCE_TOOL_IDS = Object.keys(FINANCE_TOOL_HANDLERS)
