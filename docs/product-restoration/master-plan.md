# Master plan — restauration produit d'Aigent

> **Nature** : plan de travail daté du 2026-07-31, branche `mission/product-restoration`
> @ `a1f6193`. Ce n'est **pas** de la doctrine (`CLAUDE.md` §1) : c'est un plan
> d'exécution dérivé des cinq manifestes de `docs/product-restoration/`. En cas de
> contradiction avec le code, le code a raison et c'est ce plan qu'on corrige.
>
> **Public** : un sous-agent doit pouvoir prendre **une section de surface** et
> l'implémenter sans relire les cinq manifestes. Chaque section est donc
> autoportante : routes, endpoints nommés, composants, états, tests, définition de
> fini.
>
> **Sources** : `api-manifest.md` (70 routes), `data-manifest.md` (couche données),
> `ui-manifest.md` (front réel), `test-manifest.md` (gates et tests),
> `capability-matrix.md` (21 étapes du parcours).

---

## 0. Le point de départ, en cinq faits

1. **Le front n'appelle aucune route API : 0 sur 70.** `page.tsx` lit PostgREST en
   RSC via `getDashboardOverview`. Les 70 routes sont pilotées par des scripts et
   des consommateurs externes, jamais par l'écran.
2. **2 routes UI existent** (`/` et le layout). 7 des 8 cibles manquent.
3. **9 des 10 liens de la file d'action mènent à un 404** (`/admin`, supprimé au
   reset du front et interdit par `check:no-legacy-front`).
4. **`npm run check` exit 0, `npm test` exit 0 (1721 tests) — et rien ne prouve
   qu'un écran s'affiche.** Aucun test navigateur, aucune capture, aucun DOM.
5. **Le produit est intégralement pilotable par curl, et par rien d'autre.** Le
   cockpit est en lecture pure : `button.tsx` du kit Catalyst n'est importé nulle
   part, et les 9 composants de formulaire sont dormants.

### Incohérences entre manifestes — relevées et tranchées

Le mandat demande de signaler tout écart entre les cinq audits. Trois trouvés :

| # | Écart | Arbitrage (vérifié dans le code ce jour) |
|---|---|---|
| I1 | `capability-matrix.md` §Télémétrie écrit « je n'ai pas interrogé la base gpu1 — l'affirmation *zéro ligne consumer* reste celle de `known-gaps.md`, non revérifiée ». `data-manifest.md` §3 l'affirme à partir d'une **interrogation live réelle** (38 événements, sources `aigent-internal-runner`/`aigent-shadow`/`aigent-promotion`/absent) | **Le fait tient, doublement établi** : lecture de code (4 émetteurs, tous internes) **et** comptage live. C'est le seul fait de ce plan prouvé par les deux méthodes. |
| I2 | `ui-manifest.md` §9 compte **11 modules `'use client'`** ; `test-manifest.md` §4 rapporte la gate `check:rsc-boundary` annonçant **46 composants client** | Pas une contradiction : `ui-manifest` compte les **fichiers portant la directive** dans `src/components/**`, la gate compte les **modules du graphe client** (directive + tout ce qu'ils importent, y compris `node_modules`). Les deux sont vrais. **Ne pas « corriger » l'un vers l'autre.** |
| I3 | Le mandat de mission énonce « release-gate.ts ~121 `unsafeActionCount ?? 0` → faux vert de promotion ». `data-manifest.md` §5 range `release-gate.ts:100` (`passRate ?? 0`) dans la même famille | **Distinction à faire, vérifiée ligne à ligne ce jour** — les deux `?? 0` n'ont pas le même effet, et un seul est un faux vert. Voir F1 ci-dessous. C'est la correction la plus importante du plan. |

---

## 1. Corrections PRÉALABLES — la fondation (PR 0)

Ces corrections ne créent aucun écran. Elles rendent le terrain sûr pour les sept
PR suivantes. **Aucune surface ne doit être construite avant qu'elles soient
passées** : plusieurs d'entre elles changent le contrat que les écrans vont lire.

### F1 — `release-gate.ts` : le faux vert de promotion (CRITIQUE)

**Fait vérifié dans le code, pas repris d'un manifeste.** Les deux coercions
n'ont pas le même effet et le mandat de mission les confond :

```ts
// ligne 100 — passRate ?? 0 → FAIL-SAFE, pas un faux vert
return { id: run.id, passRate: (run.pass_rate as number) ?? 0, ... }
// consommé ligne 201 : status: testRun ? (testRun.passRate >= 1 ? 'pass' : 'fail') : 'missing'
// un pass_rate null devient 0 → 0 >= 1 est faux → 'fail'. Bloque. Valeur mensongère
// affichée ("0 %" là où la vérité est "non mesuré"), mais décision sûre.

// lignes 124-125 — VRAI FAUX VERT
unsafeActionCount: (r.unsafe_action_count as number) ?? 0,
confirmationMistakeCount: (r.confirmation_mistake_count as number) ?? 0,
// consommé lignes 231 et 240 :
status: benchmark ? (benchmark.unsafeActionCount === 0 ? 'pass' : 'fail') : 'missing',
// un unsafe_action_count NULL (non mesuré) devient 0, et 0 === 0 → 'pass'.
// Un compteur de sécurité JAMAIS MESURÉ produit un FEU VERT de promotion.
```

**C'est la violation la plus dangereuse du repo** : elle transforme une absence de
mesure de sécurité en preuve d'innocuité, sur le chemin qui autorise une mise en
production. `score` / `accuracy` / `taskSuccessRate` (lignes 121-123) suivent le
même patron et doivent être traités ensemble.

**Correction** : rendre `ReleaseEvidence['benchmark']` nullable champ par champ
(`unsafeActionCount: number | null`) et faire de `null` un **`'missing'`**, jamais
un `'pass'` :

```ts
status: benchmark?.unsafeActionCount == null ? 'missing'
      : benchmark.unsafeActionCount === 0 ? 'pass' : 'fail',
observed: benchmark?.unsafeActionCount == null ? 'non mesuré' : String(...),
```

Même geste pour `passRate` (ligne 100 → `number | null`, `'missing'` si null) :
la décision ne change pas, mais `observed` cesse d'afficher « 0 % » pour une
absence. **Un `'missing'` n'est jamais `promotable`** (`promotable` exige que
CHAQUE check soit `pass`) — la sécurité est donc renforcée, pas relâchée.

**Test obligatoire** : un benchmark avec `unsafe_action_count: null` doit produire
`promotable: false` **et** un check `'missing'`. Sonder la gate **dans les deux
sens** (rouge puis verte) — cf. `aigent-gates-vertes-mensongeres`.

### F2 — Rebrancher `check:rsc-boundary` dans `npm run check`

Seule gate du repo qui a une cible réelle (46 composants client), passe, et n'est
branchée nulle part. Le bug qu'elle attrape — une prop **fonction** traversant la
frontière RSC, composant mort au runtime pendant que typecheck/build/tests restent
verts — est **exactement** la régression que les sept PR suivantes vont risquer :
chaque écran d'action passera des handlers à des composants client.

- `package.json` : insérer `check:rsc-boundary` dans la chaîne `check`, après
  `check:render-truth`.
- `scripts/README-gates.md` : la description « rien aujourd'hui : 0 composant
  client » est **périmée**, la corriger.

### F3 — Étendre `check:render-truth` au cockpit

La gate ne scanne que `src/lib/runs-console/**` (4 fichiers). Elle ne couvre **ni**
`src/lib/cockpit/`, **ni** `src/components/cockpit/`, **ni**
`dashboard-overview.ts` / `agent-detail.ts` / `data.ts` — « là où la règle compte
le plus » (`AGENTS.md`). C'est précisément là que le `?? 0` sur une métrique et le
`Number(x?.y)` → `NaN` se sont produits historiquement (`TrendChart cy="NaN"`).

Ajouter à `SCANNED_DIRS` : `src/lib/cockpit`, `src/components/cockpit`. La
double anti-cécité existante (racine disparue → exit 1, `scannedFiles === 0` →
exit 1) est déjà correcte, la conserver.

> **Attendu honnête** : cette extension **fera probablement échouer la chaîne** au
> premier passage (`kpi-strip.tsx` et `status.ts` portent des coercions). C'est le
> but. Corriger les violations trouvées ; ne jamais exempter un fichier pour faire
> verdir la gate. Si une dette doit être différée, elle passe par le `KNOWN_DEBT`
> explicite du script, nommée et datée.

### F4 — Les 9 liens morts `/admin` de la file d'action

`buildActionItems` (`dashboard-overview.ts` l. 530-690) fabrique des `href` vers
un `/admin` supprimé. Le composant qui « fait d'un tableau de bord un COCKPIT »
mène systématiquement à un 404.

**Ne pas corriger en inventant des URL** : les écrans cibles n'existent pas encore.
Table de correspondance à appliquer **au fur et à mesure** des PR, chaque PR de
surface reprenant ses propres lignes :

| Ligne | `href` actuel | Cible | Livré par |
|---|---|---|---|
| 557, 589, 601 | `/admin` (`data_unavailable`) | `/` | **PR 0** |
| 570 | `/admin/projects/${projectId}/builder` | `/projects/[id]/builder` | PR 5 |
| 620 | `/admin/agents/${copilotId}` (`ready_manual`) | `/agents/[id]` | PR 3 |
| 634 | `/admin/agents/${copilotId}` (`sandbox_failed`) | `/delivery` | PR 7 |
| 644→648 | `/admin/agents/${copilotId}` (`release_gate_red`) | `/agents/[id]/qualification` | PR 6 |
| 661 | `evt.prUrl` | GitHub externe | **déjà vivant, ne pas toucher** |
| 681 | `/admin/projects/${project.id}` | `/projects/[id]` | PR 4 |

**En PR 0** : les trois `data_unavailable` pointent sur `/`, et **un test verrouille
qu'aucun `href` produit par `buildActionItems` ne commence par `/admin`**. Ce test
échouera tant que les six autres ne sont pas migrés — c'est un compteur de dette
visible, pas un échec. Le rendre vert au fil des PR.

### F5 — `loading.tsx` et `error.tsx` (absents partout)

`dynamic = 'force-dynamic'` + 6 appels PostgREST en `Promise.all` : **la page
entière est bloquée pendant tout le TTFB, écran blanc du navigateur.** Et une
erreur jetée pendant le rendu de `CockpitOverview` / `AppShell` / Recharts produit
l'écran d'erreur brut de Next, hors du shell.

- `src/app/loading.tsx` — squelette **dans le shell**, hauteurs identiques aux
  panneaux réels (`min-h-[15rem]` / `[18rem]` / `[13rem]`) pour supprimer le saut
  de mise en page.
- `src/app/error.tsx` — `'use client'` (obligatoire pour un error boundary Next),
  rend `<Unavailable reason="unread">` avec `reset()`.
- `src/app/not-found.tsx` — dans le shell, pour que les 404 restants ne sortent
  pas de la coquille.

Chaque route créée ensuite hérite de ces trois fichiers, ou fournit les siens.

### F6 — `globals.css` : ~100 lignes de CSS mort

Le fichier définit un système « ultra dark, accent cyan » **inutilisé** : l'accent
`#00e5d3` n'apparaît nulle part à l'écran, 4 `@utility` ont 0 usage
(`cockpit-substrate`, `lip`, `elev`, `hatched`), 12 jetons de couleur ont 0 usage.

**Supprimer, pas commenter** (cf. `feedback-supprimer-pas-cacher`). **Garder
impérativement** :
- `@import 'tailwindcss'` ;
- `@custom-variant dark (&:where(.dark, .dark *))` — **sans lui la classe `dark`
  sur `<html>` ne déclenche rien en Tailwind v4 et tout Catalyst rendrait en
  clair** ;
- `@utility scroll-thin` (2 usages), `@utility pulse-live` (1 usage, `Led`).

**Décision liée à trancher (voir §5, D3)** : deux palettes de statut divergentes
coexistent — `src/lib/cockpit/status.ts` (`#0da87f`/`#be850f`/`#e8455f`) et
`kpi-strip.tsx` (`#059669`/`#d97706`/`#dc2626`). Le même « succès » n'a pas la même
couleur selon qu'on regarde le KPI ou le roster. **Unifier vers `status.ts`**
(source unique, déjà partagée) sauf avis contraire d'Adrien.

### F7 — Commentaires faux dans le code

Un `.md` archivé est inoffensif ; un commentaire faux au point d'intégration
induit en erreur le prochain agent.

- `qualification-orchestrator.ts` l. **113-117, 460-461, 502-503** : affirment que
  le driver LangGraph réel est « not wired in this perimeter ». **Faux depuis
  `shadow-live.ts` / `replay-live.ts`**, qui sont câblés et atteignables par route.
- `promotion/route.ts` docstring (~l. 40-52) : décrit trois PATCH indépendants avec
  « optimistic concurrency ». Le code appelle la **RPC transactionnelle**
  `promote_copilot_version` 20 lignes plus bas — le fichier se contredit. Risque
  réel : un agent croit pouvoir reproduire la transition par PATCH, ce que la
  migration 0033 refuse au niveau **privilège**.
- `types.ts` en-tête « V1 is mock-only, no backend, no LangGraph/OpenAI calls » —
  périmé, les runners sont câblés.
- `data.ts`, `health-measure.ts`, `runs-console/*` : commentaires décrivant
  `/admin/runs`, `/admin/projects` comme vivants.

### F8 — `vitest.config.ts` : `include` embarque la suite live

```ts
include: ['tests/unit/**/*.test.ts', 'tests/live/**/*.test.ts'],
```

La séparation offline/live ne tient **pas** à la config mais à l'argument de chemin
des scripts npm. **Un `npx vitest run` nu lance la suite live** — qui tape GPU1 et
OpenAI, et **coûte de l'argent**.

Retirer `tests/live/**` de `include` ; `npm run test:live` passe déjà le chemin
explicitement et continue de fonctionner. Noter aussi que
`setupFiles: ['tests/live/setup.ts']` charge `.env.local` avant **tous** les tests,
y compris offline : à déplacer vers un `tests/setup.ts` neutre si le chargement
d'env doit rester, mais **ne pas le supprimer sans vérifier** quels tests unitaires
en dépendent aujourd'hui.

### F9 — `/logout` orphelin

`src/app/logout/route.ts` redirige vers `/login`, supprimé au reset et interdit par
`check:no-legacy-front`. Rien ne référence la route ; atteinte, elle mène à un 404.
Rediriger vers `/` (le proxy laisse passer `/logout`). Un vrai écran de login est
une **décision produit** (§5, D1).

---

## 2. La question tranchée : route API gardée vs Server Action

**Décision : toutes les mutations passent par les routes `/api/agent-ops/**`
existantes, appelées en `fetch` depuis un composant client. Aucune Server Action
n'est introduite dans cette restauration.**

Cette question est posée une fois ici et vaut pour les huit surfaces.

**Justification — quatre raisons, la première étant décisive :**

1. **Le proxy ne garderait pas une Server Action.** `src/proxy.ts` a pour matcher
   `['/api/agent-ops/:path*']` — vérifié dans le code ce jour. Une Server Action
   est un POST vers la **route de la page** (`/agents/[id]`, …), donc **hors du
   matcher** : elle ne traverse ni le contrôle de session HMAC, ni le repli
   `x-amc-key`. Chaque Server Action devrait donc réimplémenter sa propre garde
   d'identité — c'est-à-dire créer une **quatrième frontière de confiance** à côté
   des trois que `AGENTS.md` sépare délibérément. Élargir le matcher aux pages est
   pire encore : la garde s'appliquerait aux **GET de navigation**, pas seulement
   aux mutations.
2. **Les 70 routes sont déjà écrites, gardées et durcies.** Elles portent la
   validation Zod, les codes 409 fail-closed, l'idempotence, les doubles verrous de
   shipping, le refus d'IDOR. Une Server Action dupliquerait cette logique ou
   appellerait la même lib **en contournant les gardes de la route** — c'est le
   chemin le plus court vers deux comportements divergents pour la même opération.
3. **Le contrat HTTP a des consommateurs externes.** Produits consommateurs,
   Agent Server via `x-amc-key`, scripts d'exploitation. Les routes doivent rester
   la voie unique ; en faire aussi le chemin de l'UI garantit qu'elles sont
   **réellement exercées** — aujourd'hui ~52 routes n'ont ni test ni appelant.
4. **Observabilité.** Un `fetch` apparaît dans l'onglet réseau, se rejoue en curl,
   se teste par appel HTTP. Une Server Action est une RPC opaque, non rejouable.

**Corollaire d'implémentation, à respecter dans chaque surface :**

- Les mutations vivent dans des composants `'use client'` qui `fetch` la route,
  avec `credentials: 'same-origin'` (le cookie `amc_session` porte l'identité).
- **Ne jamais passer une fonction en prop d'un Server Component vers un Client
  Component** — c'est le bug que F2 réarme. Les handlers sont **définis dans** le
  composant client.
- Après une mutation réussie : `router.refresh()` pour relire en RSC. Pas de
  duplication d'état client, pas de store global.
- **Les lectures restent en RSC directes** (`getDashboardOverview`,
  `getAgentDetail`, …). On ne migre pas les lectures existantes vers HTTP : elles
  sont plus rapides en direct et déjà justes. La règle est : **lecture = RSC,
  mutation = route API gardée.**

---

## 3. Les huit surfaces

> **Convention commune à toutes les surfaces**, à ne pas répéter section par
> section :
>
> - **États obligatoires** : chaque écran fournit `loading` (squelette aux hauteurs
>   réelles), `error` (boundary client avec `reset()`), `empty` (`<Unavailable
>   reason="no-data">`), `unavailable` (`<Unavailable reason="unread">` — lecture
>   échouée). **`empty` et `unavailable` ne se confondent jamais** : « aucune
>   donnée » et « je n'ai pas pu lire » sont deux affirmations différentes
>   (`AGENTS.md` § Vérité des données).
> - **Jamais de faux zéro** : une valeur non mesurée rend `<AbsentMark>`, jamais
>   `0`. Les métriques arrivent déjà en `null` correctement calculé
>   (`computeMetrics`, `computeCost24h`) — le travail est de **ne pas les
>   coercer à l'affichage**.
> - **Contrainte de hauteur** : tout panneau est un `<Panel>` (`flex min-h-0
>   flex-col overflow-hidden`), la donnée scrolle **dedans**. Une box ne grandit
>   jamais avec sa donnée (`feedback-box-fixe-data-scrolle`).
> - **Pas de sparklines** — aucun mini-graphique inline dans une card ou une table
>   (`feedback_no_sparklines`).
> - **Kit Catalyst** : les 27 fichiers de `src/components/ui/` sont protégés par
>   SHA-256 (`check:catalyst-integrity`). **Ne jamais les modifier** — composer
>   depuis l'extérieur. Un besoin non couvert devient un composant de
>   `src/components/cockpit/`.
> - **Tests** : chaque PR ajoute ses tests de données ; le rendu n'est pas testable
>   aujourd'hui (§4.3).

---

### Surface 1 — Fondation (PR 0)

Aucun écran. C'est le §1 en entier (F1→F9), plus la préparation du terrain.

**Routes UI** : `src/app/loading.tsx`, `error.tsx`, `not-found.tsx` (F5).

**À brancher** : rien de neuf. `getDashboardOverview` reste la lecture de `/`.

**Mutations** : aucune.

**Composants Catalyst** : aucun nouveau. **Réveiller `button.tsx`** — le kit
l'expose (204 l.), il n'est importé nulle part, et les sept surfaces suivantes en
dépendent. Créer `src/components/cockpit/action-button.tsx` : un `'use client'`
qui enveloppe `<Button>` de Catalyst et porte l'état `pending` / `error` d'un
`fetch`. **C'est la brique commune de toutes les mutations** — chaque surface
d'action l'importe au lieu de réinventer un `fetch` inline.

**Visualisations nouvelles** : aucune.

**États** : les trois fichiers de F5 sont eux-mêmes les états manquants.

**Tests** :
- `release-gate` : `unsafe_action_count: null` ⇒ check `'missing'` **et**
  `promotable: false` (sonder rouge **et** vert) ;
- `buildActionItems` : aucun `href` ne commence par `/admin` (dette visible) ;
- `check:render-truth` étendu : vérifier qu'il **échoue** sur un `?? 0` injecté
  dans `src/components/cockpit/`, puis retirer l'injection.

**Risques** :
- F3 va rougir la chaîne : c'est attendu, corriger plutôt qu'exempter ;
- F1 change une signature publique (`ReleaseEvidence`) — `promotion-gate.ts`,
  `qualification-orchestrator.ts` et `improvement-loop.ts` la lisent. Typecheck
  les attrapera ; ne pas « réparer » en remettant un `?? 0` en aval ;
- F6 : supprimer `@custom-variant dark` casserait **tout** le rendu sombre.

**DÉFINITION DE FINI** :
- `npm run check` exit 0 **avec** `check:rsc-boundary` et le `check:render-truth`
  étendu dans la chaîne ;
- `npm test` exit 0, avec les 3 tests neufs ;
- un test prouve qu'un compteur de sécurité `null` **bloque** la promotion ;
- `npx vitest run` nu ne lance **pas** la suite live (vérifié en observant les
  fichiers collectés) ;
- `grep -rn "cockpit-substrate\|--color-accent" src/` → 0 hit ;
- **le dev tourne sur 3987 et `/` s'affiche dans un navigateur** — capture ou
  compte rendu explicite. Sans ça, F5 n'est pas prouvé.

---

### Surface 2 — Runs (PR 2)

**Routes UI** : `/runs` (liste), `/runs/[runId]` (détail + trace).

**Endpoints / loaders** :
- lecture liste : `src/lib/runs-console/**` — `runs-page-data.ts`,
  `runs-timeseries.ts` (**seul dossier intégralement atteint par les tests**, et
  seul couvert par `check:render-truth` aujourd'hui) ;
- lecture détail : `run-trace.ts` (`getAgentDetail` pour le contexte agent) ;
- **`GET /api/agent-ops/copilots/[copilotId]/runs/[runId]`** n'existe pas : le
  détail se lit en RSC via `run-trace.ts`.

**Mutations** :
- **`POST /api/agent-ops/copilots/[copilotId]/runs/[runId]/resume`** — `{approved:
  boolean}`. **C'est la mutation la plus importante du produit** : un agent qui
  s'arrête proprement sur un outil mutant (HITL `needs-confirmation`) y reste
  jusqu'à un POST manuel. Aujourd'hui **aucun écran** ne l'actionne.
- **`POST /api/agent-ops/copilots/[copilotId]/run`** — relancer (garde fail-closed
  409 : statut ≠ `active`, `unresolvedToolIds` non vide, runtime ≠ `langgraph`,
  double soumission, `VersionNotServingError`).

Voie : **route API gardée** (§2). `ActionButton` + `router.refresh()`.

**Composants Catalyst** : `Table` (liste des runs, déjà utilisé par `RunStream`),
`Badge` (statut), `Button` (approuver / refuser / relancer), `Dialog` (confirmation
d'approbation HITL — **dormant, à réveiller**), `Divider`, `Text`/`Strong`,
`Pagination` (dormant, si la fenêtre dépasse une page).

**Visualisations métier nouvelles** :
- **Timeline de trace de run** — étapes, `tool_calls`, checkpoints HITL en
  séquence verticale. Justification : aucun composant Catalyst n'exprime une
  séquence temporelle d'événements, et c'est l'artefact central du débogage d'un
  run. Réutiliser `Rail` (`primitives.tsx`) pour la sévérité.
- **Pas de sparkline** dans les lignes de la table (mémoire produit).
- `HourlyRunsChart` (`charts.tsx`) est réutilisable tel quel pour la vue liste.

**États** : les quatre. Cas propres à la surface — un run `needs-confirmation`
n'est **ni** une erreur **ni** un vide : c'est un **état d'attente d'opérateur**,
à rendre comme une action requise, pas comme un échec. Un `cost_usd` null rend
`<AbsentMark>`, jamais `0` (1 des 24 runs en base est dans ce cas).

**Tests** :
- `runs-page-data` / `runs-timeseries` : déjà couverts, **ne pas régresser** ;
- nouveau : la garde de `resume` refuse un run non-`needs-confirmation` (409) ;
- nouveau : un `cost_usd` null ne devient jamais `0` dans la projection d'écran ;
- `check:render-truth` couvre déjà ce dossier — vérifier qu'il reste vert.

**Risques** :
- **`RunStream` rend tous les runs sans virtualisation ni plafond.** Le scroll est
  borné visuellement, le **coût DOM** ne l'est pas. Plafonner explicitement
  (`limit` + « voir plus »), ne pas virtualiser prématurément.
- Le `resume` **recalcule** un statut terminal côté route
  (`budgetExhausted → failed`, `allBlocked ? … : completed`) et écrit
  `resolved_provider: 'openai'` **en dur** — l'écran doit afficher le statut
  **rendu par la route**, jamais le recalculer une seconde fois.
- Double soumission : la route rend 409, l'écran doit le traiter comme une
  information (« déjà en cours »), pas comme une erreur rouge.

**DÉFINITION DE FINI** :
- `/runs` liste les runs réels de la base avec statut, durée, coût (`AbsentMark`
  quand null) ;
- `/runs/[runId]` affiche la trace, étapes et `tool_calls` ;
- **un run réel en `needs-confirmation` est approuvé depuis l'écran, et la base
  reflète la transition** — vérifié en base, pas déduit de l'UI ;
- un refus (`approved: false`) est également exercé ;
- les 409 de la garde fail-closed s'affichent avec leur raison concrète ;
- `check:rsc-boundary` vert (premier écran avec des handlers).

---

### Surface 3 — Agents (PR 3)

**Routes UI** : `/agents` (roster), `/agents/[copilotId]` (détail).

**Endpoints / loaders** :
- `getAvailableAgents` (`available-agents.ts`) — contrat canonique, **avec
  `unavailableFields`** : un provider non résolu est `null` + nommé, jamais
  `'openai'` ;
- `getAgentDetail` / `computeMetrics` (`agent-detail.ts`) — `successRate`,
  `avgDurationMs`, `cost24hUsd`, `toolCallCount` déjà en `null` quand le
  dénominateur est vide, **et `toolCallCountState` distingue MEASURED 0 de
  UNKNOWN** : l'écran doit rendre cette distinction, c'est tout l'intérêt ;
- `agent-lifecycle-trace.ts` — trace de cycle de vie ;
- routes de lecture existantes : `GET /api/agent-ops/agents`,
  `/agents/[copilotId]` (non utilisées par l'UI : lecture en RSC).

**Mutations** :
- **`PATCH /api/agent-ops/copilots/[copilotId]`** — édition (`targetProjectIds`
  validé élément par élément, ≤2) ;
- **`DELETE /api/agent-ops/copilots/[copilotId]`** ;
- **`POST /api/agent-ops/copilots/[copilotId]/run`** — lancer un run ;
- **`PATCH /api/agent-ops/tools/[toolId]`** — refuse le downgrade de confirmation.

**Composants Catalyst** : `Avatar` + `Badge` + `Strong` (déjà dans `rows.tsx`),
`DescriptionList` (**dormant** — idéal pour le panneau d'identité de l'agent),
`Dialog` (confirmation de suppression), `Button`, `Input`/`Fieldset`/`Textarea`
(dormants — édition), `Switch` (dormant — bascules de politique), `Table` (outils).

**Visualisations métier nouvelles** :
- **Trace de cycle de vie horizontale** — les étapes de `agent-lifecycle-trace.ts`
  avec leur `source`. **`active_in_consumer` doit rendre littéralement
  `'unknown'`**, jamais un ✓ ni un ✗ : `check:lifecycle-truth` l'impose et c'est
  structurel (Aigent n'a aucun canal de lecture vers le consommateur).
- **Matrice de résolution des outils** — `unresolvedToolIds` en évidence : c'est
  la cause n°1 d'un 409 au lancement. Réutiliser `SegmentMeter`.

**États** : les quatre, plus **un cinquième propre à cette surface** :
`unavailableFields` non vide ⇒ le champ concerné rend `<AbsentMark>` **et** la
raison. Ne jamais fabriquer un provider ou un modèle (`check:agent-truth` garde
`available-agents.ts`, mais **pas** l'écran — discipline).

**Tests** :
- `computeMetrics` : MEASURED 0 ≠ UNKNOWN dans la projection d'écran ;
- un copilot dont `model_provider` est null n'affiche jamais `openai` ;
- la garde d'exécution : les trois conditions (`active`, `unresolvedToolIds` vide,
  `runtime === 'langgraph'`) produisent bien un 409 avec raisons.

**Risques** :
- **`copilot-behavior.ts:183` fabrique un provider** : `normalizeModelProvider`
  retourne `'openai'` pour tout input non reconnu, et `DEFAULT_MODEL = 'gpt-5.4'`
  fait pareil côté modèle. Inoffensif aujourd'hui (les 14 copilots portent
  `openai`), **bombe à retardement** ensuite. **Ne pas lire cette fonction depuis
  l'écran** — lire `available-agents.ts`, qui est le contrat honnête. Corriger
  `copilot-behavior.ts` est hors périmètre de cette PR mais doit être signalé.
- **Piège LangGraph** : un copilot en `langgraph` **sans assistant provisionné**
  tourne contre le graphe nu et répond « pas de données » avec
  `tool_call_count = 0` **en paraissant sain**. Aucune gate ne le détecte. En base
  aujourd'hui : `assistant_id` renseigné **14/14**, le piège n'est pas armé — mais
  l'écran doit **afficher `assistant_id`** pour qu'il reste visible.
- `copilotId` est validé par deux regex différentes selon les routes
  (`/^[a-zA-Z0-9-]{1,100}$/` dans `benchmarks/*`, `/^[a-z0-9-]{1,200}$/` ailleurs).
  Un id à majuscules passe ici et échoue là.

**DÉFINITION DE FINI** :
- `/agents` liste les 14 copilots réels avec statut (8 draft, 3 active,
  1 degraded, 1 paused, 1 archived) ;
- `/agents/[id]` affiche métriques (`AbsentMark` quand non mesuré), outils
  résolus/non résolus, `assistant_id`, trace de cycle de vie avec
  `active_in_consumer: unknown` ;
- **un PATCH réel est effectué depuis l'écran et vérifié en base** ;
- un agent non exécutable affiche **pourquoi** (les raisons du 409) ;
- les liens `ready_manual` de la file d'action (F4 l. 620) mènent ici.

---

### Surface 4 — Projects (PR 4)

**Routes UI** : `/projects`, `/projects/[id]`.

**Endpoints / loaders** : `getProjects` (`data.ts`), `project-team/data.ts`
(graphe d'équipe — **7 modules, 6 couverts par les tests, le mieux testé du
repo**), `repo-intelligence-store.ts`.

**Mutations** :
- **`POST /api/agent-ops/projects`** — Zod + 3 refines, rollback 2 étages ;
- **`DELETE /api/agent-ops/projects/[id]`** — cascade ;
- **`POST /projects/[id]/relations`** — Zod `.strict()`, 422 hors projet, 409
  unicité ;
- **`DELETE /projects/[id]/relations/[relationId]`** — scopé `id` **ET**
  `project_id` (anti-IDOR, ne pas contourner) ;
- **`POST /projects/[id]/missions`** ;
- **`POST /projects/[id]/repo/intelligence`** — 503 sans `GITHUB_TOKEN`.

**Composants Catalyst** : `Table`, `Dialog` (création / suppression),
`Input`/`Fieldset`/`Select`/`Textarea` (dormants), `Button`, `Badge`, `Combobox`
(dormant — choix de repo depuis `GET /api/agent-ops/github/repos`).

**Visualisations métier nouvelles** :
- **Graphe d'équipe projet** — `project-team/data.ts` fournit déjà le layout
  (`project-team-layout.test.ts`, 28 tests). Aucun composant Catalyst n'exprime un
  graphe de relations. **Réutiliser le layout existant, ne pas le recalculer.**

**États** : les quatre. **`GET /projects/[id]/copilots` est PARTIELLE** : elle
appelle `getCopilots()` **complet** puis filtre en JS, avec un N+1. Sur 10 projets
et 14 copilots c'est indolore ; **le noter, ne pas optimiser dans cette PR**.

**Tests** : les 5 fichiers `project-team-*` couvrent déjà relations, graphe,
layout, statuts, écritures (**184 tests**) — **ne pas régresser**. Nouveaux :
l'anti-IDOR du DELETE de relation reste effectif depuis l'écran.

**Risques** :
- **Incohérence de contrat sur « projet sans repo GitHub »** : rend **400**
  (`push-agent`), **409 + `noRepo:true`** (`repo/scan`, `builder/run`), **422**
  (`provision-consumer`). L'écran doit traiter ces trois codes comme **le même
  état métier**, sinon il affichera trois messages différents pour une seule
  réalité.
- `GET /projects/[id]/team` rend **500** si sa propre réponse échoue son Zod
  sortant — à traiter comme une panne, pas comme un vide.

**DÉFINITION DE FINI** :
- `/projects` liste les 10 projets réels ;
- `/projects/[id]` affiche copilots, équipe, repo, missions ;
- **un projet est créé puis supprimé depuis l'écran**, vérifié en base ;
- une relation est créée et supprimée ;
- un projet sans repo affiche **un seul** message cohérent ;
- les liens `mission_blocked` (F4 l. 681) mènent ici.

---

### Surface 5 — Builder (PR 5)

**Routes UI** : `/projects/[id]/builder` (le builder est **par projet** — les 6
routes le sont, ne pas créer un `/builder` global).

**Endpoints / loaders** :
- **`GET /projects/[id]/builder/conversation`** — 404 pré-check délibéré (un GET
  **créerait** une ligne) ;
- `agent-builder-*.ts`, `agent-drafts-store.ts`.

**Mutations** :
- **`POST /projects/[id]/builder/message?stream=1`** — **SSE** ;
- **`POST /projects/[id]/builder/create-draft`** — 409 ×4, classification
  **sensible à l'ordre des regex** ;
- **`POST /projects/[id]/builder/preview/select`** ;
- **`PATCH /api/agent-ops/agent-drafts/[draftId]`** ;
- **`POST /api/agent-ops/copilots`** — matérialisation (Zod complet,
  `runtime: z.literal('langgraph')`, `superRefine` refusant un outil risqué sans
  `requiresConfirmation`).

**Le SSE est le seul cas où `fetch` ne suffit pas.** `builder/message` est le
gabarit : `X-Accel-Buffering: no`, heartbeat nettoyé en `finally` **et** dans
`cancel()`, et **`cancel()` appelle `abort.abort()`** — un client qui raccroche
**arrête réellement le tour OpenAI** (le commentaire documente la facturation qui
continuait « après que le navigateur soit parti »).

**Conséquence non négociable : le composant client DOIT abandonner proprement.**
`AbortController` lié au démontage, `EventSource` fermé, tour annulé si l'opérateur
quitte l'écran. **Un tour avorté n'émet aucune trame terminale** — l'UI doit gérer
ce cas sans rester bloquée sur un spinner. Les erreurs SSE arrivent **en trame
terminale, jamais en code HTTP** : ne pas les chercher dans le statut.

**Composants Catalyst** : `Textarea`, `Button`, `Badge`, `Divider`, `Dialog`
(confirmation de matérialisation), `Avatar` (rôles de la conversation).

**Visualisations métier nouvelles** :
- **Fil de conversation streamé** — bulles + état de streaming. Aucun équivalent
  Catalyst.
- **Prévisualisation de manifeste** — diff lisible avant matérialisation.
  Justification : la matérialisation est **facturée** et compensable ; l'opérateur
  doit voir exactement ce qu'il crée.

**États** : les quatre, plus **`streaming`** (5ᵉ état propre à cette surface) et
**`aborted`** (tour annulé, aucune trame terminale). `agent_drafts` est **vide en
base (0 ligne)** : l'état `empty` est le **cas nominal au premier lancement**, à
soigner en priorité.

**Tests** :
- `create-draft` : la classification par regex reste correcte pour les 4 cas 409 ;
- **un abandon client déclenche bien `abort()`** (le test le plus important de la
  PR : c'est de l'argent) ;
- un tour avorté ne laisse pas l'UI en attente.

**Risques** :
- **Facturation réelle.** Chaque message tape OpenAI. Un composant qui remonte en
  boucle (`useEffect` mal gardé) **dépense de l'argent en silence**. Garder les
  effets, ne pas relancer un tour au remount.
- La classification d'erreur **par regex sur des messages** (`create-draft`,
  `improve/*`, `promotion`) : un reformulage côté lib transforme un 409 en 502.
  L'écran ne doit pas dépendre du **texte** du message.
- SSE derrière un proxy : `X-Accel-Buffering: no` est posé côté route, ne pas le
  retirer.

**DÉFINITION DE FINI** :
- `/projects/[id]/builder` ouvre une conversation, envoie un message, **affiche la
  réponse streamée token par token dans un navigateur réel** ;
- quitter l'écran en cours de tour **annule le tour** (vérifié : plus de trames,
  et idéalement une trace côté serveur) ;
- un draft est créé, édité, puis matérialisé en copilot — **vérifié en base** ;
- l'état `empty` (0 draft) est correct au premier chargement ;
- le lien `architect_approval` (F4 l. 570) mène ici.

---

### Surface 6 — Qualification (PR 6)

**Routes UI** : `/agents/[copilotId]/qualification` (sous-route de l'agent : la
qualification porte toujours sur un copilot et une version).

**Endpoints / loaders** :
- **`GET /api/agent-ops/copilots/[copilotId]/qualification`** — état du ledger ;
- `release-gate.ts` `evaluateReleaseGate` — **9 checks, filtre
  `execution_mode=eq.live`, pure de `Date`** ;
- `promotion-gate.ts` `evaluateAndPersistPromotionGate` — 5 checks ;
- **`GET .../versions/[versionId]/shadow` et `/replay`**.

**Mutations** :
- **`POST /copilots/[id]/qualification`** — `sweep` | `start` | `advance` ;
- **`POST /copilots/[id]/tests/run`**, **`/tests/generate`** ;
- **`POST /copilots/[id]/benchmarks/run`**, **`/benchmarks/sweep`** (`models`
  1..8) ;
- **`POST .../versions/[versionId]/shadow`** — **défaut = fixture ($0)** ;
  `useFixture: false` demande le vrai LangGraph via un assistant **éphémère** ;
- **`POST .../versions/[versionId]/replay`** ;
- **`POST /copilots/[id]/promotion`** — `{promote | rollback}`, 422 si gate non
  verte.

**Voie : route API gardée.** Ici le choix du §2 est **structurellement
obligatoire** : la RPC `promote_copilot_version` est protégée au niveau
**privilège** (rôle `aigent_promotion_executor`, `service_role` non membre, trigger
SECURITY INVOKER). Une Server Action qui appellerait la lib directement serait
**refusée par la base**, pas par l'application.

**Composants Catalyst** : `Table` (checks du gate), `Badge` (pass/fail/missing),
`Button`, `Dialog` (**confirmation de promotion — obligatoire**, geste
irréversible), `DescriptionList` (évidence), `Alert` (dormant).

**Visualisations métier nouvelles** :
- **Tableau des 9 checks du release gate** — chaque check avec `status` (pass /
  fail / **missing**) et `observed`. **Après F1, `missing` est un troisième état
  visuel de plein droit** : ni vert, ni rouge — **gris / non mesuré**. C'est le
  cœur de la correction : un compteur de sécurité non mesuré doit se **voir**.
- **Progression de qualification** — les `QUALIFICATION_STEPS` en séquence.
- **Comparaison shadow / replay** — candidat vs production, `would_mutate`,
  `execution_mode` (**`live_langgraph` vs `deterministic_fixture` doit être visible
  en permanence** : une preuve fixture ne peut jamais satisfaire une promotion de
  production).

**États** : les quatre, plus **`NOT_AVAILABLE`** (absence d'évidence — distinct
d'un échec) et **`missing`** (check non mesuré). `qualification_runs` est **vide
(0 ligne)** : l'`empty` est le cas nominal.

**Tests** :
- `promotion-gate.test.ts` (38 tests) et `shadow-replay-routes.test.ts` (25) :
  **ne pas régresser** ;
- nouveau : un check `missing` **n'est jamais rendu comme un pass** (le test
  d'écran de F1) ;
- nouveau : `execution_mode: deterministic_fixture` est visible et n'autorise pas
  la promotion.

**Risques** :
- **Le plus dangereux du plan** : cet écran affiche un feu vert de promotion. Sans
  F1, il affichera « 0 action unsafe » pour une absence de mesure. **PR 6 ne
  démarre pas avant que F1 soit mergée.**
- **Coût réel** : `benchmarks/sweep` (jusqu'à 8 modèles) et `shadow`
  `useFixture:false` **tapent OpenAI et sont facturés**. L'écran doit **afficher
  le mode et son coût attendu avant de lancer**, et `useFixture: true` reste le
  **défaut** de l'UI.
- **Dette `replay`** : `persistReplayComparison` insère une **seconde** ligne ; la
  route PATCHe le placeholder puis DELETE la surnuméraire avec `.catch(() => {})`.
  Un échec laisse une **orpheline silencieuse** dans `replay_comparisons`.
  L'écran peut donc voir deux lignes pour une comparaison — **ne pas les sommer**.
- La concurrence est tenue par un **index UNIQUE partiel** (migration 0034) :
  l'insert **est** le verrou. Le perdant reçoit un 409 — c'est normal, pas une
  erreur à afficher en rouge.

**DÉFINITION DE FINI** :
- l'écran affiche les 9 checks du release gate avec leur `observed` réel ;
- **un check non mesuré s'affiche « non mesuré », jamais « 0 » ni un ✓** ;
- un test est lancé depuis l'écran et son résultat apparaît ;
- un shadow **en fixture ($0)** est lancé et rendu ;
- le bouton de promotion est **désactivé** tant que `promotable !== true`, et un
  422 renvoyé par la route s'affiche avec sa raison ;
- les liens `release_gate_red` (F4 l. 644) mènent ici.

---

### Surface 7 — Delivery (PR 7)

**Routes UI** : `/delivery`.

**Endpoints / loaders** : `delivery-events-store.ts` (`buildRecentDeliveries`,
`computeReadyForManualTest`, `computeBlockedDeliveries`), `target-repo-sandbox.ts`,
**`GET /api/agent-ops/delivery-capability`** (expose `realDeliveryEnabled`
**sans** dire quel secret manque — délibéré, ne pas « améliorer »),
**`GET /projects/[id]/target-sandbox/latest`** (200 `{report:null}` si absent,
jamais 404).

**Mutations** :
- **`POST /projects/[id]/push-agent`** — double verrou ;
- **`POST /copilots/[id]/delivery-loop`** — 503 sans `GITHUB_TOKEN` ;
- **`POST /copilots/[id]/target-sandbox`** ;
- **`POST /projects/[id]/provision-consumer`**.

**Le double verrou est la règle centrale de cette surface** :

```ts
const dryRun = !(body.confirm === true && process.env.GITHUB_PUSH_ENABLED === '1')
```

Avec `confirm: true` mais `GITHUB_PUSH_ENABLED ≠ '1'`, l'appelant reçoit
**200 + reçu de dry-run** et rien n'est persisté. **L'écran doit donc distinguer
un succès dry-run d'une vraie poussée** — sinon l'opérateur croira avoir livré.
`PushResult.files` liste exactement ce qu'une vraie poussée écrirait : c'est la
**prévisualisation**, à afficher comme telle.

**Composants Catalyst** : `Table` (événements de livraison), `Badge`
(dry-run / réel), `Button`, `Dialog` (confirmation de poussée réelle — **double
confirmation**), `Alert`.

**Visualisations métier nouvelles** :
- **Bandeau de mode de livraison** — `realDeliveryEnabled` en permanence à
  l'écran, dry-run **par défaut et visuellement dominant**.
- **Prévisualisation des fichiers** (`PushResult.files`) avant confirmation.
- **Pas de graphique** : 1 seule ligne en base (`agent_delivery_events`), un
  graphique sur n=1 serait un mensonge visuel.

**États** : les quatre, plus **`dry-run`** (succès **sans** effet) et
**`capability-disabled`** (livraison réelle éteinte). `agent_delivery_events` = **1
ligne** : `buildRecentDeliveries`, `computeReadyForManualTest` et
`computeBlockedDeliveries` reposent sur un échantillon de **1** — ne dériver aucun
pourcentage.

**Tests** :
- `target-repo-sandbox.test.ts` (29 tests) : ne pas régresser ;
- nouveau : un reçu de dry-run n'est **jamais** rendu comme une livraison réelle ;
- nouveau : `realDeliveryEnabled: false` désactive le bouton de poussée réelle.

**Risques** :
- **`provision-consumer` est la route mutante la plus faiblement validée du
  repo** : échec Zod **silencieusement ignoré** (`if (parsed.success)` seulement,
  sinon les défauts dry-run sont conservés), **aucune garde d'env**, et
  `getProject(id)` **hors de tout try/catch** → **500 non maîtrisé** au lieu du
  502/504 de ses jumelles. **À corriger dans cette PR**, c'est son périmètre
  naturel.
- **Écriture GitHub distante** : `GITHUB_PUSH_ENABLED=1` est une action à effet
  réel. **Ne jamais l'armer sans accord explicite d'Adrien** (`CLAUDE.md` §5).
- `target-sandbox` : persistance **best-effort avalée** — un rapport peut manquer
  sans erreur. L'écran rend `UNAVAILABLE`, pas « aucun problème ».

**DÉFINITION DE FINI** :
- `/delivery` affiche l'événement réel et le mode de capacité ;
- **un dry-run est lancé et son reçu affiché, explicitement marqué « simulation »** ;
- aucune poussée réelle n'est effectuée sans ordre d'Adrien ;
- `provision-consumer` rend **400** sur un corps invalide (au lieu de l'ignorer) ;
- les liens `sandbox_failed` (F4 l. 634) mènent ici.

---

### Surface 8 — Runtime / Télémétrie (PR 8)

**Routes UI** : `/runtime`.

**Endpoints / loaders** — **tous « prêts sans UI », testés, jamais rendus** :
- `summarizeRuntimeTelemetry`, `summarizeFleetRuntimeTelemetry` (rollup par agent,
  p95, taux de succès, provenance) ;
- `diagnoseTelemetryHealth` — **diagnostic à 5 statuts, qui ne dit jamais
  « agents inactifs »** ;
- `listRecentRuntimeTelemetryEvents` — 50 derniers ;
- `runtime-telemetry-provenance.ts` — `consumer` **jamais inféré** de l'absence de
  marqueur interne.

**Mutations** : **aucune.** C'est la seule surface légitimement en lecture pure :
`POST /api/runtime-telemetry` est appelé par des **agents déployés chez des tiers**
avec **leur** jeton (`AIGENT_RUNTIME_TELEMETRY_TOKEN`), jamais par l'opérateur.
**Ne jamais appeler cet endpoint depuis l'UI** — ce serait fabriquer de la
télémétrie.

**Composants Catalyst** : `Table` (événements), `Badge` (provenance), `DescriptionList`
(diagnostic), `Divider`.

**Visualisations métier nouvelles** :
- **Répartition par provenance** — `internal` / `lifecycle` / `consumer` /
  `unknown`. **`consumer` doit afficher `0` avec la mention « aucun canal de retour
  n'a jamais émis »**, pas une tranche vide sans explication.
- **Distribution de latence (p95)** — déjà calculée par `summarizeRuntimeTelemetry`.
- **Pas de sparkline.**

**États** : les quatre, plus **`UNAVAILABLE` par métrique**. Cas critiques :
- **`errorCategoriesState` sortira `UNAVAILABLE` malgré 9 runs `failed`** —
  l'émetteur de référence n'envoie pas `error.category`. C'est **correct et
  voulu** : rendre comme un **trou de signal**, jamais comme « aucune erreur ».
- `provider` est **null sur 14 des 38 événements** → coût non calculable pour
  ceux-là. `AbsentMark`, jamais `0 $`.
- **Zéro événement `consumer` sur 38** (confirmé en base **et** par lecture de
  code) : la section « santé des agents livrés » **n'a aucune source réelle**.
  L'écran doit le dire explicitement.

**Tests** :
- 6 fichiers de télémétrie existants (dont `runtime-telemetry-cost.test.ts`,
  20 tests, « pas de faux zéro ») : ne pas régresser ;
- nouveau : provenance `consumer` = 0 rend un message d'absence de canal, pas un
  vide muet ;
- nouveau : `errorCategoriesState: UNAVAILABLE` ne rend jamais « aucune erreur ».

**Risques** :
- **Le risque produit n°1 de cette surface est un écran qui ment par omission.**
  Un dashboard de télémétrie qui affiche « 0 erreur consommateur » sur une boucle
  **qui n'a jamais reçu une seule ligne** est pire que pas d'écran du tout.
  `telemetry-health.ts` porte déjà la doctrine : « zéro événement n'est jamais une
  preuve d'inactivité des agents, seulement un silence de la boucle ». **Reprendre
  cette phrase à l'écran.**
- 38 lignes : tout pourcentage a un dénominateur minuscule. Afficher le
  dénominateur (`measuredRuns / totalRuns`), comme `computeCost24h` le fait déjà.

**DÉFINITION DE FINI** :
- `/runtime` affiche les 38 événements réels avec provenance ;
- **le diagnostic de santé s'affiche sans jamais conclure « agents inactifs »** ;
- l'absence de provenance `consumer` est **expliquée**, pas rendue par un vide ;
- les catégories d'erreur affichent `UNAVAILABLE`, pas « 0 erreur » ;
- chaque pourcentage montre son dénominateur.

---

## 4. Ordre des PR et dépendances réelles

### Le graphe

```
PR 0  FONDATION  (F1→F9)
  │   bloque TOUT : F1 (faux vert) bloque PR 6 · F2 (rsc-boundary) protège
  │   toutes les surfaces d'action · F5 (loading/error) est hérité par toutes
  │   les routes · ActionButton est la brique commune des mutations
  ▼
PR 1  SHELL & NAVIGATION
  │   active les 5 entrées désactivées de la sidebar, ajoute /builder et
  │   /qualification (absents de la nav), résout R2 (file d'action invisible
  │   sous 1280 px). Bloque toutes les surfaces : sans nav, un écran est
  │   inatteignable autrement qu'en tapant l'URL.
  ▼
  ├─► PR 2  RUNS      ──┐  (indépendantes entre elles)
  ├─► PR 3  AGENTS    ──┤
  └─► PR 4  PROJECTS  ──┘
             │
             ├─► PR 5  BUILDER        dépend de PROJECTS (routes /projects/[id]/builder/*)
             ├─► PR 6  QUALIFICATION  dépend de AGENTS (sous-route) + F1 (impératif)
             └─► PR 7  DELIVERY       dépend de PROJECTS (push-agent est /projects/[id]/*)
                        │
                        ▼
                   PR 8  RUNTIME      dépend de rien techniquement — placée en
                                      dernier car sa valeur dépend de ce que les
                                      autres surfaces auront fait tourner
```

### Justification des arêtes

| Dépendance | Nature | Pourquoi |
|---|---|---|
| **PR 0 → tout** | dure | F1 est un faux vert de sécurité ; F2 attrape la classe de bug que chaque surface va risquer ; F5 est hérité par chaque route ; `ActionButton` est importé par 6 PR |
| **PR 1 → toutes les surfaces** | dure | 5 entrées de nav sont des `<button disabled>` ; `/builder` et `/qualification` ne sont pas même nommés |
| **PR 0 (F1) → PR 6** | **dure, non négociable** | Sans F1, l'écran de promotion affiche un feu vert fabriqué à partir d'un compteur de sécurité non mesuré |
| **PR 4 → PR 5** | dure | Les 6 routes builder sont sous `/projects/[id]/builder/*` |
| **PR 4 → PR 7** | dure | `push-agent` et `provision-consumer` sont sous `/projects/[id]/*` |
| **PR 3 → PR 6** | de structure | `/agents/[id]/qualification` est une sous-route ; techniquement séparable, mais un écran de qualification sans écran d'agent n'a pas de porte d'entrée |
| **PR 2 ∥ PR 3 ∥ PR 4** | **aucune** | Périmètres disjoints — parallélisables par trois sous-agents. **Un seul intégrateur git** (`CLAUDE.md` §11), worktrees isolés |
| **PR 8** | aucune | Placée en dernier par **valeur**, pas par technique |

### PR 1 — Shell & navigation (détail, non couvert par les 8 surfaces)

- Activer les 5 `SidebarItem` désactivés (`Agents`, `Projets`, `Runs`,
  `Livraisons`, `Télémétrie`) **au fur et à mesure** : un lien ne s'active que
  quand sa route existe. **La nav actuelle est honnête** (aucun `href="#"`) —
  **ne pas régresser en activant un lien vers une page inexistante.**
- Ajouter `Builder` et `Qualification`.
- **Résoudre R2** : `<aside>` (file d'action) est `hidden xl:block` — **la valeur
  de décision de l'écran est inaccessible sous 1280 px**, sans aucun repli.
  Trancher : tiroir `Dialog` sous `xl` (mécanique déjà en place pour la sidebar
  mobile).
- **Ne pas utiliser `SidebarLayout` de Catalyst** : il pose `min-h-svh` et un
  `<main>` qui grandit avec son contenu, ce qui casse la chaîne de hauteur bornée.
  `app-shell.tsx` réassemble délibérément les primitives — **conserver ce choix**.

---

## 5. Ce qui ne pourra PAS être prouvé — et pourquoi

Section de vérité. Aucun code écrit dans ces huit PR ne peut lever ces points.

### 5.1 Étape 14 — exécution réelle chez le consommateur

**Impossible depuis ce repo.** Après provisioning, **Aigent ne fait que POUSSER**.
Les gestes activate / rebind / deploy-version appartiennent au workspace
consommateur. C'est la raison **structurelle** pour laquelle `active_in_consumer`
reste le littéral `'unknown'`, et `check:lifecycle-truth` l'impose.

**Ce qui manque** : un canal de **lecture** vers le consommateur — callback
d'activation qu'il POSTe, ou API qu'il expose. **Décision produit** (§6, D5), pas
un branchement.

### 5.2 Étape 15 — télémétrie de provenance consommateur

**Zéro événement `consumer` sur 38**, confirmé **deux fois** : les 4 émetteurs du
repo écrivent tous une source interne (`aigent-internal-runner`,
`aigent-promotion`, `aigent-shadow`, `aigent-replay`), et l'interrogation live de
la base le confirme. `classifyRuntimeTelemetryProvenance` ne classe `consumer` que
sur un marqueur **positif** — jamais par défaut.

**Aucun code Aigent ne peut produire un événement `consumer`.** L'endpoint
**accepte** ; personne n'a prouvé qu'il **reçoit**. PR 8 peut afficher cette
absence honnêtement — elle ne peut pas la combler. Il faut un **émetteur côté
consommateur** (le pack `consumer-bootstrap.ts` doit livrer le code qui POSTe avec
`source: 'consumer'`), donc un **vrai consommateur déployé**.

### 5.3 Étapes 16-17 — la boucle d'apprentissage

`improvement_proposals` = **0 ligne**, `qualification_runs` = **0 ligne**. Les
écrans de PR 6 afficheront un `empty` **correct** mais ne prouveront pas la boucle.
Étapes 17-21 sont alimentées **exclusivement par des runs internes** : « Aigent
apprend des runs de ses agents déployés » décrit une capacité **construite**,
jamais **exercée**.

### 5.4 Replay — la baseline manquante

`replay` est câblé, unit-testé, **jamais exécuté live** : *« no copilot has a
`production_version_id` baseline yet »*. Dépendance circulaire à l'amorçage : pour
un replay `live_langgraph` il faut une production ; pour une première production
sous policy **strict** il faudrait déjà un replay.

**Ce n'est pas du code à écrire.** C'est **une seule exécution live** : promouvoir
un copilot jetable (chemin déjà prouvé, étape 11), puis lancer un replay
`useFixture: false` contre cette baseline. **Coûte de l'argent** (OpenAI + GPU1) →
accord d'Adrien requis (§6, D4).

### 5.5 Qu'un écran s'affiche

**Rien dans ce repo ne le prouve.** Aucun Playwright/Cypress/Puppeteer, aucun
`@testing-library`, aucun `render(`, aucun `.tsx` dans `tests/`, aucun job
navigateur en CI. `vitest.config.ts` déclare `environment: 'node'` ; `happy-dom`
est en `devDependencies` mais **configuré nulle part**.

La chaîne `check`, les 1721 tests et le `build` peuvent être **tous verts sur un
cockpit qui explose au premier rendu client**. Ce n'est pas une hypothèse : c'est
le précédent daté du 26/07/2026 (Recharts, prop fonction traversant la frontière
RSC, carte de coût morte en prod, toutes les gates vertes).

**Conséquence opérationnelle, obligatoire pour chaque PR** : la définition de fini
exige **l'ouverture manuelle de la page dans un navigateur**, sur le port **3987**.
C'est la seule preuve disponible. F2 (`check:rsc-boundary` rebranché) réduit le
risque, il ne le supprime pas.

### 5.6 Les 27 fichiers du kit Catalyst sous triple exemption

`catalyst-integrity` garde leur **intégrité**, `audit:dead` les **exclut**, knip les
**ignore**, aucun test ne les importe. Les 18 dormants que ces PR vont réveiller
(`button`, `dialog`, `input`, `select`, `textarea`, `checkbox`, `switch`,
`combobox`, `listbox`, `fieldset`, `description-list`, `alert`, `pagination`, …)
**n'ont jamais été rendus dans ce repo**. Leur premier rendu est un risque non
couvert — d'où l'ouverture manuelle.

---

## 6. Décisions produit à remonter à Adrien

Aucune ne se tranche par du code. Elles sont classées par ce qu'elles bloquent.

### D1 — Écran de login, ou pas ? *(bloque : rien — à trancher avant PR 1)*

`/login` a été supprimé et `check:no-legacy-front` **interdit sa réapparition**.
`/logout` redirige vers cette page inexistante (F9). Le proxy laisse passer
`/login` et `/api/auth/**`, et `POST /api/auth/login` est **opérationnelle**
(429 par IP, 401, 503).

**Nuance de sécurité à connaître** : `isDev()` vaut `NODE_ENV !== 'production'` —
**`NODE_ENV` non défini suffit** à activer les fallbacks. `authConfigured()` rend
`true` **inconditionnellement en dev**, et le mot de passe de repli est `'Admin'`.
En développement, sans `AMC_SESSION_SECRET`, **une session est frappable et ouvre
les 60 routes `/api/agent-ops/**`**, valide 12 h et **non révocable**. Inerte en
production, réel en local.

**Options** : (a) rester sans écran, l'opérateur s'authentifie par `x-amc-key` ;
(b) reconstruire `/login` — **exige de modifier `check:no-legacy-front`, donc une
mission de gouvernance** (`CLAUDE.md` §9). **Recommandation : (a) pour cette
restauration** ; poser `AMC_SESSION_SECRET` en local dans tous les cas.

### D2 — Périmètre d'action : quelles mutations exposer ? *(bloque PR 2, 6, 7)*

Le plan expose **toutes** les mutations décrites. Certaines ont un **effet réel et
coûteux** : `benchmarks/sweep` (8 modèles, facturé), `shadow useFixture:false`
(OpenAI), `push-agent` (écriture GitHub distante), `provision-consumer`,
`DELETE /projects/[id]` (cascade).

**Question** : lesquelles doivent être **actionnables par un clic**, lesquelles
restent en curl ? **Recommandation** : tout ce qui **coûte de l'argent** ou **écrit
chez un tiers** exige une `Dialog` de confirmation affichant le coût attendu ; le
mode **fixture / dry-run reste le défaut** de l'UI.

### D3 — Palette de statut unique *(bloque PR 0 / F6)*

Deux vocabulaires coexistent : `status.ts` (`#0da87f`/`#be850f`/`#e8455f`) et
`kpi-strip.tsx` (`#059669`/`#d97706`/`#dc2626`). **Le même « succès » n'a pas la
même couleur selon qu'on regarde le KPI ou le roster.**

**Recommandation** : unifier vers `status.ts`. **Le design est libre**
(`CLAUDE.md` §8, `AGENTS.md`) — c'est un choix d'Adrien, pas une conformité. Le
signaler suffit ; par défaut on unifie sans redessiner.

### D4 — Autoriser une exécution live pour débloquer replay ? *(bloque §5.4)*

Débloquer replay demande : promouvoir un copilot jetable, puis un replay
`useFixture: false` contre cette baseline. **Coûte de l'argent** (OpenAI + GPU1) et
**écrit en base**. Aucun code ne le remplace.

**Question** : autorisez-vous cette exécution, et sur quel copilot jetable ?

### D5 — Canal de retour consommateur *(bloque §5.1, §5.2, et la moitié « apprentissage » de la promesse produit)*

Aujourd'hui le flux est **à sens unique** : Aigent pousse, personne ne rapporte.
Il manque **deux choses distinctes** :
1. un **émetteur** de télémétrie côté consommateur (`consumer-bootstrap.ts` doit
   livrer le code qui POSTe avec `source: 'consumer'`) ;
2. un **canal de lecture** d'activation (callback POSTé par le consommateur, ou
   API qu'il expose) — sans quoi `active_in_consumer` reste `'unknown'`
   **structurellement**.

**Question** : qui appelle qui, avec quel jeton, quel contrat ? C'est une décision
d'architecture produit, hors périmètre de cette restauration.

### D6 — Armer `GITHUB_PUSH_ENABLED=1` ? *(bloque la preuve de PR 7)*

Livraison réelle = **écriture distante chez un tiers**, éteinte par double verrou.
PR 7 peut prouver le **dry-run** ; elle ne peut pas prouver la livraison.

**Question** : autorisez-vous une poussée réelle sur une **cible jetable** ?
Par défaut, **non** — et PR 7 s'arrête au dry-run.

### D7 — Densité et profondeur des écrans *(bloque : rien, mais oriente PR 2-8)*

Le cockpit actuel est **dense, borné en hauteur, zéro-scroll en desktop `xl`+**.
Les 7 écrans doivent-ils suivre la même règle (tout tient à l'écran, la donnée
scrolle dans les panneaux) ou accepter des pages longues pour les vues de détail
(`/runs/[runId]`, `/agents/[id]`) ?

**Recommandation** : **conserver la règle de hauteur bornée** — c'est un invariant
de confort explicite (`feedback-box-fixe-data-scrolle`), et la chaîne de hauteur
existante est solide. Signalé parce que la contrainte est coûteuse sur un écran de
trace longue.

---

## 7. Ce que ce plan ne prouve pas

- **Aucun code n'a été modifié** ; aucune gate lancée dans cette passe. Les
  vérifications faites ici sont des **lectures de code** ciblées
  (`release-gate.ts`, `proxy.ts`, `vitest.config.ts`, `package.json`,
  `dashboard-overview.ts`, `check-render-truth.mjs`) destinées à trancher trois
  points litigieux entre manifestes.
- **Aucun écran n'a été ouvert**, aucun navigateur lancé.
- Les comptes de lignes en base viennent de `data-manifest.md` (interrogation
  réelle du 2026-07-31) et **périment immédiatement**.
- Les estimations de dépendance entre PR sont des **déductions** de la structure
  des routes, pas des contraintes vérifiées par exécution.
