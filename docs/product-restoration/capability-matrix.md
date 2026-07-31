# Capability matrix — les 21 étapes du parcours produit

> **Constat daté (2026-07-31), établi par lecture du code sur la branche
> `mission/cockpit-catalyst-migration`.** Ce fichier n'est pas de la doctrine
> (`CLAUDE.md` §1) : c'est une observation. En cas de contradiction avec le code,
> le code a raison.
>
> Méthode : chaque ligne nomme un fichier + une fonction ouvrables. Une étape
> n'est déclarée « prouvée » que si un artefact de preuve live existe dans le
> repo. Les rapports de `docs/*.md` portant un bandeau ARCHIVED sont traités
> comme des observations faillibles et recoupés avec la source.

## Vocabulaire de classification

| Classe | Sens strict retenu ici |
|---|---|
| **OPÉRATIONNELLE** | Chemin produit complet, atteignable par un appelant réel, et **prouvé par un run live** dont l'artefact est dans le repo. |
| **PARTIELLE** | Fonctionne avec une restriction nommée qui limite le périmètre réel. |
| **BACKEND-ONLY** | Route/librairie prêtes et testées, mais **aucune surface opérateur** ne les atteint. |
| **UI MANQUANTE** | Sous-cas de backend-only où le manque d'écran est le seul obstacle produit. |
| **NON PROUVÉE** | Code câblé, jamais exercé en réel — aucun artefact live. |
| **BLOQUÉE** | Un obstacle externe empêche l'exercice (verrou, infra, credential). |
| **DÉCISION PRODUIT REQUISE** | Aucun branchement ne peut résoudre l'étape ; il faut un choix produit. |

---

## Le tableau des 21 étapes

| # | Étape | Code (fichier + fonction) | Route API | Preuve live ? | Classification |
|---|---|---|---|---|---|
| 1 | Projet | `projects/route.ts` `POST` ; lecture `data.ts` | `POST\|GET /api/agent-ops/projects` | Implicite (les projets existent en base ; aucun artefact dédié) | **BACKEND-ONLY** |
| 2 | Connexion repository | champ `project.repoFullName` ; `repo-scan.ts` `scanProjectRepo` ; `repo-intelligence.ts` `scanRepoIntelligence` | `POST /projects/[id]/repo/scan`, `/repo/intelligence` | Non — aucun artefact de scan committé | **BACKEND-ONLY** |
| 3 | Création / génération d'agent | `architect-prompt.ts` `ARCHITECT_SYSTEM_PROMPT` + `emit_manifest` ; `authoring-writes.ts` `createCopilotFromManifest` (compensable, `PartialCreationError`) | `POST /architect`, `POST /copilots` | **Oui** — `docs/agent-factory-readiness.md` : agent neuf créé de zéro contre gpu1 | **OPÉRATIONNELLE** (sans UI) |
| 4 | Résolution / construction des outils | `tool-catalog.ts`, `registry/` ; `tool-builder/mission.ts`, `tool-builder/sandbox.ts` | `/tools`, `/tools/[toolId]`, `/tool-build-missions` | Partiellement — outil `count_words` certifié par exécution | **PARTIELLE** — `mission.ts:79` : le builder ne génère+sandboxe qu'un **outil local pur** ; un outil sans sandbox ne peut pas être certifié |
| 5 | Exécution des tests | `test-runner.ts` `runTestSuite` ; `agent-suite-generator.ts` `ensureAgentSuites` | `POST /copilots/[id]/tests/run`, `/tests/generate` | **Oui** (readiness) + preuve fixture déterministe | **OPÉRATIONNELLE** (sans UI) |
| 6 | Benchmark | `benchmark-runner.ts` `runBenchmarkSuite`, `NoRunnableTasksError` ; `benchmark-sweep.ts` | `POST /copilots/[id]/benchmarks/run`, `/benchmarks/sweep` | **Oui** (readiness) | **PARTIELLE** — pas de table `benchmark_tasks` : les tâches sont sourcées des `test_cases`, plafonnées au `task_count` de la suite |
| 7 | Qualification | `qualification-orchestrator.ts` `QUALIFICATION_STEPS`, `advanceQualification` ; ledger `qualification_runs` (0040) | `POST\|GET /copilots/[id]/qualification` (`sweep`\|`start`\|`advance`) | **Oui** — `scripts/archive/prove-autonomous-factory-e2e.ts` (shadow/replay ressortis `NOT_AVAILABLE`) | **PARTIELLE** — voir §Nuance qualification ci-dessous |
| 8 | Shadow | `shadow.ts` `runShadowExperiment` ; `shadow-live.ts` `makeLiveShadowAgent` (assistant éphémère, `cleanup()`) ; `promotion-fixtures.ts` `makeFixtureShadowAgent` | `POST\|GET /copilots/[id]/versions/[vid]/shadow` | **Oui** — `docs/live-shadow-proof-*.md` : `execution_mode: live_langgraph`, `verdict PASS`, `would_mutate 0`, contre gpu1, commit `70b8288` | **OPÉRATIONNELLE** (sans UI) |
| 9 | Replay | `replay.ts` `runReplayComparison` ; `replay-live.ts` `makeLiveReplayAgents` | `POST\|GET /copilots/[id]/versions/[vid]/replay` | **Non** — câblé + unit-testé, jamais exécuté live : *« no copilot has a `production_version_id` baseline yet »* | **NON PROUVÉE** |
| 10 | Release gate | `release-gate.ts` `evaluateReleaseGate` — 9 checks, filtre `execution_mode=eq.live`, pure de `Date` | consommée par `/promotion` et `/qualification` | **Oui** (readiness, lecture seule live) | **OPÉRATIONNELLE** (sans UI) |
| 11 | Promotion | `promotion-gate.ts` `evaluateAndPersistPromotionGate` (5 checks) ; `promotion-policy.ts` `resolvePromotionPolicy` ; **RPC `promote_copilot_version`** (0027→0033) | `POST /copilots/[id]/promotion` `{promote\|rollback}` | **Oui** — readiness : promotion par la RPC officielle + 7 défauts anti-bypass re-prouvés live | **OPÉRATIONNELLE** (sans UI) |
| 12 | Livraison | `github.ts` `pushAgentToRepo` ; `delivery-loop.ts`, `delivery-events-store.ts` | `POST /projects/[id]/push-agent`, `/delivery-loop` | **Non** — chemin éteint par défaut (double verrou) | **BLOQUÉE** (verrou volontaire) |
| 13 | PR / commit consommateur | `github.ts` `pushAgentToRepoPullRequest` (`POST repos/{r}/pulls`) ; `github-pr-body.ts` | même route, `deliveryMode: 'pull_request'` | **Non** | **BLOQUÉE** (mêmes deux verrous) |
| 14 | Exécution réelle chez le consommateur | hors Aigent — `consumer-bootstrap.ts` provisionne, puis Aigent ne fait que pousser | `POST /projects/[id]/provision-consumer` ; lecture `/api/runtime/v1/**` | **Non** | **DÉCISION PRODUIT REQUISE** |
| 15 | Télémétrie remontée | `src/app/api/runtime-telemetry/route.ts` (Zod strict, 16 Ko, scan de secrets, zéro écho) ; `runtime-telemetry-store.ts` | `POST /api/runtime-telemetry` (jeton `AIGENT_RUNTIME_TELEMETRY_TOKEN`) | **Non — zéro événement de provenance `consumer`** (voir §Télémétrie) | **NON PROUVÉE** |
| 16 | Affichage du run | `dashboard-overview.ts` `getDashboardOverview` ; `src/app/page.tsx` ; `src/components/cockpit/**` | rendu serveur (RSC), pas d'API | Le cockpit rend en lecture seule | **PARTIELLE** — un cockpit **read-only** existe (voir §Écart doc↔code n°1) ; `agent-detail.ts`, `telemetry-health.ts`, `run-trace.ts` restent sans lecteur → **UI MANQUANTE** |
| 17 | Diagnostic | `improvement-diagnosis.ts` — 8 catégories, règles ordonnées, `nextRecommendedAction` ; `collectImprovementSignals` | inclus dans `POST /improve/analyze` | Non (aucun artefact live) | **BACKEND-ONLY** |
| 18 | Cycle d'amélioration (analyse) | `improvement-loop.ts` `analyzeAndPropose`, `validateManifestChanges` (allowlist, `POLICY_ORDER`, tools jamais touchés) | `POST /copilots/[id]/improve/analyze` | Non | **BACKEND-ONLY** — un seul cycle ouvert (409) |
| 19 | Création V2 | `improvement-loop.ts` `createImprovementV2` — claim atomique `PATCH …&status=eq.proposed` | `POST /improve/create-v2` | Non | **PARTIELLE** — **non atomique** : panne ⇒ claim relâché best-effort mais lignes V2 potentiellement orphelines |
| 20 | Décision humaine | `improvement-loop.ts` `decideProposal` (`approved` exige `v2-created`) ; `compareImprovementVersions` (live, jamais persisté) | `POST /improve/decision` | Non | **UI MANQUANTE** — la décision existe, aucun écran pour la rendre |
| 21 | Promotion + livraison de la V2 | mêmes chemins que 11–13 sur la version V2 | `/promotion` puis `/push-agent` | **Non** — jamais bouclé de bout en bout | **NON PROUVÉE** |

---

## Points tranchés dans le code (pas de mémoire)

### Shadow et replay : câblés, et déclenchables par un chemin produit

**Tranché : oui, ce sont des routes produit.** Les deux exposent
`POST|GET /api/agent-ops/copilots/[copilotId]/versions/[versionId]/shadow|replay`,
gardées par le proxy `agent-ops`, partageant `shadow-replay-routes-shared.ts`
(shape d'id, `liveBackendConfigured`, IDOR via `loadOwnedVersion`, refus d'une
version `archived`, `resolveCorpus`).

Le verdict `FACTORY_PARTIAL` de `docs/agent-factory-readiness.md` — *« shadow et
replay n'ont aucun déclencheur produit (ni route, ni UI) »* — est **périmé** : il
décrit l'état antérieur à `AIGENT-FACTORY-SHADOW-REPLAY-001`. Le fichier porte un
bandeau ARCHIVED, donc l'écart est signalé mais non trompeur.

Détails de conception vérifiés :
- Défaut = fixture ($0). `useFixture:false` demande le vrai LangGraph via un
  assistant **éphémère**, jamais celui de prod, avec `cleanup()` en `finally`.
- Aucun outil n'est jamais confirmé : tout outil mutant s'interrompt au
  checkpoint HITL et n'est pas exécuté.
- La concurrence est tenue par un **index UNIQUE partiel** (migration 0034) :
  l'insert EST le verrou, pas un check-then-act. Le perdant reçoit un 409.
- Re-lecture du `stage` avant persistance : une version archivée en vol ne reçoit
  jamais un PASS périmé.

**Ce qui manque pour passer au niveau supérieur** — shadow : une UI de release
(shadow est déjà OPÉRATIONNELLE côté chemin). Replay : **une seule exécution live
sur un copilot ayant un `production_version_id`** — c'est la baseline manquante,
pas un trou de câblage.

### Boucle d'amélioration V2 : un seul cycle, décision humaine obligatoire

**Un seul cycle ouvert** — deux verrous distincts :
1. `inFlightAnalyses` (Set en mémoire process) → 409 sur analyse concurrente.
   *Nuance honnête : en mémoire, donc non partagé entre instances.*
2. **Le vrai garde-fou, en base** : `improvement_proposals?copilot_id=eq.…&status=in.(proposed,v2-created)&limit=1`
   → 409 *« an improvement cycle is already open for this copilot — decide it first »*.

**Décision humaine obligatoire — confirmé.** `decideProposal` est le seul chemin
vers `approved|rejected` et n'écrit rien d'autre ; le commentaire de route est
exact : *« this records the decision; it does NOT promote anything »*. La
promotion reste derrière `/promotion`, opérateur-déclenchée.

**Aucune auto-promotion existante** : `runAutoImprovementCycle` (itérations +
budget USD + `AbortSignal`) est **exporté et testé mais appelé par personne** —
grep : une seule occurrence, sa propre définition (`improvement-loop.ts:1203`).
C'est un moteur sans surface produit, et il s'arrête de toute façon AVANT toute
approbation.

### Promotion : la RPC est la seule voie, prouvée au niveau privilège

**Tranché : oui, et le verrou n'est pas applicatif — il est en base.**

La route appelle `POST /rest/v1/rpc/promote_copilot_version` (5 args). La chaîne
de durcissement :

- **0028** : retire le `EXECUTE` PUBLIC implicite du SECURITY DEFINER.
- **0031** : supprime l'overload 3-args non gaté (bypass réel, confirmé live).
- **0032** : trigger BEFORE UPDATE refusant toute transition *vers*
  `status='active'` / `stage='production'` / repoint de `production_version_id`.
  Un trigger **n'est pas contourné par BYPASSRLS**.
- **0033** : le défaut de 0032 était que le marqueur GUC `app.promotion` était
  **forgeable par `service_role` lui-même** (prouvé live). Remplacé par une
  **séparation de privilèges** réelle : rôle `aigent_promotion_executor`
  (NOLOGIN NOINHERIT NOBYPASSRLS) dont `service_role` **n'est pas membre**, RPC
  possédée par lui, trigger en SECURITY INVOKER lisant le `current_user` réel.
  Défense en profondeur : `revoke update on copilots from service_role` puis
  re-grant colonne par colonne **sauf** `status` et `production_version_id` ;
  idem `copilot_versions` sauf `stage`.

**Auto-promotion possible ? Non, à trois niveaux :** (a) aucun appelant
automatique de la route ; (b) la route ré-évalue ET persiste le gate avant toute
écriture (422 si non vert) ; (c) la RPC **relit elle-même** la ligne
`promotion_gates` la plus récente et exige `ready`+`PASS`+fraîche (TTL clampé
côté serveur, le caller ne peut que le raccourcir) — sinon `check_violation`,
surfacé en 422 *« gate evidence stale or absent »*.

Exemption de rollback correctement bornée : la cible doit être `stage='archived'`
(sinon 409), sans quoi `{action:'rollback', versionId:<draft>}` pousserait un
draft non gaté en production.

### `active_in_consumer = 'unknown'` : structurel, pas un TODO

`agent-lifecycle-trace.ts` fixe l'étape à `reached: 'unknown'` avec
`source: 'none — no consumer-side read channel exists'`. La cause est
architecturale : après provisioning, **Aigent ne fait que POUSSER**. Les gestes
activate / rebind / deploy-version appartiennent au workspace consommateur.
`scripts/check-lifecycle-truth.mjs` impose que ça reste le littéral `'unknown'`
et que ce ne soit jamais déduit d'un `DeliveryEvent`.

**Ce qui manque** : un canal de **lecture** vers le consommateur — soit un
callback d'activation que le consommateur POSTe, soit une API que le consommateur
expose et qu'Aigent interroge. C'est une **décision produit** (qui appelle qui,
avec quel jeton, quel contrat), pas un branchement de données.

### Télémétrie consommateur : zéro événement externe prouvé

`classifyRuntimeTelemetryProvenance` (`runtime-telemetry-provenance.ts`) ne
classe `'consumer'` que sur un `environment.source` valant littéralement
`'consumer'` ou `'aigent-consumer'` — **jamais par défaut** (doctrine : inconnu
tant que non positivement prouvé). Or les **quatre seuls émetteurs du repo**
écrivent tous une source interne :

| Émetteur | `environment.source` | Provenance |
|---|---|---|
| `emitInternalRunTelemetry` | `aigent-internal-runner` | `internal` |
| `emitPromotionTelemetry` | `aigent-promotion` | `lifecycle` |
| `emitShadowTelemetry` | `aigent-shadow` | `lifecycle` |
| `emitReplayTelemetry` | `aigent-replay` | `lifecycle` |

**Conclusion : aucun émetteur consommateur n'existe dans ce repository.** Toute
ligne `consumer` devrait venir d'un produit tiers postant sur
`/api/runtime-telemetry`. L'endpoint **accepte** ; personne n'a prouvé qu'il
**reçoit**. Nuance de rigueur : je constate l'absence d'émetteur côté Aigent, je
n'ai pas interrogé la base gpu1 — l'affirmation « zéro ligne consumer en base »
reste celle de `known-gaps.md` §2, non revérifiée dans cette passe.

### Providers : confirmé dans le code

`model-router.ts` `callProvider` / `providerAvailable` — union fermée avec
`default: throw ProviderUnavailableError` :

- **`openai`** → `callOpenAI` — **câblé**.
- **`google`** → `callGemini`, `https://generativelanguage.googleapis.com/v1beta/models/…`
  — **câblé, tool-use inclus**. Idem côté graphe (`src/langgraph/model-provider.mjs`).
- **`local`** → `callLocalVllm`, gardé par `localVllmAvailable(model)` —
  **opt-in explicite** (`VLLM_LOCAL_API_KEY`).
- **`mistral`** → **absent du switch du router** ; côté graphe,
  `model-provider.mjs:86-87` lève `"provider 'mistral' is not wired in V1"`.
  Erreur typée, jamais de fallback muet. Migration **0021** l'a retiré de l'enum
  DB.

`ARCHITECT_MODEL = 'gpt-5.4'` est le modèle **de l'architecte et de l'analyse
d'amélioration**, pas le modèle unique de la plateforme. N'écris jamais
« OpenAI-only ».

---

## Nuance qualification (étape 7) — corrige une lecture répandue

`qualification-orchestrator.ts` est une **couche workflow, pas un moteur de
preuve**. `stepShadow` / `stepReplay` **lisent d'abord l'évidence persistée** :

```
shadow_experiments?copilot_id=eq.…&candidate_version_id=eq.…&order=started_at.desc&limit=1
```

Donc **si la route shadow a tourné avant, la qualification voit son verdict.**
`NOT_AVAILABLE` n'est rendu que si (a) aucune évidence n'existe **et** (b) aucun
`driver` n'est injecté. Le `NOT_AVAILABLE` observé dans
`prove-autonomous-factory-e2e.ts` reflète un ordre d'exécution (aucun shadow
lancé sur ce candidat), **pas** une incapacité de l'orchestrateur.

En revanche les commentaires du fichier (lignes 113-117, 460, 502) affirment
encore *« real LangGraph shadow driver not wired in this perimeter »* — **c'est
faux depuis que `shadow-live.ts` existe**. Voir écart n°3.

---

## Écarts doc ↔ code trouvés

### 1. `known-gaps.md` §1 et `current-capabilities.md` : « le shell est une coquille » — FAUX

`current-capabilities.md` écrit : *« Le shell est une coquille : sa navigation
pointe sur `#`, ses zones de contenu sont vides, et **il n'appelle aucune API** »*
et `known-gaps.md` §1 : *« aucune lecture humaine de la flotte — les agrégations
existent […] mais **plus personne ne les appelle** »*.

**Le code contredit les deux.** `src/app/page.tsx` (62 lignes,
`export const dynamic = 'force-dynamic'`) importe et **appelle**
`getDashboardOverview()`, et rend un cockpit complet :
`src/components/cockpit/{overview-screen,kpi-strip,charts,rows,run-stream,action-queue,topbar,primitives}.tsx`
plus `src/lib/cockpit/{overview-series,named-runs}.ts`. Les commits récents de la
branche le confirment (`feat(cockpit): refonte visuelle`, `voie A — Catalyst natif`).

**Nuance qui sauve une partie de l'affirmation** : ce cockpit est **strictement
en lecture**. Grep `onClick|onSubmit|<form>` sur `src/components/cockpit/` et
`src/app/*.tsx` → **zéro** ; les seuls `onClick` sont l'ouverture de la sidebar
mobile. Aucun composant ne `fetch` `/api/agent-ops/**`. Donc : *« aucune
lecture humaine »* est faux, *« aucune action humaine »* reste vrai.

### 2. `docs/agent-factory-readiness.md` : « shadow et replay n'ont aucun déclencheur produit » — PÉRIMÉ

Les deux routes existent (étapes 8-9). Le fichier porte un bandeau ARCHIVED et
`factory-shadow-replay-001.md` porte un encadré SUPERSEDED explicite — la dérive
est donc signalée, mais un lecteur pressé du seul readiness conclura faux.

### 3. `qualification-orchestrator.ts` — commentaires de code faux (le plus grave)

Ce n'est pas de la dérive documentaire mais de la **dérive dans le code source** :
lignes 113-117, 460-461 et 502-503 affirment que le driver LangGraph réel
« lives in the shadow/replay engine perimeter » et n'est « not wired ». Il est
câblé (`shadow-live.ts` / `replay-live.ts`) et atteignable par route.
Un `.md` archivé est inoffensif ; un commentaire faux au point d'intégration
induit en erreur le prochain agent. **À corriger dans une mission de code.**

### 4. `promotion/route.ts` — docstring qui décrit l'ancienne implémentation

Le bloc de commentaire lignes ~40-52 décrit la transition comme trois PATCH
indépendants avec *« optimistic concurrency »* sur `stage=eq.production`. Le code
20 lignes plus bas appelle la **RPC transactionnelle**. Le commentaire plus bas
(ligne ~« ATOMIC transition ») est, lui, correct — le fichier se contredit
lui-même. Risque : un agent lisant l'en-tête croit pouvoir reproduire la
transition par PATCH, ce que 0033 refuse désormais au niveau privilège.

### 5. `types.ts` — en-tête « V1 is mock-only » et types LEGACY

L'en-tête affirme encore *« no backend, no LangGraph/LangSmith/OpenAI calls »* :
**périmé**, les runners sont câblés. Et `PromotionGate` / `PromotionCheckId` /
`ShadowExperiment` / `ReplayComparison` sont LEGACY (consommés uniquement par
`seed-fixtures.ts`) ; les contrats runtime sont `PromotionGateResult`,
`ShadowExperimentRecord`, `ReplayComparisonRecord`. `CopilotVersion.scores` est
un blob **STALE dont aucun gate ne se sert**.

### 6. Ce que `known-gaps.md` dit JUSTE (à ne pas « corriger »)

§2 (télémétrie jamais exercée), §3 (double verrou shipping), §4 (un seul outil
sandboxé), §5 (mistral), §6 (dérive de version incalculable — `DeliveryEvent`
n'expose pas de `versionId` en lecture), §7 (`active_in_consumer`), §8 (étroitesse
des gates) sont **tous confirmés par le code**. Ce fichier est nettement plus
fiable que sa propre §9 ne le laisse craindre.

---

## Les 3 blocages structurels majeurs

### Blocage 1 — La boucle n'est pas bouclée : aucun retour consommateur n'a jamais existé

Étapes **14 → 15 → 16 → 17** forment la moitié « apprentissage » de la promesse
`create → qualify → ship → execute → telemetry → improve`. Aucune ne s'est jamais
produite en réel :

- l'ingestion est construite et durcie, mais **les 4 émetteurs du repo écrivent
  tous une source interne** — aucun code Aigent ne peut produire un événement
  `consumer` ;
- la livraison (12-13) est **éteinte par défaut** (`dryRun ?? true` +
  `GITHUB_PUSH_ENABLED=1`), donc rien n'est jamais parti vers un vrai repo en
  fonctionnement normal ;
- sans agent déployé, il n'y a rien à exécuter, donc rien à remonter.

**Conséquence de vérité** : « Aigent apprend des runs de ses agents déployés »
décrit une capacité **construite**, jamais **exercée**. Les étapes 17-21 sont
alimentées exclusivement par des runs internes.

**Ce qui manque** : un consommateur réel, une autorisation d'armer
`GITHUB_PUSH_ENABLED=1` sur une cible jetable, et **un émetteur de télémétrie
côté consommateur** (le pack `consumer-bootstrap.ts` doit livrer le code qui
POSTe sur `/api/runtime-telemetry` avec `source: 'consumer'`).

### Blocage 2 — Aucune surface d'action : le produit est intégralement pilotable par curl, et par rien d'autre

Le cockpit livré est **read-only**. Toutes les décisions du cycle de vie —
lancer des tests, déclencher shadow/replay, promouvoir, approuver une V2, reprendre
un run `needs-confirmation` — n'existent que comme requêtes HTTP manuelles.

Le cas le plus coûteux est l'**étape 20** : la boucle d'amélioration impose par
conception une décision humaine (`decideProposal`), et cette décision **n'a aucun
écran**. Le garde-fou produit le plus important du système ne peut être actionné
que par un opérateur écrivant du JSON à la main. De même, le HITL
(`runs/[runId]/resume`) : un agent qui s'arrête proprement sur un outil mutant y
reste jusqu'à un POST manuel.

**Ce qui manque** : un bloc UI d'action (release/promotion + décision V2 + resume
HITL) posé sur des routes qui, elles, sont déjà complètes et gardées.

### Blocage 3 — Replay n'a jamais de baseline, donc le gate de promotion strict n'a jamais été franchi de bout en bout

`promotion-gate.ts` exige cinq checks dont `replay-comparison`, et une preuve
`deterministic_fixture` peut **bloquer** mais jamais **débloquer** un check requis
(asymétrie voulue). Or replay compare le candidat à la **référence production** —
et l'artefact de mission le dit noir sur blanc : *« no copilot has a
`production_version_id` baseline yet »*.

Il en résulte un ordre de dépendance circulaire à l'amorçage : pour un replay
`live_langgraph` il faut une production ; pour une première production sous
policy **strict** il faudrait déjà un replay. Le système s'en sort par
`resolvePromotionPolicy` (lenient pour les copilots *grandfathered*, strict
post-cutover, **strict fail-closed si indéterminable**) — mais cela signifie que
la **première** promotion strict-policy réellement franchie reste à démontrer, et
que l'étape 21 (promotion d'une V2 sous régime complet) n'a jamais eu lieu.

**Ce qui manque** : promouvoir un copilot jetable (chemin déjà prouvé, étape 11),
puis exécuter un replay `useFixture:false` contre cette baseline. C'est
**une seule exécution live**, pas du code à écrire.

---

## Ce que cette passe n'a PAS vérifié

- **Aucune requête à la base gpu1** : les affirmations « zéro ligne consumer »,
  « aucune baseline production » viennent d'artefacts de mission committés, pas
  d'un `select` de cette passe.
- **Aucun agent exécuté**, aucune gate lancée (mission en lecture seule) : le
  comportement runtime au sens large n'est pas re-constaté ici.
- **Quelles migrations sont réellement appliquées sur gpu1.** 0032/0033 sont sur
  disque et leurs en-têtes décrivent des vérifications live ; 0034/0035 étaient
  déclarées non appliquées à la date de `factory-shadow-replay-001.md`, puis la
  preuve live de shadow (qui écrit `execution_mode`, colonne de 0034/0037) laisse
  déduire qu'elles l'ont été depuis. **Déduction, pas constat.**
- **Étapes 1-2** : classées BACKEND-ONLY par lecture de route ; aucun artefact ne
  prouve un scan de repo réel, mais rien ne prouve non plus qu'il n'a pas eu lieu.
