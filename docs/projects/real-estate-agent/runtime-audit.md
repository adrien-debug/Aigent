ARCHIVED — relevé daté, pas l'état courant ni de la doctrine

> **Ce document est un audit daté**, pas une source de vérité actuelle. Ses
> constats de cartographie restent instructifs, mais ses recommandations finales
> visent un état du repo qui a changé depuis. Les règles vivent dans `CLAUDE.md`
> et `AGENTS.md` ; l'état courant dans `README.md` et `docs/current-capabilities.md`.

# Runtime audit — LangGraph vs model-router direct

Passe read-only. Cartographie exacte des chemins d'exécution runtime dans
`src/lib/agent-mission-control/` (pas de suppression, pas de fix — audit +
recommandations seulement).

## 1. Le champ `runtime` et sa portée réelle

`AgentRuntime` (`src/lib/agent-mission-control/types.ts:44`) a 4 valeurs :
`'langgraph' | 'openai-assistants' | 'gemini' | 'custom'`. Miroir DB :
`supabase/migrations/0001_agent_mission_control.sql:20` (`copilots.runtime`,
`CHECK`), reconfirmé par `0005_drop_anthropic_provider.sql:7-9`.

**Constat central : `runtime` ne branche PAS partout où on l'attendrait.**
Deux familles de comportement coexistent sous le même nom de champ :

| Module | Branche réellement sur `runtime` ? | Comportement |
|---|---|---|
| `runner.ts` (exécution live d'un run) | **Oui** | `executeCopilotRun` lit `runtime` (explicite ou chargé via `loadRuntime`) ; `'langgraph'` → `executeViaLangGraph` (délègue au LangGraph Agent Server via `runOnAgentServer`) ; toute autre valeur → boucle directe `routeCompletion` (model-router) avec tool-loop maison. |
| `benchmark-runner.ts` (bench d'un copilot) | **Oui** | `usesRealGraph = runtime === 'langgraph'` (ligne 587) ; si vrai, chaque tâche passe par `runOnAgentServer` (`runTaskOnGraph`) ; sinon fallback `routeCompletion` direct (`runTaskViaCompletion`), avec `ranOnGraph: false` honnêtement flaggé (dégrade le score de sécurité, cf. `compositeScore`). |
| `test-runner.ts` (suite de tests d'un copilot) | **Non — jamais branché** | `runCase` appelle **inconditionnellement** `streamOnAgentServer` (le graph LangGraph), quel que soit `copilot.runtime`. Un copilot `runtime: 'custom'` ou `'gemini'` est quand même testé à travers le graph LangGraph, pas à travers son runtime déclaré. Le fichier ne lit même pas la colonne `runtime` (`grep` confirmé : aucune occurrence de `copilot.runtime` ni de branchement conditionnel). |
| `improvement-loop.ts` (analyse + V2 + re-run) | **Indirect, via test-runner/benchmark-runner** | N'a pas de branchement `runtime` propre : `collectImprovementSignals` lit du LangGraph (threads, LangSmith) comme source d'observabilité générique ; `runAutoImprovementCycle` ré-invoque `runTestSuite`/`runBenchmarkSuite` tels quels — donc hérite de leur inconsistance (tests toujours via graph, benchmarks conditionnels). |
| `agent-suite-generator.ts` (génération auto de suites) | **Non concerné** | Pas d'exécution d'agent — un `routeCompletion` (purpose `'architect'`) génère les cases de test/bench. N'exécute jamais le copilot lui-même. |
| `github.ts` (push du code runtime scaffoldé) | **Non concerné** | Pipeline de livraison de code source (scaffold `handler.ts` par runtime, commit GitHub). N'exécute rien côté Aigent ; c'est de la génération de fichiers statiques à pousser dans le repo cible. Le `switch (copilot.runtime)` y sert uniquement à choisir le TEMPLATE de code généré (`langgraphHandler`/`openaiAssistantsHandler`/`geminiHandler`/`customHandler`), pas un chemin d'exécution Aigent. |
| `runner-errors.ts` | **N/A** | Types d'erreurs partagés (`NotFoundError`, `ModelRouterError`, `ProviderUnavailableError`, `ModelAccessError`). Consommé par les deux familles de chemins, aucune logique de routing runtime. |

## 2. Détail des deux chemins d'exécution réels

### 2a. Chemin LangGraph (`runtime === 'langgraph'`)

- Entrée : `runner.ts::executeViaLangGraph` (run live) et
  `benchmark-runner.ts::runTaskOnGraph` (bench).
- Résolution de l'assistant : cascade unique dans
  `resolve-run-assistant.ts` (`resolveRunAssistantId` / `resolveRunAssistantFromRow`) —
  `copilots.assistant_id` → `projects.assistant_id` → `undefined` (graph
  partagé `agent_builder`). Vérifie la liveness sur le LangGraph Agent Server
  et re-provisionne si l'assistant en mémoire a disparu (redémarrage serveur).
- Exécution réelle : `langgraph-server.ts::runOnAgentServer` /
  `streamOnAgentServer` — délègue au serveur LangGraph officiel
  (`langgraphjs dev`), qui possède le graphe, le checkpointing, le
  streaming et les interrupts HITL. Le modèle réellement utilisé n'est
  vérifiable qu'a posteriori (`resolvedModel`/`modelUnverified` dans
  `ExecuteCopilotRunResult`) car le graph instancie son propre `ChatOpenAI`
  depuis sa config, avec un fallback silencieux (`DEFAULT_MODEL` dans
  `agent-builder-graph.mjs`).
- Persistance : `agent_runs` / `agent_run_steps` / `tool_calls`, avec
  `thread_id` non-null (permet un resume sur interrupt).

### 2b. Chemin model-router direct (tout `runtime` ≠ `'langgraph'`)

- Entrée : `runner.ts::executeCopilotRun` (branche `else`) et
  `benchmark-runner.ts::runTaskViaCompletion`.
- Exécution : boucle agentique maison dans `runner.ts` — appelle
  `model-router.ts::routeCompletion` en boucle (`maxTurns`), avec un
  guardrail local (`guardrailCheck`) qui exécute les tool calls via
  `TOOL_HANDLERS` (tool-handlers.ts) et gère confirmation/blocage.
  Aucun serveur LangGraph impliqué ; aucun thread, aucun interrupt HITL
  serveur — la boucle est enterrement dans le process Next.js.
- `resolvedModel`/`resolvedProvider`/`fallbackUsed` sont **toujours
  vérifiés** ici (`modelUnverified: false` en dur) car `routeCompletion`
  répond directement avec le provider réel.
- Persistance : mêmes tables (`agent_runs`/`agent_run_steps`/`tool_calls`),
  mais `thread_id: null`, `interrupted: false` toujours.

## 3. Call-sites — qui déclenche quel chemin

| Call-site | Fichier | Détermine `runtime` comment | Chemin résultant |
|---|---|---|---|
| `POST /api/agent-ops/copilots` (création) | `src/app/api/agent-ops/copilots/route.ts:95` | Body brut : `runtime: z.enum(['langgraph','openai-assistants','gemini','custom'])`, **aucune valeur par défaut forcée côté serveur**, aucune contrainte au-delà du CHECK DB. | Persiste tel quel dans `copilots.runtime`. |
| `create-agent-form.tsx` (UI de création, supprimé depuis, P007) | était `src/components/agent-ops/create-agent-form.tsx:17,32` | `RUNTIME_OPTIONS` proposait les 4 valeurs dans un `<select>` ; `DEFAULT_RUNTIME = 'langgraph'` était le défaut du formulaire (commentaire ligne 30-31 : *"langgraph is the only runtime with a real execution engine"*), mais l'utilisateur pouvait changer la sélection librement. | UI = défaut sain, mais pas d'imposition (dashboard front supprimé, P007 ; l'audit runtime backend reste valide). |
| `agent-builder-copilot.ts` (spec du copilot interne "Agent Builder") | `src/lib/agent-mission-control/agent-builder-copilot.ts:48` | `runtime: 'langgraph'` codé en dur dans la spec `CreateCopilotInput`. | Toujours LangGraph — seul point de création 100% garanti. |
| `POST /copilots/[copilotId]/run` | `src/app/api/agent-ops/copilots/[copilotId]/run/route.ts` | Ne force rien : appelle `executeCopilotRun`, qui charge `runtime` depuis la ligne `copilots` (ou accepte un `runtime` explicite du body, cf. `ExecuteCopilotRunArgs.runtime`). | Suit `runner.ts` §2a/2b selon la valeur en DB. |
| `POST /copilots/[copilotId]/benchmarks/run` | `src/app/api/agent-ops/copilots/[copilotId]/benchmarks/run/route.ts:9,78,125` | `RUNTIMES` accepte les 4 valeurs, body optionnel `runtime` transmis tel quel à `runBenchmarkSuite`. | Suit `benchmark-runner.ts` §2a/2b selon la valeur effective. |
| `POST /copilots/[copilotId]/tests/run` (+ `/stream`) | `src/app/api/agent-ops/copilots/[copilotId]/tests/run/route.ts`, `.../tests/run/stream/route.ts` | N'a pas de paramètre `runtime` du tout. | **Toujours** le graph LangGraph (`test-runner.ts`), quelle que soit la valeur DB — voir §1. |
| `improve/auto`, `improve/analyze`, `improve/create-v2` | `src/app/api/agent-ops/copilots/[copilotId]/improve/*/route.ts` | Chaînent `analyzeAndPropose` → `createImprovementV2` → `runTestSuite`/`runBenchmarkSuite` (voir `improvement-loop.ts:1272-1279`). | Hérite du split test/benchmark ci-dessus ; ne lit ni n'écrit `runtime` lui-même. |
| `ensureAgentSuites` (auto-génération de suites) | `src/lib/agent-mission-control/agent-suite-generator.ts` | N'exécute pas le copilot — génère des cases via un `routeCompletion` séparé (purpose `'architect'`). | Hors périmètre runtime. |
| `resolveRunAssistantId` / `resolveRunAssistantFromRow` | `src/lib/agent-mission-control/resolve-run-assistant.ts` | Appelé uniquement par les chemins qui vont réellement au LangGraph Agent Server (`runner.ts` §2a, `benchmark-runner.ts` §2a, `test-runner.ts` — inconditionnel). Jamais consulté par le chemin model-router direct. | N/A (résolution d'assistant, pas de décision de chemin). |

## 4. Incohérence constatée (à noter, pas à corriger dans cette passe)

Un copilot créé avec `runtime: 'custom'` (ou `'gemini'`, `'openai-assistants'`) :
- **Run live** (`/run`) → boucle model-router directe (§2b), cohérent avec son
  runtime déclaré.
- **Tests** (`/tests/run`) → passe quand même par le graph LangGraph (§2a),
  **incohérent** avec son runtime déclaré : le test n'exerce pas le
  comportement réellement livré (voir header `test-runner.ts:1-24`, qui
  documente ce choix comme volontaire pour tester "le vrai runtime déployé"
  — mais cette hypothèse n'est correcte QUE si tous les copilots tournent en
  LangGraph ; elle devient trompeuse dès qu'un copilot `custom`/`gemini`
  existe réellement en production).
- **Benchmark** (`/benchmarks/run`) → bascule honnêtement sur le fallback
  direct (§2b) et le flague (`ranOnGraph: false`), cohérent.

Autrement dit : le seul chemin qui teste FIDÈLEMENT ce qui sera exécuté en
prod est celui d'un copilot `runtime: 'langgraph'`. Pour toute autre valeur,
les tests mentent silencieusement sur le comportement réel (ils testent le
graph, pas le runtime déclaré) — un facteur de plus, indépendant de la DB,
qui pousse à imposer `langgraph` à la création plutôt qu'à corriger
`test-runner.ts` pour respecter les 3 autres runtimes (qui n'ont d'ailleurs
aucun moteur d'exécution réel dans Aigent : `openai-assistants`/`gemini`/
`custom` ne sont matérialisés QUE comme templates de code poussés vers le
repo cible via `github.ts`, jamais exécutés par Aigent lui-même).

## 5. Ce qu'il faudrait durcir pour rendre `runtime = 'langgraph'` obligatoire à la création

Objectif : imposer `langgraph` pour tout **nouveau** copilot, sans rien
casser pour les copilots existants (migrations, lecture historique, runs/
tests/benchmarks déjà persistés avec un autre runtime).

### 5.1 Types (`src/lib/agent-mission-control/types.ts`, `authoring-types.ts`)

- Ne PAS retirer les 4 valeurs de `AgentRuntime` — les lignes historiques
  (`copilots.runtime`, `benchmark_runs.runtime`) doivent rester lisibles/
  typables sans caster. `AgentRuntime` reste l'union complète.
- Ajouter un type dérivé restreint pour la création uniquement, ex.
  `export type CreatableAgentRuntime = Extract<AgentRuntime, 'langgraph'>`
  (ou un littéral `'langgraph'` directement) utilisé par
  `CreateCopilotInput.runtime` dans `authoring-types.ts` — ce qui fait
  échouer TOUT appelant TypeScript qui tenterait de construire un
  `CreateCopilotInput` avec autre chose que `'langgraph'`, sans toucher au
  type `Copilot.runtime: AgentRuntime` (lecture) qui doit rester large.

### 5.2 Formulaire (`create-agent-form.tsx`)

- Retirer `openai-assistants`/`gemini`/`custom` de `RUNTIME_OPTIONS` (ou
  griser ces options avec un badge "bientôt" / les garder visibles en
  lecture seule pour les copilots existants édités, mais absentes du flux
  de création). `DEFAULT_RUNTIME` reste `'langgraph'`.
- Supprimer le `<select name="runtime">` au profit d'un champ non éditable
  affichant "LangGraph" si on veut fermer complètement l'option (préférable
  ici puisque les 3 autres runtimes n'ont de toute façon aucun moteur
  d'exécution Aigent réel — cf. §4).

### 5.3 API — route de création (`src/app/api/agent-ops/copilots/route.ts`)

- Remplacer `runtime: z.enum(['langgraph', 'openai-assistants', 'gemini', 'custom'])`
  par `runtime: z.literal('langgraph')` dans `createCopilotBodySchema`. Un
  body avec une autre valeur retombe proprement en 400 via le chemin
  d'erreur zod déjà en place (`issue.path` → `runtime: Invalid literal value...`).
  Aucune migration DB nécessaire : le CHECK constraint continue d'autoriser
  les 4 valeurs pour ne pas bloquer un `PATCH` ultérieur sur un copilot
  existant (voir 5.5).
- Ne PAS toucher `benchmarks/run/route.ts` (`RUNTIMES` y sert à un override
  ponctuel de bench, pas à la création — laisser les 4 valeurs pour pouvoir
  bench un copilot legacy avec son runtime réel).

### 5.4 API — autres points de création potentiels

- Auditer (hors périmètre de cette passe read-only, mais à vérifier avant
  d'exécuter le durcissement) tout autre écrivain de `copilots.runtime` :
  `authoring-writes.ts::createCopilotFromManifest` (le seul writer bas
  niveau, ligne `runtime: input.runtime` — hérite automatiquement de la
  contrainte posée en 5.1/5.3 si `CreateCopilotInput` est retypé) et
  `provision-agent-builder-live.ts` / `scripts/provision-agent-builder.ts`
  (utilisent `AGENT_BUILDER_COPILOT`, déjà `'langgraph'` en dur — no-op).
- Vérifier qu'aucune route `PATCH /copilots/[copilotId]` ne permet de
  changer `runtime` après création (si elle existe et l'autorise, décider
  si on la restreint aussi à `'langgraph'` ou si on la laisse ouverte pour
  la maintenance des copilots legacy — recommandation : la laisser ouverte,
  le durcissement porte sur la CRÉATION, pas sur l'édition d'un existant).

### 5.5 Migrations / DB

- **Aucune migration nécessaire pour imposer la règle** — le durcissement
  est côté application (types + zod), pas côté contrainte DB. Le CHECK
  existant (`copilots_runtime_check`) doit rester `in ('langgraph',
  'openai-assistants','gemini','custom')` pour ne jamais bloquer une lecture
  ou un update sur une ligne historique.
- Si on veut un filet de sécurité DB en plus (défense en profondeur, pas
  strictement demandé) : une migration additive `alter table copilots alter
  column runtime set default 'langgraph'` est possible et non-cassante
  (un `DEFAULT` ne contraint rien, il ne s'applique qu'à un INSERT qui omet
  la colonne — actuellement `createCopilotFromManifest` la fournit toujours
  explicitement, donc ce défaut serait cosmétique/best-effort uniquement).
  Ne PAS resserrer le `CHECK` lui-même : ça casserait toute lecture/
  ré-écriture d'une ligne existante avec `runtime` legacy.

### 5.6 Lecture historique / non-régression

- `benchmark-runner.ts` et `runner.ts` continuent de lire `AgentRuntime`
  complet et de brancher correctement sur les 4 valeurs — **ne rien changer
  ici**, c'est précisément ce qui permet aux copilots legacy non-langgraph de
  continuer à s'exécuter (fallback model-router direct) après le
  durcissement de la création.
- `labels.ts::AGENT_RUNTIME_LABELS` (Record sur les 4 valeurs) reste
  inchangé — sert à l'affichage, y compris pour les copilots legacy.
- `runtime-badge.tsx` reste inchangé — affiche n'importe quelle valeur de
  `AgentRuntime`, y compris legacy.
- Si `CreatableAgentRuntime` (5.1) est introduit, s'assurer qu'aucun code
  existant ne fait `CreateCopilotInput.runtime = someLegacyCopilot.runtime`
  (copie d'un runtime existant vers un nouveau draft) — un tel flux
  casserait à la compilation avec le typage restreint, ce qui est le
  comportement voulu (force explicitement `'langgraph'` plutôt que
  d'hériter silencieusement d'un runtime non-supporté par la création).

### 5.7 Résumé de l'ordre d'exécution recommandé (si validé)

1. `types.ts` / `authoring-types.ts` — type `CreatableAgentRuntime` /
   restreindre `CreateCopilotInput.runtime`.
2. `authoring-writes.ts` — aucune modif de logique attendue si le typage
   suffit (le compilateur bloque tout appelant non conforme).
3. `create-agent-form.tsx` — retirer le choix du runtime côté UI (champ
   figé sur "LangGraph").
4. `copilots/route.ts` — `z.literal('langgraph')` dans le schéma zod.
5. Aucune migration DB requise ; documenter le choix dans
   `docs/agent-authoring.md` (ou `AGENTS.md`) une fois appliqué, pour
   garder la doc miroir du code.
