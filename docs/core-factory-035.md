# AIGENT-CORE-FACTORY-035 — reconstruction du cœur (design + preuves)

> État : **passe 1 en cours** — fondations canoniques prouvées d'abord, purge legacy en dernier
> (imposé par la mission : ne rien supprimer avant que le nouveau cœur soit prouvé).
> SHA de départ : `dc4bbc3` · point de récupération : tag `recovery/pre-core-factory-035`.

## 1. Vérité constatée (cartographie, pas rapport de confiance)

Sept sous-agents read-only + requêtes DB live. Faits vérifiés, contredisant plusieurs
prémisses de la mission :

### 1.1 Il n'y a PAS de popup de création d'agent
`/admin/agents/new` est **déjà une page pleine** (`NewCopilotWorkbench` + `CreateAgentForm`
+ `ArchitectChat`). Le seul modal du repo est le **project builder**
(`project-builder-modal.tsx`), qui construit un projet, pas un agent. → « supprimer le popup »
est en grande partie un non-op ; on ne fabrique pas un popup pour le supprimer. La Factory
full-page **réunit et élève** ces surfaces existantes sous `/admin/factory`.

### 1.2 Le vrai défaut : 5 listes d'outils parallèles, 1 seule paire sous gate
| # | Fichier | Rôle | Sous gate ? |
|---|---|---|---|
| 1 | `src/langgraph/tool-registry.mjs` `REGISTRY` | **autorité réelle** (monte les tools) | — |
| 2 | `copilot-behavior.ts` `REGISTRY_IDS` (20 strings) | copie manuelle, iso-module | typecheck seul |
| 3 | `tool-handlers.ts` `TOOL_HANDLERS` | handlers direct-path | **aucune** (+ bug : realestate manquant) |
| 4 | `available-agents.ts` `RUNNABLE_TOOL_NAMES` | copie catalogue | gate #1↔#4 (`check-registry-parity`) |
| 5 | `agent-builder-graph.mjs` `DEFAULT_TOOL_IDS` (5) | fallback legacy | gelé |

Seul #1↔#4 est vérifié. #1↔#2 = typecheck. #3 n'a **aucune** parité — et il lui manque les
handlers realestate (drift réel). C'est le « ajouter un outil dans 4 registres » de la mission.

### 1.3 Il n'y a PAS de runtime registry
`AgentRuntime` est une **simple union TS** (`types.ts:44`) : `langgraph | openai-assistants |
gemini | custom`. Aucune déclaration de moteur, health, capacités, disponibilité. Seul
`langgraph` a un moteur réel ; les 3 autres sont un « else » implicite dans `runner.ts:686`.
Un runtime purement déclaratif peut être stocké sur un copilot sans qu'aucune gate ne le refuse.

### 1.4 Validation eager, lifecycle lazy
Manifest validé par Zod **avant** persistance (`copilots/route.ts:221`) + garde défense-en-
profondeur (`authoring-writes.ts:218`). Mais le lifecycle est **relu à l'exécution** : le run
gate refuse fail-closed (`run/route.ts` : `active` + `unresolvedToolIds` vide, sinon 409). Le
release-gate a **9 checks live** (`release-gate.ts`), zéro stub.

### 1.5 Types morts confirmés par la DB
`PromotionGate` / `ShadowExperiment` / `ReplayComparison` : interfaces + seed-fixtures, **zéro
appelant**. Tables `promotion_gates` / `shadow_experiments` / `replay_comparisons` : **0 lignes**.
Idem `agent_drafts`, `registry_warnings`, `runtime_telemetry_events`, `project_agent_relations`,
`sandbox_reports` : 0 lignes (tables prêtes, jamais alimentées).

### 1.6 Presque aucun hardcode agent-spécifique
`grep proj-tradeagent` sur `src/lib` + `src/app/api` = **0**. Noms d'agents = **0**. Le seul
fichier agent-spécifique dans l'arbre générique est `btc-runtime-manifest.ts` — **jamais
importé** (mort). Le runtime est déjà largement générique : la peur « traitement spécial par
slug/projet » est en grande partie déjà satisfaite.

### 1.7 État DB live (source de l'export/purge)
7 copilots (4 TradeAgent `active`, Valuation Agent `draft`, Architecte Maisons Conteneurs
`draft`, Agent Builder Copilot `draft`) · 8 versions · 8 manifests · 33 tools · 44 runs · 258
steps · 101 tool_calls · 10 test_results · 2 benchmarks · 39 mission_findings · 3
delivery_events · 9 projects.

## 2. Architecture cible — une seule autorité d'exécutabilité

Chaîne canonique unique (aucun consommateur ne recalcule l'exécutabilité) :

```
Tool implementation (code)  ─┐
Runtime adapter (code)       ├─►  Canonical Registry (code = autorité)
                             │        │
                             │        ├─► TS unions DÉRIVÉES (plus de copie manuelle)
                             │        ├─► registry hash (empreinte de version)
                             │        └─► projection DB (facultative, jamais autorité seule)
                             ▼
                     Agent manifest ─► Validation eager ─► Provisioning ─► Mounted snapshot
                             ▼
                          Run ─► Tool calls ─► Evidence ─► Catalogue/UI
```

**Décision** : le **code exécutable** est l'autorité sur l'existence d'un handler/runtime. La DB
stocke instances, versions, projections — jamais une capacité. Une projection obsolète ne peut
pas rendre un agent exécutable (le run gate relit le registre canonique, pas la projection).

## 3. Ce qui a été construit (passe 1 — fondations prouvées)

### 3.1 Runtime Registry canonique — `registry/runtimes.ts`
Chaque runtime déclare son **moteur réel** (`langgraph` | `model-router` | `none`),
capacités (tools/streaming/hitl/checkpoints/telemetry), providers modèles, creatable,
note. `langgraph` = seul exécutable. `openai-assistants`/`gemini`/`custom` = `engine:none`
⇒ jamais exécutables, jamais sélectionnables, jamais « disponibles ». `isRuntimeExecutable`
/ `isRuntimeCreatable` / `runtimeAvailability` = les seuls prédicats ; plus de
`=== 'langgraph'` éparpillé.

### 3.2 Tool Registry canonique — `registry/tools.ts`
21 `ToolDefinition` (id, version semver, kind, mutates, risk, requiresConfirmation,
secretRefs **par nom**, provenance, runtimes, certification). `mutates` reflète la vérité
DB (migration 0023, read-only prouvé par le handler). **Bug de drift corrigé** :
`read_funding_open_interest` existait dans le `.mjs` exécutable + handler mais manquait de
l'union TS ⇒ ajouté (21 outils, pas 20).

### 3.3 Unions dérivées + fingerprint — `registry/index.ts`
`copilot-behavior.ts` `REGISTRY_IDS` **dérive** du registre (fini la copie manuelle).
`REGISTRY_HASH` (FNV-1a du contrat complet) = empreinte de version, pour l'evidence de run
et la détection de projection DB obsolète. Hash actuel : `3a7762ae`.

### 3.4 Validation eager — `registry/manifest-validation.ts`
`validateManifestAgainstRegistry(runtime, tools)` : classe chaque outil
(`certified`/`uncertified`/`phantom`), refuse un outil **obligatoire** phantom (⇒ NEEDS_TOOL
à l'authoring, plus de « pas de données » silencieux au run), dégrade un outil **optionnel**
absent, refuse un runtime sans moteur. **Une seule fonction** sert l'API et la Factory UI.

### 3.5 Gate d'intégrité — `scripts/check-registry-integrity.mjs` (dans `npm run check`)
Parcourt tous les runtimes + outils, échoue sur : canonical ≠ exécutable(.mjs) ≠ union
`BehaviorToolId`, id dupliqué, runtime fantôme, secretRef malformé, version non-semver,
`RUNTIME_REGISTRY` ≠ union `AgentRuntime`. **Vérifié adversarialement** : outil fantôme
injecté ⇒ échoue ; revert ⇒ passe.

### 3.6 API + preuves
- `GET /api/agent-ops/registry` — vérité canonique (runtimes+outils, purs) + counts live
  (null → tiret honnête, jamais un faux zéro) + `registryHash`.
- `scripts/prove-core-factory.mjs` — preuve **déterministe** (sans LLM/réseau) : autorité du
  registre + refus NEEDS_TOOL + dégradation optionnelle + refus runtime sans moteur. **PASSÉE**.
- `tests/unit/canonical-registry.test.ts` — 12 tests (canonical ⟺ .mjs, engine:none jamais
  exécutable, phantom refusé, hash stable). **PASSÉS**.

### 3.7 Export/restore réversible
`scripts/export-agent-domain.mjs` (déterministe, sans secret, re-export byte-identique) +
`scripts/restore-agent-domain.mjs` (dry-run par défaut, upsert idempotent). Export pris :
7 copilots + 44 runs + 258 steps + … (voir `delivery/agent-domain/`). **Filet de la purge.**

## 4. Réponses aux 10 questions du rapport (état passe 1)

1. **Zéro agent ?** — cockpit à valider (Factory + empty states honnêtes construits ; purge non exécutée, base a encore 7 agents).
2. **Créer sans code ?** — chaîne authoring + Factory + validation registre en place ; parcours complet à prouver par run live.
3. **Capability manquante ?** — **oui, câblé** : NEEDS_TOOL eager (validateur + preuve déterministe passée).
4. **Tool Builder ?** — **pas encore** (brique suivante) : la Factory montre l'état honnête « à venir ».
5. **Outil déclaré constructible ?** — **oui** : la gate d'intégrité rend impossible un outil déclaré non buildable par le `.mjs`.
6. **Catalogue == runner ?** — **oui** : même autorité canonique, gate d'intégrité + hash.
7. **Run completed = preuve ?** — inchangé cette passe (runner evidence = brique suivante) ; run gate fail-closed déjà en place.
8. **Promotion/rollback réels ?** — inchangés (release-gate 9 checks live déjà présents).
9. **Popup remplacé ?** — il n'y avait PAS de popup ; `/admin/factory` élève la création en workspace.
10. **Anciens agents supprimés ?** — **non, volontairement** : exportés, purge seulement après preuve du nouveau cœur (imposé par la mission).
