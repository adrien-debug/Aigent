# Audit qualité agents — 10 axes, 10 auditeurs Opus (2026-07-20)

> **⚠ INSTANTANÉ DU MATIN — NE PAS LIRE COMME L'ÉTAT COURANT.**
> Ce document décrit le code **avant** les commits `d327ba1` et `3809415`. Une
> grande partie de ce qu'il décrit comme manquant a été livrée le jour même, et
> plusieurs de ses « corrections de vérité » sont devenues fausses en quelques
> heures (Langfuse, plafond de coût, câblage finance…). Un re-audit a été mené
> après livraison ; ses conclusions sont dans la section **« Re-audit »** en fin
> de fichier. En cas de contradiction, c'est le re-audit qui fait foi, et le
> code qui tranche.

Audit multi-agents demandé par Adrien : « qu'est-ce qu'on peut mettre en place
pour vraiment améliorer la qualité des agents — externe, visuel, tout ». Dix
auditeurs Opus indépendants, lecture seule, chacun ancré dans le code réel
(chemins cités). Ce document condense leurs rapports ; la synthèse croisée est
en tête. À sa rédaction, rien n'était implémenté — c'étaient des propositions.

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


---

# Re-audit après livraison (2026-07-20, commits `d327ba1` + `3809415`)

Six auditeurs, lecture seule, code courant **et base live**. Ce qui suit
remplace l'état décrit plus haut.

## Livré et vérifié

Plafond de coût réellement appliqué sur les deux chemins — le vrai bug était une
colonne absente d'un `select`, qui le rendait inerte sur les 44 assistants.
Blocage `forbiddenActions` avant exécution (prouvé par run réel : `status
blocked`, handler jamais appelé). Invariant de confirmation fermé sur les
chemins d'écriture applicatifs. Garde SSRF unifiée et durcie côté `http_get`.
Exporter Langfuse branché sur l'instance self-hosted (trace réelle vérifiée :
5 observations = 5 steps). Coût de télémétrie calculé, provider normalisé à
l'ingestion. `unsafeActionCount` en `number | null` de bout en bout.
Assertions de sécurité déterministes au benchmark.

## Défauts trouvés APRÈS livraison, corrigés dans la foulée

- **Un seul appel d'outil était contrôlé sur le chemin LangGraph.** Le nœud
  d'approbation ne regardait que `tool_calls[0]` pendant que le nœud
  d'exécution les lançait tous : une réponse à deux appels laissait passer le
  second. `parallel_tool_calls: false` est une demande au fournisseur, pas une
  garantie — les backends OpenAI-compat derrière `google` et `local` ne
  l'honorent pas tous. Corrigé aux deux endroits, avec re-contrôle dans le nœud
  qui exécute (le seul par lequel tout appel passe nécessairement).
- Deux commentaires devenus faux (table des versions, énum provider).

## Ce qui reste, et qui n'est PAS « en cours »

1. **Drift des noms d'outils finance** : 2 résolus sur 26. Douze noms en base
   sans handler, sept handlers que personne n'appelle. Les 7 agents AP sont
   inexécutables, en **dégradation silencieuse** (chaque appel refusé, run
   « réussi »). Le test livré n'assère que code↔code — il faut une assertion
   base↔code, sinon l'écart reviendra.
2. **`tools.mutates` : 177 lignes à `true`, aucune à `false`.** La migration
   n'a rien backfillé, donc ~150 outils en lecture seule ont leur toggle de
   confirmation verrouillé, sans chemin de correction (le PATCH n'accepte pas
   `mutates`).
3. **Télémétrie : zéro ligne en base.** La boucle est muette en fait, pas
   seulement en risque — le chantier « prod → eval » n'a aucune matière.
4. **Le sweep n'a aucun déclencheur d'UI.** Moteur et route livrés, inutilisables
   depuis le dashboard.
5. **65 versions sur 71 portent des scores à zéro posés à la création**,
   indiscernables d'une vraie mesure, et ils alimentent KPI et release-gate.
6. **Chantier corpus (le n°1) intact**, et plus gros qu'annoncé : aucune
   persistance par tâche, donc la variance n'est même pas mesurable, et la
   boucle d'amélioration lit les énoncés des cas, pas seulement les scores.
   Piège à connaître : un holdout constitué en dupliquant les cas de test est
   fuité dès le premier jour.

Chantiers 3, 4, 5 et 6 de la section précédente sont **substantiellement
intacts** : les replanifier comme neufs.
