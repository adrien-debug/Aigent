# API manifest — inventaire exhaustif des 70 routes

> **Observation datée du 2026-07-31**, branche `mission/cockpit-catalyst-migration`.
> Document d'audit, **pas une règle** (`CLAUDE.md` §1). Le code fait foi.
> Méthode : lecture intégrale des 70 `src/app/api/**/route.ts` + `src/proxy.ts` +
> `auth.ts` + `bearer-token-auth.ts`. **Aucun appel HTTP réel n'a été effectué** :
> tous les codes listés sont lus dans le code, pas constatés sur le réseau.

## 0. Faits mesurés

| Mesure | Commande | Résultat |
|---|---|---|
| Routes totales | `find src/app/api -name route.ts \| wc -l` | **70** |
| Routes validant en Zod | `grep -rl "from 'zod'" src/app/api \| wc -l` | **12 / 70** |
| Routes traitant `isPgrestTimeout` → 504 | `grep -rln isPgrestTimeout src/app/api \| wc -l` | **54 / 70** |
| Routes émettant un 503 | `grep -rln 503 src/app/api \| wc -l` | **64 / 70** |
| Routes sans aucun `status:` explicite | balayage | **3** (`architect/resume`, `delivery-capability`, `registry`) |

**Matcher du proxy** : `['/api/agent-ops/:path*']` (`src/proxy.ts:46`). Les 10 routes de
`/api/auth/**`, `/api/runtime-telemetry` et `/api/runtime/v1/**` ne sont **jamais**
traversées par le proxy.

**Aucun appelant frontend.** `src/app/` ne contient que `layout.tsx` et `page.tsx` ;
`page.tsx` importe `getDashboardOverview` **en RSC**, sans HTTP. Aucun fichier de
`src/components/**` ne contient la chaîne `/api/`. Développé en §5.

---

## 1. Conventions transverses

- **Transport** : `pgrest()` / `pgrestUpsert()` / `pgrestWithCount()`. `requireBackend()`
  n'est **jamais appelé depuis une route** — il agit en profondeur (`postgrest.ts:80`,
  `authoring-writes.ts` ×6). Les 503 des routes viennent d'une garde d'env locale
  (`AMC_DATA_SOURCE !== 'gpu1' || !AMC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY`),
  répétée à la main dans chaque fichier.
- **Erreurs** : `isPgrestTimeout(err)` → 504, sinon 502, corps `{ error }` générique.
- **Quatre routes contournent `postgrest.ts`** avec un `fetch` brut **sans timeout** :
  `copilots/[copilotId]` PATCH, `tools/[toolId]`, `promotion` (`pgrestGet`), et les
  sondes d'existence de `builder/create-draft` / `builder/run`. Conséquence directe :
  **`isPgrestTimeout` ne peut jamais y déclencher un 504** — un timeout amont y devient
  502 ou remonte brut.
- **`null` ≠ 0** : `pgrestWithCount` rend `null` faute de `Content-Range`
  (`registry/route.ts` : « a null renders as an honest dash, never a fake zero »).

---

## 2. Inventaire par domaine

**AUTH** : `proxy` = `src/proxy.ts` (session HMAC **ou** `x-amc-key`) · `token:X` = jeton
propre · `aucune`. **Aucun des 60 handlers `/api/agent-ops/**` n'ajoute de second contrôle
d'identité** — c'est délibéré et documenté dans `team/route.ts`.

### 2.1 Copilots — cycle de vie (8 routes)

| Route | Méth. | Corps | Erreurs notables | Écrit | Verdict |
|---|---|---|---|---|---|
| `/copilots` | POST | **Zod** complet : `runtime: z.literal('langgraph')`, `slug` regex, `confirmationPolicy` enum, `superRefine` refusant un outil risqué sans `requiresConfirmation` | 400 · 409 slug · 404 projet (23503) · 502/504 | `copilots`,`manifests`,`tools`,`copilot_versions` | OPÉRATIONNELLE |
| `/copilots/[copilotId]` | PATCH, DELETE | manuel — `targetProjectIds` validé élément par élément (≤2, regex) | 400 · 404 · **502 `PostgREST ${res.status}`** | `copilots` | OPÉRATIONNELLE |
| `.../run` | POST | manuel, `userInput` ≤ 32 000 | **409 garde fail-closed** (statut ≠ `active`, `unresolvedToolIds`, runtime ≠ `langgraph`, double soumission, `VersionNotServingError`) · 503 (+`OPENAI_API_KEY`) | `agent_runs`,`agent_run_steps` | OPÉRATIONNELLE |
| `.../runs/[runId]/resume` | POST | manuel `approved: boolean` | 409 non-`needs-confirmation` · 409 `threadLost` · CAS PATCH anti-double-reprise | `agent_runs`,`tool_calls`,`agent_run_steps` | OPÉRATIONNELLE |
| `.../runs/ingest` | POST | **Zod** bornes 0..10 000 / coût 0..1000 | 409 sans version prod · 422 version non possédée · idempotence `client_run_id` | `agent_runs` | OPÉRATIONNELLE |
| `.../promotion` | POST | manuel `action: promote\|rollback` | 422 gate non verte · 409 concurrence · **RPC `promote_copilot_version`** | RPC atomique | OPÉRATIONNELLE |
| `.../qualification` | GET, POST | manuel + `?versionId` | 409 `not_a_candidate` · **`QualificationError.message` échoyé** | via orchestrateur | OPÉRATIONNELLE |
| `/copilots/provision-agent-builder` | POST | aucun | 503 · 502 · 504 | `copilots`,`manifests`,`tools`,`test_suites` | OPÉRATIONNELLE |

`run` ne recalcule **pas** le statut (il vient de `getAvailableAgent`) — conforme.
En revanche `runs/[runId]/resume` **recalcule** un statut terminal
(`budgetExhausted → failed`, `allBlocked ? (approved ? failed : blocked) : completed`)
et écrit `resolved_provider: 'openai'` **en dur**.

### 2.2 Copilots — qualification / amélioration (13 routes)

| Route | Méth. | Corps | Erreurs notables | Verdict |
|---|---|---|---|---|
| `.../benchmarks/run` | POST | manuel | 409 run en cours · 503 (+OpenAI) | OPÉRATIONNELLE |
| `.../benchmarks/sweep` | POST | manuel, `models` 1..8 | 400 · 409 · 503 | OPÉRATIONNELLE |
| `.../delivery-loop` | POST | manuel | 503 si `runSandbox` sans `GITHUB_TOKEN` | OPÉRATIONNELLE |
| `.../improve/analyze` | POST | manuel | 409 cycle ouvert (`Set` in-process + lecture DB) | OPÉRATIONNELLE |
| `.../improve/create-v2` | POST | manuel | **409 par regex sur le message d'erreur** | OPÉRATIONNELLE |
| `.../improve/decision` | POST | manuel enum | **409 par regex** · `status` échoie la requête, pas la base | OPÉRATIONNELLE |
| `.../skilltree` | POST | **Zod** `{confirm: z.literal(true)}.strict()` | 404 · 409 · 422 · **échoie `err.status` ET `err.message`** · **aucune garde d'env** | **PARTIELLE** |
| `.../target-sandbox` | POST | manuel | 503 `GITHUB_TOKEN` · **persistance best-effort avalée** | **PARTIELLE** |
| `.../target-sandbox/latest` | GET | — | 200 `{report:null}` si absent (jamais 404, documenté) | OPÉRATIONNELLE |
| `.../tests/generate` | POST | **corps jamais lu** | 409 `Set` in-process · 404 | OPÉRATIONNELLE |
| `.../tests/run` | POST | manuel (regex sur `suiteId`) | 409 run en cours · 503 | OPÉRATIONNELLE |
| `.../versions/[versionId]/replay` | POST, GET | manuel, `inputs`/`cases` **castés sans validation** | 422 `INSUFFICIENT_EVIDENCE` · 409 index unique (0034) · réconciliation de ligne double | **PARTIELLE** |
| `.../versions/[versionId]/shadow` | POST, GET | idem | 422 · 409 · pas de réconciliation (PATCH direct) | OPÉRATIONNELLE |

**Incohérence mesurée** : `copilotId` est validé par `/^[a-zA-Z0-9-]{1,100}$/` dans
`benchmarks/run` et `benchmarks/sweep`, mais par `/^[a-z0-9-]{1,200}$/` **partout ailleurs**.

**`replay` — dette réelle** : `persistReplayComparison` insère une **seconde** ligne ; la
route PATCHe le placeholder puis `DELETE` la ligne surnuméraire avec `.catch(() => {})`.
Un échec de suppression laisse **silencieusement une ligne orpheline** dans
`replay_comparisons`.

### 2.3 Projects (18 routes)

| Route | Méth. | Corps | Erreurs notables | Verdict |
|---|---|---|---|---|
| `/projects` | POST | **Zod** + 3 refines (slug/nom/longueur) | 409 slug · rollback 2 étages | OPÉRATIONNELLE |
| `/projects/[id]` | DELETE | — | 404 · cascade | OPÉRATIONNELLE |
| `/projects/[id]/copilots` | GET | — | 502/504 | **PARTIELLE** — `getCopilots()` complet puis filtre JS, + N+1 |
| `/projects/[id]/team` | GET | — | **500** si la réponse sortante échoue son propre Zod | OPÉRATIONNELLE |
| `/projects/[id]/missions` | POST | **Zod** `.strip()` | `mode` parsé puis **ignoré** au profit d'une constante | OPÉRATIONNELLE |
| `/projects/[id]/missions/latest` | GET | — | 200 `{mission:null}` si absent | OPÉRATIONNELLE |
| `/projects/[id]/relations` | POST | **Zod `.strict()`** | 422 endpoints hors projet · 409 unicité | OPÉRATIONNELLE |
| `/projects/[id]/relations/[relationId]` | DELETE | — | DELETE scopé `id` **ET** `project_id` (anti-IDOR) | OPÉRATIONNELLE |
| `/projects/[id]/repo/intelligence` | GET, POST | corps non lu | 503 `GITHUB_TOKEN` · dédup in-process | OPÉRATIONNELLE |
| `/projects/[id]/repo/scan` | POST | corps non lu | 409 `noRepo` | OPÉRATIONNELLE (non câblée, assumé) |
| `/projects/[id]/provision-consumer` | GET, POST | **Zod mais échec ignoré** | 422 sans repo · **aucune garde d'env** · `getProject` **hors try/catch** | **PARTIELLE** |
| `/projects/[id]/push-agent` | POST | **manuel** (`as T` sur le corps) | 422 sans `productionVersionId` · 409 conflit de ref | OPÉRATIONNELLE |
| `/projects/[id]/builder/message` | POST | manuel ≤ 12 000 + `?stream=1` | SSE : erreurs **en trame terminale**, jamais en code HTTP | OPÉRATIONNELLE |
| `/projects/[id]/builder/conversation` | GET | — | 404 pré-check (le GET **créerait** une ligne) | OPÉRATIONNELLE |
| `/projects/[id]/builder/create-draft` | POST | manuel lenient | 409 ×4 · classification **sensible à l'ordre des regex** | OPÉRATIONNELLE |
| `/projects/[id]/builder/preview/select` | POST | manuel ≤ 200 | 404 littéral (message jamais échoyé) | OPÉRATIONNELLE |
| `/projects/[id]/builder/resume` | POST | délégué | 409 `notProvisioned` · scan repo non fatal | OPÉRATIONNELLE (non câblée, assumé) |
| `/projects/[id]/builder/run` | POST | **hybride** : `userInput` manuel + `scan` en Zod borné | 409 `noRepo` / `notProvisioned` · scan client traité comme hostile | OPÉRATIONNELLE |

**`builder/message` est bien le gabarit SSE** : `wantsStream()`, `X-Accel-Buffering: no`,
heartbeat nettoyé en `finally` **et** dans `cancel()`, et `cancel()` appelle `abort.abort()`
— un client qui raccroche **arrête réellement le tour OpenAI** (le commentaire documente la
facturation qui continuait « après que le navigateur soit parti »). Un tour avorté n'émet
**aucune** trame terminale.

**Incohérence de contrat** : « projet sans repo GitHub » rend **400** (`push-agent`),
**409 + `noRepo:true`** (`repo/scan`, `builder/run`) et **422** (`provision-consumer`).

### 2.4 Agents, architect, GitHub, LangGraph, outils (22 routes)

| Route | Méth. | Auth | Externe | Verdict |
|---|---|---|---|---|
| `/agents` · `/agents/[copilotId]` | GET | proxy | — | OPÉRATIONNELLES |
| `/agent-drafts/[draftId]` | PATCH | proxy | — | OPÉRATIONNELLE |
| `/architect` | POST | proxy | **OpenAI payant**, 4096 tokens | **PARTIELLE** — `parsed as GeneratedManifest` sans validation |
| `/architect/run` | POST | proxy | LangGraph + OpenAI | OPÉRATIONNELLE |
| `/architect/resume` | POST | proxy | LangGraph + OpenAI | **PARTIELLE** — aucun `status:` propre |
| `/architect/runs/[id]` | GET | proxy | LangGraph | OPÉRATIONNELLE (UUID strict) |
| `/github/repos` | GET | proxy | GitHub | OPÉRATIONNELLE |
| `/github/tree` | GET | **Zod** query + refus `..` | GitHub | OPÉRATIONNELLE |
| `/github/file` | GET | **Zod** + denylist secrets → **403** | GitHub | **PARTIELLE** — denylist recopiée à la main |
| `/langgraph/*` (5 routes) | GET | proxy | LangGraph | OPÉRATIONNELLES |
| `/market-tools/[toolName]` | POST | proxy | handlers marché | OPÉRATIONNELLE |
| `/realestate-tools/[toolName]` | POST | proxy | handlers immobilier | **PARTIELLE** — pas de refus `fixtureScenario` |
| `/missions/[missionRunId]` | GET | proxy | — | OPÉRATIONNELLE |
| `/registry` | GET | proxy | — | OPÉRATIONNELLE (counts `null` fail-soft) |
| `/tool-build-missions` | GET,POST,PATCH | **Zod** sur POST | pipeline build | **PARTIELLE** — PATCH échoie `err.message` |
| `/tools/[toolId]` | PATCH | proxy | — | OPÉRATIONNELLE (refuse le downgrade de confirmation) |
| `/delivery-capability` | GET | proxy | env | **PARTIELLE** — aucun `status:` propre |

**Bridges d'outils — aucun traversal.** `market-tools` et `realestate-tools` dérivent leur
allow-list **du handler set lui-même** (`new Set(TRADING_TOOL_IDS)` /
`REALESTATE_TOOL_IDS`), jamais d'une liste recopiée — le commentaire documente l'incident
de dérive qui a motivé ce choix. Segment inconnu → 404. `market-tools` refuse en plus
`fixtureScenario` (400) ; **`realestate-tools` ne le fait pas** : asymétrie réelle.

`/github/file` bloque le traversal (`p.includes('..')` → **403**) et une denylist de
secrets (`.env`, `.pem`, `id_rsa`, `.key`, `credentials`, `.pfx`, `.p12`), mais cette
denylist est **une copie manuelle** de celle de `src/langgraph/tool-registry.mjs`, avec un
commentaire « keep in sync by hand ». La route n'est **pas** restreinte au repo du projet :
elle lit **tout repo visible par le token**.

### 2.5 Hors `/api/agent-ops/**` — 9 routes à défense propre

| Route | Méth. | Credential | Erreurs | Verdict |
|---|---|---|---|---|
| `/api/auth/login` | POST | **aucune** (allow-list du proxy) | 503 `!authConfigured()` · **429** (10 tentatives / 5 min / IP, ≤10 000 clients suivis) · 400 · 401 | OPÉRATIONNELLE |
| `/api/runtime-telemetry` | POST | `AIGENT_RUNTIME_TELEMETRY_TOKEN` | **413** > 16 Ko · 400 Zod `.strict()` · 400 motif de secret · 401 · 503 · **202** · 202 sur doublon | OPÉRATIONNELLE |
| `/runtime/v1/agents` | GET | `AIGENT_RUNTIME_API_TOKEN` | 401/503 · 503 catalogue | OPÉRATIONNELLE |
| `/runtime/v1/agents/[agentId]` | GET | idem | 400 · 404 | OPÉRATIONNELLE |
| `/runtime/v1/agents/[agentId]/runs` | POST | idem | 400 (`input` ≤ 32 000) · 409 non exécutable · idempotence | OPÉRATIONNELLE |
| `/runtime/v1/projects/[projectKey]/agents` | GET | idem | 400 · 503 | OPÉRATIONNELLE |
| `/runtime/v1/runs/[runId]` | GET | idem | 404 · 504/502 | OPÉRATIONNELLE |
| `/runtime/v1/runs/[runId]/events` | GET | idem | 404 · pas de pagination | OPÉRATIONNELLE |
| `/runtime/v1/runs/[runId]/resume` | POST | idem | **501 systématique** — aucun chemin 2xx | **MORTE (par conception)** |

`/runtime/v1/runs/[runId]/resume` **n'a aucune réponse de succès** : elle rend 404 si le run
n'existe pas, **501** s'il existe (« resume not supported: runtime/v1 runs are synchronous »).
C'est la seule route du repo sans chemin nominal. Effet de bord : le couple 404/501 est un
**oracle d'existence** de run pour tout porteur du jeton runtime.

Extraction et comparaison constant-time mutualisées dans `bearer-token-auth.ts` (cap 512).
`timingSafeEqual` **retourne tôt sur longueur inégale** : la longueur du jeton fuit par
timing, pas son contenu. **Aucune valeur de jeton n'est partagée** entre les trois frontières.

---

## 3. Risque signalé n°1 — routes mutantes hors `/api/agent-ops/**`

Quatre routes mutantes vivent hors du matcher. **Aucune n'est un trou** :

| Route | Auth propre | Constat |
|---|---|---|
| `/api/auth/login` | non — **par conception** | Surface qui *délivre* l'identité ; ne peut pas l'exiger. Défendue par `authConfigured()` (503), limiteur par IP (429), 400, 401. |
| `/api/runtime-telemetry` | `AIGENT_RUNTIME_TELEMETRY_TOKEN` | 16 Ko, Zod strict, scan de secrets, **zéro écho**. |
| `/runtime/v1/agents/[agentId]/runs` | `AIGENT_RUNTIME_API_TOKEN` | Auth avant toute lecture backend. |
| `/runtime/v1/runs/[runId]/resume` | `AIGENT_RUNTIME_API_TOKEN` | Ne mute rien (501). |

**Verdict : aucun trou d'authentification.** Toute route mutante est sous le matcher, ou
porte son propre jeton, ou est la surface d'authentification elle-même.

**Nuance obligatoire — le fail-closed est « en production ».** `auth.ts` :
`isDev()` vaut `process.env.NODE_ENV !== 'production'` — donc **`NODE_ENV` non défini
active les fallbacks**. `authConfigured()` rend `true` **inconditionnellement en dev**.
Fallbacks : `DEV_FALLBACK_SESSION_SECRET` et `DEV_FALLBACK_ADMIN_PASSWORD = 'Admin'`.
**En développement, sans `AMC_SESSION_SECRET`, une session est frappable via
`POST /api/auth/login`**, ce qui ouvre ensuite les 60 routes `/api/agent-ops/**`.

`decodeSession()` vérifie la signature **avant** de parser la charge utile, dans un
try/catch : cookie forgé → `null`, jamais d'exception (le commentaire enregistre la
régression passée où `timingSafeEqual` levait un `RangeError`, transformant un refus en
500 et court-circuitant le repli `x-amc-key`). Cookie `amc_session`, HMAC-SHA256,
TTL 12 h, `httpOnly`, `SameSite=Lax`, `Secure` **seulement** en production.
**Aucune révocation** : un cookie signé reste valide ses 12 h.

**Écart code/commentaire relevé** : `auth.ts` commente « Password matches the .env.local
default (hearst-agent-mc-2026) » alors que la constante vaut `'Admin'`.

---

## 4. Risque signalé n°2 — doubles verrous shipping

**`push-agent`** — le verrou est **conjonctif sur une seule ligne** (`route.ts:163`) :

```ts
const dryRun = !(body.confirm === true && process.env.GITHUB_PUSH_ENABLED === '1')
```

Ceinture et bretelles : `github.ts` recalcule `const wouldPush = !dryRun && pushArmed()`
avec `pushArmed()` = `GITHUB_PUSH_ENABLED === '1'` — **la variable est vérifiée deux fois**.
En dry-run, seuls des GET s'exécutent (`getDefaultBranch`, `scaffoldHostRegistry`) afin que
`PushResult.files` liste exactement ce qu'une vraie poussée écrirait ; aucun appel mutant.
Avec `confirm:true` mais `GITHUB_PUSH_ENABLED ≠ '1'`, l'appelant reçoit **200 + reçu de
dry-run**, et rien n'est persisté (`delivery_events` n'est écrit que si
`result.pushed === true && result.dryRun === false`).

**`provision-consumer`** — même garantie, mais **répartie sur deux fichiers** : la route ne
calcule que `dryRun: !confirm`, et le second verrou vit dans `github.ts:55`. La conjonction
tient, sa **lisibilité** non.

**Défaut réel de `provision-consumer`** (vérifié ligne à ligne) : le corps est parsé en Zod
mais **un échec de `safeParse` ne rend pas 400** — `if (parsed.success)` seulement, sinon les
défauts dry-run sont conservés silencieusement. La route n'a **aucune garde d'env**, et
`getProject(id)` est appelé **hors de tout try/catch** : une panne PostgREST y produit un
**500 non maîtrisé** au lieu du 502/504 de ses jumelles. C'est la route d'écriture la plus
faiblement validée du lot.

`/api/agent-ops/delivery-capability` expose `realDeliveryEnabled` sans détailler quelle
précondition manque — délibéré, pour ne pas révéler quel secret est absent.

---

## 5. Risque signalé n°3 — routes sans appelant

**Fait mesuré** : aucun fichier de `src/components/**` ni `src/app/*.tsx` ne contient
`/api/`. Les seuls appelants in-repo sont des **scripts** (`run`, `runs/:runId/resume`,
`copilots`) et des **tests** qui importent le handler directement, sans HTTP (≈18 routes).

**Interprétation honnête** : ces routes ne sont pas « mortes » au sens de code inatteignable.
Elles sont le **contrat HTTP d'un produit dont le front a été réinitialisé**
(`AGENTS.md` § Frontend) et dont les consommateurs sont **externes** (produits
consommateurs, LangGraph Agent Server via `x-amc-key`, scripts d'exploitation). Un audit
de couverture in-repo **ne peut pas prouver** qu'une route est morte.

Je classe donc :

- **MORTE : 1 seule** — `/api/runtime/v1/runs/[runId]/resume`, qui n'a aucun chemin de
  succès dans son propre code (501 systématique). C'est un fait de code, pas d'usage.
- **Non câblées mais assumées** — `architect/runs/[id]`, `projects/[id]/repo/scan`,
  `projects/[id]/builder/resume`, `projects/[id]/builder/run` portent toutes un en-tête
  déclarant explicitement « NOT-WIRED to the front, kept as an `x-amc-key` capability ».
  Intentionnel, pas une dérive.
- **Sans preuve d'exécution : ≈52 routes** — ni test, ni script, ni appelant.

---

## 6. Les cinq risques majeurs

1. **Session frappable en développement.** `isDev()` = `NODE_ENV !== 'production'`, donc
   `NODE_ENV` **non défini** suffit ; `authConfigured()` rend `true` sans condition et le
   mot de passe de repli est `'Admin'`. Un `POST /api/auth/login` délivre alors un cookie
   valide 12 h, non révocable, qui ouvre les **60** routes `/api/agent-ops/**`. Inerte en
   production, réel en local.
2. **`provision-consumer` — écriture GitHub à validation défaillante.** Échec Zod
   silencieusement ignoré, **aucune garde d'env**, `getProject` hors try/catch (500 non
   maîtrisé). C'est la seule route mutante distante dont le corps n'est pas réellement
   refusé quand il est invalide.
3. **58 routes sur 70 valident à la main**, et quatre contournent `postgrest.ts` par un
   `fetch` **sans timeout** — donc sans 504 possible. S'y ajoute la classification d'erreurs
   **par regex sur des messages** (`improve/create-v2`, `improve/decision`, `promotion`,
   `create-draft`) : un simple reformulage côté lib transforme un 409 en 502.
4. **Trois routes échoient de l'amont.** `skilltree` renvoie `err.status` **comme statut
   HTTP** et `err.message` dans le corps (aucun clamp de plage, et cette route n'a **aucune
   garde d'env**) ; `tool-build-missions` PATCH renvoie `err.message` ; deux routes
   renvoient `PostgREST ${res.status}`. Contraire à la convention de corps générique.
5. **Aucune preuve d'exécution pour ~52 routes.** Un typecheck vert ne prouve pas qu'une
   route répond 200/401/503 comme annoncé (`CLAUDE.md` §7). La preuve reste un appel HTTP
   réel sur le dev (port 3987), plus la gate concernée.

**Anomalie de données à surveiller** : `replay` supprime sa ligne surnuméraire avec
`.catch(() => {})` — un échec laisse une orpheline **silencieuse** dans
`replay_comparisons`, exactement le régime « non atomique » que `improvement-loop.ts`
documente honnêtement et que celui-ci ne documente pas.

---

## 7. Ce que ce document NE prouve pas

- **Aucun appel HTTP n'a été passé.** Tous les codes sont lus, pas constatés.
- Les tables citées le sont quand elles étaient visibles dans la route ou dans la fonction
  appelée ; ailleurs la mention reste générique plutôt qu'inventée.
- OPÉRATIONNELLE = « le code est cohérent et complet pour son contrat », **jamais**
  « vérifiée en exécution ».
