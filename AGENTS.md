<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:catalyst-ui-rules -->
## UI (gate : `npm run check:catalyst`)
- **Dashboard** (`src/app/admin/`, `src/components/agent-ops/`) → **primitives Catalyst
  uniquement** (`src/components/catalyst/`). Zéro `<button>`/`<input>`/`<select>`/`<textarea>`/
  `<table>` natif. Un contrôle au style entièrement custom (toggle, tuile sélectionnable, croix
  de suppression dans un badge) utilise `Headless.Button` (`@headlessui/react`) plutôt qu'un
  `<button>` brut — même sémantique clavier/focus/disabled que `Button` Catalyst, sans hériter
  de son padding/couleur par défaut.
- **Marketing** (`src/app/(site)/`, `src/components/marketing/`) → blocs Tailwind Plus pris tels
  quels, restylés sur les tokens du projet (`accent-*`/`zinc`). Pas de primitive Catalyst ici —
  convention volontaire, le marketing est une vitrine statique.
- **Un seul accent : `accent` (vert tendre, `#A7FB90`, `src/app/globals.css`).** Tout le reste est `zinc`.
  Les 18 autres couleurs que `<Button color>` accepte sont interdites hors `components/catalyst/`.
- Besoin d'une section/écran dashboard ? → **lis** `~/.claude/tailwind-blocks/application-ui/`
  pour la structure, puis monte-la avec les primitives Catalyst. Ne colle jamais le JSX brut d'un
  bloc dans le dashboard.
- 23 primitives disponibles dans `src/components/catalyst/` (alert, auth-layout, avatar, badge,
  button, description-list, dialog, divider, dropdown, fieldset, heading, input, link, listbox,
  navbar, pagination, select, sidebar-layout, stacked-layout, switch, table, text, textarea).
<!-- END:catalyst-ui-rules -->

<!-- BEGIN:trading-factory -->
## Trading Agent Factory (AIG-TRADE-001)

Couche métier trading pour l'univers **ETH-only** de TradeAgent, entièrement
**read-only et truth-aware** (aucun chemin d'écriture ordre/compte/marché). Tout
sous `src/lib/agent-mission-control/market/` :

- `truth.ts` / `snapshot.ts` / `indicators.ts` — `MarketSnapshot` normalisé avec
  provenance+fraîcheur (LIVE/SNAPSHOT/HISTORICAL/FIXTURE/FALLBACK/UNAVAILABLE) ;
  math ATR/stdev/régime/structure déterministe. Donnée absente → UNAVAILABLE,
  jamais inventée. Prix = décimales lossless, jamais float.
- `provider.ts` — `HttpMarketProvider` lit les routes **publiques** `/api/market/*`
  de TradeAgent (`TRADEAGENT_MARKET_URL`) ; TradeAgent n'est **jamais** écrit.
- `tools.ts` — 8 outils read-only validés Zod (jamais de throw). `read_account_risk_snapshot`
  toujours UNAVAILABLE (capital jamais fabriqué).
- `contracts.ts` — 6 contrats de sortie Zod versionnés (v1.0.0).
- `agents/roster.ts` — les 6 agents (Atlas/Vector/Sentinel/Pulse/Meridian/Sage) en
  config pure. `eval/` — corpus de tests + benchmark (gates de blocage, sécurité 100%).
  `shadow.ts` (SNAPSHOT-only) · `council.ts` (Sentinel BLOCKED terminal) ·
  `delivery.ts` (paquet TradeAgent checksummé, n'active rien).
- **Pas de surface UI dédiée** : les agents trading vivent dans les surfaces
  agents existantes (`/admin/agents`), comme tous les autres copilots.
- Docs : `docs/trading-agent-factory.md` + `docs/runbook-trading-factory.md`.
- **Matérialisation OpenAI des 6 agents = étape facturée, non exécutée** (attend accord §8).

### Export statique des 6 agents (AIG-PACK-015)
- `npm run export:trading` (`scripts/export-trading-packages.mjs`, node pur, zéro
  dep, zéro appel LLM/réseau/secret) exporte les 6 agents matérialisés au commit
  `d448441` en paquets **déterministes + checksummés** sous `delivery/tradeagent/` :
  `<slug>/{package.json,contract.json,checksum.txt}` + `manifest.json` global (checksum global).
- **SNAPSHOT-ONLY** : source = `delivery/tradeagent/_snapshot/db-truth.json` (vérité DB
  gelée, lue une fois du périmètre gpu1 puis figée). Benchmark = **lu** depuis
  `copilot_versions.scores` (global `0.985`, evidence `FIXTURE`), jamais régénéré.
- **Reproductible** : deux exports byte-identiques (JSON canonique, clés triées, LF,
  zéro horodatage runtime). Marchés **réconciliés au backend réel** — `backendExecutableMarkets:
  [ETH,BTC,SOL,XAU]` ; « ETH-only » = allowlist retail runtime (`MARKET_EXECUTABLE_SYMBOLS`),
  jamais une limite backend.
- **Gate sécurité** : contrat Sentinel/Pulse invalide → l'export abort non-zéro, n'écrit rien.
- Tests : `tests/unit/export-trading-packages.test.ts` (double-export identique, altération 1 octet
  détectée, blocage Sentinel/Pulse). Détail : `delivery/tradeagent/README.md`.
## My Team — canvas d'équipe projet (AIG-TEAM-CANVAS-002)

Cartographie vivante des agents d'un projet, en graphe. Route
`/admin/projects/[id]/team`, API `GET /api/agent-ops/projects/[id]/team`,
sous-nav projet `Overview · Agent Builder · My Team`
(`src/components/agent-ops/project-tabs.tsx` — n'expose QUE des routes projet
qui existent réellement).

- **Moteur** : `@xyflow/react` 12.11.2. **Pas d'elkjs** — le layout
  (`project-team/layout.ts`) est une fonction pure déterministe, donc testable.
  `graph-canvas-svg.tsx` (diagramme LangGraph 5 nœuds figés) n'est PAS réutilisé.
- **Contrat unique** : `getProjectTeamGraph(projectId)` sert la page ET la route ;
  zéro logique dupliquée. Sortie validée Zod `.strict()`.
- **Vérité des relations** : `origin: 'explicit'` ⟺ une ligne persistée énonce
  cette arête. Appartenance projet = `explicit` (restitue `copilots.project_id`) ;
  groupes issus de `copilots.tags` = `derived` et rendus en pointillé. Jamais
  d'inférence par nom, modèle, co-appartenance ou proximité temporelle.
  `shares-tool` plafonné à `SHARED_TOOL_MAX_AGENTS = 4` (un outil commodité ne
  porte aucun signal).
- **Activité d'une arête** : uniquement sur un fait persisté ON the relation
  (`mission_runs`). La co-activité de deux agents n'anime rien. Aujourd'hui
  `orchestrator_copilot_id` est toujours NULL ⇒ aucune arête active — c'est correct.
- **Donnée absente ≠ zéro** : compteurs d'activité `number | null` + `unavailableAgents` ;
  `node.runHistory` (`known|unreadable|outside-window|not-applicable`) ;
  `toolsUnavailable` ; `freshness.latestActivityState`. `totalRuns` exact via
  `count=exact`, jamais une fenêtre tronquée. Inconnu → tiret, jamais `0` ni `"null"`.
- **`active` n'est jamais dérivé de `copilots.status`** — il exige un run réellement `running`.
- **Isolation projet** : requête `project_id=eq.` + re-filtre strict en mémoire.
  Les copilots à `project_id` NULL et les `target_project_ids` n'entrent jamais.
- Migration `0019_project_agent_relations.sql` (RLS deny-by-default, service_role).
  Relations cross-projet rejetées **à la lecture**, pas par contrainte SQL — aucun
  write path aujourd'hui ; un futur writer DOIT revérifier les deux `project_id`.
- Docs : `docs/project-team-canvas.md`.

## Accounting Agent Factory (AIG-FIN-001)

Couche métier comptabilité, **read-only/dry-run** (aucun chemin d'écriture réel
vers un ERP, zéro appel LLM/réseau/secret). Tout sous
`src/lib/agent-mission-control/finance/`, miroir de `market/` :

- **Principe** : UN agent métier (ex. TVA) + connecteurs par ERP — jamais un agent
  par logiciel. Pipeline : Agent métier → Policy → Approbation → Execution Gateway
  (UNIQUE porte d'écriture, stub read-only) → Connecteur → Xero/Sage/NetSuite/….
  Format pivot = écriture comptable standard (lignes débit/crédit équilibrées).
- **65 rôles ≠ 65 LLM** : ~35 `llm` (copilots : prompt + outils read-only + contrat
  Zod), 10 `connector` (code déterministe, jamais un LLM), ~20 `service` (Gateway,
  Permissions, Sync, Erreurs, Identités, Planificateur…). 8 équipes : Finance
  Command, Data Ops, AP, AR, Accounting & Close, Tax, Control & Audit, Spécialisés.
- **P1 matérialisable** = équipe Accounts Payable (documents, fournisseurs,
  controle-factures, securite-fournisseurs, ecritures + controleur-general) +
  connecteur générique CSV read-only.
- **Gates** : `securite-fournisseurs` et `controleur-general` BLOCKED **terminal**
  (comme Sentinel) ; sécurité 100 % au benchmark ; auto-approbation impossible (§47).
- Montants = `DecimalString` lossless, jamais float. Donnée absente = UNAVAILABLE
  avec provenance (LIVE/SNAPSHOT/HISTORICAL/FIXTURE/FALLBACK/UNAVAILABLE).
- Docs : `docs/accounting-agent-factory.md`. Projet consommateur : `proj-accounting-agent`.
- **Matérialisation OpenAI = étape facturée, non exécutée** (attend accord §8).
<!-- END:trading-factory -->
