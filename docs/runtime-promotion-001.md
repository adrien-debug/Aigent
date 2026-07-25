# AIGENT-RUNTIME-PROMOTION-001 — design + preuves

> Branche `feat/runtime-promotion-001` · base `496d0eb` · tag `recovery/pre-promotion-001`.
> Objectif : PromotionGate/Shadow/Replay = mécanismes RÉELLEMENT exécutés, pas des
> types/seed. Aucune promotion sans preuve persistée relue au moment T.

## Phase 1 — Matrice de vérité (état AVANT)

| Concept | Type | Seed | Persisté | Appelé runtime | Bloque promotion |
|---|---|---|---|---|---|
| PromotionGate | ✅ types.ts | ✅ seed-fixtures | table `promotion_gates` existe (0 lignes, jamais écrite) | ❌ | ❌ (release-gate.ts est le vrai bloqueur, mais ne persiste rien) |
| ShadowExperiment | ✅ types.ts | ✅ seed-fixtures | table `shadow_experiments` (0 lignes) | ⚠️ market/shadow.ts existe mais **spécifique trading**, pas générique agent | ❌ |
| ReplayComparison | ✅ types.ts | ✅ seed-fixtures | table `replay_comparisons` (0 lignes) | ❌ | ❌ |

**Ce qui EXISTE et marche déjà** (à ne pas réécrire) :
- `release-gate.ts` `evaluateReleaseGate` = 9 checks live (tests/benchmark/unsafe/…), `promotable = every pass`. Autorité applicative, appelée par UI + route promotion.
- Route `promotion/route.ts` : garde serveur fail-closed 422 si gate non verte, IDOR, rollback archived-only, RPC atomique.
- RPC `promote_copilot_version` (0027) : atomique, security definer, index partiel unique single-production (concurrent → 23505 → 409). **MAIS** écrit `status='active'` sans vérifier de preuve au niveau DB — le seul rempart est la route.

**Le trou** : une écriture directe (service_role) ou un appel RPC direct contourne la gate applicative. La table `promotion_gates` n'est jamais écrite → aucune preuve persistée relue au moment T.

## Décisions d'architecture

1. **Autorité unique = `promotion-gate.ts`** (nouveau) qui ENVELOPPE et étend `evaluateReleaseGate` :
   - relit au moment T : version candidate, manifest validé, runtime exécutable (registry/runtimes), outils résolus+certifiés (registry/tools), tests, benchmark, unsafe, draft, **+ shadow requis**, **+ replay requis**.
   - statuts : `PASS | FAIL | NOT_CONFIGURED | INSUFFICIENT_EVIDENCE`.
   - **persiste** une `gate_evaluation` (row `promotion_gates`) avec checks + hash de preuve + timestamp.
2. **Anti-bypass au niveau DB** : la RPC `promote_copilot_version` est durcie (nouvelle migration) pour EXIGER une gate_evaluation `ready` fraîche (< TTL) pour (copilot, version) AVANT de flipper `active`. Une preuve périmée ou absente → `raise exception`. Ainsi ni écriture directe ni RPC ne contourne.
3. **Shadow générique** (`shadow-runner.ts`) : exécute la candidate via un adapter, bloque tout outil `mutates=true` → `WOULD_MUTATE` journalisé, jamais exécuté. Zéro effet externe.
4. **Replay** (`replay-runner.ts`) : rejoue un corpus sur ref + candidate, compare, verdict `BETTER|EQUIVALENT|WORSE|INCONCLUSIVE`. Non-déterminisme étiqueté.
5. **Preuve sans run facturé** : `FixtureModelAdapter` déterministe (scripted tool calls → `count_words` certifié). Aucun appel OpenAI/Google.
6. **Télémétrie** : la colonne `status` a un CHECK `(started|completed|failed)` → j'ajoute une colonne `event_type` (nullable, sans CHECK) + `experiment_id`/`gate_evaluation_id` portés dans `environment` jsonb. 8 event types émis.

Détail au fil des phases ci-dessous.
