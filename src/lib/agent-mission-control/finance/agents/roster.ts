/**
 * AIG-FIN-001 — the Accounting Agent Factory roster, as typed data.
 *
 * Mirror of market/agents/roster.ts for the finance domain: DEFINITIONS ONLY.
 * This file is PURE, SELF-CONTAINED CONFIG — local types, zero runtime import,
 * no LLM/network/secret touched, nothing persisted. A later (billed, §8-gated)
 * materialization step turns the P1 slice into real copilots; this file is the
 * immutable source of truth that materializer reads.
 *
 * Architecture decision encoded here (frozen product spec, 2026-07-18):
 *   - the 65 roles are NOT 65 LLM agents. `kind` separates:
 *       'llm'       — business agents with reasoning (prompt + read-only tools
 *                     + versioned Zod output contract, contracts.ts);
 *       'connector' — deterministic API adapters (Xero/Sage/NetSuite/…), NEVER
 *                     an LLM, always `writeEnabled: false` in this pass;
 *       'service'   — coded/tested infrastructure (gateway, permissions, sync,
 *                     scheduler, error handling, identities), never a prompt.
 *   - business intelligence is ERP-independent: one VAT agent + jurisdiction
 *     packs in CONFIG, never one agent per ERP or per country.
 *   - everything is read-only / dry-run. There is NO real write path to any
 *     ERP; the only write door is the execution-gateway service, stubbed
 *     read-only in this pass.
 *   - blocking gates: controleur-general, securite-fournisseurs and
 *     fraude-anomalies carry `blocking: true` — their BLOCKED verdict is
 *     TERMINAL (like Sentinel in the trading council), no agent overrides it.
 *   - materializable P1 slice (Accounts Payable vertical + its independent
 *     verifier) is the ONLY set with `materializable: true`.
 *
 * Cross-cutting hard rules the roles below must honour at runtime (asserted by
 * the finance eval corpus, not enforceable in pure config):
 *   - amounts are lossless decimal strings (DecimalString), never floats;
 *   - a missing datum is UNAVAILABLE with provenance
 *     (LIVE/SNAPSHOT/HISTORICAL/FIXTURE/FALLBACK/UNAVAILABLE), never invented;
 *   - the standard journal entry (balanced debit/credit lines + journal +
 *     period + dimensions + evidence + approval) is the PIVOT FORMAT every
 *     business agent produces and every connector consumes;
 *   - self-approval is impossible (separation of duties): whoever prepared an
 *     action can never approve it.
 */

// ---------------------------------------------------------------------------
// Types (local on purpose — this file imports nothing)
// ---------------------------------------------------------------------------

/** The eight finance teams, closed union so a typo fails to typecheck. */
export type FinanceTeamId =
  | 'finance-command'
  | 'data-operations'
  | 'accounts-payable'
  | 'accounts-receivable'
  | 'accounting-close'
  | 'tax'
  | 'control-audit'
  | 'integration-platform'

/** What a role actually is: reasoning agent, coded service, or ERP adapter. */
export type FinanceRoleKind = 'llm' | 'service' | 'connector'

/** A finance team, described as pure data. */
export interface FinanceTeam {
  readonly id: FinanceTeamId
  /** Short human name. */
  readonly name: string
  /** One-line mission. */
  readonly mission: string
}

/** Fields shared by every role, whatever its kind. */
interface FinanceRoleBase {
  /** Stable kebab-case identity, e.g. 'securite-fournisseurs'. */
  readonly slug: string
  readonly team: FinanceTeamId
  readonly kind: FinanceRoleKind
  /** One-line definition, straight from the frozen product spec. */
  readonly definition: string
  /** Business actions the role covers (taken from the spec, not invented). */
  readonly actions: readonly string[]
  /**
   * Blocking gate: a `true` role can emit a TERMINAL BLOCKED verdict no other
   * agent may override (mirror of Sentinel in the trading council).
   */
  readonly blocking: boolean
  /**
   * P1 materialization slice. `true` ONLY for the Accounts Payable vertical +
   * its independent verifier. Materialization itself is billed and NOT run in
   * this pass (§8 stop).
   */
  readonly materializable: boolean
}

/** A business agent with reasoning — prompt + read-only tools + contract. */
export interface FinanceLlmRoleDef extends FinanceRoleBase {
  readonly kind: 'llm'
  /**
   * Read-only tool names (strings by design: the roster stays import-free;
   * the finance eval asserts they resolve against tools.ts).
   */
  readonly toolNames: readonly string[]
  /**
   * Versioned output-contract id (contracts.ts), `null` when the role has no
   * structured contract yet (non-P1 roles get theirs at their own tranche).
   */
  readonly contractId: string | null
  /**
   * Jurisdiction packs carried in CONFIG (never as separate agents). Only the
   * VAT agent uses this today.
   */
  readonly jurisdictionPacks?: readonly string[]
}

/** Coded, tested infrastructure — never a prompt. */
export interface FinanceServiceRoleDef extends FinanceRoleBase {
  readonly kind: 'service'
}

/** Deterministic ERP adapter — never an LLM, read-only in this pass. */
export interface FinanceConnectorRoleDef extends FinanceRoleBase {
  readonly kind: 'connector'
  /** Hard invariant of the pass: no connector may write to an ERP. */
  readonly writeEnabled: false
}

export type FinanceRoleDef =
  | FinanceLlmRoleDef
  | FinanceServiceRoleDef
  | FinanceConnectorRoleDef

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const FINANCE_TEAMS: readonly FinanceTeam[] = [
  {
    id: 'finance-command',
    name: 'Finance Command',
    mission:
      'Orchestration : détection des événements, missions, supervision des agents, vérification indépendante.',
  },
  {
    id: 'data-operations',
    name: 'Data Operations',
    mission:
      'Ingestion et qualité des données financières : documents, emails, données maîtres, mappings comptables.',
  },
  {
    id: 'accounts-payable',
    name: 'Accounts Payable',
    mission:
      'Cycle fournisseurs de bout en bout — la tranche verticale P1 matérialisable.',
  },
  {
    id: 'accounts-receivable',
    name: 'Accounts Receivable',
    mission: 'Cycle clients : facturation, encaissements, recouvrement, revenu.',
  },
  {
    id: 'accounting-close',
    name: 'Accounting & Close',
    mission:
      'Comptabilité générale, rapprochements, clôture et agents spécialisés transverses.',
  },
  {
    id: 'tax',
    name: 'Tax',
    mission:
      'Fiscalité : TVA multi-juridictions (packs en config), IS, retenues, international, prix de transfert.',
  },
  {
    id: 'control-audit',
    name: 'Control & Audit',
    mission:
      'Contrôle interne, preuves d’audit, anti-fraude, séparation des responsabilités, conformité.',
  },
  {
    id: 'integration-platform',
    name: 'Integration Platform',
    mission:
      'Connecteurs ERP déterministes + services techniques transversaux (gateway, sync, permissions).',
  },
] as const

// ---------------------------------------------------------------------------
// Roster — 65 roles, in spec order per team
// ---------------------------------------------------------------------------

export const FINANCE_ROSTER: readonly FinanceRoleDef[] = [
  // --- 1. Finance Command --------------------------------------------------
  {
    slug: 'chief-finance',
    team: 'finance-command',
    kind: 'llm',
    definition:
      'Chef d’orchestre : transforme les événements en missions et surveille leur complétion réelle.',
    actions: [
      'détecte les événements',
      'crée les missions',
      'choisit les agents',
      'ordonne les travaux',
      'surveille les échéances',
      'relance les missions bloquées',
      'demande validation humaine',
      'vérifie la complétion réelle',
      'escalade les risques au DAF',
    ],
    toolNames: [
      'read_mission_status',
      'read_finance_calendar',
      'read_close_checklist',
      'read_approval_trail',
    ],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'planificateur',
    team: 'finance-command',
    kind: 'service',
    definition:
      'Transforme les obligations en calendrier de missions avec dépendances et alertes.',
    actions: [
      'missions quotidiennes/mensuelles/annuelles',
      'dates de clôture',
      'planning TVA/IS/paie/déclarations',
      'dépendances',
      'alertes avant échéance',
      'replanification en cas de retard',
    ],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'superviseur',
    team: 'finance-command',
    kind: 'llm',
    definition:
      'Surveille les agents : blocages, erreurs, coûts et délais, jusqu’à suspendre un agent défaillant.',
    actions: [
      'détecte les blocages',
      'taux d’erreur',
      'coûts d’exécution',
      'délais',
      'suspend un agent défaillant',
      'réattribue une mission',
      'compare production/objectifs',
    ],
    toolNames: ['read_mission_status', 'read_agent_run_metrics'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'controleur-general',
    team: 'finance-command',
    kind: 'llm',
    definition:
      'Vérificateur indépendant : refait les contrôles importants et bloque toute action risquée (verdict terminal).',
    actions: [
      'refait les contrôles importants',
      'vérifie les calculs',
      'détecte les contradictions',
      'contrôle les règles',
      'bloque une action risquée',
      'demande une seconde validation',
      'verdict accepté/à revoir/rejeté',
    ],
    toolNames: [
      'read_ledger_entries',
      'read_journal_entry_proposals',
      'read_approval_trail',
      'read_audit_evidence',
    ],
    contractId: 'ControlVerdict@v1.0.0',
    blocking: true,
    materializable: true,
  },
  {
    slug: 'assistant-finance',
    team: 'finance-command',
    kind: 'llm',
    definition:
      'Interface conversationnelle finance : explique, cherche, résume et lance — sans JAMAIS contourner les approbations.',
    actions: [
      'explique une anomalie',
      'cherche une facture',
      'missions bloquées',
      'résumé de clôture',
      'variations',
      'lance une mission',
      'prépare une décision',
      'ne peut jamais contourner les approbations',
    ],
    toolNames: [
      'read_mission_status',
      'read_document_inventory',
      'read_ledger_entries',
      'read_close_checklist',
    ],
    contractId: null,
    blocking: false,
    materializable: false,
  },

  // --- 2. Data Operations --------------------------------------------------
  {
    slug: 'documents',
    team: 'data-operations',
    kind: 'llm',
    definition:
      'Lit les pièces (factures, avoirs), extrait les champs en décimales lossless et associe pièce↔transaction.',
    actions: [
      'lit les factures',
      'extrait montants/dates/taxes/références',
      'reconnaît les avoirs',
      'classe',
      'détecte pages manquantes',
      'associe pièce↔transaction',
      'vérifie la lisibilité',
      'cherche les doublons',
    ],
    toolNames: ['read_document_inventory', 'read_invoice_extraction', 'read_vendor_masterdata'],
    contractId: 'DocumentExtractionReport@v1.0.0',
    blocking: false,
    materializable: true,
  },
  {
    slug: 'email-finance',
    team: 'data-operations',
    kind: 'llm',
    definition:
      'Surveille les boîtes finance : factures, relances, demandes clients, pièces jointes, urgences.',
    actions: [
      'récupère factures',
      'reconnaît relances fournisseurs',
      'identifie demandes clients',
      'extrait PJ',
      'crée dossiers',
      'demande pièces manquantes',
      'classe par urgence',
    ],
    toolNames: ['read_email_inbox_snapshot', 'read_document_inventory'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'qualite-donnees',
    team: 'data-operations',
    kind: 'llm',
    definition:
      'Gardien de la qualité : empêche tout calcul sur données incomplètes ou périmées.',
    actions: [
      'champs manquants',
      'formats incorrects',
      'devises',
      'incohérences de dates',
      'ids dupliqués',
      'fraîcheur des syncs',
      'empêche un calcul sur données incomplètes',
    ],
    toolNames: ['read_erp_sync_status', 'read_master_data_mappings', 'read_document_inventory'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'referentiel',
    team: 'data-operations',
    kind: 'llm',
    definition:
      'Données maîtres : harmonise, déduplique et maintient les correspondances multi-logiciels.',
    actions: [
      'harmonise noms fournisseurs',
      'déduplique clients',
      'plans de comptes',
      'centres de coûts',
      'taxes',
      'entités juridiques',
      'correspondances multi-logiciels',
    ],
    toolNames: ['read_vendor_masterdata', 'read_customer_masterdata', 'read_master_data_mappings'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'mapping-comptable',
    team: 'data-operations',
    kind: 'llm',
    definition:
      'Catégories métier → plan comptable : propose les imputations et apprend des validations.',
    actions: [
      'propose compte/journal/centre de coût/projet',
      'apprend des validations',
      'détecte les catégorisations inhabituelles',
      'maintient les mappings inter-systèmes',
    ],
    toolNames: ['read_master_data_mappings', 'read_ledger_entries'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'demande-informations',
    team: 'data-operations',
    kind: 'llm',
    definition:
      'Chasse l’information manquante : bonne question, bon interlocuteur, relance jusqu’à clôture.',
    actions: [
      'info manquante',
      'bon interlocuteur',
      'demande précise',
      'relance auto',
      'association réponse↔dossier',
      'clôture',
    ],
    toolNames: ['read_email_inbox_snapshot', 'read_mission_status'],
    contractId: null,
    blocking: false,
    materializable: false,
  },

  // --- 3. Accounts Payable (P1) --------------------------------------------
  {
    slug: 'fournisseurs',
    team: 'accounts-payable',
    kind: 'llm',
    definition:
      'Tient le cycle fournisseurs : contrôle, suit, détecte les doublons et prépare pour validation.',
    actions: [
      'contrôle infos fournisseur',
      'vérifie factures reçues',
      'suit les factures en attente',
      'identifie les inconnus',
      'détecte doublons',
      'propose les écritures',
      'suit les litiges',
      'prépare pour validation',
    ],
    toolNames: [
      'read_vendor_masterdata',
      'read_open_payables',
      'read_invoice_extraction',
      'read_document_inventory',
    ],
    contractId: 'VendorInvoiceReview@v1.0.0',
    blocking: false,
    materializable: true,
  },
  {
    slug: 'controle-factures',
    team: 'accounts-payable',
    kind: 'llm',
    definition:
      '3-way match facture/commande/réception : écarts, mentions obligatoires, blocage des non conformes.',
    actions: [
      '3-way match facture/commande/réception',
      'prix',
      'quantités',
      'remises',
      'écarts',
      'mentions obligatoires',
      'bloque les non conformes',
    ],
    toolNames: [
      'read_invoice_extraction',
      'read_purchase_orders',
      'read_goods_receipts',
      'read_vendor_masterdata',
    ],
    contractId: 'InvoiceControlReport@v1.0.0',
    blocking: false,
    materializable: true,
  },
  {
    slug: 'securite-fournisseurs',
    team: 'accounts-payable',
    kind: 'llm',
    definition:
      'Anti-fraude fournisseurs : IBAN changés, comptes dupliqués, domaines suspects — blocage terminal du risque.',
    actions: [
      'changement d’IBAN',
      'comparaison historique',
      'doublons de comptes bancaires',
      'domaines email suspects',
      'changements inhabituels',
      'validation renforcée',
      'blocage fournisseur à risque',
    ],
    toolNames: [
      'read_vendor_masterdata',
      'read_vendor_bank_history',
      'read_open_payables',
    ],
    contractId: 'VendorSecurityAssessment@v1.0.0',
    blocking: true,
    materializable: true,
  },
  {
    slug: 'achats',
    team: 'accounts-payable',
    kind: 'llm',
    definition:
      'Discipline achats : facture vs bon de commande, budgets, approbations, achats hors process.',
    actions: [
      'facture vs bon de commande',
      'budgets',
      'niveaux d’approbation',
      'achats hors process',
      'engagements non facturés',
      'fractionnements artificiels',
    ],
    toolNames: ['read_purchase_orders', 'read_budget_forecast', 'read_approval_trail'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'paiements-fournisseurs',
    team: 'accounts-payable',
    kind: 'llm',
    definition:
      'Prépare les paiements SANS jamais les exécuter : lot, contrôles, priorités, transmission au système autorisé.',
    actions: [
      'sélection échéances',
      'anti-double-paiement',
      'vérif coordonnées bancaires',
      'lot de paiements',
      'priorités tréso',
      'validations',
      'transmission au système autorisé',
      'vérif statut après exécution',
    ],
    toolNames: [
      'read_open_payables',
      'read_payment_batches',
      'read_vendor_bank_history',
      'read_treasury_positions',
    ],
    contractId: 'PaymentBatchProposal@v1.0.0',
    blocking: false,
    materializable: true,
  },

  // --- 4. Accounts Receivable ----------------------------------------------
  {
    slug: 'clients',
    team: 'accounts-receivable',
    kind: 'llm',
    definition:
      'Tient le cycle clients : factures émises, règlements, impayés, litiges, relances.',
    actions: [
      'factures émises',
      'échéances',
      'rapprochement règlements',
      'impayés',
      'avoirs incohérents',
      'litiges',
      'relances',
    ],
    toolNames: ['read_open_receivables', 'read_customer_masterdata', 'read_bank_transactions'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'facturation',
    team: 'accounts-receivable',
    kind: 'llm',
    definition:
      'Produit les projets de factures depuis contrats et tarifs, transmis au logiciel après validation.',
    actions: [
      'projets de factures',
      'contrats',
      'tarifs',
      'taxes',
      'périodes',
      'prestations non facturées',
      'transmission au logiciel après validation',
    ],
    toolNames: ['read_contract_registry', 'read_open_receivables', 'read_tax_positions'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'recouvrement',
    team: 'accounts-receivable',
    kind: 'llm',
    definition:
      'Pilote le recouvrement : segmentation, relances personnalisées, escalade, provisions douteuses.',
    actions: [
      'segmentation',
      'retards',
      'relances personnalisées',
      'promesses de paiement',
      'litiges',
      'escalade',
      'provisions créances douteuses',
    ],
    toolNames: ['read_open_receivables', 'read_customer_masterdata'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'reconnaissance-revenu',
    team: 'accounts-receivable',
    kind: 'llm',
    definition:
      'Reconnaissance du revenu : obligations de performance, répartition, cut-off, hypothèses documentées.',
    actions: [
      'contrats',
      'obligations de performance',
      'répartition dans le temps',
      'PCA',
      'FAE',
      'écritures de cut-off',
      'hypothèses documentées',
    ],
    toolNames: ['read_contract_registry', 'read_ledger_entries', 'read_open_receivables'],
    contractId: null,
    blocking: false,
    materializable: false,
  },

  // --- 5. Accounting & Close -----------------------------------------------
  {
    slug: 'banque',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Importe et normalise les transactions bancaires, identifie les contreparties, ouvre les missions de rapprochement.',
    actions: [
      'importe transactions',
      'normalise descriptions',
      'identifie payeurs/bénéficiaires',
      'transactions inconnues',
      'frais bancaires',
      'virements internes',
      'missions de rapprochement',
    ],
    toolNames: ['read_bank_transactions', 'read_vendor_masterdata', 'read_customer_masterdata'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'rapprochement-bancaire',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Rapproche banque↔comptabilité avec preuve : correspondances, différences, régularisations autorisées.',
    actions: [
      'correspondances exactes/multiples',
      'facture↔règlement',
      'différences montant/date',
      'écriture de régularisation',
      'exécution autorisée',
      'preuve du rapprochement',
    ],
    toolNames: ['read_bank_transactions', 'read_ledger_entries', 'read_open_payables'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'rapprochement-general',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Rapproche n’importe quelles sources : sous-ledgers, paie, immos, fisc, contre la balance.',
    actions: [
      'banque/compta',
      'clients/encaissements',
      'fournisseurs/paiements',
      'paie/GL',
      'immos/compta',
      'fisc/comptes de taxes',
      'sous-ledgers/balance',
    ],
    toolNames: ['read_ledger_entries', 'read_bank_transactions', 'read_trial_balance'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'comptes-attente',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Vide les comptes d’attente : origine, affectation, responsable — bloque la clôture si inexpliqué.',
    actions: [
      'soldes anciens',
      'transaction d’origine',
      'affectation proposée',
      'responsable',
      'résolution',
      'blocage de clôture si compte d’attente important inexpliqué',
    ],
    toolNames: ['read_ledger_entries', 'read_trial_balance'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'cloture',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Pilote la clôture : checklist, dépendances, avancement, dossier final, validation.',
    actions: [
      'checklist',
      'assignation',
      'dépendances',
      'avancement',
      'comptes non réconciliés',
      'écritures de clôture',
      'dossier final',
      'validation de clôture',
    ],
    toolNames: ['read_close_checklist', 'read_trial_balance', 'read_ledger_entries'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'cut-off',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Assure le cut-off de période : CAP, CCA, PAR, PCA, écritures et extournes.',
    actions: ['factures en retard', 'CAP', 'CCA', 'PAR', 'PCA', 'écritures', 'extournes'],
    toolNames: ['read_ledger_entries', 'read_open_payables', 'read_open_receivables'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'provisions',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Calcule et documente les provisions : risques, méthode, reprises, hypothèses, validations.',
    actions: [
      'risques',
      'historiques',
      'méthode',
      'calcul',
      'reprises',
      'hypothèses',
      'validations',
    ],
    toolNames: ['read_ledger_entries', 'read_trial_balance'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'ecritures-comptables',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Construit le FORMAT PIVOT : lignes débit/crédit équilibrées + journal + période + dimensions + preuves + approbation.',
    actions: [
      'lignes débit/crédit équilibrées',
      'journal',
      'période',
      'dimensions',
      'preuves jointes',
      'approbation',
      'transmission au connecteur',
    ],
    toolNames: [
      'read_ledger_entries',
      'read_master_data_mappings',
      'read_invoice_extraction',
      'read_approval_trail',
    ],
    contractId: 'JournalEntryProposal@v1.0.0',
    blocking: false,
    materializable: true,
  },
  {
    slug: 'balance-generale',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Analyse la balance : comparaisons de périodes, soldes inhabituels, variations, missions d’investigation.',
    actions: [
      'comparaison de périodes',
      'soldes inhabituels',
      'comptes inversés',
      'mouvements manquants',
      'variations',
      'missions d’investigation',
    ],
    toolNames: ['read_trial_balance', 'read_ledger_entries'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'consolidation',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Consolide le groupe : harmonisation, devises, éliminations intercompany, preuves de transformation.',
    actions: [
      'harmonisation plans de comptes',
      'conversion devises',
      'intégration balances',
      'éliminations intercompany',
      'minoritaires',
      'écritures de conso',
      'preuves de transformation',
    ],
    toolNames: ['read_trial_balance', 'read_intercompany_balances', 'read_fx_rates'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'immobilisations',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Gère les immobilisations : capitalisation, amortissements, cessions, rapprochement registre/compta.',
    actions: [
      'dépenses immobilisables',
      'fiches d’actifs',
      'catégorie',
      'durée d’amortissement',
      'calcul',
      'cessions',
      'dépréciations',
      'rapprochement registre/compta',
    ],
    toolNames: ['read_fixed_asset_register', 'read_ledger_entries'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'paie',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Comptabilise la paie : journaux, charges, rapprochements — données nominatives protégées.',
    actions: [
      'journaux de paie',
      'totaux',
      'variations',
      'charges sociales',
      'écritures',
      'rapprochement paiements',
      'protection données nominatives',
    ],
    toolNames: ['read_payroll_journals', 'read_ledger_entries', 'read_bank_transactions'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'notes-frais',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Contrôle les notes de frais : politique, doublons, plafonds, TVA, justification, remboursement.',
    actions: [
      'reçus',
      'politique de dépenses',
      'doublons',
      'plafonds',
      'TVA',
      'centre de coût',
      'justification',
      'remboursement',
    ],
    toolNames: ['read_expense_reports', 'read_tax_positions'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'intercompany',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Rapproche l’intercompany : opérations réciproques, soldes, différences, corrections, éliminations.',
    actions: [
      'opérations réciproques',
      'rapprochement factures',
      'soldes',
      'différences devise/période',
      'corrections',
      'éliminations',
    ],
    toolNames: ['read_intercompany_balances', 'read_ledger_entries', 'read_fx_rates'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'contrats',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Lit les contrats : montants, échéances, indexations, renouvellements, écarts factures↔contrat.',
    actions: [
      'lit les contrats',
      'montants',
      'échéances',
      'clauses d’indexation',
      'renouvellements',
      'factures↔contrat',
      'écarts',
    ],
    toolNames: ['read_contract_registry', 'read_invoice_extraction'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'tresorerie',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Suit la trésorerie : soldes consolidés, prévisions, tensions, covenants, financement.',
    actions: [
      'soldes consolidés',
      'prévisions',
      'encaissements',
      'paiements',
      'tensions',
      'transferts',
      'covenants',
      'financement',
    ],
    toolNames: ['read_treasury_positions', 'read_bank_transactions', 'read_payment_batches'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'devises',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Gère les devises : taux, conversions, écarts de change, réévaluations, contrôle des taux appliqués.',
    actions: [
      'taux',
      'conversions',
      'écarts de change',
      'réévaluations',
      'gains/pertes',
      'contrôle des taux appliqués',
    ],
    toolNames: ['read_fx_rates', 'read_ledger_entries'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'budget-forecast',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Suit budgets et forecasts : écarts, dépassements, scénarios, alertes.',
    actions: [
      'budgets',
      'écarts',
      'variations',
      'forecasts',
      'dépassements',
      'scénarios',
      'alertes',
    ],
    toolNames: ['read_budget_forecast', 'read_trial_balance'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'reporting-gestion',
    team: 'accounting-close',
    kind: 'llm',
    definition:
      'Produit le reporting de gestion : P&L, bilan, cash-flow, par axe, commentaires d’écarts, risques.',
    actions: [
      'P&L',
      'bilan',
      'cash-flow',
      'par société',
      'par centre de coût',
      'commentaires d’écarts',
      'risques',
    ],
    toolNames: ['read_trial_balance', 'read_budget_forecast', 'read_treasury_positions'],
    contractId: null,
    blocking: false,
    materializable: false,
  },

  // --- 6. Tax ---------------------------------------------------------------
  {
    slug: 'tva',
    team: 'tax',
    kind: 'llm',
    definition:
      'UN agent TVA + packs juridiction en CONFIG (jamais un agent par pays) : classification, calcul, déclaration, dossier.',
    actions: [
      'classification',
      'taux',
      'TVA récupérable',
      'factures non conformes',
      'transfrontalier',
      'rapprochement comptes TVA',
      'calcul déclaration',
      'explication des variations',
      'dossier justificatif',
      'transmission après validation',
    ],
    toolNames: ['read_tax_positions', 'read_invoice_extraction', 'read_ledger_entries'],
    contractId: null,
    jurisdictionPacks: ['fr-tva', 'uk-vat', 'uae-vat', 'gst'],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'impot-societes',
    team: 'tax',
    kind: 'llm',
    definition:
      'Prépare l’IS : réintégrations, déductions, déficits, différences temporaires, provision fiscale.',
    actions: [
      'résultat comptable',
      'réintégrations',
      'déductions',
      'déficits reportables',
      'différences temporaires',
      'estimation IS',
      'acomptes',
      'provision fiscale',
      'documentation',
    ],
    toolNames: ['read_trial_balance', 'read_tax_positions', 'read_ledger_entries'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'retenues-source',
    team: 'tax',
    kind: 'llm',
    definition:
      'Gère les retenues à la source : paiements concernés, taux, conventions, certificats, échéances.',
    actions: [
      'paiements concernés',
      'taux',
      'conventions fiscales',
      'calcul',
      'certificats',
      'paiements administration',
      'dates limites',
    ],
    toolNames: ['read_payment_batches', 'read_tax_positions', 'read_vendor_masterdata'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'fiscalite-internationale',
    team: 'tax',
    kind: 'llm',
    definition:
      'Surveille la fiscalité internationale : flux transfrontaliers, établissement stable, escalade fiscaliste.',
    actions: [
      'flux transfrontaliers',
      'établissement stable',
      'retenues',
      'obligations locales',
      'conventions',
      'escalade fiscaliste',
    ],
    toolNames: ['read_intercompany_balances', 'read_tax_positions'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'prix-transfert',
    team: 'tax',
    kind: 'llm',
    definition:
      'Contrôle les prix de transfert : flux intercompany, méthodes, marges, documentation, ajustements.',
    actions: [
      'flux intercompany',
      'méthodes de facturation',
      'marges',
      'écarts',
      'documentation',
      'ajustements de fin de période',
    ],
    toolNames: ['read_intercompany_balances', 'read_contract_registry', 'read_tax_positions'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'calendrier-fiscal',
    team: 'tax',
    kind: 'service',
    definition:
      'Tient le calendrier fiscal : échéances, déclarations requises, dépôts, paiements, accusés de réception.',
    actions: [
      'échéances',
      'déclarations requises',
      'relances',
      'complétude',
      'dépôts',
      'paiements',
      'accusés de réception',
    ],
    blocking: false,
    materializable: false,
  },

  // --- 7. Control & Audit ---------------------------------------------------
  {
    slug: 'audit-interne',
    team: 'control-audit',
    kind: 'llm',
    definition:
      'Teste les contrôles internes : échantillons, preuves, violations, remédiations, rapports.',
    actions: ['teste les contrôles internes', 'échantillons', 'preuves', 'violations', 'remédiations', 'rapports'],
    toolNames: ['read_audit_evidence', 'read_ledger_entries', 'read_approval_trail'],
    contractId: null,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'evidence-vault',
    team: 'control-audit',
    kind: 'service',
    definition:
      'Coffre à preuves : conserve pièces, règles, calculs, validations, réponses API ; relie chaque écriture à son dossier.',
    actions: [
      'conserve pièces sources',
      'règles',
      'calculs',
      'validations',
      'réponses API',
      'relie chaque écriture à son dossier',
      'exports d’audit',
    ],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'fraude-anomalies',
    team: 'control-audit',
    kind: 'llm',
    definition:
      'Détecte fraudes et anomalies avec score de risque — blocage terminal des cas critiques.',
    actions: [
      'doublons',
      'montants inhabituels',
      'hors horaires',
      'fournisseurs liés',
      'paiements fractionnés',
      'changements de coordonnées',
      'score de risque',
      'blocage des cas critiques',
    ],
    toolNames: [
      'read_ledger_entries',
      'read_payment_batches',
      'read_vendor_bank_history',
      'read_audit_evidence',
    ],
    contractId: null,
    blocking: true,
    materializable: false,
  },
  {
    slug: 'separation-responsabilites',
    team: 'control-audit',
    kind: 'service',
    definition:
      'Séparation des responsabilités : qui a préparé/approuvé/exécuté — l’auto-approbation est impossible.',
    actions: [
      'qui a préparé/approuvé/exécuté',
      'anti-auto-approbation',
      'conflits de permissions',
      'double validation',
    ],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'conformite',
    team: 'control-audit',
    kind: 'llm',
    definition:
      'Vérifie la conformité : processus, approbations, obligations, violations, plans de correction.',
    actions: ['processus', 'approbations', 'obligations', 'violations', 'preuves', 'plans de correction'],
    toolNames: ['read_approval_trail', 'read_audit_evidence', 'read_permission_matrix'],
    contractId: null,
    blocking: false,
    materializable: false,
  },

  // --- 8. Integration Platform — connectors (deterministic, never an LLM) ---
  {
    slug: 'connecteur-xero',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur Xero : organisations, objets comptables, sync, envoi des écritures autorisées avec vérification.',
    actions: [
      'organisations',
      'comptes/contacts/factures/paiements',
      'taux de taxe',
      'sync',
      'objets compatibles',
      'envoi écritures autorisées',
      'PJ',
      'vérif résultat',
      'gestion identifiants/erreurs API',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-sage',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur Sage : détection de version (multi-produits → adaptateurs distincts), sync et correspondances.',
    actions: [
      'détection de version',
      'plan comptable',
      'tiers',
      'sync factures/écritures',
      'fiscalité locale',
      'erreurs de sync',
      'correspondances Sage↔modèle interne',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-quickbooks',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur QuickBooks : comptes, tiers, rapports, création/màj des objets autorisés avec vérification.',
    actions: [
      'comptes/classes',
      'tiers/factures/paiements',
      'rapports',
      'création/màj des objets autorisés',
      'vérif',
      'différences de modèle',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-netsuite',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur NetSuite : filiales, transactions, dimensions, devises, requêtes, écritures validées.',
    actions: [
      'filiales',
      'transactions',
      'tiers',
      'dimensions',
      'devises',
      'requêtes',
      'écritures validées',
      'scripts spécifiques',
      'vérif',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-dynamics365bc',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur Dynamics 365 BC : sociétés, tiers, dimensions analytiques, envoi autorisé, vérif comptabilisation.',
    actions: [
      'sociétés',
      'comptes',
      'tiers',
      'factures/paiements',
      'dimensions analytiques',
      'envoi autorisé',
      'vérif comptabilisation',
      'extensions client',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-pennylane',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur Pennylane : dossiers, factures, pièces, statuts, catégorisations, échanges cabinet.',
    actions: [
      'dossiers',
      'factures',
      'pièces',
      'statuts',
      'catégorisations',
      'écritures autorisées',
      'échanges cabinet',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-cegid',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur Cegid : sociétés, plans/journaux, écritures, tiers, données fiscales, spécificités des offres.',
    actions: [
      'sociétés',
      'plans/journaux',
      'écritures',
      'tiers',
      'envoi validé',
      'données fiscales',
      'spécificités des offres',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-sap',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur SAP : identification du produit (S/4HANA/Business One/… → variantes), ledgers, workflows d’approbation.',
    actions: [
      'identification du produit',
      'sociétés/ledgers',
      'écritures',
      'tiers',
      'centres de coûts/ordres',
      'envoi autorisé',
      'workflows d’approbation',
      'vérif',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-zoho-books',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Adaptateur Zoho Books : contacts, factures, paiements, banques/taxes, identifiants croisés.',
    actions: [
      'contacts/factures/paiements',
      'banques/taxes',
      'propositions validées',
      'statuts',
      'identifiants croisés',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },
  {
    slug: 'connecteur-generique',
    team: 'integration-platform',
    kind: 'connector',
    definition:
      'Connecteur générique (P1 côté plateforme, read-only) : CSV import/export, API REST, webhooks, rapport des limitations.',
    actions: [
      'CSV import/export',
      'API REST',
      'webhooks',
      'mapping d’objets',
      'vérif formats',
      'rapport des limitations',
      'lecture seule si l’écriture n’est pas sûre',
    ],
    writeEnabled: false,
    blocking: false,
    materializable: false,
  },

  // --- 8bis. Integration Platform — technical services ----------------------
  {
    slug: 'synchronisation',
    team: 'integration-platform',
    kind: 'service',
    definition:
      'Service de sync : initiale/incrémentale, curseurs, reprise après erreur, conflits, fraîcheur.',
    actions: [
      'sync initiale/incrémentale',
      'curseurs',
      'reprise après erreur',
      'détection de modifs',
      'résolution de conflits',
      'fraîcheur',
    ],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'resolution-identites',
    team: 'integration-platform',
    kind: 'service',
    definition:
      'Résout la même réalité dans plusieurs systèmes : fournisseurs, clients, comptes, factures, homonymes.',
    actions: [
      'fournisseurs',
      'clients',
      'comptes',
      'factures',
      'homonymes',
      'identifiants croisés',
    ],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'execution-gateway',
    team: 'integration-platform',
    kind: 'service',
    definition:
      'UNIQUE porte d’écriture (stub read-only en P1) : permissions, mandat, approbations, idempotence, blocage au doute.',
    actions: [
      'permissions',
      'mandat de l’agent',
      'approbations',
      'anti-doublon',
      'idempotence',
      'journal d’intention',
      'appel connecteur',
      'vérif résultat',
      'blocage au doute',
    ],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'gestion-erreurs',
    team: 'integration-platform',
    kind: 'service',
    definition:
      'Gère les erreurs : classification, retry des récupérables, anti-répétition dangereuse, passage en lecture seule.',
    actions: [
      'classification',
      'retry des récupérables',
      'anti-répétition dangereuse',
      'incidents',
      'information utilisateur',
      'passage en lecture seule',
    ],
    blocking: false,
    materializable: false,
  },
  {
    slug: 'permissions',
    team: 'integration-platform',
    kind: 'service',
    definition:
      'Permissions : par société/module/type d’action, seuils financiers, révocation immédiate, contrôle avant exécution.',
    actions: [
      'par société/module/type d’action',
      'seuils financiers',
      'restrictions géographiques',
      'révocation immédiate',
      'contrôle avant chaque exécution',
    ],
    blocking: false,
    materializable: false,
  },
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a role by its slug. Returns undefined if unknown. */
export function getRoleBySlug(slug: string): FinanceRoleDef | undefined {
  return FINANCE_ROSTER.find((r) => r.slug === slug)
}

/**
 * The P1 materialization slice — the ONLY roles a materializer may turn into
 * real copilots in this pass (Accounts Payable vertical + independent
 * verifier). All are LLM roles by construction; the return type says so.
 */
export function getMaterializableAgents(): FinanceLlmRoleDef[] {
  return FINANCE_ROSTER.filter(
    (r): r is FinanceLlmRoleDef => r.kind === 'llm' && r.materializable,
  )
}
