# Audit qualité agents — 10 axes, 10 auditeurs Opus (2026-07-20)

Audit multi-agents demandé par Adrien : « qu'est-ce qu'on peut mettre en place
pour vraiment améliorer la qualité des agents — externe, visuel, tout ». Dix
auditeurs Opus indépendants, lecture seule, chacun ancré dans le code réel
(chemins cités). Ce document condense leurs rapports ; la synthèse croisée est
en tête. Rien ici n'est implémenté — ce sont des propositions.

---

## Corrections de vérité (doctrine interne périmée, vérifiée par ≥1 auditeur)

1. **Gemini tool-use EST câblé** dans `model-router.ts` (`toGeminiTools`,
   round-trip `functionCall`/`functionResponse`) — confirmé indépendamment par
   2 auditeurs. La fiche du sous-agent `agent-aigent-langgraph` est périmée.
2. **La télémétrie retour prod EXISTE** (Prompt 62/64 livré) :
   `POST /api/runtime-telemetry`, table `runtime_telemetry_events` (0017),
   wrapper opt-in, UI `/admin/telemetry`, consommée par l'improvement-loop.
   MAIS health-only (shapes rédigées, statut, latence) : aucun signal de
   qualité, aucun coût calculé, et 3 interrupteurs opt-in éteints par défaut
   → boucle potentiellement muette sans alerte. Mémoire mise à jour.
3. **`LANGFUSE_*` n'existe pas dans Aigent** (grep zéro) — ces vars vivent dans
   dropship-platform. Toute intégration Langfuse serait un chantier neuf.
4. **La table « Score comparison » des versions lit le blob `scores` périmé**
   que le release-gate lui-même refuse d'utiliser (il recalcule live).
5. **Mirage mémoire** : les steps `memory-read`/`memory-write` affichés par
   l'UI n'existent que dans `seed-fixtures.ts`. Aucune infra mémoire réelle.
6. **`maxCostPerRunUsd` est un placebo** : stocké, jamais comparé au runtime.
7. **Les 9 outils finance ne sont câblés dans aucun runner**
   (`FINANCE_TOOL_HANDLERS` importé nulle part) — gamme comptable inexécutable
   malgré le bench 16/16. Gateway §47 et Council Sentinel : codés, testés,
   mais importés par aucun chemin live.

## Méta-constat

Le pattern qui revient dans 8 audits sur 10 : **les organes existent, la
circulation manque**. Corpus à splits verrouillés, scoring per-dimension capé
par gates, provenance truth-aware, sandbox, repo-intelligence frais, télémétrie,
contrats Zod versionnés, council à veto terminal — tout est déjà codé quelque
part dans le repo, mais pas branché au chemin d'exécution générique. Le chemin
« extraordinaire » est surtout un chantier de **généralisation et de câblage**,
pas d'invention.

## Quick wins (S, cumulables, ~zéro risque)

- Enforcer `maxCostPerRunUsd` dans la boucle `runner.ts` (pattern déjà prouvé
  dans `improvement-loop.ts:1252`) + plafond jour/agent.
- Fix énum provider télémétrie (`gemini`→`google`) puis calcul du coût prod à
  l'ingestion (colonne `cost_usd`).
- Indicateur « boucle télémétrie muette » + vars manquantes dans `.env.example`.
- Ancrage temporel serveur systématique (portage neutre du
  `buildTemporalContext` dropship) sur les deux chemins d'exécution.
- Invariant machine « outil write/high-risk ⇒ `requires_confirmation` » (CHECK
  SQL + Zod + check release).
- Spread `...FINANCE_TOOL_HANDLERS` dans `TOOL_HANDLERS` + factories REGISTRY.
- Garde SSRF sur `TRADEAGENT_MARKET_URL` (même contrôle que `http_get`).
- Purger (ou câbler) les steps mémoire fixture-only ; supprimer ou câbler
  franchement `mistral` (pas de demi-état).
- Assertions sécurité déterministes au bench à côté du juge LLM (tool call non
  bloqué sur outil confirm-required ⇒ unsafe, verdict juge ignoré).

## Les 6 chantiers structurants (classés)

1. **Évals V2** — corpus golden séparé des `test_cases` avec splits
   train/tune/validation verrouillés ; N répétitions + variance (gate compare
   `mean − stddev`) ; scoring per-dimension avec rubric (généraliser
   `market/eval/benchmark.ts`) ; gate red-team versionnée = 10e check du
   release-gate (promptfoo/DeepTeam local ou corpus maison) ; juge calibré
   (kappa vs labels humains, self-consistency sur cas litigieux) ; éval de
   trajectoire (efficacité/redondance des tool calls, steps déjà persistés) ;
   cas adversariaux dropship rapatriés comme `caseKind: 'behavioral'`.
2. **Sweep multi-modèles** — `runBenchmarkSweep` sur les 5 ids vLLM (coût ~0)
   + frontier ; matrice UI métriques × modèles ; promotion avec modèle gagnant
   pinné + `benchmark_run` comme preuve ; re-bench périodique anti-dérive ;
   context-fit guard (skip UNAVAILABLE, jamais score 0) ; routage
   qualité/coût par purpose ; chaînes de fallback inter-providers tracées.
3. **Mémoire runtime** — seam unique `run/route.ts:144-196` : blocs advisory
   provenancés (signal historique de runs façon dropship, findings de mission
   jamais relus, télémétrie, repo-intelligence déjà frais) ; sessions
   multi-tours pour copilots livrés (pattern project-builder) ; mémoire
   long-terme gatée (`agent_memory` avec provenance + `stale_at`).
4. **Boucle prod → eval** — échecs prod récurrents promus en `test_cases`
   (table `prod_failure_cases` + clustering par `error_hash`) ; ledger coût
   unifié interne+prod par copilot/version ; feedback opérateur
   (thumbs/notes par run, rattaché aux versions) ; cohortes avant/après
   promotion sur données réelles (UNAVAILABLE si volume insuffisant).
5. **UX itération** — édition directe manifest/prompt + « Enregistrer &
   re-tester » en un clic (aujourd'hui : uniquement via boucle improve LLM
   facturée ; `settings-guardrails.tsx` est un mock non persisté) ; boucle
   improve non-terminale (`decision: 'revise'`) ; cas de test éditables
   (CRUD) ; bench en SSE fond (miroir de `tests/run/stream`) ; diff de
   manifest avant promotion ; dupliquer un agent ; rejouer un cas raté en run
   live ; versions-table alimentée par les runs live, pas le blob périmé.
6. **Outillage** — `web_search` (Tavily/Exa, portage direct du client
   dropship) ; `run_sandbox` (exposer l'isolation existante comme outil
   confirm-required) ; `open_pull_request` gated (la couche github.ts existe) ;
   `search_docs` (BM25 d'abord) ; provider market public read-only pour que la
   gamme trading soit LIVE hors périmètre TradeAgent ; connecteur ERP
   read-only réel pour la gamme finance ; montage MCP générique gouverné (L).

## Infra observabilité (choix stratégique, audit état de l'art)

Deux voies compatibles self-hosted GPU1 : **(a)** déployer **Langfuse OSS**
(traces, datasets versionnés, experiments, juge sur vLLM local, file
d'annotation humaine — fournit d'un coup une partie des chantiers 1 et 4) ;
**(b)** rester natif Postgres et émettre des spans **OpenTelemetry `gen_ai.*`**
d'abord (portabilité, zéro lock-in — `run-trace.ts` n'exporte aujourd'hui que
vers LangSmith SaaS, wired-but-unverified). Recommandation auditeur : (a) si on
veut aller vite, (b) d'abord si on veut rester 100 % maison.

## Sécurité — état des lieux de l'auditeur dédié

Solide et enforced by code : release-gate re-évalué serveur (fail-closed),
HITL structurel LangGraph, blocage chemins secrets, garde SSRF `http_get`,
sandbox `execFile` env minimal, RLS deny-by-default partout, §47 et Sentinel
codés. Trous réels : plafond coût non enforced (quick win), sécurité bench =
juge LLM seul, gates sophistiquées inertes (câblage à la matérialisation),
audit trail mutable (proposition : table append-only chaînée SHA-256),
confirmations par nom d'outil et non par action+args (généraliser les
confirmKeys granulaires de dropship), secret GitHub global non scopé par agent.

## Visuel (doctrine Catalyst, mono-accent, zéro sparkline)

Matrice shootout métriques × modèles ; diff prompt/manifest côte-à-côte ;
coût par étape dans `run-timeline` + rollup SplitBar ; heatmap sécurité
gate × version (intensités accent nommées uniquement) ; badge provenance
unifié (LIVE/SNAPSHOT/FIXTURE/UNAVAILABLE) adopté par toutes les cartes ;
delta ladder d'évolution des scores (deltas discrets, pas de courbe) ;
coût/débit par agent sur le canvas My Team ; KPI band qualité sur l'overview.

---

*Sources : 10 rapports d'auditeurs Opus (session 2026-07-20), chacun fondé sur
lecture du code avec chemins cités ; l'axe état-de-l'art cite des sources web
2026 datées. Les capacités d'outils externes (Langfuse, promptfoo, DeepEval,
Braintrust, OTel GenAI) sont inférées de leur doc, non testées ici.*
