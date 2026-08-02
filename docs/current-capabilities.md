# Current capabilities — verified state

> État établi par lecture du code, au SHA où ce fichier a été committé. La colonne
> **preuve** nomme un fichier que tu peux ouvrir. Une capacité sans fichier de
> preuve n'a pas sa place dans ce tableau.
>
> **Ce fichier n'est pas de la doctrine** — c'est un constat daté et faillible.
> Les règles vivent dans `CLAUDE.md` et `AGENTS.md`. En cas de contradiction entre
> ce document et le code, **le code a raison** et c'est ce document qu'on corrige.
>
> **États** — `wired` (atteignable de bout en bout par un appelant réel) ·
> `partial` (fonctionne avec une restriction nommée) · `backend-only` (la route
> HTTP ou la bibliothèque existe et est testée, mais aucune surface opérateur ne
> l'atteint) · `not wired` (déclaré dans le code, lève ou ne fait rien).

## Frontend — 16 écrans, reconstruction en cours

Le front historique a été entièrement supprimé (mission `frontend-reset`), puis
**reconstruit à partir du 2026-07-31**. État vérifié : shell + listes + détails
branchés ; `/actions` est branché depuis le 2026-08-01 ; `/settings` reste un
placeholder honnête.

| Capacité | État | Preuve |
|---|---|---|
| Shell — sidebar mobile (`Dialog`), rail desktop, colonne secondaire | wired | `src/components/app-shell.tsx`, `src/components/navigation.ts` |
| Aperçu `/` — KPI, activité, flux, file d'action | wired | `src/app/page.tsx`, `src/components/cockpit/` |
| Runs · Agents · Projets (+ détails) | wired | `src/app/{runs,agents,projects}/`, `src/components/{runs,agents,projects}/` |
| Builder · Qualification · Livraison · Runtime | wired | `src/app/{builder,qualification,delivery,runtime}/` |
| Actions `/actions` — file opérateur complète, filtres, reprise de run | wired | `src/app/actions/page.tsx`, `src/components/actions/`, `src/lib/agent-mission-control/operator-queue.ts` |
| Learning `/learning` — supervision, file de revue, évaluations, connaissance | wired | `src/app/learning/page.tsx`, `src/components/learning/`, `src/lib/agent-mission-control/learning-overview.ts` |
| Pont Obsidian — URI natives `open` / `new` / `search`, 4 templates | wired | `src/lib/agent-mission-control/obsidian-bridge.ts`, `docs/templates/obsidian/` |
| Learning Runtime (H-Supervised) — client health/capabilities server-only | partial — contrat câblé, **aucun moteur en face** | `src/lib/agent-mission-control/learning-runtime.ts` |
| Réglages | partial — UI placeholder, mais contrat backend de posture câblé (lecture opérateur) | `src/app/settings/page.tsx`, `src/app/api/agent-ops/settings/posture/route.ts`, `src/lib/agent-mission-control/settings-posture.ts` |
| Kit UI — 14 primitives, jetons `--aig-*`, empreinte SHA-256 | wired | `src/components/ui/`, `check:ui-kit-integrity` |
| Tailwind v4 · Headless UI · Heroicons · Recharts | wired | `postcss.config.mjs`, `src/app/globals.css` |

| Ce qui reste supprimé et interdit de retour | |
|---|---|
| Console `/admin` | aucune route admin |
| Marketing `(site)/`, page `/login` | absents |
| `src/theme.css`, `design/` | absents |
| Ancien arbre `src/components/console\|agent-ops\|views\|shell\|marketing` | interdit sur disque et en import |

**Free design** : aucun kit, palette ni système de tokens imposé (`AGENTS.md`
§ Frontend). L'API HTTP reste la voie d'automatisation ; le front est la voie
opérateur. Gate `check:no-legacy-front` : autorise `src/components/`, refuse le
retour des surfaces démolies.

## Authoring & lifecycle

La colonne État qualifie le **mécanisme**. Plusieurs ont désormais une surface
opérateur ; l'API sous `/api/agent-ops/**` reste la voie d'automatisation.

| Capacité | État | Preuve |
|---|---|---|
| Flow architect — description NL → manifest structuré | wired (HTTP) | `api/agent-ops/architect/route.ts`, `authoring-types.ts` |
| Matérialisation d'un copilot depuis un manifest | wired | `authoring-writes.ts` (`createCopilotFromManifest`) |
| Auto-eval à la création (suites test + bench générées) | wired | `agent-autoeval.ts` (`prepareAutoEval`), `agent-suite-generator.ts` |
| Run réel d'un copilot | wired — garde fail-closed à trois conditions | `copilots/[copilotId]/run/route.ts`, `runner.ts` |
| Garde d'exécution — `active` + tools résolus + runtime `langgraph` | wired | `copilots/[copilotId]/run/route.ts` |
| Human-in-the-loop interrupt / resume | wired | `copilots/[copilotId]/runs/[runId]/resume/route.ts`, `langgraph-server.ts` |
| Génération + exécution de suites de tests | wired | `tests/generate/route.ts`, `tests/run/route.ts`, `test-runner.ts` |
| Benchmarks (unitaire + sweep) | partial — les tâches sont sourcées depuis `test_cases`, il n'existe pas de table `benchmark_tasks` | `benchmarks/run/route.ts`, `benchmark-runner.ts` |
| Release gate — 9 checks recalculés live | wired | `release-gate.ts` |
| Promotion gate — étend le release gate (exécutabilité runtime, tools résolus) | wired | `promotion-gate.ts` |
| Orchestrateur de qualification (tests → bench → shadow → replay → gate) | wired | `qualification-orchestrator.ts`, `copilots/[copilotId]/qualification/route.ts` |
| Shadow experiment | wired | `shadow-live.ts`, `versions/[versionId]/shadow/route.ts` |
| Replay comparison | wired | `replay-live.ts`, `versions/[versionId]/replay/route.ts` |
| Promotion vers `active` | wired — transactionnelle via RPC Postgres, jamais d'auto-promotion | `copilots/[copilotId]/promotion/route.ts`, RPC `promote_copilot_version` |
| Boucle d'amélioration — analyze / create-v2 / decision | wired — un seul cycle ouvert à la fois, décision humaine obligatoire | `improvement-loop.ts`, routes `improve/*` |
| Diagnostic déterministe des échecs (autoritaire sur le LLM) | wired | `improvement-diagnosis.ts` |
| Project builder conversationnel (boucle d'outils repo, SSE) | wired — UI builder + HTTP | `project-builder-conversation.ts`, `src/app/builder/`, `projects/[id]/builder/*` |
| Repo scan / repo intelligence | wired — lecture GitHub bornée, n'écrit jamais | `repo-scan.ts`, `repo-intelligence.ts` |

## Shipping vers les produits consommateurs

| Capacité | État | Preuve |
|---|---|---|
| Provisioning d'un workspace consommateur | partial — l'API existe ; l'UI d'intake est livrée dans le pack consommateur | `provision-consumer/route.ts`, `consumer-bootstrap.ts` |
| Push des artefacts d'agent vers le repo consommateur | wired — **dry-run** sauf `GITHUB_PUSH_ENABLED=1` **et** `confirm: true` | `push-agent/route.ts`, `github.ts` (`pushAgentToRepo`) |
| Push sous forme de pull request | wired — mêmes deux verrous | `github.ts` (`pushAgentToRepoPullRequest`) |
| Delivery loop + delivery scorecard | wired | `delivery-loop/route.ts`, `delivery-scorecard-server.ts` |
| Runtime API v1 — le consommateur lit ses agents et poste ses runs | backend-only | `src/app/api/runtime/v1/**` (7 routes), `runtime-catalogue.ts` |

**Après provisioning, Aigent ne fait que POUSSER.** Les gestes activate / rebind /
deploy-version appartiennent au workspace consommateur. Le lifecycle ne déduit
jamais `active_in_consumer` d'une livraison ni de la télémétrie brute : le seul
verdict admissible vient de `consumer-activation.ts`.

## Télémétrie

| Capacité | État | Preuve |
|---|---|---|
| Endpoint d'ingestion pour les handlers déployés chez un consommateur | backend-only — jeton dédié `AIGENT_RUNTIME_TELEMETRY_TOKEN`, payload plafonné et validé | `src/app/api/runtime-telemetry/route.ts` |
| Runs internes d'Aigent versés dans la même table | wired (automatique) | `runner.ts` → `emitInternalRunTelemetry` |
| Événements de cycle de vie (promotion / shadow / replay) sur le même canal | wired (automatique) | `runtime-telemetry-store.ts` |
| Résumé par agent, consommé par la boucle d'amélioration | backend-only | `improvement-loop.ts` → `summarizeRuntimeTelemetry` |
| Résumé de flotte, diagnostic de santé, flux d'événements récents | wired — consommé par `/` et `/runs` | `dashboard-overview.ts`, `telemetry-health.ts`, `src/components/cockpit/` |

**Ce que la télémétrie n'a jamais prouvé.** Le canal de retour consommateur est
construit et authentifié mais **n'a jamais porté de trafic réel** venant d'un
agent déployé à l'extérieur : chaque ligne stockée est un run interne d'Aigent ou
un événement de cycle de vie. Détail chiffré : `docs/known-gaps.md`.

## Runtime & providers

| Capacité | État | Preuve |
|---|---|---|
| Graphe LangGraph `agent_builder` sur l'Agent Server officiel | wired — **seul runtime produit exécutable** | `src/langgraph/`, `langgraph.json` |
| Boucle model-router directe | wired — réservée aux runners de test/benchmark | `model-router.ts` |
| Provider `openai` | wired | `model-router.ts` |
| Provider `google` / Gemini — **tool-use inclus** | wired | `model-router.ts` (`callGemini`), `src/langgraph/model-provider.mjs` |
| Provider `local` (vLLM, compatible OpenAI) | partial — opt-in explicite, `VLLM_LOCAL_API_KEY` | `model-router.ts` (`callLocalVllm`), `model-local.ts` |
| Provider `mistral` | **not wired** — erreur typée, jamais de fallback muet | `model-router.ts`, `src/langgraph/model-provider.mjs` |
| Registre canonique d'outils et de runtimes | wired — autorité unique | `src/lib/agent-mission-control/registry/` |
| Outils market (trading, read-only) | wired | `market/`, `api/agent-ops/market-tools/[toolName]/route.ts` |
| Outils immobilier | wired | `realestate/`, `api/agent-ops/realestate-tools/[toolName]/route.ts` |
| Tool builder | partial — un seul outil dispose d'un sandbox | `tool-builder/`, `api/agent-ops/tool-build-missions/route.ts` |
| Hooks d'observabilité Langfuse / LangSmith | backend-only | `langfuse.ts`, `langsmith.ts` |

Comptes d'outils et de runtimes : ne les recopie pas ici, ils dérivent.
`npm run check:registry-integrity` les affiche à la seconde près.

## Gates

**`package.json` fait foi** — pas ce document. Pour la liste exacte et à jour :

```bash
node -e "console.log(require('./package.json').scripts.check)"
```

Au moment de cette passe, `npm run check` enchaîne : `typecheck` · `lint:fast`
· `lint` · `check:no-legacy-front` · `check:ui-kit-integrity` ·
`check:agent-truth` · `check:lifecycle-truth` · `check:registry-parity` ·
`check:registry-integrity` · `check:dev-port` · `check:render-truth` ·
`check:rsc-boundary` · `check:schema-rebuildable` · `check:secrets` ·
`audit:dead`.

La chaîne est **entièrement statique et hors ligne**. `check:tool-rows` et
`check:tool-definitions` en sont volontairement sorties : elles interrogent la
base live, s'auto-skippent sans backend (donc ne mesuraient rien en CI) et leur
option `--fix` **écrit en base**. Ce sont des commandes d'exploitation manuelles.

`npm run verify` ajoute `quality:dead` (knip), `test` (vitest, suite offline) et
`build`. `test:live` est opt-in, tape GPU1 + OpenAI et coûte de l'argent.

Constat vérifié sur la mission `AIGENT-CODEX-011` : la chaîne `check` est verte,
mais `quality:dead` échoue encore sur **3 types exportés non utilisés** dans le
frontend actif (`src/components/lab/registry.ts`,
`src/components/visualizations/embed/contract.ts`) laissés à l'intégrateur
frontend propriétaire.

**Aucune gate ne mesure le rendu** — c'est une décision (free design), pas un
manque à combler par une gate visuelle. Ce que chaque gate ne garantit PAS est
dans `scripts/README-gates.md`.
