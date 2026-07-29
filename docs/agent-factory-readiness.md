ARCHIVED — historical state, not current doctrine

# Agent Factory Readiness — AIGENT-RUNTIME-PROMOTION-001

**Question :** Aigent est-il aujourd'hui capable de créer un nouvel agent réellement
exécutable de bout en bout, par un chemin produit cohérent, et de le promouvoir sans
contournement ?

**Verdict : `FACTORY_PARTIAL`.**

La chaîne `création → version → manifest → outil certifié → tests → benchmark → shadow →
replay → gate → promotion → exécution` est **entièrement prouvée en réel** (agent neuf créé
de zéro, promu par la RPC officielle, exécuté après promotion avec un vrai appel d'outil).
Mais deux maillons — **shadow** et **replay** — n'ont **aucun déclencheur produit** (ni route,
ni UI) : ils ne s'exécutent que via des fonctions runtime appelées par script/fixture. Le cycle
« complet » annoncé n'est donc pas intégralement câblé en chemin produit cohérent. `READY`
exigerait qu'un opérateur puisse déclencher shadow + replay depuis l'UI/API — ce n'est pas le cas.

Avant ce travail, le verdict aurait été **`FACTORY_BLOCKED`** : la RPC de promotion officielle
renvoyait `42501 permission denied` (grant manquant) — **aucun** agent ne pouvait être promu.
Ce blocage, plus 6 autres défauts anti-bypass, ont été corrigés dans cette PR.

- **SHA de base revu :** `e3d78a7`
- **CI GitHub sur `e3d78a7` :** `check + build` **success** (2m48s) — run `30136782220`.
- **Backend live :** gpu1 `aigent-db.hearst.app` (PostgREST service-role) + `nexus-postgres` (base `aigent`).
- **Migrations ajoutées :** `0030` (grant RPC + colonne replay), `0031` (durcissement anti-bypass RPC). Appliquées live sur gpu1.

---

## 1. Défauts trouvés à la revue et corrigés (réels, confirmés live)

Chaque défaut est un chemin concret par lequel un agent atteint `ACTIVE`/`production` sans
preuve valide, ou une preuve reliée à la mauvaise candidate. Tous confirmés contre gpu1.

| # | Défaut | Gravité | Preuve du trou (avant) | Correctif | Test de non-régression |
|---|--------|---------|------------------------|-----------|------------------------|
| 1 | `replay_comparisons` **sans** `candidate_version_id` → le gate lit *la dernière replay du copilot*, pas celle de la candidate. Un replay `BETTER` de la version A satisfait la promotion de la version B. | HIGH | Live : `select candidate_version_id from replay_comparisons` → `42703 column does not exist` | `0030` ajoute la colonne + index ; `persistReplayComparison` l'écrit ; le gate filtre dessus (comme le shadow). | `promotion-gate.test.ts` (3 tests : filtre candidate, replay d'une autre version ne satisfait pas, persist écrit la colonne) |
| 2 | RPC 5-args `promote_copilot_version` **jamais grantée** à `service_role` (0029 fait `revoke from public`, jamais `grant`). **Toute promotion officielle morte.** | **BLOQUANT** | Live : `POST /rpc/promote_copilot_version` (5 args) → `42501 permission denied` (403) | `0030` : `grant execute … to service_role`. | `promotion-rpc-antibypass.test.ts` (#2) + live `promotion-antibypass.live.test.ts` |
| 3 | L'**ancien overload 3-args** (0027, **non-gaté**) survit à 0029 et reste granté `service_role`. Un appel SQL direct `select promote_copilot_version(a,b,c)` flippe un draft en `production`+`active` **sans aucune gate**. | BLOQUANT / HIGH | Live : `pg_proc` liste 2 overloads ; via PostgREST un body 3-clés → `PGRST203` (ambigu), mais l'appel SQL direct reste ouvert | `0031` : `drop function … (text,text,text)`. Un seul overload survit. | `promotion-rpc-antibypass.test.ts` (#3) + live |
| 4 | Le chemin `p_is_rollback=true` saute la gate **et** ne vérifie pas que la cible est `archived` (garde seulement en TypeScript). `{p_is_rollback:true, p_version_id:<draft>}` → `ACTIVE` sans preuve. | HIGH | Lecture code : le check `archived` n'existe que dans `route.ts:201`, pas dans la RPC | `0031` : la RPC exige `stage='archived'` sur rollback, au niveau DB. | live (`#4: rollback d'un draft refusé`) + `promotion-rpc-antibypass.test.ts` (#4) |
| 5 / 7 | `promotion_gates` est **append-only** ; le gate forward faisait `count(*)>0` de rows PASS fraîches. Une éval `blocked` postérieure n'invalide pas une PASS antérieure → une preuve **contredite** dans la fenêtre TTL promeut quand même. | HIGH | Lecture code : `select count(*) … where gate_result='PASS'` ; aucun `update/supersede` sur la table | `0031` : la RPC lit la **dernière** éval (`order by last_evaluated_at desc limit 1`) et exige qu'*elle* soit `ready`+`PASS`+fraîche. | live (`#5: promote sans gate fraîche refusé`) + `promotion-rpc-antibypass.test.ts` (#5/#7) |
| 6 | Le check `tools-resolved-certified` certifie les rows `tools` **du copilot**, pas les `tool_ids` du **manifest de la candidate** (pas de FK). Un manifest avec `tool_id` fantôme passe la gate → promotion certifiée sur des outils que la candidate n'exécute pas. | MEDIUM | Lecture code : gate lit `tools?copilot_id=eq…` ; le runtime monte `manifests.tool_ids` | `promotion-gate.ts` : le check résout les `tool_ids` du manifest candidate → row → nom → certification ; un id sans row = phantom. | `promotion-gate.test.ts` (2 tests : phantom-id → FAIL ; lit le manifest, pas le pool) |

Défauts refutés / hors-scope à la vérification adversariale : le limb `registry_hash` du #5/#7
(REGISTRY_HASH est une constante de process, pas per-copilot — non exploitable en 1h) ; aucun
secret/prompt/payload dans la télémétrie (vérifié : `inputShape`/`error`/`usage` vides, seuls
ids/verdicts/statuts dans `environment`).

### 1bis. Rework post-revue (SHA `74257ea`) — 2 contournements DB restants, fermés par `0032`

La revue de `74257ea` a validé CI + corrections, mais a trouvé **deux bypass DB** que 0030/0031 ne
fermaient pas. Les deux confirmés live avec le **vrai rôle applicatif** (`service_role`, `BYPASSRLS=t`,
`UPDATE` direct), corrigés par la migration **`0032`**, re-prouvés live.

| # | Défaut | Gravité | Preuve du trou (avant) | Correctif `0032` | Test |
|---|--------|---------|------------------------|------------------|------|
| 8 | **Écriture directe `service_role`** : `PATCH /copilots {status:active,production_version_id}` (et l'UPDATE SQL) atteignent `active`/`production` **sans la RPC**. RLS inutile (BYPASSRLS). La garantie 0029 « la DB refuse » était fausse. | **P0** | Live : `PATCH … {status:active}` → **HTTP 200**, copilot `active` ; `set role service_role; update … → UPDATE 1` | Trigger `BEFORE UPDATE` (`enforce_promotion_via_rpc`) : refuse toute transition vers `active`/`production` sauf GUC `app.promotion='rpc'` posé par la seule RPC (SET LOCAL). BYPASSRLS ne contourne pas un trigger. | live (4 refus SQL/PostgREST + RPC OK) + unit structure |
| 9 | **TTL contrôlé par l'appelant** : `p_max_evidence_age_seconds` utilisé verbatim → un appel direct avec `999999999` réutilise une preuve ancienne. | HIGH | Lecture code : `make_interval(secs => p_max_evidence_age_seconds)` sans borne | `0032` : borne serveur dure `3600`, `least(…, 3600)`, `≤0`/`NULL` fail-closed. L'appelant ne peut que raccourcir. | live (gate 2h + TTL 999999999 → refusé ; -1/0 → refusé ; fraîche → OK) + unit structure |

Vérifs complémentaires (toutes vérifiées) : tie-break `order by last_evaluated_at desc, id desc` ;
fraîcheur via `now()` DB (jamais une date client) ; `search_path=pg_catalog, public` épinglé sur la
RPC ET le trigger ; un seul overload de la RPC (pas de signature à TTL libre). **Frontière de
confiance documentée** : `0032` garantit « aucune transition active/production hors RPC exigeant une
gate fraîche » — PAS « service_role ne peut pas forger une preuve » (il détient `INSERT` sur
`promotion_gates`, chemin légitime de `persistGateEvaluation`) ; un rôle d'écriture de preuves séparé
serait le durcissement suivant. Détail complet : `docs/runtime-promotion-001.md` § Rework post-revue.

### 1ter. Rework #2 (SHA `5544e32`) — le GUC de 0032 était FORGEABLE → séparation de privilèges (`0033`)

La revue a démontré que le marqueur de session `app.promotion='rpc'` de `0032` est **forgeable par
`service_role` lui-même** (`set_config('app.promotion','rpc',true)` puis UPDATE direct → `active`,
reproduit live). Un GUC de session est une valeur déclarative de l'appelant, **pas une autorité**.

| # | Défaut | Gravité | Preuve du trou (avant `0033`) | Correctif `0033` | Test |
|---|--------|---------|-------------------------------|------------------|------|
| 10 | **GUC forgeable** : `service_role` pose lui-même `app.promotion='rpc'` → le trigger `0032` autorise l'UPDATE direct vers `active`/`production`. | **P0** | Live SQL : `set_config(...,'rpc',true)` + `update … status='active'` → **UPDATE 1**, copilot `active` sans la RPC | Séparation de privilèges : rôle protégé `aigent_promotion_executor` (NOLOGIN/NOINHERIT/NOBYPASSRLS, dont service_role n'est pas membre) owner de la RPC ; trigger `SECURITY INVOKER` sur `current_user` (plus de GUC) ; `REVOKE UPDATE(status,production_version_id,stage)` à service_role ; policies RLS ciblant l'executor. | 14 live + 9 unit structure |
| 11 | **TTL sémantique** divergente entre 0032 (clamp silencieux) et l'intention. | LOW | — | `0033` : `NULL`/`0`/négatif → **erreur dure** ; `1..3600` verbatim ; `>3600` borné. Code = tests = doc. | live (NULL/0/-5 → erreur) + unit |

**Prouvé après `0033` (live, rôle réel `service_role`)** : GUC forgé + UPDATE direct → **refusé**
(`permission denied`, état reste `draft`) ; PATCH PostgREST `{status:active}` → `403` ; RPC officielle
avec gate fraîche → `active`/`production` ; `service_role` **non membre** de l'executor (`SET ROLE`
impossible) ; `service_role` **a perdu** `UPDATE` sur les 3 colonnes critiques ; ni service_role ni
executor n'ont `CREATE` sur `public` (anti-shadowing). **Consommateur** `provision-tradeagent-roster.mjs
--activate` (PATCH direct `status=active`) désactivé explicitement → renvoie vers `/promotion`.
Détail : `docs/runtime-promotion-001.md` § Rework 2 (P0).

### Méthode de revue

Relecture manuelle du diff complet (20 fichiers) **plus** une revue adversariale multi-agents
(6 lentilles disjointes × verify adversarial par finding, 17 agents). Chaque finding a été
reproduit contre le code réel avant correction ; chaque correctif a été vérifié live contre gpu1.

---

## 2. Matrice de capacité — chemin réel de création d'un agent neuf

Source : audit factuel des modules d'authoring (`createCopilotFromManifest`, routes, migrations).
`reallyCalled=yes` signifie « invoqué par un chemin produit réel (route/UI) », pas seulement défini.

| Étape | Existe | Réellement appelée | Persistée | Testée | Atteignable | Manuel | Bloquante | Chemin produit |
|-------|:-----:|:------------------:|:---------:|:------:|:-----------:|:------:|:---------:|----------------|
| 1. copilot (draft) | ✅ | ✅ | `copilots` | ✅ | UI + API | non | oui | `POST /api/agent-ops/copilots` → `createCopilotFromManifest` |
| 2. version draft | ✅ | ✅ | `copilot_versions` | ✅ | UI + API | non | oui | même fonction (scores `null`, non benchmarké) |
| 3. manifest | ✅ | ✅ | `manifests` (+PATCH `tool_ids`) | ✅ | UI + API | non | oui | même fonction |
| 4. outils (invariant confirmation) | ✅ | ✅ | `tools` | ✅ | UI + API | non | oui | même fonction ; `assertToolConfirmationInvariant` avant tout write ; pas de tool-builder produit autonome |
| 5. runtime (assistant LangGraph) | ✅ | ✅ | `copilots.assistant_id` + Agent Server | ✅ | UI + API | non | **oui** | `ensureCopilotAssistant`+`setCopilotAssistantId` — **enchaîné par la route uniquement**, pas par la fonction seule ; runtime **verrouillé `langgraph`** côté form |
| 6. tests | ✅ | ✅ | `test_suites`/`test_cases`/`test_runs` | ✅ | UI + API | non | pour le gate | auto-eval (best-effort) + `POST /copilots/:id/tests/run` — **exécute un run LLM réel par cas** |
| 7. benchmark | ✅ | ✅ | `benchmark_runs`/`benchmark_results` | ✅ | UI + API | non | pour le gate | `POST /copilots/:id/benchmarks/run` — **run LLM réel** |
| 8. **shadow** | ✅ (moteur) | **❌** | `shadow_experiments` | ✅ (fixture) | **script/fixture seul** | **oui** | non* | `runShadowExperiment`/`persistShadowExperiment` — **zéro appelant hors fixtures** |
| 9. **replay** | ✅ (moteur) | **❌** | `replay_comparisons` | ✅ (fixture) | **script/fixture seul** | **oui** | non* | `runReplayComparison`/`persistReplayComparison` — **zéro appelant hors fixtures** |
| 10. gate | ✅ | ✅ | `promotion_gates` | ✅ | API | non | oui | `POST /copilots/:id/promotion` → `evaluateAndPersistPromotionGate` → RPC |
| 11. promotion | ✅ | ✅ | `copilots`/`copilot_versions` (RPC atomique) | ✅ | API | non | oui | RPC `promote_copilot_version` (5-args, durcie) |
| 12. run post-promotion | ✅ | ✅ | `agent_runs`/`agent_run_steps`/`tool_calls`/télémétrie | ✅ | UI + API | non | oui | `POST /copilots/:id/run` → `executeCopilotRun` (garde fail-closed `getAvailableAgent`) |

*Non-bloquant **uniquement** parce que la policy par défaut (`requireShadow:false, requireReplay:false`)
traite shadow/replay en `NOT_CONFIGURED`. Un agent atteint donc `active` **sans jamais** avoir été
shadow-testé ni replay-comparé, faute de déclencheur produit.

**Conclusion de la matrice :** un opérateur **peut** créer un agent neuf exécutable de bout en bout
depuis l'UI/API par un chemin produit unique et cohérent (`createCopilotFromManifest` + routes
tests/benchmark/promotion/run), **sans SQL**. Les seuls maillons hors chemin produit sont **shadow
et replay** (moteurs réels, mais sans route/UI qui les alimente).

---

## 3. Preuve end-to-end minimale — agent neuf créé et exécuté

Script : `scripts/prove-factory-e2e.ts` (+ `scripts/prove-factory-run.ts`). Part d'un état où
l'agent **n'existe pas**, namespace nettoyable, chemins officiels, **0 appel facturé** sur la
partie déterministe.

**Commandes réellement exécutées :**

```bash
# Chaîne complète déterministe + run réel + nettoyage automatique :
LANGGRAPH_API_URL=http://127.0.0.1:2024 \
  node --env-file=.env.local npx tsx --conditions=react-server scripts/prove-factory-e2e.ts
```

**Identifiant de l'agent de preuve :** `copilot-factory-proof-e2e-01d66d90-65445c93`
(nom `FACTORY-PROOF-E2E 01d66d90`, distinct de tout seed).

**Résultat (token `01d66d90`, `allOk=true`, 8 étapes réellement exécutées, 2 écritures directes flaggées) :**

| # | Étape | Type | Objet persisté / preuve |
|---|-------|------|-------------------------|
| 0 | précondition : agent absent | read | 0 row nommée `FACTORY-PROOF-E2E 01d66d90` |
| 1 | **création** (`createCopilotFromManifest`) | **réel** | `copilot`, `manifest`, `tools[count_words]`, `copilot_versions` (draft) |
| 1b | **assistant LangGraph** (`ensureCopilotAssistant`) | **réel** | `copilots.assistant_id=ed2fb6ad…` (comme la route) |
| 2 | vérif persistance | read | `status=draft`, `stage=draft`, `tool_ids=[tool-count-words-…]`, `count_words(mutates=false)` |
| 3 | tests 100% | **écriture directe** ⚠ | `test_runs` `pass_rate=1` — **défaut : pas d'adapter déterministe** |
| 4 | benchmark | **écriture directe** ⚠ | `benchmark_runs` `score=92`, `unsafe=0` — **défaut : pas d'adapter déterministe** |
| 5 | **shadow** (`runShadowExperiment`) | **réel, $0** | `shadow_experiments` : `verdict=PASS`, `wouldMutate=0`, `count_words` exécuté |
| 6 | **replay** (`runReplayComparison`) | **réel, $0** | `replay_comparisons` : `verdict=EQUIVALENT`, `candidate_version_id` **lié** (fix #1) |
| 7 | **gate** (`evaluateAndPersistPromotionGate`, `requireShadow`+`requireReplay`) | **réel** | `promotion_gates` : `overall=PASS` — 5 checks PASS (release, runtime, tools, shadow, replay) |
| 8 | **promotion** (RPC officielle 5-args) | **réel** | `copilot.status=active`, `production_version_id`, `version.stage=production` (fix #2) |
| 9 | **run post-promotion** (`executeCopilotRun`) | **réel** | `agent_runs` : `status=completed`, `toolCallCount=1`, `model=gpt-5.4` (vérifié), sortie `{"word_count":9}` ; télémétrie : 1 event `hasToolCalls=true` |
| 10 | nettoyage (`deleteCopilotCascade`) | **réel** | copilot + enfants supprimés en cascade — **0 row restante** |

**Distinction stricte réel / fixture / non prouvé :**

- **Réel exécuté (code produit/runtime, gpu1) :** création, assistant, shadow, replay, gate,
  promotion RPC, run post-promotion, nettoyage.
- **Fixture déterministe ($0) :** l'input du shadow/replay est piloté par `promotion-fixtures.ts`
  (count_words, aucun appel facturé) — le *moteur* est réel, l'*entrée* est scriptée.
- **Écriture directe (identifiée comme défaut produit) :** les rows `test_runs`/`benchmark_runs`.
  Raison : `runTestSuite`/`runBenchmarkSuite` exécutent **un run LLM facturé par cas** et n'ont
  **aucun adapter déterministe** — une preuve offline $0 doit écrire l'évidence directement. C'est
  une lacune produit, pas une commodité.
- **Non prouvé volontairement :** un run LLM complet pour *tests + benchmark* (coût, hors objectif §8).

**Nettoyage :** l'agent de preuve est supprimé en cascade en fin de script (`--keep` pour le
conserver). Vérifié : aucune trace `FACTORY-PROOF*` / `ANTIBYPASS-LIVE*` en base après exécution.

---

## 4. Tests de non-contournement (12 cas)

`tests/unit/factory-non-bypass.test.ts` (13 assertions, offline, $0) + `tests/live/promotion-antibypass.live.test.ts`
(5 assertions live gpu1, namespace nettoyé). Suites cœur préexistantes : `promotion-gate.test.ts`,
`runner-lifecycle-guard.test.ts`, `promotion-rpc-antibypass.test.ts`.

| # | Cas | Résultat | Mécanisme prouvé |
|---|-----|----------|------------------|
| 1 | création sans runtime valide refusée | ✅ | gate `runtime-executable` FAIL (`engine:none`) |
| 2 | outil inconnu refusé | ✅ | gate `tools-resolved-certified` FAIL |
| 3 | outil connu non certifié refusé | ✅ | même check (`send_wire_transfer`) |
| 4 | manifest invalide refusé | ✅ | `assertToolConfirmationInvariant` (tool mutating sans confirmation) |
| 5 | draft non exécutable en prod | ✅ | run route `getAvailableAgent` (active + tools résolus) ; release-gate `is-draft` |
| 6 | promotion sans tests impossible | ✅ | release-gate `tests-pass` missing → non promotable |
| 7 | promotion sans shadow requis impossible | ✅ | gate `shadow-proof` INSUFFICIENT |
| 8 | promotion sans replay requis impossible | ✅ | gate `replay-comparison` INSUFFICIENT (+ INCONCLUSIVE ne satisfait jamais) |
| 9 | agent promu puis dépromu non exécutable | ✅ | runner `assertVersionStillServing` → `VersionNotServingError` (409) |
| 10 | création partielle sans état incohérent | ✅ | candidate à évidence incomplète (tool_id phantom) jamais PASS |
| 11 | double-submit idempotent / refusé | ✅ | run route `inFlightRuns` (409 sur run concurrent) |
| 12 | 2 promotions concurrentes ≠ 2 versions actives | ✅ **live** | index unique partiel `copilot_versions_one_production_per_copilot` → 1 seule production |

**Live gpu1 (`promotion-antibypass.live.test.ts`, 5/5) :** #3 un seul overload survit · #5 promote sans
gate fraîche refusé au DB · #4 rollback d'un draft refusé au DB · chemin officiel (gate fraîche →
active/production) · #12 deux promotions concurrentes → exactement 1 production.

---

## 5. Validation

```
npm run check           → exit 0 (typecheck, lint, ds, catalyst, agent-truth, danger,
                          render-truth, status-truth, registry-parity, registry-integrity, audit:dead)
npm run test (unit)     → 112 fichiers, 1340 tests ✓ (nouveaux : gate +5, rpc-antibypass 6,
                          non-bypass 13, direct-write-lockdown 7)
tests/live anti-bypass  → 5/5 ✓ contre gpu1 (promotion-antibypass.live)
tests/live lockdown+TTL → 14/14 ✓ contre gpu1 (promotion-direct-write-lockdown.live)
tests/live privsep      → 14/14 ✓ contre gpu1 (promotion-privilege-separation.live)
Preuve E2E              → allOk=true (8 réel / 2 direct-write flaggés), agent nettoyé
Migrations 0030..0033   → appliquées live gpu1, fermetures re-vérifiées (0033 = séparation de privilèges)
```

---

## 6. Risques restants (honnêtes)

1. **Shadow & replay sans déclencheur produit** — le principal frein au `READY`. Les moteurs sont
   réels et câblés dans le gate, mais aucun route/UI ne les exécute pour un agent neuf. Tant que la
   policy par défaut les laisse `NOT_CONFIGURED`, un agent atteint `active` sans preuve
   shadow/replay. Chantier suivant : une route `POST /copilots/:id/shadow` + `…/replay` et une
   policy par défaut qui les exige.
2. **Tests & benchmark sans adapter déterministe** — chaque cas est un run LLM facturé ; pas de
   moyen offline $0 de produire l'évidence (d'où les écritures directes de la preuve). Un
   `FixtureModelAdapter` sur `runTestSuite`/`runBenchmarkSuite` (comme `promotion-fixtures.ts`)
   fermerait ce trou.
3. **Assistant non enchaîné hors route** — `createCopilotFromManifest` seul ne provisionne pas
   l'assistant LangGraph ; seule la route le fait. Un script/chemin alternatif produit un agent nu
   (piège AGENTS.md `tool_call_count=0`). Non exploitable via l'UI, mais fragile.
4. **Runtime verrouillé `langgraph` à la création** — le multi-provider existe côté runner mais la
   surface de création (`/admin/agents/new`) verrouille `langgraph` (`z.literal`). Cohérent avec la
   doctrine (langgraph obligatoire), à noter.
4bis. **Chemin d'activation legacy hors-RPC** — `scripts/provision-tradeagent-roster.mjs:276` faisait
   un `PATCH copilots {status:'active'}` **direct** (après ses propres checks TS). Depuis le trigger
   `0032` ce PATCH échoue fail-closed (`42501`) : ce script devra activer via la RPC officielle. Le
   comportement est correct (c'était un chemin d'activation hors-gate), mais le script legacy est
   désormais à migrer — noté, non corrigé dans ce rework (hors scope promotion).
5. **Fraîcheur gate par contenu** — la RPC exige désormais la *dernière* éval PASS fraîche (fix #5),
   et la fenêtre est **bornée serveur à 3600 s non contournable** (fix #9 / `0032`). Reste une
   fenêtre TTL (≤1h) où une éval PASS peut théoriquement précéder un changement de config non
   re-évalué ; le chemin route re-évalue toujours juste avant, donc seul un appel RPC direct dans la
   fenêtre est concerné — surface résiduelle faible, derrière `service_role`.
6. **Forge de preuve par `service_role`** — l'écriture directe vers `active`/`production` est
   désormais **impossible** hors RPC (`0033` : privilèges de colonne retirés à `service_role` +
   trigger `SECURITY INVOKER` sur `current_user`, prouvé live même avec un GUC forgé), mais
   `service_role` détient encore `INSERT` sur `promotion_gates` (chemin légitime de
   `persistGateEvaluation`). Un détenteur de la clé service-role peut donc forger une gate PASS puis
   appeler la RPC. Fermer ceci exigerait un **rôle d'écriture de preuves séparé** des tables de
   lifecycle — durcissement suivant, hors scope de ce rework. La garantie DB actuelle est « pas de
   transition hors RPC-avec-gate-fraîche », pas « pas de preuve forgeable par le rôle de confiance ».

---

## 7. Verdict — `FACTORY_PARTIAL`

Aigent **peut** créer un agent neuf et l'**exécuter réellement après promotion** par un chemin
produit cohérent — prouvé de bout en bout (agent `copilot-factory-proof-e2e-01d66d90`, run
`completed`, `count_words` appelé, sortie correcte). Le blocage dur (RPC de promotion morte) et
six trous anti-bypass ont été fermés et prouvés live. **Mais** le cycle complet annoncé n'est pas
intégralement câblé en chemin produit : **shadow et replay n'ont aucun déclencheur produit**, et la
policy par défaut ne les exige pas. Le système est donc **partiel**, pas prêt : la création +
exécution fonctionne, la preuve continue (shadow/replay) reste hors du chemin produit.
