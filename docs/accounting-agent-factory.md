# Accounting Agent Factory (AIG-FIN-001)

The mission-specific layer that turns Aigent's generic copilot lifecycle into an
**accounting** agent factory. Everything lives under
`src/lib/agent-mission-control/finance/` and is **read-only / dry-run,
truth-aware, and never touches a real ERP write path**.

> Status of THIS build: P0 socle + P1 Accounts Payable vertical slice (tools,
> output contracts, agent definitions, test corpus, benchmark scoring, gateway
> stub, generic CSV connector) — all non-LLM. **Materializing the agents as
> real OpenAI-backed copilots, running benchmarks, and the improvement loop are
> OpenAI-billed steps gated behind explicit human approval (global rule §8).**

## 1. Founding principle — business agent, not per-ERP agent

We do **not** build a VAT-agent-for-Xero plus a VAT-agent-for-Sage plus a
VAT-agent-for-NetSuite. We build **one business VAT agent**; per-ERP
**connectors** translate its actions. The non-negotiable pipeline:

```
Business agent → Policy Engine & controls → (optional) Approval → Execution Gateway → Connector → Xero/Sage/NetSuite/QuickBooks/Dynamics/Cegid…
```

Business intelligence is independent of the accounting software. Switching ERP
= swapping the connector + a few mappings — **never the agents**.

The **pivot format** is the standard journal entry (§32): balanced debit/credit
lines + journal + period + dimensions + attached evidence + approval. Every
business agent produces this format; every connector consumes it.

## 2. Architecture decision — 65 roles, NOT 65 LLM agents

| `kind` | What | Count | Nature |
|---|---|---|---|
| `llm` | Business reasoning agents (Aigent copilots: prompt + read-only tools + Zod contract) | ~35 | prompt-driven |
| `connector` | §11 Integration Platform connectors (Xero, Sage, QuickBooks, NetSuite, Dynamics 365 BC, Pennylane, Cegid, SAP, Zoho Books, generic CSV/REST) | 10 | **deterministic code — never an LLM** |
| `service` | §12 technical services (Execution Gateway, Permissions, Sync, Error handling, Identity resolution, Evidence Vault, Segregation of duties) + Planner/Tax calendar | ~20 | infrastructure code, tested, never a prompt |

Orchestration (§1): **chief-finance** is an `llm` sitting on top of a mission
state machine; the **planner** is a `service`.

## 3. The 8 teams (65 roles)

1. **Finance Command** — chief-finance (llm), planificateur (service),
   superviseur (llm), **controleur-general (llm, BLOCKING)** — independent
   verifier: re-runs important controls, detects contradictions, blocks risky
   actions; verdict accepted / to-review / rejected.
2. **Data Operations** — documents, email-finance, qualite-donnees,
   referentiel, mapping-comptable (all llm).
3. **Accounts Payable** (**P1 — materializable slice**) — fournisseurs,
   controle-factures (3-way match), **securite-fournisseurs (BLOCKING,
   anti-fraud: IBAN changes, duplicate bank accounts, suspicious domains)**,
   achats, paiements-fournisseurs (prepares payments **without executing**).
4. **Accounts Receivable** — clients, facturation, recouvrement,
   reconnaissance-revenu.
5. **Accounting & Close** — banque, rapprochement-bancaire,
   rapprochement-general, comptes-attente, cloture, cut-off, provisions,
   **ecritures-comptables (P1 — builds the pivot format)**, balance-generale,
   consolidation.
6. **Tax** — tva (**one** agent + per-jurisdiction packs in CONFIG — FR VAT,
   UK VAT, UAE VAT, GST… — never separate agents), impot-societes,
   retenues-source, fiscalite-internationale, prix-transfert,
   calendrier-fiscal (service).
7. **Control & Audit** — audit-interne, evidence-vault (service),
   **fraude-anomalies (llm, BLOCKING)**, separation-responsabilites (service,
   anti-self-approval §47), conformite.
8. **Specialized / transverse** — immobilisations, paie, notes-frais,
   intercompany, contrats, tresorerie, devises, budget-forecast,
   reporting-gestion; plus communication (demande-informations,
   assistant-finance — **can never bypass approvals**).

**Integration Platform** (kind `connector`): connecteur-xero, -sage (version
detection → distinct adapters), -quickbooks, -netsuite, -dynamics365bc,
-pennylane, -cegid, -sap (product detection → variants), -zoho-books, and
**connecteur-generique (P1)** — CSV import/export + REST + webhooks,
**READ-ONLY whenever writing is not proven safe**.

**Technical services** (kind `service`): synchronisation,
resolution-identites, **execution-gateway (P1, stub)** — the **single** write
door: permissions, agent mandate, approvals, anti-duplicate, idempotency,
intent journal, connector call, result verification, blocks on doubt;
gestion-erreurs (degrades to read-only), permissions (per company/module/
action type, financial thresholds, immediate revocation).

## 4. P0+P1 scope (this pass — read-only)

- **P0 socle**: `src/lib/agent-mission-control/finance/` mirroring `market/` —
  truth/snapshot, versioned Zod output contracts, read-only tools, gateway
  **stub** (read-only), roster as pure config, eval corpus + benchmark.
- **P1 vertical slice** = the Accounts Payable team materializable:
  agent-documents, agent-fournisseurs, agent-controle-factures,
  agent-securite-fournisseurs, agent-ecritures + agent-controleur-general
  (independent verifier). Generic CSV connector (§60) read-only.
- Everything is read-only / dry-run: **no real write path to any ERP, no LLM
  call, no network call, no secret.**

## 5. Data dictionary — money & truth

- Amounts are **lossless decimal strings** (`DecimalString`), **never**
  `number`/float on a money path.
- Every datum is provenance-tagged: `LIVE` / `SNAPSHOT` / `HISTORICAL` /
  `FIXTURE` / `FALLBACK` / `UNAVAILABLE`. Missing data → `UNAVAILABLE` with
  provenance — **never invented, never a fake zero**.

## 6. Blocking gates & benchmark

- **securite-fournisseurs** and **controleur-general** verdicts of `BLOCKED`
  are **terminal** — no majority, no other agent, no retry overrides them
  (same rule as Sentinel in the trading council). fraude-anomalies blocks
  critical cases the same way.
- Benchmark: **security 100% required**; a run with any unsafe action,
  fabricated data, or invalid critical contract is blocked and its global
  score floored — no average can mask a critical defect.
- Auto-approval is impossible by construction (segregation of duties §47:
  preparer ≠ approver ≠ executor). A doubtful connector runs read-only.

## 7. Materialization & delivery

- **Materializing the agents as OpenAI-backed copilots is a billed step, NOT
  executed in this pass** — explicit human approval required first (§8).
- Delivery (later phase): deterministic checksummed export to
  `delivery/accounting/`, same discipline as AIG-PACK-015. Consumer project:
  `proj-accounting-agent` (visible at `/admin/projects/proj-accounting-agent`).
