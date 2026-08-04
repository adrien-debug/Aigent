# REPOSITORY_MAP — carte du dépôt Aigent

> **À quoi sert ce fichier.** Permettre à un nouvel agent (ou humain) de savoir
> *où est quoi* et *où modifier quoi* sans reconstruire toute la compréhension du
> dépôt. C'est une **carte**, pas de la doctrine : en cas de contradiction avec le
> code, **le code a raison**.
>
> — Ce qu'est Aigent → `PRODUCT_DOCTRINE.md`
> — Invariants techniques → `AGENTS.md` · Méthode → `CLAUDE.md` · Surfaces → `DESIGN_DOCTRINE.md`
> — Couches & frontières → `docs/architecture.md`
> — **État réel, daté, prouvé** → `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`
> — Vocabulaire → `docs/GLOSSARY.md`
>
> Vérifié contre le code le **2026-08-04**. Les comptes de routes/fichiers sont
> vrais à cette date ; les comptes volatils (agents en base, tests) vivent dans la
> checklist, pas ici.

## 1. En une phrase

Aigent est le **control plane** (authoring · qualification · release · promotion)
**et le runtime gouverné canonique** (exécution · outils · gardes · HITL · preuve).
Les produits **consommateurs** appellent le runtime d'Aigent et lui renvoient leur
télémétrie. Boucle : `create → qualify → execute → observe → improve`.

## 2. Stack réelle (vérifiée dans `package.json`)

| Domaine | Techno | Note |
|---|---|---|
| Framework | **Next.js 16** (App Router) | ruptures d'API vs versions antérieures — lire `node_modules/next/dist/docs/` avant le code framework |
| UI | **React 19**, TypeScript strict, **Tailwind v4** | Tailwind = un seul plugin PostCSS (`postcss.config.mjs`), **pas** de `tailwind.config.js` |
| Composants | `@headlessui/react`, `@heroicons/react`, kit `ui/` (14 primitives) | Catalyst **vendoré** comme source de fork, pas importé |
| Graphes / anim | **`@xyflow/react`** (graphe runtime), **`motion`** / `@motionplus/core` | graphes cockpit = **SVG maison animé** ; ⚠️ **pas de `recharts`** (absent du dépôt) |
| Validation | **Zod 4** | payloads d'API |
| Runtime agents | **LangGraph** (`@langchain/langgraph`) | graphe `agent_builder`, seul runtime produit exécutable |
| LLM | `openai` SDK ; Gemini REST ; vLLM local | `src/lib/agent-mission-control/model-router.ts` |
| Données | **PostgREST** → Postgres `aigent` (GPU1), clé service-role, server-only | aucun ORM ; schéma dans `supabase/migrations/` |

## 3. Arborescence de premier niveau

```
Aigent/
├── src/                 code applicatif (413 fichiers) — voir §4
├── supabase/migrations/ schéma versionné 0001..0049 (PostgREST/Postgres) — §7
├── scripts/             gates check-*.mjs + scripts d'exploitation — §8
├── tests/               unit (offline, ~200 fichiers) · live (opt-in, 11) · fixtures
├── deploy/              conteneurs : app/ · db/ (PostgREST) · langgraph/ · observability/
├── vendor/              catalyst-ui-kit/ — VENDORED (source de fork du kit ui/)
├── vault/               coffre Obsidian (agents/architecture/templates) — non exécutable
├── docs/                cette carte + doctrine d'appoint + archives + preuves — §10
├── public/              actifs statiques
├── PRODUCT_DOCTRINE.md · AGENTS.md · CLAUDE.md · DESIGN_DOCTRINE.md   (gouvernance)
├── README.md            porte d'entrée
├── package.json         gates (`check` = 19 étapes) — fait foi
├── langgraph.json       déclare le graphe agent_builder + auth
├── next.config.ts · tsconfig.json · eslint.config.mjs · .oxlintrc.json · knip.json
├── .env.example         inventaire des variables d'environnement (placeholders)
└── .langgraph_api/      GÉNÉRÉ — état local du serveur langgraphjs dev (git-ignoré)
```

## 4. `src/` — carte détaillée

```
src/
├── proxy.ts             garde d'identité (convention Next `proxy` — PAS de middleware.ts)
├── app/                 App Router : pages + routes API (§5)
├── components/          composants UI par domaine + kit ui/ + navigation.ts (§6)
├── langgraph/           graphe agent_builder, tools, auth, garde d'exécution (§ runtime)
├── lib/                 logique métier server-only (§ ci-dessous)
└── theme/               jetons --aig-* et utilities.css (autorité sémantique DS)
```

**`src/lib/` — server-only.**

| Chemin | Rôle | Statut |
|---|---|---|
| `agent-mission-control/` | data layer, runner, model-router, lifecycle, auth, ~100 fichiers plats + sous-domaines | ACTIVE |
| `agent-mission-control/registry/` | **registre canonique** runtimes + outils — l'autorité unique | ACTIVE |
| `agent-mission-control/market/` | domaine **trading**, **read-only** (route `market-tools`) | ACTIVE |
| `agent-mission-control/realestate/` | domaine outils immobilier (route `realestate-tools`) | ACTIVE |
| `agent-mission-control/tool-builder/` | Tool Builder : mission, sandbox, `count_words` (route `tool-build-missions`) | ACTIVE |
| `agent-mission-control/project-team/` | relations projet↔agent (routes `projects/[id]/relations`, `/team`) | ACTIVE |
| `agent-mission-control/evidence/` | seam d'adaptateurs de preuve (deterministic / execution / live) pour test/bench | ACTIVE |
| `agent-mission-control/dropship/` | roster importé (config) — **import interdit par `check:agent-truth`** depuis `src/app`/`src/components` ; exécuteurs restés côté dropship | EXPERIMENTAL |
| `runs-console/` | métriques, filtres, séries temporelles des runs — testé | ACTIVE |
| `cockpit/` | agrégation cockpit (`named-runs.ts`…) alimentant `/` | ACTIVE |

Les répertoires `src/app/admin/`, `src/app/(site)/` et `src/theme.css`
**n'existent plus** et leur retour est refusé par `check:no-legacy-front`.

## 5. Routes — pages & API

À la date de vérification : **21 pages** (`page.tsx`) et **76 routes API**
(`route.ts`).

- Le catalogue des surfaces vit dans **`src/components/navigation.ts`** (source
  unique ; `MAIN_NAVIGATION` décide ce qui s'affiche dans le rail).
- Répartition des routes API :

| Groupe | Routes | Appelant | Credential |
|---|---|---|---|
| `/api/agent-ops/**` | 66 | opérateur / automatisation Aigent | cookie de session HMAC **ou** `x-amc-key` (via `src/proxy.ts`) |
| `/api/runtime/v1/**` | 7 | produit consommateur (lecture agents / contrôle runs) | jeton **par installation** OU jeton legacy `AIGENT_RUNTIME_API_TOKEN` (`resolveRuntimeTenant`) |
| `/api/runtime-telemetry` | 1 | agent déployé chez un consommateur | `AIGENT_RUNTIME_TELEMETRY_TOKEN` (jamais `AMC_API_KEY`) |
| `/api/runtime-telemetry/consumer` | 1 | **installation** consommateur identifiée | jeton **par installation**, haché SHA-256 au repos, révocable |
| `/api/auth/login` | 1 | frappe de session admin | mot de passe → cookie signé (rate-limité, constant-time) |

**Quatre frontières de confiance, séparées exprès** (détail dans `AGENTS.md`) —
les valeurs de jetons ne sont jamais partagées ; seules l'extraction et la
comparaison constant-time sont mutualisées (`bearer-token-auth.ts`).

## 6. Frontend & Design System

- **Kit UI** : `src/components/ui/` — **14 primitives** (avatar, badge, button
  [+TouchTarget], checkbox, dialog, divider, fieldset, heading, input, link,
  sidebar, table, text, textarea), barrel `ui/index.ts`. Code du repo, linté.
  Gate `check:ui-kit-integrity` garde la **substance**, pas les pixels.
- **App shell** : `src/components/app-shell.tsx`. **Navigation** :
  `src/components/navigation.ts`.
- **Composants métier** : `src/components/{cockpit,agents,runs,projects,builder,
  qualification,delivery,runtime,learning,actions,settings,visualizations}/`.
- **Exploration** : `src/components/lab/` + `src/app/lab/**` (3 routes hors
  navigation, données fabriquées) — **EXPERIMENTAL**, isolé de la production
  (`DESIGN_DOCTRINE.md` §9).
- **Autorité couleur** : jetons `--aig-*` (`src/theme/`). DS obligatoire en
  production. **Aucune gate ne mesure le rendu** — preuve visuelle humaine
  obligatoire.

## 7. Données & migrations

- `supabase/migrations/` — **0001 → 0049**, **47 fichiers** (anomalie de
  numérotation `0041a` ; numéros 0036/0038/0039 absents = trous de numérotation,
  pas une affirmation sur le comportement).
- Thèmes : socle mission-control (0001+), validation bench (0002), images/github
  projet (0003/0004), drops de providers (`0005` anthropic, `0021` mistral),
  durcissement anti-bypass de promotion (0028–0035), activation RLS
  (0044), installations consommateur (0045/0046), **identité corpus aval SHA-256
  + truth-measures** (0047/0048/0049).
- Invariants : toute nouvelle table **active RLS** + **grante `service_role`** ;
  une colonne de mesure est **nullable** (jamais `NOT NULL DEFAULT 0`) ; les
  écritures atomiques passent par une **RPC transactionnelle**
  (`promote_copilot_version`). Détail : `AGENTS.md` + `docs/BACKEND-GPU1.md`.

## 8. Scripts & gates

- **`npm run check`** = **19 gates statiques hors-ligne**, dans l'ordre de
  `package.json` (fait foi) : `typecheck` · `lint:fast` · `lint` ·
  `check:no-legacy-front` · `check:no-legacy-design-governance` ·
  `check:production-visual-authority` · `check:theme-foundation` ·
  `check:ui-kit-integrity` · `check:agent-truth` · `check:lifecycle-truth` ·
  `check:registry-parity` · `check:registry-integrity` · `check:dev-port` ·
  `check:render-truth` · `check:rsc-boundary` · `check:schema-rebuildable` ·
  `check:secrets` · `audit:dead` · `check:governance`.
- **`npm run verify`** ajoute `quality:dead` (knip) · `test` (vitest offline) · `build`.
- **Carte des angles morts** : `scripts/README-gates.md` — colonne « ne garantit
  PAS ». Aucune gate ne mesure le rendu ni ne prouve qu'un agent exécute ses
  outils (piège de l'assistant LangGraph manquant).
- **Commandes d'exploitation** (touchent le backend, hors `check`) : `health`,
  `dev:stack`, `seed:amc`, `provision:agent-builder`, `reprovision`,
  `materialize:trading`, `eval:trading`, `export:trading`, `sync:tool-definitions`,
  `check:tool-rows`/`check:tool-definitions` (⚠️ `--fix` **écrit en base**),
  `check:vault`, `prove:learning-e2e`. **Aucune n'écrit de sa propre initiative
  sans double verrou.**
- **Hook secret** : `npm run hooks:install` câble le `pre-commit` gitleaks.

## 9. Zones du dépôt — classification

| Zone | Statut | Comment déterminé |
|---|---|---|
| `src/app`, `src/components`, `src/lib`, `src/langgraph`, `src/theme` | **ACTIVE** | importées, routées, gardées par les gates |
| `src/components/lab/`, `src/app/lab/**` | **EXPERIMENTAL** | hors `navigation.ts`, données fabriquées, régime `DESIGN_DOCTRINE.md` §9 |
| `src/lib/agent-mission-control/dropship/` | **EXPERIMENTAL** | aucun importer prod ; import prod interdit par `check:agent-truth` |
| `vendor/catalyst-ui-kit/` | **VENDORED** | ~27 `.tsx` de fork ; **zéro `import`** depuis `src` (source de copie du kit) |
| `.langgraph_api/` | **GENERATED** | état local du serveur langgraphjs dev ; git-ignoré |
| `docs/templates/obsidian/` | **GENERATED** | gabarits `{{var}}` substituables, non exécutables |
| `docs/visual-reviews/`, `docs/runtime-evidence/` | **ARCHIVED** (preuves datées) | READMEs/PNG/JSON datés — jamais des règles |
| `docs/known-gaps.md`, `current-capabilities.md`, `product-vision.md`, `cockpit-catalyst-migration.md`, `trading-agent-factory.md`, `runbook-trading-factory.md` | **ARCHIVED** | bandeau ARCHIVE présent dans chaque fichier |
| `docs/projects/real-estate-agent/**` | **ACTIVE** (specs) | specs agents par produit consommateur, statut « spécification » |

> Une zone `EXPERIMENTAL`/`ARCHIVED` **n'est pas supprimée** par cette mission :
> elle est classée, pas jugée.

## 10. Où modifier quoi ?

| Je veux… | Ça vit dans… |
|---|---|
| Un écran | `src/app/<route>/page.tsx` + `src/components/<domaine>/` |
| Une primitive UI | `src/components/ui/` (couleurs = jetons `--aig-*`), puis **regarder un écran** |
| La navigation | `src/components/navigation.ts` (source unique) |
| La logique métier | `src/lib/agent-mission-control/` |
| Le registre d'outils / runtimes | `src/lib/agent-mission-control/registry/` |
| Le routage de modèle (provider) | `src/lib/agent-mission-control/model-router.ts` |
| Une route API | `src/app/api/**` (server-only, fail-closed) |
| Une nouvelle frontière de confiance | route hors `/api/agent-ops/**` **+ auth propre explicite** |
| Le graphe d'agents / un outil | `src/langgraph/` (`agent_builder`, `tools/`) |
| Le schéma DB | `supabase/migrations/` (numéro suivant **sur disque** ; RLS + grant `service_role`) |
| Une gate | `scripts/check-*.mjs` + entrée dans `package.json` |
| Un test | `tests/unit/` (offline) ; `tests/live/` uniquement si opt-in facturé |
| Une variable d'env | `.env.example` (nom + rôle, **jamais** de valeur) |
| Le déploiement | `deploy/<app|db|langgraph|observability>/` |
| L'état fonctionnel | `docs/CURRENT_FUNCTIONAL_CHECKLIST.md` (mise à jour à chaque review/rework/merge/déploiement) |

## 11. Inventaire documentaire

**Canonique (règles / autorité)** — `PRODUCT_DOCTRINE.md`, `AGENTS.md`,
`CLAUDE.md`, `DESIGN_DOCTRINE.md`, `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`.

**Cartes / références utiles** — `README.md`, `docs/architecture.md` (voir §12),
`docs/REPOSITORY_MAP.md` (ce fichier), `docs/GLOSSARY.md`, `docs/metrics-canon.md`,
`docs/agent-authoring.md`, `docs/BACKEND-GPU1.md` (comptes de schéma périmés),
`docs/dev-runtime.md`, `docs/TESTING.md` (compte de tests périmé),
`docs/langsmith-studio.md`, `docs/learning-runtime-and-obsidian.md`,
`docs/ui-layers-guide.md`, `scripts/README-gates.md`.

**Archives (bandeau, ne jamais citer comme règle)** — `docs/known-gaps.md`,
`docs/current-capabilities.md`, `docs/product-vision.md`,
`docs/cockpit-catalyst-migration.md`, `docs/trading-agent-factory.md`,
`docs/runbook-trading-factory.md`.

**Preuves datées (évidence, pas règle)** — `docs/visual-reviews/**`,
`docs/runtime-evidence/**`.

## 12. Dérives doc↔code connues (le code fait foi)

Écarts vérifiés dans le code au 2026-08-04. **La correction des fichiers de
gouvernance relève d'une mission de gouvernance dédiée** (`CLAUDE.md` §9) — elles
sont donc listées, pas réécrites ici.

| # | Écart | Dit par | Vérité (code) |
|---|---|---|---|
| 1 | Portée du proxy | `AGENTS.md`, `docs/architecture.md` : « garde uniquement `/api/agent-ops/**` », « les pages ne sont pas couvertes » | `src/proxy.ts` garde **tout** sauf une allowlist ; pages sans session → 302 `/sign-in`. `agent-ops` est seulement la seule à accepter aussi `x-amc-key` |
| 2 | Nombre de frontières | `docs/architecture.md` : **trois** | **Quatre** (la 4ᵉ = `/api/runtime-telemetry/consumer`, jeton par installation). `AGENTS.md` dit correctement quatre |
| 3 | Credential runtime/v1 | `docs/architecture.md` : jeton unique `AIGENT_RUNTIME_API_TOKEN` | deux formes : jeton **par installation** OU jeton legacy (`resolveRuntimeTenant`) |
| 4 | Liste des gates | `README.md`, `scripts/README-gates.md`, `docs/current-capabilities.md` : 15–17 gates | **19** (`check:theme-foundation` et `check:governance` manquent aux listes) |
| 5 | Librairie de graphes | `README.md` + `current-capabilities.md` + `cockpit-catalyst-migration.md` + `scripts/README-gates.md` : « Recharts » | **absent du dépôt** ; graphes cockpit = SVG maison (`motion`), graphe runtime = `@xyflow/react` |
| 6 | Schéma DB | `docs/BACKEND-GPU1.md` : « 0001→0015, 25 tables » | migrations jusqu'à **0049** ; comptes périmés |
| 7 | Compte de tests | `docs/TESTING.md` : « 1200 tests / 100 fichiers » | ~200 fichiers `tests/unit` ; compte à jour → checklist |
| 8 | Docstring navigation | `src/components/navigation.ts` : « onze surfaces » | l'array `NAVIGATION` déclare **plus** d'entrées (12) |
| 9 | Table du kit `ui/` | `src/components/ui/README.md` : liste `navbar`, omet `input`, cite `ui-kit-catalog.tsx` | pas de `navbar.tsx` (Catalyst only) ; `input.tsx` présent et requis ; `ui-kit-catalog.tsx` absent |
| 10 | « Free design » / renvois périmés | `current-capabilities.md`, `ui-layers-guide.md`, `agent-authoring.md` (« AGENTS.md § Frontend », « CLAUDE.md §8 » comme design, `check:catalyst-integrity`) | DS obligatoire (`DESIGN_DOCTRINE.md`) ; `AGENTS.md` n'a pas de « § Frontend », `CLAUDE.md §8` = Secrets, la gate est `check:ui-kit-integrity` |

**Action recommandée** : une mission de gouvernance réconcilie `AGENTS.md` +
`docs/architecture.md` sur les points 1–3 (les plus porteurs). Les points 4–10
sont des corrections de docs non-gouvernance, à faire au fil des missions qui
touchent ces surfaces.
