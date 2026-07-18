/**
 * AIG-FIN-001 — precise tool descriptions for the model.
 *
 * The runner exposes tools to the model with an EMPTY JSON-Schema (permissive
 * object args), so the ONLY signal the model has for how to call a tool is its
 * description. These strings therefore carry the exact argument shape + enums,
 * so the model calls the Zod-validated handlers correctly instead of guessing
 * (and getting rejected). Kept beside the tools they describe — the finance
 * mirror of `market/tool-descriptions.ts`. All tools are READ-ONLY: nothing
 * can write to an ERP, schedule or execute a payment; missing data returns
 * truth=UNAVAILABLE, never a fabricated value.
 */

export const FINANCE_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  read_invoice_document:
    'Read one supplier invoice (or list/filter invoices) with lines, amounts, taxes, PO/receipt refs and status. ' +
    'Args JSON: {"invoiceId"?: string, "invoiceNumber"?: string, "supplierId"?: string}. ' +
    'Example: {"invoiceId":"inv-2026-0107"} or {} to list all. Amounts are lossless decimal strings, never floats. ' +
    'Unknown id → truth=UNAVAILABLE (never fake data).',
  read_supplier_master:
    'Read the supplier master data INCLUDING the full IBAN history (not just the current IBAN) — fraud checks reason on changes. ' +
    'Args JSON: {"supplierId"?: string}. ' +
    'Example: {"supplierId":"sup-helios-cloud"} or {} to list all. ' +
    'A recently changed IBAN or a pending-validation status is a red flag to surface, not a fact to trust.',
  read_purchase_orders:
    'Read purchase orders (3-way-match input) with lines, ordered quantities, unit prices and totals. ' +
    'Args JSON: {"purchaseOrderRef"?: string (id or order number), "supplierId"?: string, "status"?: "open"|"partially-received"|"received"|"closed"|"cancelled"}. ' +
    'Example: {"purchaseOrderRef":"PO-2026-051"}. Unknown ref → truth=UNAVAILABLE.',
  read_goods_receipts:
    'Read goods receipts (3-way-match input) with received quantities linked to PO lines. ' +
    'Args JSON: {"goodsReceiptRef"?: string (id or receipt number), "purchaseOrderRef"?: string}. ' +
    'Example: {"purchaseOrderRef":"PO-2026-051"}. Unknown ref → truth=UNAVAILABLE.',
  read_bank_transactions:
    'Read normalized bank transactions (signed decimal-string amounts: negative = money out) with counterparty and match status. ' +
    'Args JSON: {"matchStatus"?: "unmatched"|"matched"|"suspense", "limit"?: 1..500}. ' +
    'Example: {"matchStatus":"suspense"}. Read-only bank feed — nothing here moves money.',
  read_chart_of_accounts:
    'Read the entity\'s chart of accounts (code, label, kind). ' +
    'Args JSON: {"kind"?: "asset"|"liability"|"equity"|"revenue"|"expense"}. ' +
    'Example: {"kind":"expense"} or {} for the full chart.',
  read_tax_codes:
    'Read the tax codes (rate percent as decimal string, jurisdiction, kind). ' +
    'Args JSON: {"jurisdiction"?: string e.g. "FR"|"UK", "kind"?: "input"|"output"|"exempt"|"reverse-charge"}. ' +
    'Example: {"jurisdiction":"FR"}. Unknown jurisdiction → truth=UNAVAILABLE — never invent a rate.',
  read_open_missions:
    'Read the AP mission queue (3-way matches, IBAN verifications, duplicate reviews, entry/payment preparation). ' +
    'Args JSON: {"status"?: "open"|"in-progress"|"blocked"|"done", "kind"?: "3-way-match"|"iban-verification"|"duplicate-review"|"entry-preparation"|"payment-preparation", "assignedAgent"?: string}. ' +
    'Example: {"status":"blocked"}. A blocked mission carries its blockedReason — treat it as terminal until a human clears it.',
  read_payment_status:
    'Read the payment status of invoices (dry-run lifecycle: not-scheduled/on-hold/scheduled/sent-for-execution/executed). ' +
    'Args JSON: {"invoiceId"?: string, "state"?: "not-scheduled"|"on-hold"|"scheduled"|"sent-for-execution"|"executed"}. ' +
    'Example: {"invoiceId":"inv-2026-0107"}. OBSERVATION ONLY — this tool can never schedule, approve or execute a payment. ' +
    'Unknown invoice → truth=UNAVAILABLE.',
}
