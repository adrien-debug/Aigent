# AIGENT-FACTORY-SHADOW-REPLAY-001 — Shadow/Replay as product capabilities

> Branche `feat/factory-shadow-replay-001` · base `origin/feat/runtime-promotion-001` (tip
> `0b91ce6`, PR #19, alors non mergée). Objectif : Shadow et Replay ne sont plus des moteurs
> appelables uniquement par script (`scripts/prove-factory-e2e.ts`) — ce sont des routes API
> produit, avec preuve persistée, idempotence réelle, IDOR fermé, et un écran Release qui les
> déclenche.

## Verdict final

**`SHADOW_REPLAY_PRODUCT_PARTIAL`**

Le code, les migrations, la policy, l'UI et 14 des tests obligatoires sont livrés et
vérifiés offline (112 fichiers / 1357 tests, `npm run check` intégralement vert, isolé dans
un worktree dédié). Le blocage est unique et précis : **la preuve E2E vivante contre gpu1
n'a pas été exécutée**, pour trois raisons documentées ci-dessous, aucune contournée. Rien
n'a été inventé pour compenser : pas de preuve fixture présentée comme preuve gate produit,
pas de chemin runtime alternatif institutionnalisé pour se substituer à la preuve réelle
manquante.

## Ce qui est livré

### Routes API produit
- `POST/GET /api/agent-ops/copilots/:copilotId/versions/:versionId/shadow`
- `POST/GET /api/agent-ops/copilots/:copilotId/versions/:versionId/replay`

Chaque route : auth héritée du middleware `proxy.ts`, ownership + anti-IDOR (404 générique,
pattern identique à `promotion/route.ts`), validation manifest/runtime, idempotence réelle
(voir plus bas), persistance des preuves via `shadow_experiments`/`replay_comparisons`,
télémétrie (`emitShadowTelemetry`/`emitReplayTelemetry`, jamais de payload/prompt brut —
prouvé par test), erreurs structurées `{error, code?}`.

### Idempotence — garantie DB, pas applicative
Migration `0034_shadow_replay_lifecycle.sql` : index UNIQUE partiel sur
`(copilot_id, candidate_version_id) WHERE status IN ('queued','running')` pour les deux
tables. Deux POST concurrents pour la même candidate collisionnent à l'INSERT (23505), le
perdant reçoit un 409 structuré — ce n'est pas un check-then-act applicatif (qui a une
fenêtre de course), c'est la même classe de garantie que l'index partiel
`copilot_versions_one_production_per_copilot` déjà en production sur ce repo.

### Policy de promotion — évolutive, sans casse silencieuse
Migration `0035_promotion_policy_versioning.sql` ajoute `copilots.requires_shadow_replay`
(nullable). `promotion-policy.ts` (`resolvePromotionPolicy`) :
- `true` → policy stricte (`requireShadow`+`requireReplay`) — tout nouveau copilot créé via
  `createCopilotFromManifest` reçoit `true` explicitement, jamais `NULL` par défaut.
- `false` → opt-out explicite (réservé à une décision humaine future, jamais posé
  automatiquement aujourd'hui).
- `NULL` → copilot pré-cutover (historique) : reste sur la policy indulgente
  `DEFAULT_PROMOTION_POLICY` **mais journalisé** (`source: 'grandfathered-null'`), jamais
  silencieux.
- Ligne introuvable/illisible → **fail-closed strict**, jamais un défaut indulgent en cas
  d'incertitude.

### UI — écran Release
`ProofActions` (dans `promotion-evidence-panel.tsx`) : deux boutons ("Run shadow
experiment" / "Run replay comparison") greffés dans la section "Promotion evidence"
existante, pas un second cockpit. Dialog de confirmation Catalyst, état `pending`/`running`
(désactivé client-side dès `queued`/`running`)/`error`/`INSUFFICIENT_EVIDENCE` (texte neutre,
jamais un bandeau rouge), `router.refresh()` après succès. Corrige aussi un bug pré-existant
trouvé en revue : la lecture `replay_comparisons` sur `release/page.tsx` ne filtrait pas
`candidate_version_id` (contrairement à la lecture `shadow_experiments` juste au-dessus) —
elle pouvait afficher le replay d'une AUTRE candidate. Corrigé.

Captures : `docs/visual-reviews/AIGENT-FACTORY-SHADOW-REPLAY-001/` (état normal, dialog de
confirmation shadow, état erreur — capturé via un vrai 401 d'auth rencontré en dev, hors
périmètre de cette mission, non modifié).

### Les 12 scénarios de test obligatoires — tous couverts

| # | Scénario | Fichier |
|---|---|---|
| 1 | Deux shadows concurrents | `shadow-replay-routes.test.ts` |
| 2 | Deux replays concurrents | `shadow-replay-routes.test.ts` |
| 3 | Replay d'une autre candidate | `shadow-replay-routes.test.ts` |
| 4 | Shadow avec outil mutating | `shadow-replay-routes.test.ts` |
| 5 | Manifest change mid-exécution | `shadow-replay-routes-gaps.test.ts` |
| 6 | Candidate archivée GENUINEMENT mid-flight (pas juste at-launch) | `shadow-replay-routes-gaps.test.ts` |
| 7 | Corpus absent/vide | `shadow-replay-routes.test.ts` |
| 8 | Run interrompu (crash mi-corpus) | `shadow-replay-routes-gaps.test.ts` |
| 9 | Double-clic UI | couvert côté API par #1/#2 + désactivation client-side dans `ProofActions` |
| 10 | Tentative IDOR | `shadow-replay-routes.test.ts` |
| 11 | Preuve ancienne/contredite (gate lit la plus récente) | `shadow-replay-routes.test.ts` |
| 12 | Télémétrie sans secret | `shadow-replay-routes.test.ts` |

Note de revue sur #6 : la première version des tests ne prouvait que le refus
« archivée-au-lancement » — la vérification post-run (`readVersionStage` après
`runShadowExperiment`/`runReplayComparison`) n'était pas exercée. `shadow-replay-routes-gaps.test.ts`
force l'archivage strictement ENTRE les deux lectures pour prouver le bon garde-fou.

## Décision de scope prise en cours de mission : pas de runtime alternatif institutionnalisé

Une implémentation antérieure de ce travail exposait `useFixture:false` sur les deux routes
pour driver une exécution "réelle" via `executeCopilotRun` (runtime direct/model-router).
**Ceci a été retiré** sur instruction explicite, et à raison : le runtime direct n'est PAS un
substitut fidèle au graphe LangGraph d'un copilot `runtime: 'langgraph'` — l'assistant
LangGraph déjà provisionné pour un copilot ne reflète pas forcément le manifeste exact d'une
version candidate (tools/prompt différents). Router `useFixture:false` vers le runtime direct
aurait fait passer une évaluation d'un AUTRE moteur pour une preuve de la candidate réelle —
exactement le genre de preuve fabriquée que ce projet refuse.

`useFixture:false` retourne maintenant `501 {code: 'REAL_EXECUTION_NOT_WIRED'}` sur les deux
routes, **avant** la réservation de ligne (donc n'occupe jamais le slot de concurrence) —
prouvé par test. `buildRunCallback`/`localDeterministicRunAgent` (le code qui pilotait le
runtime direct) ont été supprimés de `shadow-replay-routes-shared.ts`, pas laissés morts.

## Ce qui manque pour lever le 501 — brancher `ensureCandidateAssistant`

`feat/deterministic-evidence-001` (branche sœur, non mergée à date de cette doc) livre une
primitive `ensureCandidateAssistant` dont l'objet est précisément de provisionner un
assistant LangGraph ÉPHÉMÈRE reflétant le manifeste exact d'une version candidate, distinct
de l'assistant de production du copilot. C'est la pièce manquante identifiée dans
`AGENTS.md` ("piège LangGraph — c'est l'assistant qui manque, pas le runtime") appliquée au
cas candidate/shadow/replay.

Pour brancher une vraie exécution Shadow/Replay (non-fixture) une fois cette primitive
disponible :

1. **Shadow** (`shadow.ts`'s `ShadowRunAgent`) a besoin d'un callback qui, pour chaque input,
   passe par le graphe LangGraph de l'assistant éphémère ET expose le seam
   `ShadowToolGate.check(toolName)` AVANT chaque appel outil — aujourd'hui, aucun point
   d'injection n'existe entre le graphe LangGraph et un gate par-appel-outil (le graphe
   exécute les outils lui-même, sans hook externe). Il faut soit (a) un hook côté graphe qui
   consulte le gate avant d'exécuter un outil marqué `mutates`, soit (b) construire le
   manifest de l'assistant éphémère pour qu'il n'expose QUE les outils non-mutants au moment
   du provisioning (plus simple, mais alors le WOULD_MUTATE n'est jamais observé — voir
   compromis ci-dessous).
2. **Replay** (`replay.ts`'s `ReplayRunner`) a besoin d'un callback par version (référence +
   candidate) qui invoque l'assistant éphémère correspondant et retourne un `ReplayOutcome`
   structuré (`ok`, `outputShape`, `score`, `toolsCalled`, `unsafeActions`, `latencyMs`,
   `costUsd`). Le score n'a pas d'équivalent aujourd'hui hors contexte benchmark/judge — soit
   on l'appelle nul honnêtement (comme le fait le code retiré), soit on route par un juge
   dédié (coût supplémentaire, à décider).
3. **Coût** : chaque input de corpus devient un run LLM RÉEL et FACTURÉ. Avant de câbler quoi
   que ce soit ici, il faut une autorisation explicite d'un run facturé — ce n'est pas
   implicite dans "livrer la feature".
4. **Provisioning/nettoyage de l'assistant éphémère** : qui le crée, quand, et qui le détruit
   après le shadow/replay — `ensureCandidateAssistant` doit documenter son propre cycle de vie
   (sinon chaque shadow/replay laisse un assistant Studio orphelin, même problème que
   `deleteCopilotAssistant` résout déjà pour le cycle de vie normal d'un copilot).

Tant que ces quatre points ne sont pas résolus et explicitement autorisés (facturation), les
routes restent fixture-only PAR CONCEPTION, pas par oubli.

## Pourquoi le live E2E est bloqué (les trois raisons, aucune contournée)

1. **Migrations `0034`/`0035` non appliquées sur gpu1.** Elles existent sur disque, sont
   prouvées correctes offline (deux tests reproduisent en mémoire la sémantique exacte de
   l'index partiel), mais gpu1 est une infrastructure PARTAGÉE — une autre session travaillait
   dessus en simultané pendant cette mission (branches `feat/autonomous-factory-001` et
   `feat/deterministic-evidence-001` constatées actives dans des worktrees voisins). Appliquer
   des migrations sur une base partagée exige une PR dédiée et une revue, pas un appel SQL
   ad hoc depuis un script de preuve. Tentative réelle documentée : `createCopilotFromManifest`
   échoue avec `PGRST204 — Could not find the 'requires_shadow_replay' column of 'copilots'
   in the schema cache` contre gpu1 en l'état actuel.
2. **L'Agent Server LangGraph n'est pas confirmé joignable** depuis l'environnement où cette
   preuve tournerait — nécessaire de toute façon uniquement pour un chemin non-fixture (voir
   section précédente), pas pour la preuve fixture elle-même, mais documenté ici car la
   mission demande une preuve E2E complète, pas partielle.
3. **Aucune autorisation de run facturé n'a été donnée.** Le chemin fixture reste $0 par
   construction ; un vrai run LLM (même pour un seul input de corpus) est un coût réel qui
   nécessite un accord explicite, jamais supposé.

`scripts/prove-shadow-replay-e2e.ts` est écrit et prêt (utilise les vraies fonctions `POST`/
`GET` exportées par les routes — même code que Next.js invoque pour une requête HTTP réelle,
pas un raccourci) mais n'a **jamais été exécuté avec succès contre gpu1** ; il échoue
aujourd'hui exactement au point (1) ci-dessus. Le live E2E sera exécuté sur la branche
d'intégration une fois les migrations revues+appliquées, LangGraph mis à disposition
contrôlée, et les appels facturés explicitement autorisés — pas avant.

## Fichiers

**Nouveaux** : `supabase/migrations/0034_shadow_replay_lifecycle.sql`,
`supabase/migrations/0035_promotion_policy_versioning.sql`,
`src/lib/agent-mission-control/promotion-policy.ts`,
`src/lib/agent-mission-control/shadow-replay-routes-shared.ts`,
`src/app/api/agent-ops/copilots/[copilotId]/versions/[versionId]/shadow/route.ts`,
`src/app/api/agent-ops/copilots/[copilotId]/versions/[versionId]/replay/route.ts`,
`tests/unit/shadow-replay-routes.test.ts`, `tests/unit/shadow-replay-routes-gaps.test.ts`,
`tests/unit/promotion-policy.test.ts`, `scripts/prove-shadow-replay-e2e.ts`,
`docs/visual-reviews/AIGENT-FACTORY-SHADOW-REPLAY-001/`.

**Modifiés** : `src/app/api/agent-ops/copilots/[copilotId]/promotion/route.ts` (utilise
`resolvePromotionPolicy`), `src/lib/agent-mission-control/authoring-writes.ts` (nouveaux
copilots → `requires_shadow_replay: true`), `src/app/admin/agents/[id]/release/page.tsx`
(fix filtre `candidate_version_id` + intégration `ProofActions`),
`src/components/agent-ops/agent-detail/promotion-evidence-panel.tsx` (`'use client'` +
`ProofActions`), `tests/unit/promotion-status.test.ts` (mock ajusté).

**Non touchés** : migrations `0001`-`0033`, `release-gate.ts`, les runners tests/benchmark
(sauf aucune modification — vérifié), tout fichier appartenant aux sessions concurrentes
(`test-runner.ts`, `benchmark-runner.ts`, `evidence/`, `0037`, `0040` — laissés strictement
intacts, jamais commités depuis cette branche).

## Preuves offline

- `npx vitest run --project unit tests/unit` → 112 fichiers, 1357 tests, tous verts (worktree
  dédié `Aigent-sr001`, isolé des sessions concurrentes).
- `npm run check` → vert intégralement (typecheck, lint, `check:ds`, `check:catalyst`,
  `check:agent-truth`, `check:danger`, `check:render-truth`, `check:status-truth`,
  `check:registry-parity`, `check:registry-integrity`, `audit:dead`).
- `npm run check:catalyst` / `check:ds` re-vérifiés isolément après les changements UI.

## Limites connues, honnêtement listées

- Live E2E non exécuté (voir section dédiée ci-dessus) — c'est LE gap qui motive le verdict
  PARTIAL, pas un détail secondaire.
- Réconciliation replay : `persistReplayComparison` insère toujours une nouvelle ligne ; la
  route réconcilie sur la ligne réservée par un PATCH + DELETE best-effort de la ligne
  excédentaire. Un crash entre le PATCH et le DELETE laisse une ligne orpheline en statut
  terminal (jamais `queued`/`running`, donc jamais un risque de concurrence) — dette mineure,
  pas une faille de correction.
- Shadow/replay non-fixture : voir la section `ensureCandidateAssistant` ci-dessus — refusé
  explicitement (501), pas simulé.
