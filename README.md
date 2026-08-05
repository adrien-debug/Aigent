# Aigent — Agent Mission Control

**The central plane where LLM agents are created, qualified, shipped, observed
and improved.** Aigent is not the product an end user touches: the agents it
produces run inside *consumer* products, those products report their runs back
here, and Aigent turns that history into governed V2s.

```
   create → qualify → ship ──► CONSUMER PRODUCT executes the agent
      ↑                                    │
      └──── improve ◄──── telemetry ◄──────┘
```

- **`docs/product-vision.md`** — what the platform is for, and what it is not.
- **`docs/current-capabilities.md`** — every capability with its real state
  (wired / partial / backend-only / not wired) and the file that proves it.
- **`docs/architecture.md`** — layers, trust boundaries, directory map.
- **`docs/known-gaps.md`** — what is honestly missing.

Everything is server-only and **fail-closed**. Without the live backend and the
credentials for the provider a given run selects, data and execution paths
return `503` / `ProviderUnavailableError`. There is no mock path for agent
authoring or runs.

Le tronçon aval versionne désormais son corpus par un SHA-256 canonique et exige
la même empreinte sur qualification, shadow, replay, proposition et comparaison
V1/V2. Un hash absent ou différent produit `INSUFFICIENT_EVIDENCE`, jamais un
delta flatteur. Ce câblage requiert les migrations additives `0047` et `0048` ;
tant qu’elles ne sont pas appliquées au backend, le parcours réel reste
indisponible et n’est pas déclaré fonctionnel.

## Frontend

Le front historique a été supprimé (mission `frontend-reset`), puis reconstruit à
partir du **2026-07-31**.

> **Le compte d'écrans et leur état ne vivent pas ici.** Ils vivent dans
> `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`, seule source cumulative de l'état réel.
> Un compte recopié dans un README est faux à la mission suivante — ça a déjà
> été le cas de celui-ci.

| Route | Rôle |
|---|---|
| `/` | Aperçu — KPI 24 h, activité, flux d'exécution, file d'action |
| `/runs` · `/agents` · `/projects` | Listes + détail (`/agents/[copilotId]`, `/projects/[id]`) |
| `/builder` · `/builder/[projectId]` | Construction d'agents |
| `/qualification` · `/qualification/[copilotId]` | Qualification avant livraison |
| `/delivery` · `/delivery/[copilotId]` | Livraison vers un repo consommateur |
| `/runtime` | Santé du canal de télémétrie |
| `/learning` | Supervision, file de revue, évaluations, pont Obsidian, Learning Runtime |
| `/actions` | File opérateur complète — reprise des runs en attente d'approbation |
| `/settings` | Réglages (UI placeholder, backend posture disponible via `/api/agent-ops/settings/posture`) |

| Élément | État |
|---|---|
| Shell | `src/components/app-shell.tsx` — graphite continu (`--aig-*`), rail creux + zone de travail un palier au-dessus |
| CTA / liens accent | `aig-btn-accent` et `aig-link-accent` dans `src/theme/utilities.css` — posés sur `Button` / `Link` Catalyst, pas de fork `ui/` |
| `/agents` | Page pilote recomposée en liste produit + détail éditorial, sans grille de panneaux |
| Kit UI | `src/components/ui/` — **14 primitives**, toutes consommées ; `Link` branché sur `next/link` (Catalyst + App Router) ; code du repo, linté (`src/components/ui/README.md`) |
| Composants métier | `src/components/{cockpit,agents,runs,projects,builder,qualification,delivery,runtime}/` |
| Console `/admin` | **Absente** et interdite de retour |
| Marketing `(site)/`, `/login`, `src/theme.css` | **Absents** et interdits de retour |
| API · Backend | **Actifs** — `src/app/api/**`, `src/lib/**`, LangGraph, migrations |

**Le Design System est obligatoire sur les surfaces de production**
(`DESIGN_DOCTRINE.md`). Les jetons `--aig-*` sont l'autorité sémantique ; le kit
`ui/` et Catalyst se réutilisent avant toute création maison ; toute
modification d'une surface de production exige une preuve visuelle.

`/lab` (Composer/Lab/Prototype) est une **surface d'exploration** : elle ne crée
aucune règle produit et ne contourne ni l'accessibilité, ni la vérité des
données, ni la sécurité. Une promotion vers une surface production exige revue
humaine, normalisation sémantique, responsive, a11y et tests adaptés.

Trois gates encadrent le front, avec responsabilités séparées :
- `check:no-legacy-front` — refuse le retour des surfaces démolies ;
  `src/components/` est autorisé.
- `check:no-legacy-design-governance` — bloque uniquement le retour de l'ancienne
  doctrine (zéro-scroll obligatoire, viewport lock, DS Guardian, `check:ds`,
  `check:catalyst`, sync externe de gouvernance).
- `check:production-visual-authority` — garde uniquement les surfaces de
  production : autorité sémantique unique des statuts, pas de palette parallèle
  structurante, pas de couleur littérale hors thème dans les écrans produit.
  Exclusions explicites : `Composer`/`Lab`, prototypes, visualisations externes,
  fichiers globaux de tokens.
- `check:ui-kit-integrity` — vérifie la **substance** du kit `ui/` : les 14
  primitives et leurs 43 exports consommés, la cible tactile de 44 px en
  contexte tactile, les marqueurs d'accessibilité, zéro couleur Tailwind brute,
  et depuis **AIGENT-DS-REFACTOR-002** l'usage des jetons DS (radius 4/8/16,
  `shadow-(--shadow-*)`, pas d'`oklch()` littéral). Barrel `ui/index.ts` vérifié
  si présent. Elle interdit la **perte**, pas le changement : modifier une
  primitive est légitime et ne demande aucune régénération.

> ⚠️ **Angle mort connu.** Aucune gate ne mesure le rendu. Le 2026-07-31, une
> réécriture du kit a supprimé 2438 lignes pour en écrire 257 (`TouchTarget` vidé
> de sa cible tactile de 44 px, `Button` réduit à 4 couleurs sur les 6 consommées)
> — **les 15 gates sont restées vertes**, le build aussi. Revert `5e2aa63`.
> Après toute modification d'une primitive : ouvrir un écran qui la consomme et
> regarder. Une gate verte prouve ce qu'elle mesure, rien de plus.

## Notable partial capabilities

State the restriction, not the headline:

- **Shipping to a consumer repo** is a **dry run** unless `confirm: true` is in
  the request body **and** `GITHUB_PUSH_ENABLED=1` is in the environment.
- **Telemetry** is aggregated in `dashboard-overview.ts` and `agent-detail.ts`,
  and surfaced on `/` and `/runs`. A run that reported no usage shows
  `Non mesuré` — never a fabricated `0` (`docs/metrics-canon.md`).
- **Consumer proof chain (installations)** uses the dedicated route
  `/api/runtime-telemetry/consumer`: each accepted event must match a real
  installation (`project_id`, `copilot_id`, `version_id`, `delivery_event_id`),
  and only rows with `version_verified=true` can contribute to
  `active_in_consumer`.
- **Lifecycle version drift** is computed from persisted evidence only:
  `agent_delivery_events.version_id` vs `runtime_telemetry_events.agent_version`.
  Missing proof stays `unknown`; no timestamp/name/position inference.
- **Tool builder** sandboxing is generic/fail-closed: explicit capability
  allowlist, timeout, I/O bounds, isolated empty env context, and outcomes
  limited to `certified | failed | unavailable`. `count_words` is the first
  registered sandboxed tool.
- **Provider `mistral`** is declared and **not wired** — it throws a typed error
  rather than falling back silently.
- **Provider `local`** (vLLM) requires an explicit opt-in key.
- **Settings backend** is wired read-only at
  `/api/agent-ops/settings/posture` (redacted server-only posture contract); the
  `/settings` UI remains intentionally placeholder for now.

## Stack

- **Next.js 16** App Router — ⚠️ breaking changes vs. older Next; read
  `node_modules/next/dist/docs/` before touching framework code (`AGENTS.md`).
- **React 19**, TypeScript, **Tailwind v4**, Headless UI, Heroicons, `@xyflow/react`
  (graphe runtime), `motion` (animations ; graphes cockpit en SVG maison), `clsx`.
  Kit `src/components/ui/` : 14 primitives maison, issues d'un
  fork Catalyst mais **plus réalignées sur l'amont** — c'est du code du repo,
  linté et typé comme le reste.
- **LangGraph** — the `agent_builder` graph in `src/langgraph/`, served by the
  official LangGraph Agent Server. Mandatory runtime for every agent.
- **Direct model-router** (`src/lib/agent-mission-control/model-router.ts`) —
  per-copilot provider, routing to OpenAI / Gemini / local vLLM.
- **Postgres via PostgREST** — the `aigent` perimeter on GPU1, service-role,
  server-only. See `docs/BACKEND-GPU1.md`.

## Getting started

```bash
cp .env.example .env.local   # fill in real values; never commit this file
npm run dev
```

Runs both servers together:

- **Next.js → http://localhost:3987** — the app shell on `/`.
  **Never port 3000. Never port 3210.** See `AGENTS.md` § "Port de dev".
- **LangGraph Agent Server → http://127.0.0.1:2024** — serves `agent_builder`.

Either alone: `npm run dev:next` / `npm run langgraph`. Studio:
`npm run langgraph:studio`.

Required env: `AMC_DATA_SOURCE=gpu1`, `AMC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `AMC_SESSION_SECRET`, `OPENAI_API_KEY`. See
`.env.example` for the full list.

After a clone, arm the secret hook once: `npm run hooks:install` (see `CLAUDE.md`).

## Checks

```bash
npm run check      # gate statique complète — 19 étapes
npm run verify     # check + knip + tests unitaires + build
npm run typecheck
npm run lint
npm run test       # vitest tests/unit — compte à jour dans docs/CURRENT_FUNCTIONAL_CHECKLIST.md
npm run test:live  # opt-in — tape gpu1 + OpenAI, coûte de l'argent
```

`npm run check` enchaîne, dans l'ordre : `typecheck` · `lint:fast` · `lint` ·
`check:no-legacy-front` · `check:no-legacy-design-governance` ·
`check:production-visual-authority` · `check:theme-foundation` ·
`check:ui-kit-integrity` · `check:agent-truth` · `check:lifecycle-truth` ·
`check:registry-parity` · `check:registry-integrity` · `check:dev-port` ·
`check:render-truth` · `check:rsc-boundary` · `check:schema-rebuildable` ·
`check:secrets` · `audit:dead` · `check:governance`. Le premier rouge
arrête tout. **`package.json` fait foi** — pas cette liste.

Ce que la gate **ne** voit pas, et qu'il faut vérifier autrement : le rendu à
l'écran, la mise en page, un composant vidé de sa substance, un parcours réel de
bout en bout, une migration qui s'applique vraiment. La carte complète des angles
morts est dans `scripts/README-gates.md`.

Une gate rouge prime sur n'importe quelle phrase d'un `.md` — cette précédence est
posée dans `AGENTS.md`. L'inverse n'est pas vrai : une gate verte ne prouve que ce
qu'elle mesure.

## Mode d'emploi — travailler sur ce repo

**Où est quoi**

| Je veux toucher… | Ça vit dans… |
|---|---|
| Un écran | `src/app/<route>/page.tsx` + `src/components/<domaine>/` |
| Une primitive UI | `src/components/ui/` — couleurs en jetons `--aig-*`, puis regarder un écran qui la consomme |
| La navigation | `src/components/navigation.ts` (source de vérité unique) |
| La logique métier | `src/lib/agent-mission-control/` |
| Une route API | `src/app/api/**` — server-only, fail-closed |
| Le graphe d'agents | `src/langgraph/` (`agent_builder`) |
| Le schéma DB | `supabase/migrations/` — toute table doit y être créée (`check:schema-rebuildable`) |
| Une gate | `scripts/check-*.mjs` + son entrée dans `package.json` |

**Boucle de travail**

```bash
npm run dev                  # Next :3987 + LangGraph :2024 ensemble
# … coder …
npm run check                # ~13 s, avant de committer
# si une surface visuelle a bougé : ouvrir l'écran et REGARDER
npm run verify               # avant un push qui touche le build
```

**Trois pièges déjà payés**

1. **Port** — jamais 3000, 3001 ni 3210. Le dev est épinglé sur **3987**
   (`check:dev-port` le vérifie dans 4 résolveurs).
2. **Kit UI** — modifier une primitive est légitime ; `check:ui-kit-integrity`
   refuse la **perte** (un export consommé, la cible tactile de 44 px, un
   marqueur d'accessibilité, une couleur Tailwind brute). Les couleurs viennent
   des jetons `--aig-*`. Après modification, **regarder un écran qui la
   consomme** : aucune gate ne mesure le rendu.
3. **Aucune donnée fabriquée** — une valeur absente s'affiche `Non mesuré`,
   jamais `0`. `check:render-truth` et `check:lifecycle-truth` refusent les zéros
   inventés, les `NaN` coercés et les statuts non prouvés.

**Gouvernance locale, et elle le reste.** Aucun script de setup extérieur ne doit
réinstaller des règles ou des gates ici (`CLAUDE.md` §9). `.claude/settings.json`
désactive explicitement les plugins d'organisation.

## Where the rules live

**Governance is 100 % local.** Four rule files + the gates declared in
`package.json` are the complete set of rules for this project. No remote
repository, no external doctrine, no plugin, no governance SHA and no sync
command is needed to work on Aigent — you can understand and develop it offline
from this repository alone.

- **`PRODUCT_DOCTRINE.md`** — ce qu'est Aigent, qui l'utilise, la décision
  d'architecture runtime, la boucle create → qualify → execute → observe →
  improve, et la frontière avec les produits consommateurs.
- **`DESIGN_DOCTRINE.md`** — le Design System des surfaces de production :
  autorité des jetons, réutilisation du kit, états obligatoires, accessibilité,
  preuves visuelles, régime des zones d'exploration.
- **`AGENTS.md`** — invariants techniques : port, runtime, frontières de
  confiance, authentification, vérité des données, migrations, shipping.
- **`CLAUDE.md`** — méthode d'exécution : une issue / une branche / une PR,
  autonomie, quand demander, staging nommé, STOP en review, merge et
  déploiement sur ordre explicite.
- **`docs/CURRENT_FUNCTIONAL_CHECKLIST.md`** — **l'état réel**, cumulatif et
  prouvé : fonctionnel, testé, mergé, déployé, non fonctionnel, limites,
  prochaines étapes. À reprendre à chaque mission, jamais à recréer ailleurs.
- **`docs/REPOSITORY_MAP.md`** — carte du dépôt : arborescence, frontières, zones
  (active / expérimentale / vendorée / archive), « où modifier quoi », inventaire
  documentaire et **dérives doc↔code connues** (le code fait foi).
- **`docs/GLOSSARY.md`** — vocabulaire du projet (copilot, manifeste, promotion,
  shadow/replay, runtime gouverné, installation consommateur…).
- **`docs/metrics-canon.md`** — how a number is allowed to be displayed.
- **`docs/agent-authoring.md`** — authoring flow and execution paths.
- **`docs/BACKEND-GPU1.md`** — Postgres/PostgREST perimeter.
- **`docs/TESTING.md`**, **`docs/dev-runtime.md`** — test and runtime specifics.
- **`docs/projects/`** — specs agents par produit consommateur (ex. real-estate).
- Rapports de mission datés : **historique git**, pas de dossier d'archive vivant.
