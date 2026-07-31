# Manifeste des tests & gates — Aigent

> **Relevé daté du 2026-07-31**, branche `mission/cockpit-catalyst-migration`
> (HEAD `a1f6193`). Ce document est une **observation**, pas une règle
> (`CLAUDE.md` §1). Les chiffres dérivent au premier commit : ils sont datés,
> pas gravés.
>
> Méthode : les deux chaînes ont été **réellement exécutées**, pas supposées.
> Tout ce qui est écrit « vert » ci-dessous a une sortie de commande derrière.

---

## 0. Résultat réel des deux commandes

### `npm run check` → **exit 0** (chaîne complète verte)

Les 13 étapes, dans l'ordre du `package.json`, avec leur sortie réelle :

| # | Étape | Sortie |
| --- | --- | --- |
| 1 | `typecheck` (`tsc --noEmit`) | silencieux, exit 0 |
| 2 | `lint:fast` (`oxlint src`) | **4 warnings** (non bloquants) `unicorn(no-array-sort)` |
| 3 | `lint` (`eslint`) | silencieux, exit 0 |
| 4 | `check:no-legacy-front` | ✓ — 286 fichiers scannés sous `src/` |
| 5 | `check:catalyst-integrity` | ✓ — 27 fichiers vérifiés par empreinte SHA-256 |
| 6 | `check:agent-truth` | ✓ — 109 fichiers runtime, 4 cibles protégées présentes |
| 7 | `check:lifecycle-truth` | ✓ |
| 8 | `check:registry-parity` | ✓ — 22 buildable / 17 runnable (5 natifs + 9 market + 3 realestate) |
| 9 | `check:registry-integrity` | ✓ — 22 outils, 4 runtimes, hash `882a2de4` |
| 10 | `check:dev-port` | ✓ — port 3987 épinglé dans 4 resolvers |
| 11 | `check:render-truth` | ✓ — **4 fichiers scannés** dans `src/lib/runs-console` |
| 12 | `check:secrets` (gitleaks) | ✓ — 1027 commits, 13.53 MB, no leaks found |
| 13 | `audit:dead` | ✓ — **9 composants vérifiés** (kit `ui/` exclu) |

Les 4 warnings oxlint (informatifs, n'échouent pas) :

```
src/lib/cockpit/named-runs.ts:93:6      unicorn(no-array-sort)
src/lib/cockpit/named-runs.ts:142:34    unicorn(no-array-sort)
src/lib/cockpit/overview-series.ts:110:32  unicorn(no-array-sort)
src/components/cockpit/overview-screen.tsx:61:44  unicorn(no-array-sort)
```

### `npm test` (`vitest run tests/unit`) → **exit 0**

```
 Test Files  151 passed (151)
      Tests  1721 passed (1721)
   Duration  7.20s
```

Deux lignes `export-trading-packages FAILED: EXPORT BLOCKED …` apparaissent en
sortie : ce sont des **logs attendus** de `export-trading-packages.test.ts`, qui
teste que l'export refuse un contrat safety-critical invalide. Ce ne sont pas des
échecs.

**Aucun échec, aucun test skippé, aucun test `.todo` dans la suite unitaire.**

---

## 1. Suites de tests

### Vue d'ensemble

| Suite | Fichiers | Tests | Réseau | Lancée par |
| --- | --- | --- | --- | --- |
| `tests/unit/**` | 151 | **1721** | **offline** | `npm test`, CI |
| `tests/live/**` | 9 | 57 (déclarés) | **live** (GPU1 + OpenAI, facturé) | `npm run test:live` **uniquement**, opt-in |

Config : `vitest.config.ts`, `environment: 'node'`, `globals: false`,
`testTimeout: 30_000`, alias `@` → `src`, conditions de résolution
`react-server, node, import, default` (donc les modules server-only se résolvent
comme en production).

**Piège de config à connaître** : le champ `include` de `vitest.config.ts` liste
`['tests/unit/**/*.test.ts', 'tests/live/**/*.test.ts']` — donc **les deux**. La
séparation offline/live ne tient PAS à la config mais à l'argument de chemin des
scripts npm (`vitest run tests/unit` vs `vitest run tests/live`). Un `npx vitest
run` nu lancerait la suite live. Par ailleurs `setupFiles: ['tests/live/setup.ts']`
s'applique aussi à la suite unitaire : il charge `.env.local` dans `process.env`
avant **tous** les tests, y compris offline.

### `tests/live/**` — 9 fichiers, opt-in, hors CI

| Fichier | Tests | Couvre |
| --- | --- | --- |
| `promotion-direct-write-lockdown.live.test.ts` | 14 | verrouillage des écritures directes de promotion, en base réelle |
| `promotion-privilege-separation.live.test.ts` | 14 | séparation des privilèges de promotion, en base réelle |
| `dropship-behavior.test.ts` | 12 | comportement des copilots dropship contre le vrai runtime |
| `auth-and-security.test.ts` | 6 | les trois frontières d'authentification contre le serveur live |
| `promotion-antibypass.live.test.ts` | 5 | anti-bypass de la RPC `promote_copilot_version` |
| `langfuse-export.test.ts` | 3 | export de traces vers Langfuse |
| `copilot-run.test.ts` | 1 | un run de copilot de bout en bout |
| `hitl-resume.test.ts` | 1 | interrupt/resume human-in-the-loop |
| `missions-api.test.ts` | 1 | API missions live |

Chaque fichier porte sa propre sonde (`resolveLiveStack` / `hasBackendEnv`) et se
**skippe** si le backend n'est pas configuré. `tests/live/setup.ts` charge
`.env.local` s'il existe, sinon laisse `process.env` tel quel.

### `tests/unit/**` — les 20 plus gros fichiers

| Tests | Fichier | Couvre |
| --- | --- | --- |
| 60 | `project-team-relations.test.ts` | relations d'équipe projet (graphe, contraintes) |
| 57 | `dashboard-overview.test.ts` | agrégations de l'overview (vérité des données) |
| 40 | `project-team-graph.test.ts` | construction du graphe d'équipe |
| 38 | `agent-lifecycle-capabilities.test.ts` | capacités déclarées du cycle de vie |
| 38 | `promotion-gate.test.ts` | gate de promotion (les 9 checks) |
| 36 | `dev-stack.test.ts` | résolution de port, garde anti-kill du dev stack |
| 29 | `project-team-relations-write.test.ts` | écritures de relations |
| 29 | `target-repo-sandbox.test.ts` | sandbox de repo cible |
| 28 | `project-team-layout.test.ts` | layout du graphe d'équipe |
| 27 | `project-team-status.test.ts` | statuts d'équipe |
| 25 | `health-check.test.ts` | health check |
| 25 | `shadow-replay-routes.test.ts` | routes shadow / replay |
| 23 | `market-roster.test.ts` | roster trading |
| 23 | `tool-builder.test.ts` | Tool Builder (certification par test) |
| 22 | `benchmark-runner-runtime-routing.test.ts` | routage runtime du runner de benchmark |
| 22 | `project-copilots-route.test.ts` | route copilots d'un projet |
| 21 | `http-guard.test.ts` | garde HTTP |
| 21 | `runtime-telemetry-generator.test.ts` | génération de télémétrie runtime |
| 20 | `runtime-telemetry-cost.test.ts` | coût dans la télémétrie (pas de faux zéro) |
| 18 | `agent-health.test.ts` | santé d'agent |
| 18 | `qualification-orchestrator.test.ts` | orchestration de qualification |

Blocs thématiques dominants : **promotion / anti-bypass** (6 fichiers), **vérité
des données** (`data-truth-canon`, `cost-truth`, `render-truth` côté données),
**registre d'outils** (`canonical-registry`, `registry-runtimes`, `resolve-tool-id`,
`tool-confirmation-invariant`), **domaine market** (18 fichiers), **project-team**
(7 fichiers), **télémétrie runtime** (6 fichiers), **runs-console** (5 fichiers
dans `tests/unit/runs-console/`), **cockpit** (1 seul fichier :
`tests/unit/cockpit/overview-series.test.ts`, 9 tests).

---

## 2. Les gates de `npm run check` — ce qu'elles vérifient, ce qu'elles ne garantissent PAS

Composition réelle (source : `package.json`, autorité) :

```
typecheck · lint:fast · lint · check:no-legacy-front · check:catalyst-integrity ·
check:agent-truth · check:lifecycle-truth · check:registry-parity ·
check:registry-integrity · check:dev-port · check:render-truth ·
check:secrets · audit:dead
```

| Gate | Vérifie EXACTEMENT | Ne garantit PAS |
| --- | --- | --- |
| `typecheck` | `tsc --noEmit` sur tout le projet | rien au runtime — le repo a déjà eu typecheck + build + 1483 tests verts sur un graphique **mort au rendu** |
| `lint:fast` (oxlint) | `src` seulement. **Les 4 warnings actuels n'échouent pas** | ni `scripts/`, ni `tests/` ; un warning n'est pas une gate |
| `lint` (eslint) | config `eslint-config-next` | idem — rien de sémantique |
| `check:no-legacy-front` | 5 répertoires interdits absents (`design`, `docs/visual-reviews`, `src/app/admin`, `src/app/(site)`, `src/app/login`), `src/theme.css` absent, 3 fichiers de squelette **présents** (`src/app/page.tsx`, `layout.tsx`, `globals.css`), et 7 préfixes d'import interdits absents de 286 fichiers. Échoue si le scan ouvre 0 fichier | **qu'un écran neuf soit bon.** `src/components/` est de nouveau autorisé : la gate ne dit plus rien sur son contenu, seulement qu'il ne réimporte pas les sous-arbres démolis |
| `check:catalyst-integrity` | voir §3 — empreinte SHA-256 des 27 fichiers de `src/components/ui/` | **que les écrans utilisent Catalyst**, ni qu'ils ne le combattent pas depuis l'extérieur (`className` agressifs) |
| `check:agent-truth` | 3 checks : (1) aucun import de `market/dropship/agents/roster` depuis `src/app`+`src/components` ; (2) aucune lecture de `delivery/tradeagent/**` ; (3) dans `available-agents.ts`, aucun provider/modèle littéral assigné (`=`, `:`) ni retombé par `??`/`\|\|`. Anti-cécité : échoue si 0 fichier runtime, ou si le contrat canonique / les 4 cibles protégées n'ont pas été ouverts | que les agents servis soient **exécutables**. Lecture **ligne à ligne** : un défaut fabriqué via une fonction, un ternaire, une constante déclarée ailleurs ou une concaténation reste invisible. Le check 3 ne regarde **qu'un seul fichier** |
| `check:lifecycle-truth` | 5 mensonges interdits dans **un seul fichier** : `src/lib/agent-mission-control/agent-lifecycle-trace.ts` | **tout le reste du domaine lifecycle.** Sa portée est un module, pas un domaine |
| `check:registry-parity` | les 3 familles de `RUNNABLE_TOOL_NAMES` (5 natifs + 9 market + 3 realestate) sont buildables par `REGISTRY_IDS` — valeurs **importées** du `.mjs`, pas scrapées ; parité bidirectionnelle market + realestate ; échoue si une 4ᵉ source apparaît ou si un ensemble tombe sous son minimum | que l'outil **fonctionne** (handler juste, provider joignable). Ni **que l'assistant LangGraph existe** — c'est l'absence d'assistant qui produit `tool_call_count = 0` avec un agent d'apparence saine |
| `check:registry-integrity` | canonique ⟺ `.mjs` ⟺ union `BehaviorToolId` ⟺ union `AgentRuntime` (22 / 4, **valeurs réelles** via `tsx`) ; semver ; `secretRefs` UPPER_SNAKE ; `kind`/`risk`/`mutates`/`requiresConfirmation`/`certification` valides ; **`mutates: true` ⇒ `requiresConfirmation: true`** ; aucun ensemble vide | que les **lignes `tools` en base** soient conformes (c'est `check:tool-rows`, hors chaîne) ; que la classification déclarée soit **vraie** — `mutates: false` est une affirmation humaine que rien ne confronte au handler |
| `check:dev-port` | 3987 épinglé dans **4 resolvers** ; aucun port banni (3000/3001/3210) en code vif ou doctrine ; échoue si un resolver a disparu | qu'un serveur tourne réellement sur 3987 — gate **statique** |
| `check:render-truth` | 3 coalescences interdites (métrique `?? 0`, `Number(x?.y)` → NaN, absence affirmée en mots) sur **`src/lib/runs-console/**` uniquement — 4 fichiers**. Échoue si une racine de scan disparaît ou si 0 fichier est lu | **tout le reste.** Ni `src/lib/cockpit/`, ni `src/components/cockpit/`, ni `dashboard-overview.ts`, ni `agent-detail.ts`, ni `data.ts` — là où la règle compte le plus. Voir §8 |
| `check:secrets` | `gitleaks` sur **tout** l'historique (1027 commits) + hook `pre-commit` sur l'index | **un secret qu'aucune règle gitleaks ne décrit.** Précédent réel : un mot de passe de dev écrit en prose dans un `.md` est resté versionné des semaines, gate verte |
| `audit:dead` | aucun composant non référencé — **9 composants** jugés (`src/components/` moins le kit `src/components/ui/`, exclu comme inventaire vendoré) | le code mort **à l'exécution** : une branche jamais atteinte reste « référencée ». La détection est textuelle (`content.includes(needle)`) — une mention dans un `.md` ou un commentaire suffit à déclarer un composant vivant |

---

## 3. `check:catalyst-integrity` — mécanisme exact

Fichier : `scripts/check-catalyst-integrity.mjs` (87 lignes).

**Mécanisme : empreinte SHA-256 par fichier, comparée à un manifeste versionné.
Il n'y a AUCUNE comparaison avec un amont distant** — pas de réseau, pas de
`node_modules`, pas de fetch Tailwind Plus.

1. `KIT_DIR = 'src/components/ui'` — répertoire en dur.
2. `readdirSync(KIT_DIR)` (non récursif), filtre `.tsx` et `.ts`, tri
   alphabétique.
3. Pour chaque fichier : `createHash('sha256').update(readFileSync(path)).digest('hex')`
   → objet `{ nom: hash }`.
4. Lecture du manifeste `scripts/catalyst-kit.sha256.json`.
5. Trois diffs :
   - **MODIFIÉ** : le nom existe des deux côtés, les hashes diffèrent ;
   - **AJOUTÉ** : présent sur disque, absent du manifeste ;
   - **SUPPRIMÉ** : présent au manifeste, absent du disque.
6. Trois listes vides → exit 0. Sinon exit 1 en nommant chaque fichier.

**Ce qui la ferait échouer** — n'importe lequel de ces gestes :

- modifier **un seul octet** de l'un des 27 fichiers de `src/components/ui/`
  (y compris un espace, un commentaire, ou un reformatage Prettier) ;
- ajouter un `.ts`/`.tsx` dans `src/components/ui/` ;
- supprimer ou renommer un fichier du kit ;
- rendre `scripts/catalyst-kit.sha256.json` introuvable ou illisible (message
  dédié, exit 1).

**Échappatoire délibérée et visible** : `node scripts/check-catalyst-integrity.mjs
--update` régénère le manifeste et sort 0. Le script l'assume — le diff du JSON
d'empreintes devient la **preuve en revue** qu'on a touché au kit. La gate ne rend
donc pas la modification impossible : elle la rend **impossible à faire
silencieusement**.

**Origine documentée dans l'en-tête du script** : le 2026-07-31, une mission
« migrer vers Catalyst » a réécrit 215 lignes de `src/components/ui/` pour y
porter la densité et les couleurs du produit — un fork silencieux portant des noms
Catalyst. Cette gate rend cette dérive visible.

**Ce qu'elle ne garantit PAS** (le script le dit lui-même à chaque exécution
réussie) : que les écrans **utilisent** réellement Catalyst, ni qu'ils ne le
combattent pas de l'extérieur (`className` agressifs, `!important`, styles
inline). Elle protège le **kit**, jamais son **usage**. Un écran qui n'importe
aucun composant Catalyst et réimplémente tout à la main laisse cette gate verte.

Elle ne regarde pas non plus `src/components/ui/` **récursivement** : un
sous-répertoire y serait invisible.

---

## 4. Gates hors chaîne

| Gate | Pourquoi hors chaîne | Ce qu'elle mesurerait |
| --- | --- | --- |
| `check:tool-rows` | **réseau.** Appel PostgREST vers GPU1. Sortie mesurée sans backend : `◦ tool-row drift gate SKIPPED — no gpu1 backend configured` puis **exit 0**. Vacuité systématique en CI, précisément là où elle prétendait protéger | que les lignes `tools` **réellement provisionnées en base** ne contredisent pas le registre canonique |
| `check:tool-definitions` | **même diagnostic, même skip vérifié** (exit 0 silencieux) | que le catalogue `tool_definitions` en base soit aligné sur le registre, et que chaque montage porte sa FK |
| `check:rsc-boundary` | historiquement « 0 composant client, rien à mesurer ». **Ce n'est plus vrai** — voir l'encadré ci-dessous | qu'aucun Server Component ne passe une prop **fonction** à un Client Component (React ne sérialise pas une fonction : le composant part dans son error boundary au runtime pendant que typecheck, build et tests restent verts) |
| `test:live` | **opt-in, coûte de l'argent** : tape GPU1 + OpenAI. 9 fichiers, 57 tests | promotion anti-bypass en base réelle, comportement dropship, les 3 frontières d'auth contre le serveur live, run de copilot E2E, HITL interrupt/resume, export Langfuse |

> ### ⚠️ `check:rsc-boundary` est désarmé alors qu'il a une cible
>
> Exécuté à la main sur ce HEAD :
>
> ```
> ✓ RSC boundary guard passed — aucune prop fonction ne traverse la frontière (46 composants client).
> EXIT=0
> ```
>
> **46 composants client existent maintenant.** La gate s'est réarmée toute seule,
> comme son en-tête le promettait — mais elle **reste hors de `npm run check`**.
> `scripts/README-gates.md` la décrit encore comme mesurant « rien aujourd'hui :
> 0 composant client », ce qui est **périmé**. C'est aujourd'hui la seule gate du
> repo qui a une cible réelle, passe, et n'est branchée nulle part. Le bug
> historique qu'elle existe pour attraper (Recharts, `formatUsd` passé à
> `<HourlyCostChart>`, carte de coût morte en prod pendant que tout était vert) est
> exactement le type de régression que la reconstruction du cockpit peut rejouer.
>
> Limites connues et assumées de son implémentation : les props identifiant ne sont
> résolues que **dans le fichier appelant**, et une fonction atteinte via une prop
> objet n'est pas détectée. Elle attrape la forme directe et commune.

Également hors des deux chaînes : `quality:dead` (knip) et `quality:dup` (jscpd)
ne sont pas dans `check` — knip est dans `verify`, jscpd dans aucune chaîne.
Config knip : `ignore: ["src/components/ui/**"]` — **le kit Catalyst est exclu de
la détection de code mort**, et `ignoreDependencies: ["tailwindcss", "motion"]`.

---

## 5. CI — `.github/workflows/ci.yml`

**Déclencheurs** : `push` sur `main`, **et toute `pull_request`**.
Concurrence : `ci-${{ github.ref }}`, `cancel-in-progress: true`.

### Job 1 — `check + build` (`ubuntu-latest`), bloquant

1. `actions/checkout@v4` avec **`fetch-depth: 0`** — requis : `check:secrets`
   scanne tout l'historique, un clone superficiel laisserait passer une fuite
   ancienne.
2. `actions/setup-node@v4`, Node **20**, cache npm.
3. `npm ci`.
4. **Installation de gitleaks 8.30.1** (absent des runners GitHub par défaut).
5. `npm run check` — les 13 étapes.
6. `npm test` — la suite unitaire offline (1721 tests).
7. `npm run build` — `next build`.
8. `proof.json` (`if: always()`) : repo, sha, run_url, status, timestamp,
   `generated_by: "ci (jamais par un agent)"`, uploadé en artefact 30 jours.

**Ce qui tourne donc sur PR : `check` + `test` + `build`.** À noter : c'est
**plus** que ce que `AGENTS.md` laisse entendre (il ne mentionne que `check` pour
la CI) et **moins** que `npm run verify` (knip / `quality:dead` n'est pas en CI).

### Job 2 — `sonarqube` (`[self-hosted, gpu1]`), **`continue-on-error: true`**

`docker run sonarsource/sonar-scanner-cli` avec `SONAR_TOKEN` (secret
write-only). **Ne bloque jamais une PR** — un échec ou un runner GPU1 hors ligne
laisse la CI verte.

**Aucune étape de déploiement** dans ce workflow — cohérent avec `CLAUDE.md` §10.
Aucun job navigateur, aucun Playwright, aucun Storybook, aucun test visuel.

---

## 6. Surfaces NON testées — chiffres par dossier

**Méthode et sa limite, énoncées honnêtement** : il n'existe **aucune couverture
instrumentée** dans ce repo (pas de `vitest --coverage`, pas de `@vitest/coverage-v8`
en dépendance, pas de seuil). Le chiffrage ci-dessous mesure **l'atteignabilité par
import** : un module est compté « atteint » si un fichier de `tests/unit/**`
l'importe directement (via `@/…` ou un chemin relatif). C'est une **borne
supérieure généreuse** — un module importé n'est pas un module couvert, et les
imports transitifs ne sont pas comptés (donc c'est aussi une sous-estimation dans
l'autre sens). À lire comme un **ordre de grandeur**, pas comme un taux.

**286 modules dans `src/` · 142 atteints par un import de test · 144 jamais
importés (≈ 50 %).**

| Dossier | Modules | Jamais importés par un test |
| --- | --- | --- |
| `src/lib/agent-mission-control` (racine) | 109 | **30** |
| `src/components/ui` (kit Catalyst) | 27 | **27 — la totalité** |
| `src/components/cockpit` | 8 | **8 — la totalité** |
| `src/components` (racine, `app-shell.tsx`) | 1 | **1** |
| `src/app/api/**` | 70 routes | **57** (13 atteintes) |
| `src/langgraph` | 10 | **5** |
| `src/lib/agent-mission-control/realestate` | 6 | **4** |
| `src/lib/agent-mission-control/registry` | 4 | **2** |
| `src/lib/cockpit` | 3 | **2** (`named-runs.ts`, `status.ts`) |
| `src/lib/agent-mission-control/market` | 24 | **3** |
| `src/lib/agent-mission-control/project-team` | 7 | **1** |
| `src/app` (pages/layout) | 3 | **3** |
| `src/lib/runs-console` | 4 | **0 — intégralement atteint** |
| `src/lib/agent-mission-control/evidence` | 4 | **0** |
| `src/lib/agent-mission-control/tool-builder` | 3 | **0** |
| `src/lib/agent-mission-control/dropship` | 1 | **0** |

### Les 30 modules non testés de `src/lib/agent-mission-control` (racine)

```
agent-autoeval                     model-catalog
agent-builder-copilot              model-local
agent-drafts-store                 pending-architect-approvals
architect-prompt                   project-builder-architect-prompt
architect-skills-schema            provision-agent-builder-live
delivery-loop-server               replay-live
delivery-scorecard-server          repo-coverage-keywords
forbidden-actions                  repo-intelligence-store
langgraph-explorer                 repo-scan
llm-client                         resolve-run-assistant
resource-ids                       runner
runtime-catalogue                  seed-fixtures
shadow-replay-routes-shared        slug
target-repo-sandbox-server         test-runner
tool-args                          tool-handlers
```

Les plus lourds de conséquence : **`runner.ts`** (le moteur d'exécution qui émet
la télémétrie interne), **`tool-handlers.ts`** (l'implémentation réelle de tous
les outils — le fichier même que `check:registry-integrity` ne confronte jamais à
ses classifications déclarées), **`llm-client.ts`**, **`test-runner.ts`**,
**`resolve-run-assistant.ts`** (le chemin exact du piège « assistant manquant »
documenté dans `AGENTS.md`).

### Frontend — zéro test, sans exception

- **0 fichier `.tsx` dans `tests/`.**
- **0 test importe `src/components/`.**
- Les 36 composants (27 de kit + 8 cockpit + `app-shell.tsx`) n'ont **aucun
  test unitaire, aucun test de rendu, aucun snapshot**.
- `vitest.config.ts` déclare `environment: 'node'`. `happy-dom` est en
  `devDependencies` mais **n'est configuré nulle part** — c'est une dépendance
  résiduelle, aucun test ne s'exécute dans un DOM.
- Le seul test qui touche la couche cockpit est
  `tests/unit/cockpit/overview-series.test.ts` (9 tests) : il teste la **fonction
  de données** `src/lib/cockpit/overview-series.ts`, pas un composant.
  `src/lib/cockpit/named-runs.ts` et `status.ts` n'ont aucun test.

---

## 7. Tests navigateur / visuels / E2E produit

**Confirmé : il n'y en a aucun.** Vérifié, pas supposé.

- Aucun Playwright, Cypress, Puppeteer ou WebdriverIO en dépendance ni en
  configuration ; aucun répertoire `e2e/`.
- Aucun `@testing-library/*`, aucun `render(` dans `tests/`.
- Aucun Storybook (retiré ; `test:storybook-unit` — une gate terminée par
  `|| true`, incapable d'échouer — a été supprimée, cf. `scripts/README-gates.md`).
- Aucun test de régression visuelle, aucune capture, aucun snapshot d'image.
- Aucun job navigateur en CI.
- `check:no-legacy-front`, `check:catalyst-integrity` et `audit:dead` sont des
  gates **de fichiers**, pas de rendu : elles lisent des chemins et des octets.

**Conséquence à énoncer sans l'arrondir : rien dans ce repo ne prouve qu'un écran
s'affiche.** La chaîne `check` complète, les 1721 tests et le `build` peuvent être
verts sur un cockpit qui explose au premier rendu client. Ce n'est pas une
hypothèse : c'est le précédent daté du 26/07/2026 (Recharts, prop fonction
traversant la frontière RSC, carte de coût morte en prod, toutes les gates
vertes) — et la gate écrite pour l'attraper, `check:rsc-boundary`, est
aujourd'hui **hors chaîne** (§4). La seule preuve possible reste **l'ouverture
manuelle de la page**.

---

## 8. Gates qui peuvent afficher un ✓ sur zéro cible

Sonde mentale de chaque script de la chaîne, plus les hors-chaîne.

### Vraies vacuités — un ✓ (ou exit 0) sans avoir rien mesuré

| Gate | Mécanisme de la vacuité | Statut |
| --- | --- | --- |
| `check:tool-rows` | `if (!live) { console.log('SKIPPED'); process.exit(0) }`. **Vérifié à l'exécution** : sortie `◦ … SKIPPED`, exit 0 | **réel**, mais **honnête** (dit « SKIPPED », et hors chaîne pour cette raison) |
| `check:tool-definitions` | strictement identique, **vérifié** | idem |
| `audit:dead` | branche `if (!fs.existsSync('src/components'))` → message « 0 cible » + exit 0. Inatteignable aujourd'hui (le répertoire existe). **Mais la vraie vacuité est ailleurs et active** : `KIT_DIR` exclut `src/components/ui/`, donc **27 des 36 composants ne sont jamais jugés** — le ✓ annonce « 9 checked », ce qui est exact mais ne représente qu'un quart de la surface | **partiel et déclaré** (le compte affiché trahit le périmètre) |
| `check:rsc-boundary` | l'inverse d'une vacuité : elle **a** 46 cibles, passe, et n'est branchée dans aucune chaîne. Le `README-gates.md` la décrit encore comme mesurant « rien » | **documentation périmée** |

### Vacuités **fermées** par une anti-cécité explicite

Ces gates échoueraient plutôt que de passer sur zéro cible — c'est mesuré dans
leur code :

- `check:no-legacy-front` → `if (scanned === 0) failures.push('import scan opened 0 file')` ;
  et les 3 fichiers de squelette sont exigés **positivement**.
- `check:render-truth` → double anti-cécité : racine de scan disparue = exit 1
  (message dédié), et `scannedFiles === 0` = exit 1.
- `check:agent-truth` → échoue si 0 fichier runtime scanné, si le contrat
  canonique n'a pas été rencontré, ou si l'une des 4 cibles protégées manque.
- `check:registry-parity` → compte minimal obligatoire sur chaque ensemble indexé
  (« une gate qui indexe 0 élément doit ÉCHOUER »), plus détection d'une 4ᵉ source
  non couverte.
- `check:registry-integrity` → « 0 élément(s) indexé(s), minimum 22 ».
- `check:dev-port` → un resolver manquant fait échouer.
- `check:catalyst-integrity` → manifeste illisible = exit 1. **Mais** un
  `KIT_DIR` vide produirait `{}` comparé à `{}` … qui déclencherait 27
  `SUPPRIMÉ` → exit 1. Vacuité fermée par le diff bidirectionnel.

### Le mensonge silencieux le plus important n'est pas une vacuité — c'est un **périmètre**

`check:render-truth` sort `✓ … 4 fichier(s) scanné(s) dans src/lib/runs-console`.
Le ✓ est **vrai** et le périmètre est **affiché**. Mais lu vite, il donne le
sentiment que la vérité des données est gardée à l'affichage. Elle ne l'est pas :

- `src/lib/cockpit/` (3 fichiers, dont `named-runs.ts` et `status.ts`) — **non
  scanné**, alors que c'est la couche de données du cockpit en cours de
  construction ;
- `src/components/cockpit/` (8 fichiers, dont `kpi-strip.tsx` et `charts.tsx`) —
  **non scanné**, alors que c'est exactement là que le `?? 0` sur une métrique et
  le `Number(x?.y)` → « NaN » se sont produits historiquement ;
- `dashboard-overview.ts`, `agent-detail.ts`, `data.ts` — **non scannés**, et
  `AGENTS.md` le dit déjà : « là où la règle compte le plus. La règle y tient par
  discipline, pas par gate ».

C'est la première correction à faire si l'on veut que la chaîne dise quelque chose
sur le cockpit reconstruit. Cette observation ne prescrit rien — elle constate un
écart entre ce que la chaîne mesure et ce qui est en train d'être écrit.

### Ce qu'aucune gate ne garde ici

- **Qu'un agent puisse exécuter ses outils.** `registry-parity` et
  `registry-integrity` prouvent que les *listes* s'accordent, jamais qu'un
  assistant LangGraph est provisionné. Le symptôme (`tool_call_count = 0`, agent
  d'apparence saine) reste possible avec les deux gates vertes.
- **Que `mutates` / `risk` / `kind` soient vrais** — déclarés à la main, jamais
  confrontés au handler (`tool-handlers.ts`, qui n'a par ailleurs aucun test).
- **Qu'un écran s'affiche** (§7).
- **Que les 27 fichiers du kit Catalyst soient utilisés** — `catalyst-integrity`
  garde leur intégrité, `audit:dead` les exclut, knip les ignore, aucun test ne
  les importe. Ce sont 27 fichiers sous **triple exemption**.

---

## Annexe — commandes de reproduction

```bash
npm run check          # 13 étapes, statique + offline, ~90 s
npm test               # 151 fichiers, 1721 tests, ~7 s
npm run verify         # check + knip + test + build

node scripts/check-rsc-boundary.mjs        # hors chaîne — 46 composants client, exit 0
node scripts/check-tool-rows-drift.mjs     # hors chaîne — SKIPPED sans backend
node scripts/check-tool-definitions.mjs    # hors chaîne — SKIPPED sans backend
npm run test:live                          # opt-in, facturé (GPU1 + OpenAI)

node -e "console.log(require('./package.json').scripts.check)"   # composition faisant foi
```
