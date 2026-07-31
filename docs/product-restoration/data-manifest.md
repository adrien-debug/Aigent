# Data manifest — inventaire de la couche données

> Audit en lecture seule, 2026-07-31, branche `mission/cockpit-catalyst-migration`.
> Périmètre : `src/lib/**`, `src/langgraph/**`, `supabase/migrations/**`, `scripts/**`.
> **Hors périmètre** : `src/app/api/**` (audité par un autre agent).
>
> Ce document est une **observation datée**, pas une règle (`CLAUDE.md` §1).
> Les comptes de lignes viennent d'une interrogation **réelle** de GPU1 le
> 2026-07-31 ; ils changent à chaque run et ne doivent pas être recopiés ailleurs.

## 1. Transport PostgREST — sain, source unique

`src/lib/agent-mission-control/postgrest.ts` (193 lignes) est le seul transport.
Aucune violation trouvée. Points vérifiés dans le code :

| Élément | État |
|---|---|
| `requireBackend()` | throw si `AMC_DATA_SOURCE !== 'gpu1'` ou creds absentes. Aucun mock embarqué. |
| Timeout | `PGREST_TIMEOUT_MS = 30_000`, `AbortSignal.timeout`, rethrow `PgrestError(504)`. |
| `isPgrestTimeout()` | source unique de la classification 504 vs 502. |
| `PgrestError.message` | générique par construction (`PostgREST <status> on <method> <path>`) ; corps amont isolé sur `.detail`. |
| `pgrestWithCount()` | lit `Content-Range`, rend `null` si total absent ou `*`. **Ne retombe jamais sur `rows.length`.** |
| `camelRow` / `camelRows` | snake→camel top-level. |
| `import 'server-only'` | présent en tête. |

`readRows()` renvoie `[]` sur HTTP 204 / corps vide — c'est une **réponse réussie
vide**, pas un échec masqué. Correct.

## 2. Schéma réel

30 tables déclarées dans les migrations (`create table`), 41 fichiers de
migration, **numérotation à trous** (0036, 0038, 0039 absents ; le dernier est
`0044`). Recalcul :

```
grep -h "create table" supabase/migrations/*.sql | sed 's/.*exists //;s/ *(.*//' | sort -u
```

`agent_drafts` n'a **pas** de `create table` dans le répertoire (créée à chaud sur
le serveur ; `0042` ne fait que re-granter) — le répertoire n'est donc pas un
instantané complet du schéma.

### RLS — la fuite mesurée est CLOSE

13 tables portent `enable row level security` (dont `agent_drafts`,
`improvement_proposals`, `project_builder_conversations`,
`project_builder_messages` — celles de la fuite `0010`/`0012`, refermées par
`0044`).

**Vérification live faite ce jour** : requête anon (sans clé) sur 20 tables via
`https://aigent-db.hearst.app` → **401 sur les 20**, y compris celles sans
`enable row level security` explicite (`copilots`, `projects`, `agent_runs`,
`manifests`, `tools`, `copilot_versions`, `tool_calls`, `test_*`, `benchmark_*`,
`promotion_gates`, `shadow_experiments`, `replay_comparisons`,
`registry_warnings`). Aucun `grant ... to anon` dans les migrations.

La fuite documentée dans l'historique (269 messages builder lisibles publiquement)
**ne se reproduit plus**. Le 401 uniforme indique que `anon` n'a plus aucun grant
utile ; ce n'est pas une preuve que chaque table porte RLS, donc la règle des
**deux gestes** (`enable row level security` **et** `grant ... to service_role`)
reste obligatoire pour toute nouvelle table.

### Invariants de schéma confirmés

- `model_provider` ∈ `('openai','google','local')` — `anthropic` retiré par `0005`,
  `mistral` par `0021`.
- `agent_runs.cost_usd` nullable **sans default** depuis `0025` : « non mesuré =
  `null` » inscrit dans le schéma.
- `agent_runs.project_id` `not null` **sans FK** — intégrité tenue par le code.
- CHECK `copilots.runtime` plus large que l'invariant produit ; c'est
  l'application (`z.literal('langgraph')`) qui impose `langgraph`, pas la base.
- Promotion atomique par RPC `promote_copilot_version`, écritures directes
  verrouillées par trigger (`0029`→`0033`).

## 3. Données réellement en base (live, 2026-07-31)

Interrogation réelle via `Prefer: count=exact`, `Range: 0-0`. **Ce sont des
comptes constatés, pas des estimations.**

| Table | Lignes |
|---|---|
| `copilots` | 14 |
| `projects` | 10 |
| `manifests` | 14 |
| `copilot_versions` | 14 |
| `agent_runs` | 24 |
| `runtime_telemetry_events` | 38 |
| `project_builder_conversations` | 25 |
| `tool_definitions` | 22 |
| `test_runs` | 6 |
| `benchmark_results` | 5 |
| `agent_delivery_events` | 1 |
| `agent_drafts` | **0** |
| `improvement_proposals` | **0** |
| `qualification_runs` | **0** |

Détail des 14 copilots : `runtime` = `langgraph` pour les 14 ; `assistant_id`
renseigné **14/14** (le piège « assistant manquant » n'est pas armé aujourd'hui) ;
`model_provider` = `openai` pour les 14. Statuts : 8 `draft`, 3 `active`,
1 `degraded`, 1 `paused`, 1 `archived`.

24 `agent_runs` : 21 `completed`, 3 `failed`, **1 seul** avec `cost_usd` null.
Dernier run : `2026-07-30T18:46`.

38 événements de télémétrie, `environment.source` : `aigent-internal-runner` 17,
`aigent-shadow` 8, `aigent-promotion` 6, **absent 7**. Statuts : 24 `completed`,
9 `failed`, 5 `started`. `provider` : `openai` 24, **null 14**.

**Aucun événement de provenance `consumer`.** La boucle de retour depuis un
produit consommateur n'a jamais reçu une seule ligne : tout ce qui est en base est
d'origine interne Aigent.

## 4. Agrégations sans source aujourd'hui

- **Tout ce qui dérive de `consumer`** — `runtimeTelemetryProvenance === 'consumer'`
  n'a 0 ligne. Toute UI qui présenterait « santé des agents livrés » n'a **aucune
  source réelle**.
- **`improvement_proposals` vide** → `latestProposal`, les comparaisons V1/V2 et
  toute la boucle d'amélioration n'ont rien à afficher.
- **`qualification_runs` vide** → l'orchestration de qualification n'a aucun
  historique.
- **`agent_drafts` vide** → le Draft/Agent Builder n'a aucun brouillon persisté.
- **`agent_delivery_events` = 1 ligne** → `buildRecentDeliveries`,
  `computeReadyForManualTest`, `computeBlockedDeliveries` reposent sur un
  échantillon de 1.
- **Catégories d'erreur télémétrie** : l'émetteur de référence n'envoie pas
  `error.category`, donc `errorCategoriesState` sortira `UNAVAILABLE` malgré
  9 runs `failed`. C'est **correct et voulu**, mais toute UI doit le rendre comme
  un trou de signal, jamais comme « aucune erreur ».

## 5. Vérité des données — violations trouvées

La discipline est **globalement excellente** sur les surfaces de lecture
principales. Les violations sont concentrées dans les couches de décision
interne (gate, boucle d'amélioration), pas dans les agrégats de dashboard.

### Exemplaire — à ne pas régresser

- `dashboard-overview.ts:398` `computeCost24h` — trois absences distinctes rendues
  `null`, jamais 0 ; renvoie `{usd, measuredRuns, totalRuns}` pour que le
  dénominateur soit rendu. Le commentaire 367-397 documente la régression évitée.
- `dashboard-overview.ts:355` `computeSuccess24h` — `null` si lecture échouée,
  `null` si dénominateur terminal = 0.
- `dashboard-overview.ts:962` `getDashboardOverview` — chaque lecture faillible a
  son `.catch(() => ({..., warning}))` qui pousse un `dataWarnings` **nommé**
  (`RUNS_READ_FAILED_WARNING`, etc.), et rend `null`, jamais `[]` ni `0`. C'est le
  bon patron.
- `agent-detail.ts:165` `computeMetrics` — `successRate`/`avgDurationMs`/
  `cost24hUsd`/`toolCallCount` tous `null` quand le dénominateur est vide ; les
  `?? 0` internes sont gardés par un `length > 0` en amont, donc inoffensifs.
  `toolCallCountState` distingue MEASURED 0 de UNKNOWN.
- `runtime-telemetry-store.ts:388-402` — le coût n'est sommé que si provider
  mappable **et** modèle **et** split input/output présents. Jamais de 0 deviné.
- `runtime-telemetry-store.ts:409-415` — les failures sans catégorie ne sont pas
  bucketées en `uncategorized` (refus de fabriquer une catégorie).
- `runtime-telemetry-provenance.ts:30-46` — n'infère jamais `consumer` de
  l'absence de marqueur interne ; `unknown` tant que non prouvé.
- `telemetry-health.ts` — doctrine explicite : « zéro événement » n'est jamais une
  preuve d'inactivité des agents, seulement un silence de la boucle.
- `available-agents.ts:21` — chaque champ non résolu est `null` **et** nommé dans
  `unavailableFields`.
- `dashboard-overview.ts:426` `runsOrderKey` — clé de tri uniquement, `-1` pour
  « non mesuré » afin qu'il ne surclasse pas un zéro prouvé, avec le commentaire
  qui interdit de la lire comme une mesure.

### Violations — provider/modèle fabriqué

**`copilot-behavior.ts:176`** — `const DEFAULT_MODEL_PROVIDER: ModelProvider = 'openai'`
**`copilot-behavior.ts:183-186`** :

```ts
function normalizeModelProvider(raw: ModelProvider | string | null | undefined): ModelProvider {
  if (raw === 'openai' || raw === 'google' || raw === 'local') return raw
  return DEFAULT_MODEL_PROVIDER
}
```

Un `model_provider` **null** ou inconnu devient silencieusement `'openai'`.
C'est exactement le fallback muet que `0021` visait : un ancien `mistral`
persisté serait rebasculé sur `openai` sans erreur → run faussement crédible.
Appelé en `copilot-behavior.ts:615`. `DEFAULT_MODEL = 'gpt-5.4'` (ligne 175)
pose le même problème côté modèle.
Aujourd'hui inoffensif en pratique (les 14 copilots portent `openai`), mais
c'est une bombe à retardement, pas une sécurité. Contredit l'invariant
`available-agents.ts` (« non résolu → `null` + `unavailableFields`, jamais
`'openai'` »). La gate `check:agent-truth` ne couvre pas ce fichier.

**`benchmark-runner.ts:751-753`** — même patron, trois fois :
`modelProvider ?? 'openai'`, `runtime ?? 'custom'`, `model ?? ''`. Un copilot dont
la colonne est vide se voit attribuer un provider inventé au moment de lancer un
benchmark facturé.

### Violations — `?? 0` sur une métrique mesurée

- **`release-gate.ts:100`** — `passRate: (run.pass_rate as number) ?? 0`. Un
  `pass_rate` null (colonne non renseignée) devient un taux de réussite **mesuré
  de 0 %** dans l'évidence de release. Ici l'effet est « fail-safe » (bloque au
  lieu de laisser passer), mais la valeur rendue est un **mensonge chiffré** :
  la gate dira « 0 % de réussite » là où la vérité est « non mesuré ».
- **`release-gate.ts:121-125`** — `score`, `accuracy`, `taskSuccessRate`,
  `unsafeActionCount`, `confirmationMistakeCount` tous `?? 0`. Deux de ces champs
  sont des **compteurs de sécurité** : un `unsafe_action_count` null devient
  « 0 action unsafe », c'est-à-dire un feu vert fabriqué. C'est la violation la
  plus dangereuse du périmètre.
- **`improvement-loop.ts:337, 383-387, 403-405, 981, 991, 1039`** — la même
  famille : `passRate`, `score`, `accuracy`, `taskSuccessRate`,
  `unsafeActionCount`, `confirmationMistakeCount`, `toolCallCount`,
  `unsafeAttemptCount`, `latencyMs`, `costUsd` tous coercés en 0.
- **`improvement-loop.ts:1330, 1340`** — `cumulativeCostUsd += testRun.totalCostUsd ?? 0`
  et `Number(rows[0]?.total_cost_usd ?? 0)`. Le budget `maxCostUsd` est compté sur
  une somme qui traite « coût non mesuré » comme « gratuit » : la boucle peut
  dépenser au-delà du plafond en croyant être sous budget. Contexte aggravant —
  LangGraph rend couramment un coût null, et c'est le seul runtime produit.

### Violations — moyenne / agrégat sur dénominateur incluant des absences

- **`improvement-loop.ts:1157`** `aggregateV2PassRate` — `cmp.tests.map((t) => t.v2?.passRate ?? 0)`
  puis `Math.min(...)`. Une suite **sans run V2** (absence) pèse comme un
  échec total 0. Le commentaire l'assume (« No V2 test run at all → 0 »), mais
  cela signifie qu'une suite non exécutée est indiscernable d'une suite ratée.
- **`improvement-loop.ts:1163`** `aggregateV1PassRate` — idem côté base.
- **`improvement-loop.ts:1170`** `allSuitesConverged` — `(t.v2?.passRate ?? 0) === 1`.
  Direction sûre ici (une absence empêche la convergence), mais même confusion.
- **`agent-lifecycle.ts:540`** — `suiteCount: suiteCount ?? 0`. Le commentaire
  affirme que le 0 est mesuré et qu'un échec de lecture est porté ailleurs ; à
  vérifier si un jour la source devient faillible.
- **`shadow-live.ts:171`** — `costUsd: r.costUsd ?? 0` dans le résultat de run
  shadow.
- **`model-router.ts:226-227`** — `inputTokens: usage?.prompt_tokens ?? 0`. Une
  réponse OpenAI sans bloc `usage` produit 0 token, donc un coût calculé de 0 $.
  C'est la racine amont d'une partie des coûts nuls stockés.

### Découverts en qualification navigateur (2026-07-31), corrigés depuis

- **`overview-screen.tsx:61`** — `[...projectCards].sort((a,b) => (b.runs24h ?? 0) - (a.runs24h ?? 0))`.
  L'amont fait délibérément passer un compte **non mesuré** SOUS un zéro mesuré
  (`runsOrderKey` rend `-1`, et son commentaire l'énonce). Ce re-tri à l'écran
  annulait cette intention : « personne n'a mesuré » remontait au rang de
  « prouvé calme ». **Corrigé** — l'ordre vient désormais de l'amont, sans retouche.
- **`rows.tsx:111-126`** — un projet **sans aucun copilot** affichait
  `$0.00 · 0 runs`. `sumMeasuredHealth` rend `{ value: 0 }` sur une équipe vide
  (sa garde est `team.length > 0 && measured === 0`), ce qui est défendable au
  contrat mais se lit à l'écran « mesuré, calme » alors que le fait est
  « personne ». **Corrigé** — troisième état « rien à mesurer ».

### `catch → []` / lecture échouée transformée en vide

- **`consumer-bootstrap.ts:208`** — `catch { return [] }` sur la lecture du
  registre local. Fichier absent (cas normal) et fichier illisible/corrompu
  (anomalie) rendent le même `[]`.
- **`github.ts:1382`** — `catch { return [] }` sur un `registry.json` corrompu,
  commenté « start clean rather than propagate garbage ». Choix délibéré, mais il
  fait qu'un registre distant illisible se présente comme un registre vide — et la
  suite du code y **réécrit** un registre neuf, donc perte silencieuse d'entrées.
  À traiter comme une décision à confirmer, pas comme un bug évident.

**Portée exacte de ces deux-là, vérifiée le 2026-07-31** (la première rédaction
laissait croire qu'ils polluaient l'affichage des dépôts) : aucun des deux n'est
sur le chemin de LECTURE d'un repository par une surface. `github.ts:1382` est
dans `readHostRegistry`, privé, sur un chemin d'**écriture** ; `consumer-bootstrap`
lit un registre local d'agents, pas un dépôt. La lecture d'arbre que consomme
`/projects` est `getRepoTree`, qui **lève** au lieu de rendre `[]` — un dépôt
illisible y est donc distinguable d'un dépôt vide. L'observation reste vraie,
son périmètre était trop large.

**Défaut voisin, celui-là bien sur le chemin de lecture** : `github.ts:453-461`
déstructure `truncated` de la réponse GitHub sans jamais le lire — un arbre
tronqué par l'API est indiscernable d'un arbre complet.

Les autres `catch { return null }` recensés (`agent-detail.ts:312,333`,
`test-runner.ts:282`, `sandbox-reports-store.ts:64`, `auth.ts:134,142`,
`agent-builder-run.ts:276`, `langgraph-explorer.ts:210`, …) rendent `null`
— « inconnu », pas « zéro » — et sont conformes.

## 6. Clients externes

| Client | Fichier | Comportement d'échec |
|---|---|---|
| PostgREST | `postgrest.ts` | throw ; 504 timeout / 502 autre |
| LangGraph | `langgraph-client.ts`, `langgraph-server.ts`, `src/langgraph/agent-server-endpoint.mjs` | endpoint distant refusé hors prod, local refusé en prod |
| Model router | `model-router.ts` | `openai` / `google` / `local` seulement ; `default:` → `ProviderUnavailableError('unknown provider')`. **`mistral` non câblé, erreur typée, pas de fallback** — conforme |
| GitHub | `github.ts` (1818 l.) | double verrou `confirm:true` + `GITHUB_PUSH_ENABLED=1` |
| Langfuse | `langfuse.ts` | piège connu : le shell exporte des vars Cloud qui écrasent `.env.local` |

`model-router.ts` respecte l'invariant multi-provider : pas de régression
OpenAI-only, `ProviderUnavailableError` distinct de `ModelAccessError` et de
`ModelRouterError`.

## 7. Registre

`registry/runtimes.ts` — `langgraph` seul `creatable: true` et seul moteur réel ;
`openai-assistants`, `gemini`, `custom` déclarés `creatable: false` avec
`engine: 'none'` et une note explicite. `isRuntimeExecutable` /
`isRuntimeCreatable` / `runtimeAvailability` exposent les raisons
(`not-creatable`, …). Conforme à l'invariant « LangGraph seul runtime produit ».
`registry/tools.ts` + `manifest-validation.ts` complètent ; gates
`check:registry-parity` et `check:registry-integrity` en chaîne.

## 8. Prêt-sans-UI

Données et agrégations complètes, calculées, testées, sans aucun rendu :

- `summarizeRuntimeTelemetry` / `summarizeFleetRuntimeTelemetry` (rollup par
  agent, p95, taux de succès, provenance des mesures) — **38 lignes réelles**.
- `diagnoseTelemetryHealth` — diagnostic à 5 statuts, jamais « agents inactifs ».
- `listRecentRuntimeTelemetryEvents` — 50 derniers, prêt à lister.
- `getDashboardOverview` — KPI + `dataWarnings` nommés, prêt à afficher.
- `getAgentDetail` / `computeMetrics` — métriques par agent avec états MEASURED /
  UNKNOWN déjà distingués.
- `getAvailableAgents` — contrat canonique avec `unavailableFields`.
- `agent-lifecycle-trace.ts` — trace de cycle de vie, `active_in_consumer` figé à
  `'unknown'`.

## 9. Ce que cet audit ne prouve pas

- Aucune route de `src/app/api/**` n'a été lue (hors périmètre).
- Aucun test n'a été exécuté, aucune gate lancée : c'est une lecture de code plus
  une interrogation en lecture seule de la base.
- Le 401 anon uniforme prouve que l'exposition publique est fermée **aujourd'hui**,
  pas que chaque table porte `enable row level security` — cela n'a pas été
  vérifié via `pg_class` (PostgREST n'expose pas le catalogue).
- Les comptes de lignes sont datés du 2026-07-31 et périment immédiatement.
