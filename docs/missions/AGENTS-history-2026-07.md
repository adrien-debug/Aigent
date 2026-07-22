# Historique des missions — archive AGENTS.md (extrait le 2026-07-22)

> Contenu déplacé verbatim depuis `AGENTS.md` (qui ne garde que les invariants courts).

<!-- BEGIN:tradeagent-roster -->
## Roster TradeAgent canonique (AIGENT-RESET-TRADEAGENT-022)

**Reset destructif du 2026-07-22.** Les 40 anciens copilots et leurs 2795 lignes
enfants (runs, tool calls, benchmarks, tests, manifests, versions, tools) ont été
supprimés. `scripts/reset-agent-platform.mjs` — dry-run par défaut, `--apply`
pour écrire, idempotent. Il vide d'abord les 3 colonnes qui pointent un copilot
**sans FK** (`mission_findings.copilot_id`, `mission_runs.orchestrator_copilot_id`,
`mission_runs.participant_copilot_ids`), que la cascade ne nettoie pas.

**Roster actuel** (`scripts/provision-tradeagent-roster.mjs`) — 4 agents dans
`proj-tradeagent`, provider `openai`, modèle `gpt-5.4` :

| Agent | Outils | Statut |
|---|---|---|
| Market Intelligence | 5 | `active` — prouvé par run |
| Portfolio Risk Guardian | 5 | `active` — prouvé par run |
| Execution Supervisor | 4 | `draft` |
| Performance Analyst | 4 | `draft` |

**Deux pièges à ne pas réintroduire :**
1. **LangGraph est OBLIGATOIRE — le vrai piège est un agent `langgraph` SANS assistant
   provisionné.** `runner.ts` route `runtime: 'langgraph'` vers le LangGraph Agent Server, qui
   possède son propre graphe. Un copilot `langgraph` sans assistant tourne contre le graphe nu et
   hérite des outils génériques legacy : les outils marché du manifest ne sont **jamais montés**,
   l'agent répond « je n'ai pas de données marché » avec `tool_call_count = 0` tout en paraissant
   sain dans le catalogue. La cause n'est PAS le runtime (formulation antérieure, fausse) mais
   l'**absence d'assistant** : provisionner l'assistant (`scripts/ensure-langgraph-assistants.ts`)
   PUIS `runtime: 'langgraph'` — jamais flipper le runtime seul.
2. **La description d'un outil EST son contrat d'entrée.** Le runner l'envoie au
   modèle sans schéma JSON. Les schémas Zod attendent `pair` (pas `symbol`) —
   sans description explicite, le modèle devine et chaque appel échoue.

**Non construits, volontairement** : Strategy Research (aucun handler de
backtest) et Withdrawal Review (`read_account_risk_snapshot` retourne toujours
UNAVAILABLE sans compte connecté). Pas de coquille vide.

`active` signifie **prouvé** : `--activate` exige un run `completed`, zéro
tentative unsafe et un modèle vérifié.

## Historique — roster précédent (AIG-TRADEAGENT-ONLY-019)

Le catalogue actif ne sert que des agents réellement exécutables. Un agent est
`active` seulement si son `project_id` existe, son provider est câblé, sa version
et son manifest sont présents, **et** chaque outil déclaré se résout vers un
handler enregistré. Une ligne `tools` ne suffit pas : le runner exige un handler
par NOM (`runner.ts` — « has no registered handler »).

**Actifs (`proj-tradeagent`, zéro outil non résolu)** — BTC Alert & Levels
Sentinel · Portfolio Risk & Lock Advisor · Source Reliability & Price Trust
Sentinel · Withdrawal Review Copilot · Market Regime & Rotation Copilot.

**Historiques non actifs** — `copilot-tradeagent-market-intelligence-b1c8c291` et
`copilot-tradeagent-portfolio-risk-guardian-91f81963` sont `degraded` : ils
déclarent `read_repo_file`, `list_repo_tree` et `search_repo`, absents du
registry. Ne jamais les présenter comme actifs ou exécutables. Les rendre actifs
suppose d'implémenter ces trois handlers, pas de changer leur statut.

**Archivés** — les six copilots `aig-trade-001` sans projet (Atlas, Vector,
Sentinel, Pulse, Meridian, Sage) sont `archived` ⇒ `unavailable`. Leurs 74 runs
historiques restent lisibles ; on ne les réattribue jamais à `proj-tradeagent`.
Opération rejouable : `scripts/archive-non-tradeagent-agents.mjs` (dry-run par
défaut, `--apply` pour écrire).

`archived` n'est pas `inactive` : la retraite est une décision, la pause un état.

**Garde d'exécution (AIG-…-GATE-020)** — `POST /api/agent-ops/copilots/:id/run`
relit l'agent canonique au lancement et refuse fail-closed : seul `active` **et**
`unresolvedToolIds` vide autorise un run. Catalogue injoignable → 503 · absent →
404 · connu mais non exécutable → 409 avec les raisons concrètes. Ne recalcule
jamais le statut dans une route : deux implémentations divergent toujours.
<!-- END:tradeagent-roster -->

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
  agents existantes (`/admin/agents/[id]`, projets sur `/admin`), comme tous
  les autres copilots.
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

### Runtime multi-provider — vérité d'exécution (ne pas régresser en « OpenAI-only »)
Aigent n'est **pas** OpenAI-only. Deux chemins d'exécution, deux réalités :
- **Chemin model-router DIRECT** (`model-router.ts`, tout `runtime` ≠ `langgraph`) =
  **multi-provider** : il résout le `model_provider` du copilot et route vers
  `openai` (SDK), `google` (Gemini REST), ou `local` (parc vLLM d'Adrien,
  OpenAI-compatible, opt-in explicite — jamais de redirection silencieuse).
  `mistral` déclaré mais non câblé (`ProviderUnavailableError`). Aucun fallback
  muet : provider indisponible → erreur typée.
- **Chemin LangGraph** (`runtime === 'langgraph'`) = **multi-provider** via
  `src/langgraph/model-provider.mjs` : lit `modelProvider` du
  `CopilotBehaviorConfig` (sourcé depuis `copilots.model_provider`) et instancie
  `ChatOpenAI` pour `openai`, Gemini OpenAI-compat pour `google`, vLLM local pour
  `local`. `mistral` déclaré mais non câblé (erreur explicite).
<!-- END:trading-factory -->
