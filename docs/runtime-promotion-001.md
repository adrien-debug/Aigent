ARCHIVED — historical state, not current doctrine

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

> **⚠️ Correction de vérité (voir « Rework post-revue » en fin de doc).** La formulation
> initiale « ni écriture directe ni RPC ne contourne » (plus bas) était **inexacte** pour
> l'écriture directe : jusqu'à la migration `0032`, le rôle applicatif `service_role`
> (`BYPASSRLS=t`, `UPDATE` direct sur `copilots`/`copilot_versions`) pouvait flipper un copilot
> en `active`/`production` **sans passer par la RPC**, en SQL comme via PostgREST. La garantie
> réellement prouvée avant `0032` portait sur la **RPC** (elle refuse une preuve absente/périmée),
> pas sur **toute écriture directe**. `0032` ferme ce trou au niveau DB (trigger de transition).

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

## Preuves (réel vs fixture vs non prouvé)

### Anti-bypass DB — PROUVÉ LIVE (transaction rollback, zéro effet réel)
Contre gpu1, dans une transaction annulée :
| Cas | Résultat |
|---|---|
| RPC sans gate évaluation | **REFUSED** — "no fresh passing gate evaluation" |
| RPC avec gate fraîche + PASS | **ACCEPTED** — le handshake persist→RPC fonctionne |
| RPC avec gate périmée (2h > TTL) | **REFUSED** — le TTL est relu au moment T |
Après rollback : version toujours `draft`, 0 ligne temporaire. Ni écriture directe,
ni RPC, ni preuve périmée n'atteint ACTIVE.

### PromotionGate — PROUVÉ LIVE (lecture seule)
`evaluatePromotionGate('copilot-market-intelligence', <candidate>)` → overall FAIL
(2 release checks échouent), runtime PASS (langgraph), tools PASS (5 certifiés),
shadow/replay NOT_CONFIGURED. Honnête : bloque une version non prouvée.

### Shadow — PROUVÉ LIVE (fixture déterministe, coût 0)
`runShadowExperiment` sur `count_words` (2 inputs) → verdict PASS, 0 would-mutate,
persisté dans `shadow_experiments` (PASS|0|2). Aucun appel LLM facturé.

### Tests (fixtures déterministes, offline)
`promotion-gate.test.ts` (23) + `runner-lifecycle-guard.test.ts` (5) = 28 tests
non-contournement, zéro réseau : phantom tool→FAIL, engine:none→FAIL, test rouge→
FAIL, benchmark absent→INSUFFICIENT, replay WORSE→FAIL, replay INCONCLUSIVE→
INSUFFICIENT, shadow mutating→WOULD_MUTATE bloqué jamais exécuté, version archivée→
run refusé, evidence_hash change quand la preuve change, télémétrie sans secret.

### Distinction honnête
- **Runtime réellement exécuté** : la RPC durcie + le PromotionGate + le shadow
  `count_words` + la garde lifecycle — tous exécutés contre gpu1 réel.
- **Simulation déterministe de test** : le `runAgent`/`FixtureModelAdapter` injecté
  (count_words) pour prouver shadow/replay sans coût. C'est du vrai code d'outil,
  mais le "modèle" est scripté, pas un LLM.
- **Présent mais non prouvé avec un fournisseur payant** : un run agent COMPLET
  de bout en bout (OpenAI/Google) — volontairement NON exécuté (§8, non-objectif
  "pas de run facturé"). Le câblage runner→gate→lifecycle est prouvé par les
  chemins ci-dessus, pas par un run LLM facturé.

Détail au fil des phases ci-dessus.

---

## Rework post-revue (SHA `74257ea` → migrations 0030–0032)

La revue du SHA `74257ea` a validé la CI et la plupart des corrections, mais a trouvé **7 défauts
anti-bypass** (fermés par `0030`+`0031`, cf. `docs/agent-factory-readiness.md`) **plus deux
contournements DB restants**, corrigés par la migration **`0032`** et prouvés live contre gpu1.

### Modèle de rôle réel (vérité de terrain)

| Fait | Valeur (gpu1) |
|---|---|
| Rôle DB de l'app (JWT `role`) | **`service_role`** |
| `service_role.rolsuper` / `rolbypassrls` | `f` / **`t`** (RLS inutile contre lui) |
| Grants `service_role` sur `copilots`/`copilot_versions`/`promotion_gates` | full CRUD (dont **`UPDATE`**) |
| Owner de la RPC `promote_copilot_version` (security definer) | `postgres` |
| `search_path` de la RPC / du trigger (avant 0032) | **absent** (défaut) → fixé `pg_catalog, public` |

### REWORK 2 — écriture directe `service_role` (P0, Cas A : elle fonctionnait)

**Prouvé AVANT 0032** : `set role service_role; update copilots set status='active', production_version_id=… ` → `UPDATE 1` ; et `PATCH /copilots {status:active}` via PostgREST → **HTTP 200**, copilot `active`. L'affirmation « la DB refuse une écriture directe » était donc fausse.

**Correctif (`0032`)** — un trigger `BEFORE UPDATE` sur `copilots` et `copilot_versions`
(`enforce_promotion_via_rpc`) refuse toute transition **vers** `status='active'` /
`stage='production'` / un repoint direct de `production_version_id`, **sauf** quand la RPC officielle
a posé le GUC transaction-local `app.promotion='rpc'` (`SET LOCAL`, invisible hors de sa propre
transaction). **BYPASSRLS ne contourne PAS un trigger**, donc `service_role` est bloqué en direct,
mais la RPC (qui pose le GUC) passe. Le trigger est chirurgical : tout autre `UPDATE` (assistant_id,
latest_version_id, updated_at, un statut non-live) passe.

**Prouvé APRÈS 0032 (live gpu1, agent jetable nettoyé) :**

| Cas | Attendu | Résultat |
|---|---|---|
| SQL direct `update … stage='production'` | refusé | `insufficient_privilege` |
| SQL direct `update … status='active'` | refusé | `insufficient_privilege` |
| SQL direct `production_version_id=…` | refusé | `insufficient_privilege` |
| **PostgREST** `PATCH {status:active,…}` | refusé | `42501` (**HTTP 403**) |
| `updated_at` bénin | passe | `UPDATE 1` |
| RPC sans gate fraîche | refusé | `23514` (400) |
| RPC **avec gate fraîche** | accepté | **204 → active/production** |
| rollback officiel vers `archived` | accepté | 204 → production |
| état après refus | cohérent | reste `draft`, 1 seule production |

### REWORK 1 — TTL contrôlé par l'appelant

**Avant** : `p_max_evidence_age_seconds` était utilisé verbatim → un appelant direct passant
`999999999` réutilisait une preuve vieille de plusieurs heures.

**Correctif (`0032`)** — la RPC applique une **borne serveur dure** `c_max_ttl_seconds = 3600` :
`v_ttl := least(coalesce(nullif(p_max_evidence_age_seconds,0), 3600), 3600)`, et une valeur
`NULL`/`≤0` retombe fail-closed sur le max. L'appelant ne peut que **raccourcir** la fenêtre.
La comparaison utilise `now()` (horloge DB), jamais une date fournie par le client.

**Prouvé APRÈS 0032 (live) :** gate vieille de 2h + `TTL=999999999` → **refusé** (« within 3600 s ») ·
`TTL=-1` et `TTL=0` → **refusé** (fail-closed) · gate rafraîchie → **accepté**. Un seul overload
existe (pas de signature historique à TTL libre) ; PostgREST n'offre aucun appel alternatif.

### Vérifications complémentaires

- **Tie-break déterministe** : la lecture de la dernière éval fait `order by last_evaluated_at desc, id desc` — deux `last_evaluated_at` égaux ne rendent pas « la dernière » ambiguë.
- **Horloge DB** : la fraîcheur compare à `now()` DB ; aucune date client n'entre dans le calcul.
- **`search_path` sûr** : RPC + trigger épinglés `pg_catalog, public` (anti-détournement de résolution).

### Frontière de confiance (garantie RPC vs garantie contre toute écriture)

La garantie fermée par `0032`+`0033` est : **aucune transition `active`/`production` sans passer par
la RPC, qui exige une gate `ready/PASS` fraîche (≤3600 s) persistée pour la (copilot, candidate)
exacte.** Elle n'est PAS « `service_role` ne peut pas forger une preuve » : `service_role` détient
`INSERT` sur `promotion_gates` (nécessaire à `persistGateEvaluation`, le chemin légitime), donc un
détenteur de la clé service-role peut insérer une gate PASS pour un copilot réel puis appeler la
RPC. Distinguer une insertion de preuve légitime d'une malveillante au niveau DB exigerait un
**rôle d'écriture de preuves séparé** des tables de lifecycle (durcissement futur, hors scope de
ce rework). Rôles autorisés à écrire les preuves aujourd'hui : `service_role` uniquement (INSERT
sur `promotion_gates`), via `persistGateEvaluation`.

---

## Rework 2 (P0) — le GUC de 0032 était FORGEABLE → séparation de privilèges (`0033`)

### ⚠️ Correction de vérité

La description de `0032` ci-dessus affirmait que le marqueur `app.promotion='rpc'`, posé en
`SET LOCAL`, « ne peut pas être pré-posé par un appelant direct ». **C'était FAUX.** `SET LOCAL` /
`set_config(..., true)` limite la portée de la valeur à la transaction, mais **ne réserve pas la
valeur à la RPC** : `service_role`, qui contrôle entièrement sa propre transaction, peut poser le
marqueur lui-même. Un GUC de session est une **valeur déclarative contrôlée par l'appelant, pas une
autorité**.

**Exploit reproduit live (gpu1, rôle réel `service_role`, agent jetable) :**
```sql
set role service_role;
select set_config('app.promotion','rpc',true);          -- forged = 'rpc'
update copilot_versions set stage='production' where …;   -- AVANT 0033 : UPDATE 1
update copilots set status='active', production_version_id=… where …; -- UPDATE 1
```
→ copilot `active`/`production` **sans la RPC**. Via PostgREST le vecteur direct était déjà refusé
(chaque requête = sa propre transaction, `set_config` non exposé), mais l'accès SQL direct
(scripts, pool) contournait la garantie. Le P0 était réel.

### Correctif — une frontière que `service_role` ne peut pas simuler

`0033` remplace le GUC par une **séparation de privilèges** :

1. **Rôle protégé** `aigent_promotion_executor` : `NOLOGIN NOINHERIT NOBYPASSRLS`. `service_role`
   n'en est **pas membre** (prouvé : `pg_has_role('service_role','aigent_promotion_executor','MEMBER')=f`),
   donc — étant non-superuser — il **ne peut pas `SET ROLE`** vers lui (règle Postgres).
2. **La RPC est OWNED par ce rôle** et reste `SECURITY DEFINER` → à l'intérieur de la RPC,
   `current_user = aigent_promotion_executor`.
3. **Le trigger de garde est `SECURITY INVOKER`** (défaut — surtout PAS `security definer`, qui
   ferait de `current_user` le *propriétaire de la fonction*, piège explicite). Il observe le rôle
   **effectif réel** de l'`UPDATE` et n'autorise que `current_user = 'aigent_promotion_executor'`.
   **Plus aucun GUC n'est consulté.**
4. **Défense en profondeur au niveau colonne** : `REVOKE UPDATE(status, production_version_id)` sur
   `copilots` et `UPDATE(stage)` sur `copilot_versions` à `service_role` (re-grant de toutes les
   autres colonnes). Un `UPDATE` direct de `service_role` sur ces colonnes → `permission denied`
   **avant même** d'atteindre le trigger.
5. **RLS** : ces tables ont RLS activée sans policy (deny-all pour un rôle sans BYPASSRLS).
   `service_role` y accédait par `BYPASSRLS` ; l'executor **n'a pas `BYPASSRLS`** (interdit par la
   mission comme sécurité) — des policies **ciblant explicitement l'executor** l'autorisent, et lui
   seul, pour SELECT/UPDATE.
6. **Anti-shadowing** : l'executor n'a pas `CREATE` sur `public` ; `search_path=pg_catalog, public`
   épinglé sur la RPC et le trigger.

### Preuves APRÈS 0033 (live, rôle réel `service_role`, agents jetables nettoyés)

| Vecteur | Attendu | Résultat |
|---|---|---|
| `set_config('app.promotion','rpc',true)` **puis** UPDATE direct (SQL) | refusé | **`REFUSED: permission denied for table copilot_versions/copilots`** — état reste `draft` |
| PATCH PostgREST `{status:active}` | refusé | `42501` (**HTTP 403**) |
| PATCH bénin (`updated_at`, `assistant_id`) | passe | `204` |
| RPC officielle sans gate | refusé | `check_violation` |
| RPC officielle **avec gate fraîche** | accepté | **active/production** |
| rollback officiel vers `archived` | accepté | production |
| `service_role` membre de l'executor | non | `f` (ne peut pas SET ROLE) |
| `service_role` UPDATE(status / production_version_id / stage) | retiré | `has_column_privilege = f` |
| `service_role` / executor CREATE sur `public` | non | `f` (anti-shadowing) |
| owner + search_path de la RPC | executor + `pg_catalog, public` | ✓ |

### Sémantique TTL unique (code = tests = doc)

`0033` fige la sémantique : **`NULL` / `0` / négatif → erreur dure fail-closed** (`invalid
p_max_evidence_age_seconds`) ; **`1..3600` → utilisé tel quel** ; **`>3600` → borné à 3600**
(l'appelant ne peut que raccourcir). Prouvé live (NULL/0/-5 → erreur ; gate 2h + `999999999` →
refusé « within 3600 s » ; `1800` + gate fraîche → accepté). C'est un durcissement vs `0032` (qui
retombait silencieusement sur le max pour `≤0/NULL`).

### Consommateur migré / décidé

`scripts/provision-tradeagent-roster.mjs` `--activate` faisait un `PATCH copilots {status:'active'}`
**direct**, sans gate ni version production — un contournement. Depuis `0033` il échouerait
`permission denied` : il est désormais **désactivé explicitement** avec un message renvoyant vers le
chemin officiel (`/promotion`), au lieu de planter sur une erreur DB opaque. Aucun autre consommateur
runtime n'écrit ces colonnes : la route de promotion passe par la RPC ; création/provisioning
insèrent `draft`/`null` (INSERT, hors trigger) ; `seed-fixtures` s'appliquent comme `postgres`
(seed-amc.ts), pas comme `service_role`.
