# Dictionnaire canonique des métriques — Agent Mission Control

> **Périmètre — à lire avant de s'en servir.** La **doctrine des chiffres** (§0) est
> **toujours en vigueur** : c'est la règle vivante du projet, rappelée dans `AGENTS.md` et
> tenue par `check:render-truth` / `check:status-truth`.
>
> En revanche, les **rattachements « Page principale »** de ce document décrivent un
> dashboard **antérieur**. Les écrans qu'il nomme — `/admin/performance`, `/admin/factory`,
> watchlist, `fleet-kpi-band.tsx`, `RegistryKpis` — **n'existent plus** ; la console actuelle
> compte six routes (voir `README.md`). Une entrée métrique reste utile pour sa **source** et
> sa **nullabilité** ; ne pas s'y fier pour savoir où un chiffre s'affiche aujourd'hui.

> **Livrable A2.** Référence unique de toute métrique affichée dans l'admin. La Phase 3 (pages)
> s'y adosse : un chiffre ne s'affiche que s'il a une entrée ici, avec sa source réelle, sa
> nullabilité et son état. Cette doc est **descriptive du code existant** (resolvers réels), pas
> prescriptive : quand le code ment, l'entrée le dit (section FIABLE vs TROMPEUR).
>
> **Sources lues** (tous `server-only`) :
> `src/lib/agent-mission-control/data.ts` · `agent-health.ts` · `available-agents.ts` ·
> `agent-detail.ts` · `agent-lifecycle.ts` · `telemetry-health.ts` · `dashboard-overview.ts` ·
> `types.ts`.

---

## 0. Doctrine des chiffres (invariant transversal)

Toute valeur non mesurable voyage **`null` + un état**, jamais `0`. Les collisions interdites :

| Confusion interdite | Bonne lecture |
|---|---|
| `null` ≠ `0` | absence de mesure ≠ mesure d'une valeur nulle |
| absence de writer ≠ « jamais utilisé » | un canal sans émetteur n'est pas un canal à zéro |
| absence de run ≠ « 0% de succès » | pas de verdict ≠ tous les verdicts échoués |
| absence de score ≠ « score 0 » | jamais benchmarké ≠ benchmark à 0 |
| API indisponible ≠ sain | lookup échoué ≠ « rien trouvé » |
| config ≠ capacité | manifest déclare un outil ≠ le runner le monte |
| outil déclaré ≠ outil monté | `tool_ids` ≠ handler enregistré |
| agent `active` ≠ exécutable | statut stocké ≠ le run gate accepte |

**États canoniques** utilisés dans ce document :

- **MEASURED** — valeur lue d'une source réelle, dans la fenêtre, fraîche.
- **UNKNOWN** — la valeur pourrait exister mais n'a pas été prouvée (lookup non tenté / champ absent du blob).
- **UNAVAILABLE** — la source a été interrogée et a échoué (DB down, timeout, erreur PostgREST).
- **STALE** — valeur mesurée mais hors de sa fenêtre de fraîcheur (télémétrie muette, blob jamais recalculé).
- **NOT_APPLICABLE** — la métrique n'a pas de sens dans ce contexte (ex : `successRate` sur zéro run décidé).

**Distinction structurante `healthEvidence` / `healthUnavailableFields`** (portée par `Copilot`,
posée dans `data.ts` → `enrichCopilot`) : `healthEvidence: 'runs' | 'none'` dit si `testPassRate` /
`benchmarkScore` viennent de vrais runs ; `healthUnavailableFields` liste les métriques du blob que
NI le blob NI un resolver n'a pu prouver. **Toute vue qui affiche `copilot.health.<metric>` DOIT
d'abord vérifier ces deux champs** — sinon elle rend un placeholder `0` comme une mesure.

---

## 1. KPIs cockpit (`/admin`) — `dashboard-overview.ts` → `DashboardKpis`

Assemblés par `getDashboardOverview()` → `assembleDashboardOverview()`. **Une seule vague PostgREST**
(pas de scorecard par agent : trop coûteux, 10-15 RTT chacun).

### 1.1 `productionAgents` — « Production agents » ✅ FIABLE

- **Identifiant** : `kpis.productionAgents`
- **Définition** : nombre de copilots servant la production = `productionVersionId` non nul **OU**
  `displayStatus === 'production'`.
- **Source** : `computeProductionAgents(copilots)` sur `getCopilots({ health: 'list' })`.
- **Unité** : compte (entier). **Fenêtre** : instantané. **Fraîcheur** : live (no-store).
- **Couverture** : tous les copilots.
- **Type** : `number | null`. **Nullable** : oui (mais en pratique jamais null ici — `computeProductionAgents` retourne toujours un nombre ; le `| null` du type couvre une future absence).
- **0 vs absence** : `0` = mesuré, aucun agent en prod. Pas de branche « unavailable » pour ce champ.
- **États** : MEASURED. **Page principale** : `/admin`. **Secondaires** : —
- **Note** : lit `displayStatus`, PAS `copilots.status` (qui reste `draft` après promotion — cf. `deriveDisplayStatus`). C'est correct.

### 1.2 `readyForManualTest` — « Ready for manual test » ✅ FIABLE

- **Identifiant** : `kpis.readyForManualTest`
- **Définition** : nombre d'events de livraison (dernier par copilot) avec `status === 'ready_for_manual_test'`.
- **Source** : `computeReadyForManualTest(latestDeliveries)` sur `fetchLatestDeliveryEvents()` (table `agent_delivery_events`, dernier event par `copilot_id`, limit 200).
- **Unité** : compte. **Fenêtre** : dernier event par copilot. **Fraîcheur** : live.
- **Couverture** : copilots ayant au moins un delivery event.
- **Type** : `number | null`. **Nullable** : oui par le type ; en pratique `0` si `latestDeliveries.length === 0`.
- **0 vs absence** : `null` quand `latestDeliveryByCopilot === null` (lecture échouée → `DELIVERY_READ_FAILED_WARNING` dans `dataWarnings` + item `data_unavailable` dans la file). `0` quand la lecture a réussi et qu'aucun copilot n'a d'event. Ne plus confondre avec un `Map` vide avalé silencieusement — corrigé dans `getDashboardOverview`.
- **Page principale** : `/admin`. **Secondaires** : action items (`buildActionItems`, kind `ready_manual`).

### 1.3 `sandboxPassRate` — « Sandbox pass rate » ✅ FIABLE (nullable honnête)

- **Identifiant** : `kpis.sandboxPassRate`
- **Définition** : `passed / total` des derniers sandbox reports (par copilot), en **pourcentage entier 0..100**.
- **Source** : `computeSandboxPassRate(sandboxSnapshots)` sur `fetchLatestSandboxSnapshots()` (table `sandbox_reports`, dernier par copilot).
- **Unité** : pourcentage (0..100, arrondi). **Fenêtre** : dernier report par copilot. **Fraîcheur** : live.
- **Couverture** : copilots avec au moins un sandbox report.
- **Type** : `number | null`. **Nullable** : **OUI** — `null` quand `reports.length === 0`.
- **0 vs absence** : ✅ correct — `null` quand `latestSandboxByCopilot === null` (warning `SANDBOX_READ_FAILED_WARNING`). `null` aussi quand la lecture a réussi et qu'aucun report n'existe. `0` = mesuré, tous les reports échoués.
- **États** : MEASURED | NOT_APPLICABLE (`null`, aucun report) | UNAVAILABLE (`null` + warning si la table est injoignable).
- **Page principale** : `/admin`. **Secondaires** : —

### 1.4 `avgRepoFit` — « Avg repo fit » ✅ FIABLE (nullable honnête)

- **Identifiant** : `kpis.avgRepoFit`
- **Définition** : moyenne des `repoFitScore` non nuls agrégés depuis les sandbox snapshots **et** les scorecards.
- **Source** : `computeAvgRepoFit(repoFitScores)`. Note : `scorecards` est passé `new Map()` vide par `getDashboardOverview` (les scorecards par agent sont trop chères) → en pratique seuls les `sandboxSnapshots.repoFitScore` alimentent ce KPI aujourd'hui.
- **Unité** : score entier (arrondi). **Fenêtre** : dernier snapshot par copilot. **Fraîcheur** : live.
- **Couverture** : copilots avec un `repoFitScore` non nul dans leur dernier sandbox report.
- **Type** : `number | null`. **Nullable** : **OUI** — `null` quand aucun score.
- **0 vs absence** : ✅ correct — filtre `!= null` avant moyenne, `null` si liste vide.
- **États** : MEASURED | NOT_APPLICABLE (`null`).
- **Page principale** : `/admin`. **Secondaires** : —
- **Note couverture** : sous-couvert par design (scorecards vides) — le nom « Avg repo fit » suggère « toute la flotte » alors que la base est « sandbox reports uniquement ». Non trompeur sur la valeur, mais périmètre à documenter côté page.

### 1.5 `blockedDeliveries` — « Blocked deliveries » ⚠️ MIXTE

- **Identifiant** : `kpis.blockedDeliveries`
- **Définition** : nombre de copilots bloqués (par `isBlockedDelivery`) **+** missions bloquées (`status==='blocked'` ou `decision==='blocked'`).
- **Source** : `computeBlockedDeliveries(copilotIds, latestDeliveryByCopilot, latestSandboxByCopilot, scorecards, missionRuns)`. `isBlockedDelivery` déclenche sur : sandbox `failed` · mission `blocked` · delivery `execute_failed`/`blocked` · `scorecard.releaseGateRed` · scorecard `not_ready` avec blockers.
- **Unité** : compte. **Fenêtre** : dernier état par copilot + 10 dernières missions (`fetchMissionRuns` limit 10). **Fraîcheur** : live.
- **Couverture** : ⚠️ **partielle** — `scorecards` est `new Map()` vide dans `getDashboardOverview`, donc les branches `scorecard.releaseGateRed` et `scorecard.level==='not_ready'` ne se déclenchent JAMAIS sur le cockpit. Un agent bloqué UNIQUEMENT par une release gate rouge n'est PAS compté ici (il l'est sur la page agent). Les branches sandbox/mission/delivery, elles, fonctionnent.
- **Type** : `number | null`. **Nullable** : oui par le type ; en pratique un entier.
- **0 vs absence** : `0` = mesuré (aucun bloqué détectable via les signaux DISPONIBLES). ⚠️ un `0` ne prouve PAS « rien de bloqué » — seulement « rien de bloqué via sandbox/mission/delivery », les release-gates n'étant pas consultées ici.
- **États** : MEASURED (partiel). **Page principale** : `/admin`. **Secondaires** : action items (`sandbox_failed`, `release_gate_red` — mais celui-ci ne se déclenche pas faute de scorecards, `mission_blocked`).

---

## 2. Rollup projet (`/admin/projects`) — `dashboard-overview.ts` → `ProjectOverviewItem`

`buildProjectOverview(projects, copilots)` agrège les copilots par `projectId`. Chaque champ vient du
`copilot.health.*` déjà enrichi par `data.ts`.

### 2.1 `copilotCount` / `activeCount` ✅ FIABLE

- **Définition** : `copilotCount` = copilots du projet ; `activeCount` = ceux dont `copilot.status === 'active'` (⚠️ colonne stockée, PAS `displayStatus`).
- **Source** : boucle sur `getCopilots({ health: 'list' })`.
- **Type** : `number`. **Nullable** : non (défaut `0` si projet sans copilot — c'est un vrai 0 mesuré).
- **⚠️ Incohérence de vocabulaire** : `activeCount` compte `status === 'active'` (lifecycle stocké), alors que le KPI cockpit `productionAgents` compte `displayStatus`. Un agent promu (status reste `draft`, `productionVersionId` set) compte dans `productionAgents` mais **pas** dans `activeCount`. Deux définitions d'« actif » sur deux pages. À harmoniser ou expliciter côté page.
- **États** : MEASURED. **Page principale** : `/admin/projects`. **Secondaires** : `dashboard-project-list.tsx`.

### 2.2 `runsLast24h` (colonne « Runs 24h ») ✅ FIABLE

- **Définition** : somme de `copilot.health.runsLast24h` sur les copilots du projet.
- **Source** : `resolve24hMetricsBatch` (agent-health.ts) → vrais `agent_runs` dans la fenêtre 24h, **hors runs d'évaluation** (`NON_EVALUATION_RUN_FILTER`), écrit dans le blob par `enrichCopilot`.
- **Unité** : compte. **Fenêtre** : rolling 24h (`started_at >= now-24h`). **Fraîcheur** : live à chaque requête.
- **Type** : `number`. **Nullable** : non. **0 vs absence** : ✅ `0` = vrai zéro (fenêtre lue, vide). Le blob stale d'origine est écrasé par la vérité run-backed (`enrichCopilot` applique toujours `kpi24h`).
- **États** : MEASURED. **Page principale** : `/admin/projects`. **Secondaires** : `dashboard-project-list.tsx`, KPI band performance (`Total Runs 24h`).

### 2.3 `costLast24hUsd` (colonne « Cost 24h ») ✅ FIABLE

- **Définition** : somme de `copilot.health.costLast24hUsd` sur les copilots du projet.
- **Source** : `resolve24hMetricsBatch` — somme de `agent_runs.cost_usd` sur la fenêtre 24h, **lossless** (micro-USD entiers, une seule division finale). `cost_usd` null/absent contribue `0`.
- **Unité** : USD (`UsdAmount`). **Fenêtre** : rolling 24h. **Fraîcheur** : live.
- **Type** : `number`. **Nullable** : non (agrégat). **0 vs absence** : `0` = mesuré (aucun run coûté dans la fenêtre). ⚠️ mais un run dont `cost_usd` est null contribue `0` **sans** trace ici — la perte de mesure de coût est visible seulement sur la page agent (`runsWithoutCost`), pas au niveau projet.
- **États** : MEASURED. **Page principale** : `/admin/projects`. **Secondaires** : `dashboard-project-list.tsx`, KPI band performance.

### 2.4 `passRate` (rollup projet) ✅ FIABLE (nullable honnête)

- **Définition** : moyenne des `copilot.health.testPassRate` **restreinte aux copilots avec `healthEvidence === 'runs'`** (preuve par run réel).
- **Source** : `buildProjectOverview` — n'empile dans `passRates` que si `copilot.healthEvidence === 'runs'`.
- **Unité** : fraction 0..1. **Fenêtre** : dernier test_run complété par copilot. **Fraîcheur** : live.
- **Type** : `number | null`. **Nullable** : **OUI** — `null` si aucun copilot du projet n'a de preuve run.
- **0 vs absence** : ✅ **exemplaire** — un copilot au blob `testPassRate: 0` sans preuve (`healthEvidence: 'none'`) est **exclu** de la moyenne, pas compté comme 0%. `null` = personne de mesuré.
- **États** : MEASURED | NOT_APPLICABLE (`null`). **Page principale** : `/admin/projects`. **Secondaires** : —

### 2.5 `openWarnings` (rollup projet, badge « N alerts ») ❌ TROMPEUR — FANTÔME

- **Identifiant** : `ProjectOverviewItem.openWarnings`
- **Définition prétendue** : somme de `copilot.health.openWarnings` sur les copilots du projet.
- **Source réelle** : `copilots.health.openWarnings` — **jamais écrit par aucun resolver run-backed**. `normalizeHealth` (data.ts) le lit du blob JSONB stocké ; `provision-tradeagent-roster.mjs` écrit `health: {}` → `openWarnings` absent → `take('openWarnings')` **retourne `0` en placeholder** et pousse `openWarnings` dans `healthUnavailableFields`.
- **Unité** : compte. **Fenêtre** : aucune (statique blob). **Fraîcheur** : ❌ STALE par nature — écrit à la création, jamais recalculé.
- **Couverture** : ❌ **aucun writer réel**. Aucun code ne calcule ni n'incrémente `openWarnings` à partir de faits runtime.
- **Type** : `number`. **Nullable** : non dans le contrat `CopilotHealth` (typé `number`) → **c'est le bug de fond** : un champ jamais mesuré est typé non-nullable, donc son placeholder `0` est indistinguable d'une mesure. La vérité vit dans `healthUnavailableFields` (qui contient `'openWarnings'`), que `ProjectOverviewItem` **n'expose pas**.
- **0 vs absence** : ❌ **collapse total** — `openWarnings === 0` sur le rollup projet signifie presque toujours « jamais mesuré », affiché comme « aucune alerte ». Le badge « N alerts » ne se déclenche que si un blob a par hasard une valeur non nulle héritée d'un seed.
- **États réels** : UNKNOWN (masqué en MEASURED=0). **Page principale** : `/admin/projects`. **Secondaires** : `dashboard-project-list.tsx`, fleet KPI band + watchlist performance.
- **VERDICT** : **métrique fantôme**. À traiter en Phase 3 comme non fiable : ne pas afficher de badge « 0 alerts », ou l'afficher explicitement « — » via `healthUnavailableFields`. `fleet-kpi-band.tsx` a déjà commencé à qualifier (`warningsMeasuredCount`, `agentsWithWarnings`) mais le rollup projet ne le fait PAS.

---

## 3. Métriques agent-détail (`/admin/agents/[id]`) — `agent-detail.ts` → `AgentMetrics`

`computeMetrics(runs)` sur `getRunsForCopilot(id, 50)` (runs opérationnels, hors évaluation). Contrat :
chaque champ `number | null` où `null` = NON MESURÉ (dash), `0` = zéro mesuré.

### 3.1 `runs24h` (« Runs 24h ») ✅ FIABLE

- **Définition** : runs dont `startedAt` est dans les dernières 24h (fenêtre calculée dans `computeMetrics`, indépendante du blob).
- **Source** : filtre en mémoire sur les 50 derniers runs. **Unité** : compte. **Fenêtre** : 24h. **Fraîcheur** : live.
- **Type** : `number`. **Nullable** : non. **0 vs absence** : `0` = mesuré (fenêtre lue, vide). ⚠️ limite : basé sur les 50 derniers runs seulement — un agent à >50 runs/24h sous-compterait (bornage `getRunsForCopilot` limit 50). En pratique volume faible, mais à noter.
- **États** : MEASURED. **Page principale** : `/admin/agents/[id]`. **Secondaires** : —

### 3.2 `totalRuns` ✅ FIABLE (borné)

- **Définition** : nombre de runs retournés (≤ 50). **Source** : `runs.length`. **Type** : `number`, non nullable.
- **⚠️** : c'est `runs.length` borné à 50, PAS le total historique. Un agent à 200 runs affiche `totalRuns: 50`. Nom trompeur si présenté comme « total ». **États** : MEASURED (borné). **Page** : `/admin/agents/[id]`.

### 3.3 `successRate` (« Success rate ») ✅ FIABLE (nullable honnête)

- **Définition** : `completed / (completed + failed)` sur les runs **décidés** uniquement (`status ∈ {completed, failed}`). Les runs `running`/`needs-confirmation`/`blocked` sont exclus du dénominateur.
- **Source** : `computeMetrics`. **Unité** : fraction 0..1. **Fenêtre** : les ≤50 derniers runs. **Fraîcheur** : live.
- **Type** : `number | null`. **Nullable** : **OUI** — `null` si zéro run décidé.
- **0 vs absence** : ✅ correct — `null` (NOT_APPLICABLE) = aucun verdict, `0` = tous les runs décidés ont échoué. Ne pas afficher « 0% success » quand il n'y a aucun run.
- **États** : MEASURED | NOT_APPLICABLE (`null`). **Page principale** : `/admin/agents/[id]`. **Secondaires** : —

### 3.4 `avgDurationMs` (« Avg duration ») ✅ FIABLE (nullable honnête)

- **Définition** : moyenne de `run.latencyMs` sur les runs où elle est finie/numérique.
- **Source** : `computeMetrics`. **Unité** : ms (`DurationMs`). **Fenêtre** : ≤50 derniers runs. **Type** : `number | null`.
- **Nullable** : **OUI** — `null` si aucune latence exploitable. **0 vs absence** : ✅ `null` si vide.
- **États** : MEASURED | UNKNOWN (`null`). **Page** : `/admin/agents/[id]`.

### 3.5 `cost24hUsd` (« Cost 24h » page agent) ✅ FIABLE (nullable honnête)

- **Définition** : somme des `costUsd` des runs **de la fenêtre 24h** où `costUsd` est numérique.
- **Source** : `computeMetrics` — `recent.filter(costUsd finite)`. **Unité** : USD. **Fenêtre** : 24h. **Fraîcheur** : live.
- **Type** : `number | null`. **Nullable** : **OUI** — `null` si aucun run coûté dans la fenêtre.
- **0 vs absence** : ✅ correct — `null` = aucune mesure de coût (dash), pas `0`. Qualifié par `runsWithoutCost`.
- **États** : MEASURED | UNKNOWN (`null`). **Page principale** : `/admin/agents/[id]`, `/admin/agents/[id]/observability`.

### 3.6 `runsWithoutCost` ✅ FIABLE — qualificateur d'honnêteté

- **Définition** : `recent.length - costed.length` = runs 24h dont le coût n'a jamais été enregistré.
- **Source** : `computeMetrics`. **Unité** : compte. **Type** : `number`, non nullable.
- **Raison d'être** : rend `cost24hUsd` honnête — un `cost24hUsd` bas avec `runsWithoutCost > 0` signale une sous-mesure, pas un coût faible. **États** : MEASURED. **Page** : `/admin/agents/[id]`.

### 3.7 `toolCallCount` (agent-détail agrégé) ✅ FIABLE (nullable honnête)

- **Identifiant** : `AgentMetrics.toolCallCount`
- **Définition** : somme de `run.toolCallCount` sur les runs où c'est un nombre.
- **Source** : `computeMetrics` — `counted = runs.map(toolCallCount).filter(number)`. **Unité** : compte. **Fenêtre** : ≤50 runs.
- **Type** : `number | null`. **Nullable** : **OUI** — `null` si aucun run n'a de `toolCallCount` numérique.
- **0 vs absence** : ✅ correct au niveau agrégat — `null` si aucune donnée.
- **⚠️ PIÈGE DOCTRINAL au niveau RUN** (cf. AGENTS.md) : un copilot LangGraph **sans assistant provisionné** tourne contre le graphe nu, hérite des 5 outils legacy, et répond « pas de données » avec `tool_call_count = 0` **en paraissant sain**. Ici `0` est un vrai zéro (le run n'a appelé aucun outil), mais la CAUSE (assistant manquant) n'est pas visible dans cette métrique. Un `toolCallCount` agrégé faible/nul sur un agent supposé actif est un **symptôme**, pas une preuve d'inactivité. Ne pas conclure « agent OK » d'un `toolCallCount` non nul, ni « agent inactif » d'un `toolCallCount` nul.
- **États** : MEASURED | UNKNOWN (`null`). **Page** : `/admin/agents/[id]`, observability.

### 3.8 `lastRun` (« Last run ») ✅ FIABLE

- **Définition** : `runs[0]` (le plus récent). **Source** : premier élément du tri `started_at.desc`. **Type** : `AgentRun | undefined`.
- **Nullable** : oui (`undefined` si aucun run). **0 vs absence** : `undefined` = jamais de run (dash/`TimeAgoValue null`).
- **États** : MEASURED | NOT_APPLICABLE. **Page** : `/admin/agents/[id]` (KPI « Last run »), header agent-détail.

---

## 4. Exécutabilité & statuts — `available-agents.ts` → `AvailableAgent`

La source canonique du « qu'est-ce que le runtime peut prouver AUJOURD'HUI ». Un manifest n'est pas un
agent ; `active` ≠ exécutable.

### 4.1 `executable` (« Executable ») ✅ FIABLE — cœur de la mission

- **Identifiant** : `AvailableAgent.executable` (= `AgentDetail.executable`, = `blockers.length === 0`)
- **Définition** : le run gate accepterait-il un lancement MAINTENANT ? = `status === 'active'` **ET** `unresolvedToolIds.length === 0`. Même règle que `POST /api/agent-ops/copilots/:id/run` et `runtime-catalogue.isExecutable`.
- **Source** : `toAvailableAgent` (available-agents.ts). Sur la page agent, `agent-detail.ts` le recalcule via `computeBlockers` (mêmes règles, miroir du 409).
- **Unité** : booléen. **Fenêtre** : instantané. **Fraîcheur** : live.
- **Type** : `boolean`. **Nullable** : non — mais un agent absent du catalogue → `agent === undefined` → blocker `not-in-catalogue` → `executable: false`.
- **config ≠ capacité / déclaré ≠ monté** : ✅ exemplaire — un outil est « résolu » seulement si une ligne `tools` existe ET que son `name` est dans `RUNNABLE_TOOL_NAMES`. Un manifest déclarant un outil sans handler → `unresolvedToolIds` non vide → `degraded` → NON exécutable.
- **États** : MEASURED. **Page principale** : `/admin/agents/[id]` (KPI « Executable » Yes/No). **Secondaires** : `/admin/agents` (tooltip de ligne, `agentExecutableLabel`), observability.
- **⚠️** : `executable` ≠ `status`. `status` = « existe-t-il un chemin d'exécution câblé » ; `executable` = « le gate accepte-t-il ». Nommer les deux pareil est le bug historique (page promettant un lancement que l'API refuse). Ne jamais dériver « executable » du `status` seul.

### 4.2 `status` (runtime) — « ACTIVE / INACTIVE / DEGRADED / UNAVAILABLE » ✅ FIABLE

- **Définition** : statut RUNTIME dérivé, jamais stocké : `archived`→`unavailable` ; pas de chemin câblé→`unavailable` ; outils non résolus ou zéro outil→`degraded` ; `status==='active'` ou version en production→`active` ; sinon→`inactive`.
- **Source** : `toAvailableAgent`. Chemin câblé = projet ∧ provider ∈ `WIRED_PROVIDERS` (`openai`/`google`/`local`) ∧ modèle ∧ version ∧ manifest ∧ runtime ∈ `EXECUTABLE_RUNTIMES`.
- **Type** : enum `AvailableAgentStatus`. **Nullable** : non. **0 vs absence** : N/A (enum). Absence de preuve → `unavailable`, jamais une valeur rassurante.
- **États** : MEASURED. **Page principale** : `/admin/agents` (badge). **Secondaires** : agent-détail, team canvas, counters.
- **⚠️ Trois statuts coexistent** : `status` (runtime), `lifecycleStatus` (colonne `copilots.status` brute), `displayStatus` (production-aware, dans `Copilot`). Un agent est légitimement `draft` (lifecycle) + `inactive` (runtime) au même instant. Toute page DOIT dire lequel elle montre.

### 4.3 `unresolvedToolIds` ✅ FIABLE

- **Définition** : ids d'outils déclarés (`manifest.tool_ids`) sans handler enregistré. Cause concrète du `degraded`.
- **Source** : `toAvailableAgent` — `declaredToolIds.filter(!isResolved)`. **Type** : `string[]`. **0 vs absence** : `[]` = tous résolus (mesuré).
- **États** : MEASURED. **Page principale** : agent-détail (`computeBlockers`, blocker `unresolved-tools`). **Secondaires** : run gate.

### 4.4 `unavailableFields` ✅ FIABLE — le canal « absent ≠ zéro »

- **Définition** : liste des champs de l'agent NON résolus depuis le persistant (`projectId`, `provider`, `configuredModel`, `executedModel`, `version`, `tools`, `readOnly`, `lastRunCostUsd`, …).
- **Source** : `toAvailableAgent` pousse chaque champ null dans cette liste. **Type** : `string[]`.
- **Raison d'être** : distingue « no cost » de « cost not measured ». Toute vue qui affiche un de ces champs DOIT consulter cette liste. **États** : MEASURED. **Page** : agent-détail, catalogue.

### 4.5 `lastRunCostUsd` (colonne « Cost » page `/admin/agents`) ⚠️ TROMPEUR (étiquette)

- **Identifiant** : `AvailableAgent.lastRunCostUsd`
- **Définition RÉELLE** : coût du **DERNIER run** de l'agent (`agent_runs` le plus récent hors évaluation), null si non mesuré.
- **Source** : `toAvailableAgent` — `lastRun.cost_usd`. **Unité** : USD. **Fenêtre** : le dernier run (PAS une fenêtre 24h). **Type** : `number | null`, nullable ✅.
- **❌ ÉTIQUETTE TROMPEUSE** : la colonne de `/admin/agents/page.tsx` s'intitule **« Cost »** et affiche `agent.lastRunCostUsd` — c'est le coût d'**un seul run** (le dernier), pas un coût 24h ni cumulé. Le brief mission le désigne « Cost colonne agents = coût du dernier run mal étiqueté 24h ». **En l'état, l'en-tête est un « Cost » nu** (pas « Cost 24h »), donc l'étiquette n'affirme pas explicitement 24h — mais elle reste ambiguë : un lecteur suppose un agrégat. À clarifier en Phase 3 : renommer « Last run cost » ou expliciter la fenêtre. **Ne pas confondre** avec `health.costLast24hUsd` (agrégat 24h, colonnes projet) ni `AgentMetrics.cost24hUsd` (page agent).
- **0 vs absence** : ✅ `null` (dash) si le dernier run n'a pas de coût. **États** : MEASURED | UNKNOWN (`null`).
- **Page principale** : `/admin/agents` (colonne « Cost »). **Secondaires** : —

### 4.6 `executedModel` vs `configuredModel` ✅ FIABLE

- **Définition** : `configuredModel` = `copilots.model` déclaré ; `executedModel` = modèle prouvé au dernier run **seulement si** `model_unverified === false` (défaut DB `true` → non prouvé → `null`).
- **Source** : `toAvailableAgent`. **Type** : `string | null` (les deux). **Nullable** : oui.
- **config ≠ capacité** : ✅ un modèle déclaré n'est pas un modèle exécuté prouvé. `executedModel: null` = non vérifié, jamais deviné. `withProvenExecutedModel` (summary) compte les agents au dernier run prouvé — **pas** « agents vérifiés » (les autres sont *non prouvés*, pas *faux*).
- **États** : MEASURED (configured) | MEASURED/UNKNOWN (executed). **Page** : agent-détail, catalogue.

---

## 5. KPIs registre & flotte — `data.ts` → `RegistryKpis` / `fleet-kpi-band.tsx`

### 5.1 `RegistryKpis` (getRegistryKpis)

| Champ | Définition | Source | Nullable | 0 vs absence | Fiabilité |
|---|---|---|---|---|---|
| `totalCopilots` | nb copilots | `getCopilots()` | non | vrai 0 | ✅ |
| `activeCopilots` | `displayStatus ∈ {active, production}` | idem | non | vrai 0 | ✅ (utilise displayStatus, correct) |
| `avgTestPassRate` | moyenne `health.testPassRate` **sur `healthEvidence==='runs'`** | idem | non (défaut `0`) | ⚠️ retourne `0` si `measured.length===0` — devrait être null/dash | ⚠️ MIXTE |
| `runsLast24h` | somme `health.runsLast24h` | resolve24hMetricsBatch | non | vrai 0 | ✅ |
| `totalCostLast24hUsd` | somme `health.costLast24hUsd` | idem | non | vrai 0 (mais cost null→0 sans trace) | ✅ |
| `openWarnings` | somme `health.openWarnings` | blob | non | ❌ voir 2.5 | ❌ FANTÔME |

- **`avgTestPassRate`** ⚠️ : correctement restreint aux agents à preuve run (bon), mais renvoie `0` quand personne n'est mesuré au lieu de `null`. Une flotte sans aucun run afficherait « 0% » au lieu de « — ». À traiter comme null en Phase 3.
- **`openWarnings`** ❌ : même fantôme qu'en §2.5, sommé sur toute la flotte.

### 5.2 Fleet KPI band (`fleet-kpi-band.tsx`) — « Total Runs 24h », « Open warnings », latence flotte

- **Bon élève partiel** : `fleet-kpi-band.tsx` a introduit `sumMeasured`, `measuredOn`, `warningsMeasuredCount`, `agentsWithWarnings` — il qualifie combien d'agents ont RÉELLEMENT mesuré `openWarnings` et affiche `NOT_MEASURED` quand la somme est nulle non-mesurée. C'est le patron à généraliser. **`openWarnings` reste fantôme à la source** (aucun writer), mais cette vue au moins ne le présente plus comme un `0` mesuré.
- **Latence flotte** : dérivée de `health.avgLatencyMs`, prouvée uniquement si `healthEvidence==='runs'` (via `resolveCopilotHealthBatch` includeLatency). `null`/`NOT_MEASURED` sinon. ✅
- **Page principale** : `/admin/performance`. **Secondaires** : watchlist.

### 5.3 `openWarnings` (watchlist `fleet-watchlist.tsx`) ❌ TROMPEUR

- Filtre `copilot.health.openWarnings > 0` et trie dessus. Comme le blob n'est jamais écrit, cette watchlist est en pratique **toujours vide** (aucun agent n'a `openWarnings > 0` sauf seed résiduel). Un opérateur en déduit « aucun agent à surveiller » — faux. ❌ FANTÔME. **Page** : `/admin/performance`.

---

## 6. Scores de version — `agent-health.ts` → `ResolvedVersionScores` (page Release)

`resolveVersionScoresBatch(versionIds)`, appliqué dans `getVersionsForCopilot`. Runs PINNÉS à `version_id`
(même évidence que la release gate).

| Métrique | Définition | Nullable | 0 vs absence | État | Fiabilité |
|---|---|---|---|---|---|
| `version.scores.testPassRate` | pass_rate du dernier test_run complété pinné à la version | run-backed écrase le blob ; sinon baseline stocké | ⚠️ garde le blob `0` si aucun run (`if resolved.testPassRate!==null`) | MEASURED/STALE | ✅ (baseline stale possible) |
| `version.scores.benchmarkScore` | score du dernier benchmark complété pinné | idem | idem | MEASURED/STALE | ✅ |
| `version.scores.unsafeActionCount` | `unsafe_action_count` du dernier benchmark pinné | **OUI** (`null`) | ✅ **exemplaire** — règle INVERSE : le run-backed gagne même null, donc un non-benchmarké lit `null` (« not measured »), jamais « 0 unsafe » | MEASURED/NULL | ✅ |
| `version.scores.shadowAgreement` | 0..1, null si jamais shadowé | **OUI** | ✅ null natif | NULL | ✅ |
| `version.scoresEvidence` | `'runs' | 'none'` | non | — | — | ✅ |

- **`unsafeActionCount`** ✅ : le seul champ suivant la « règle inverse » (le null run-backed écrase le blob zéro-init) — car « 0 action unsafe » est une affirmation de sécurité que personne n'a mesurée sur une version jamais benchmarkée. Modèle à suivre.
- **Page principale** : `/admin/agents/[id]/evolution` ou Release. **Secondaires** : release gate (mais la gate a sa propre lecture pinnée au candidat — deux questions, deux reads).

---

## 7. Lifecycle & benchmark — `agent-lifecycle.ts` → `AgentLifecycle`

`getAgentLifecycle(id)`. Chaque capacité porte sa raison ; un read échoué → `unavailable`, jamais `0`.

### 7.1 `suiteCount` ⚠️ NULLABLE MASQUÉ

- **Définition** : nb de `test_suites` du copilot. **Source** : `readSuiteCount` → `null` si le read échoue, sinon compte.
- **Type exposé** : `number` (`suiteCount ?? 0` en sortie). **⚠️** : la sortie coalesce `null → 0`, MAIS l'information « unread » survit dans `capabilities['run-tests']`/`generate-suite` (qui portent `suiteError`). **Ne pas lire `suiteCount === 0` comme « aucune suite »** sans vérifier la capability associée. **0 vs absence** : `0` peut être « aucune suite » OU « read échoué » — désambiguïsé par la capability. **États** : MEASURED | UNAVAILABLE (via capability).
- **Page** : `/admin/agents/[id]` (Evolution/Release).

### 7.2 `latestBenchmark` (benchmark score, tout version confondue) ✅ FIABLE (double nullable)

- **Identifiant** : `AgentLifecycle.latestBenchmark`
- **Définition** : dernier benchmark COMPLÉTÉ du copilot, toutes versions → `{ score: number | null, recordedAt: string | null } | null`.
- **Source** : `readLatestBenchmark`. **Deux niveaux de null** : l'objet entier `null` = aucun benchmark complété (ou read échoué) ; `score: null` **dans** un objet non-null = le run existe mais n'a enregistré aucun score. **Les deux claims sont différents et ne collapsent pas.** ✅
- **Type** : `{ score: number|null, recordedAt: string|null } | null`. **Nullable** : oui (2 niveaux). **0 vs absence** : ✅ un run sans result row ou score null → `null`, jamais `0` (qui lirait comme un plancher mesuré).
- **États** : MEASURED | NULL (jamais benchmarké) | UNAVAILABLE (read échoué, via `benchmarkError` porté par les capabilities). **Note** : question DIFFÉRENTE de `release-gate` (pinné au candidat) — celle-ci = « cet agent a-t-il jamais été benchmarké ». **Page** : `/admin/agents/[id]`.

### 7.3 `capabilities[LifecycleActionId]` (8 contrôles) ✅ FIABLE

- **Définition** : pour chaque action (`generate-suite`, `run-tests`, `run-benchmark`, `auto-improve`, `create-v2`, `decide`, `promote`, `rollback`) : `available` | `degraded` (tourne mais ne prouve pas ce qu'il dit) | `unavailable` (raison + détail vérifiable).
- **Source** : `agent-lifecycle.ts`, chaque capability dérivée d'un moteur réel (test-runner 029, benchmark-runner 030, release-gate). **Jamais un booléen nu** — l'indisponibilité porte toujours sa raison, que la vue DOIT afficher à côté du bouton désactivé.
- **⚠️ `run-tests`/`run-benchmark`** dépendent du RUNTIME propre du copilot : `langgraph`→graph, `openai-assistants`→direct ; tout autre → `unavailable` (le runner throw `UnsupportedRuntimeError` avant tout run). Un copilot `langgraph` mais sur validation bench (`projectId` null) sur le chemin direct est refusé. Le null (« unread ») n'est jamais un `available` optimiste.
- **États** : les 3 états de `Capability`. **Page** : Evolution/Release de l'agent.

### 7.4 `gate` (ReleaseGate — promotabilité) ✅ FIABLE

- **Définition** : verdict de promotion, **jamais recalculé ici** — `evaluateReleaseGate` est la source unique, restatée par `promoteCapability`. `null` si pas de version candidate ; `unavailable` si le read échoue.
- **Type** : `ReleaseGate | null`. **États** : MEASURED | NULL | UNAVAILABLE (via `gateError`). **Page** : Release. **Ne pas recréer une 2e gate.**

---

## 8. Santé télémétrie runtime — `telemetry-health.ts` → `TelemetryHealthDiagnostic`

Diagnostic PUR (aucun I/O), le caller fournit les faits. **Doctrine centrale** : « zéro event reçu » n'est
JAMAIS une preuve que les agents ne tournent pas — seulement que la boucle est silencieuse.

### 8.1 `status` (télémétrie) ✅ FIABLE — modèle doctrinal

- **Définition** : `not_configured` (token d'ingestion Aigent absent, level 3) | `incomplete_configuration` (ingestion OK, zéro agent déclare télémétrie, level 1) | `loop_muted` (agents déclarent mais aucun event / event trop vieux) | `healthy` | `unavailable` (lookup échoué).
- **Source** : `diagnoseTelemetryHealth(input)`. `input.agentsWithTelemetryDeclared` vient de `countManifestsWithTelemetryDeclared` (data.ts) → `null` si PostgREST ne rend pas un count exact.
- **Type** : enum. **États** : mappe 1:1 sur MEASURED/UNKNOWN/UNAVAILABLE/STALE.
- **config ≠ capacité** : ✅ exemplaire — la boucle est opt-in à 3 niveaux indépendants ; le diagnostic ne dit JAMAIS « agents inactifs », seulement « boucle silencieuse » / « données indisponibles ».
- **Page principale** : `/admin/telemetry` (ou observability flotte).

### 8.2 `daysSinceLastEvent` ✅ FIABLE (nullable honnête)

- **Définition** : jours depuis le dernier event reçu ; `null` si jamais reçu OU inconnu (désambiguïsé par `status`/`lastEventLookupFailed`).
- **Type** : `number | null`. **0 vs absence** : ✅ `null` = jamais/inconnu, jamais `0`. **STALE** si `> muteThresholdDays` (défaut 7). **Page** : télémétrie.

### 8.3 `agentsWithTelemetryDeclared` ✅ FIABLE (nullable honnête)

- **Définition** : nb de manifests déclarant un wrapper télémétrie (`manifests.telemetry` non-null, migration 0018).
- **Source** : `countManifestsWithTelemetryDeclared` → `pgrestWithCount('...telemetry=not.is.null...')`.
- **Type** : `number | null`. **Nullable** : **OUI** — `null` quand PostgREST ne rend pas un count exact → le diagnostic dit « unavailable » plutôt que « 0 agent déclaré ». ✅
- **0 vs absence** : ✅ correct — `0` = interrogé, personne ne déclare ; `null` = pas pu compter. **États** : MEASURED | UNAVAILABLE. **Page** : télémétrie.

---

## 9. Métriques run individuel — `types.ts` → `AgentRun` (page trace/run)

Champs bruts d'un run, lus par `getRunsForCopilot`/`getRecentRuns`. Consommés par les traces.

| Champ | Type | Nullable | 0 vs absence | État | Note |
|---|---|---|---|---|---|
| `toolCallCount` | `number` | non (contrat) | ⚠️ `0` réel possible mais voir §3.7 piège assistant | MEASURED | un `0` sur agent supposé actif = symptôme assistant manquant |
| `latencyMs` | `DurationMs` | non | vrai 0 improbable | MEASURED | |
| `costUsd` | `UsdAmount \| null` | **OUI** | ✅ `null` = non mesurable (LangGraph sans usage), jamais 0 | MEASURED/UNKNOWN | commenté explicitement dans types.ts |
| `unsafeAttemptCount` | `number` | non | vrai 0 = aucune tentative unsafe observée sur CE run | MEASURED | |
| `status` | `AgentRunStatus` | non | enum | MEASURED | `completed/failed` = décidé ; `running/needs-confirmation/blocked` = non |
| `resolvedModel` / `resolvedProvider` | `string \| null` | **OUI** | `null` = non prouvé (`modelUnverified`), jamais deviné | MEASURED/UNKNOWN | normalisé par `normalizeResolvedModel` |
| `modelUnverified` | `boolean` | non | fail-closed : `true` sauf `=== false` explicite | MEASURED | absence de preuve = unverified |

- **`costUsd`** ✅ : le contrat au niveau run est honnête (`null` explicite). C'est l'AGRÉGATION (rollup projet §2.3) qui perd la trace du null en le sommant comme `0`. La perte est récupérée au niveau agent par `runsWithoutCost` (§3.6), pas au niveau projet.

---

## 10. Synthèse — FIABLE vs TROMPEUR

### ✅ FIABLES (source réelle, nullabilité honnête)
- KPIs cockpit : `productionAgents`, `readyForManualTest`, `sandboxPassRate`, `avgRepoFit` (périmètre à expliciter).
- Rollup projet : `copilotCount`, `runsLast24h`, `costLast24hUsd`, `passRate` (exemplaire).
- Agent-détail : `runs24h`, `successRate`, `avgDurationMs`, `cost24hUsd`, `runsWithoutCost`, `toolCallCount` (agrégat), `lastRun`.
- Exécutabilité : `executable`, `status` runtime, `unresolvedToolIds`, `unavailableFields`, `executedModel`.
- Version scores : `unsafeActionCount` (exemplaire, règle inverse), `shadowAgreement`.
- Lifecycle : `latestBenchmark` (double nullable), `capabilities`, `gate`.
- Télémétrie : `status`, `daysSinceLastEvent`, `agentsWithTelemetryDeclared` (modèle doctrinal).
- Run : `costUsd`, `resolvedModel`, `modelUnverified`.

### ❌ TROMPEUSES / FANTÔMES (à traiter en Phase 3)
1. **`openWarnings` (partout : rollup projet, RegistryKpis, fleet band, watchlist)** — **FANTÔME** : typé `number` non-nullable, aucun writer run-backed, `normalizeHealth` retourne `0` en placeholder et pousse `'openWarnings'` dans `healthUnavailableFields` (que le rollup projet n'expose pas). Un « 0 alerts » ou une watchlist vide se lit comme « rien à surveiller » alors que c'est « jamais mesuré ». `fleet-kpi-band.tsx` qualifie partiellement (à généraliser) ; le rollup projet et la watchlist ne qualifient PAS.
2. **`lastRunCostUsd` colonne « Cost » sur `/admin/agents`** — **ÉTIQUETTE AMBIGUË** : c'est le coût du **dernier run** (un seul run), pas un 24h ni un cumul. En-tête « Cost » nu, suggère un agrégat. À renommer « Last run cost » ou expliciter la fenêtre.
3. **`totalRuns` (agent-détail)** — **BORNÉ trompeur** : `runs.length` plafonné à 50, présenté comme « total ». Un agent >50 runs sous-affiche.
4. **`avgTestPassRate` (RegistryKpis)** — retourne `0` quand personne n'est mesuré au lieu de `null`/dash (les données individuelles, elles, sont correctes via `healthEvidence`).
5. **`blockedDeliveries` (cockpit)** — **COUVERTURE PARTIELLE** : `scorecards` passé vide → branches release-gate jamais évaluées ; un `0` ne prouve pas « rien de bloqué », seulement « rien via sandbox/mission/delivery ».
6. **`activeCount` (rollup projet) vs `productionAgents` (cockpit)** — **DEUX définitions d'« actif »** : `status==='active'` stocké vs `displayStatus`. Un agent promu compte dans l'un, pas l'autre.

### ⚠️ PIÈGES DOCTRINAUX (métrique techniquement correcte, interprétation risquée)
- **`toolCallCount = 0`** sur un agent supposé actif : symptôme d'un **assistant LangGraph manquant** (l'agent tourne contre le graphe nu, 5 outils legacy, répond « pas de données », `tool_call_count=0` en paraissant sain). Cause = absence d'assistant, PAS le runtime. Ne jamais conclure activité/inactivité de cette seule métrique.
- **Lecture DB échouée sur le cockpit** : `getDashboardOverview` laisse désormais `fetchLatestDeliveryEvents` / `fetchLatestSandboxSnapshots` / `getRecentRunsInWindow` **rejeter** ; l'échec devient `null` + warning (`DELIVERY_READ_FAILED_WARNING`, `SANDBOX_READ_FAILED_WARNING`, `RUNS_READ_FAILED_WARNING`) — plus de `Map`/`[]` vide qui masque UNAVAILABLE. Les KPIs `readyForManualTest`, `sandboxPassRate`, `runs24h`/`windowRuns` respectent ce contrat.
- **`suiteCount` sortie `?? 0`** : ne jamais lire `=== 0` comme « aucune suite » sans consulter `capabilities['run-tests']` (qui porte l'erreur de read).
