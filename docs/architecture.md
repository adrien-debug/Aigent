# Architecture — comment Aigent est assemblé

> Carte structurelle : ce qu'est chaque couche et où passe sa frontière. L'état
> des capacités vit dans `docs/current-capabilities.md` ; les invariants runtime
> dans `AGENTS.md`. **Ce fichier n'est pas de la doctrine** — c'est une carte, et
> en cas de contradiction avec le code, c'est le code qui a raison.

## Couches

```
appelant HTTP  (opérateur · automatisation · agent déployé chez un consommateur)
  │
  ├── /                        shell applicatif (src/components/app-shell.tsx)
  │                            front en reconstruction — cf. AGENTS.md § Frontend
  │
  ▼
src/proxy.ts                   garde d'identité — matcher : /api/agent-ops/** UNIQUEMENT
  │                            (convention Next `proxy` ; il n'y a PAS de middleware.ts)
  ▼
src/app/api/**                 route handlers — les SEULS points d'écriture
  │                            · /api/agent-ops/**      gardé par le proxy
  │                            · /api/runtime-telemetry  jeton propre, hors matcher
  │                            · /api/runtime/v1/**      jeton propre, hors matcher
  │                            · /api/auth/login         frappe la session, hors matcher
  ▼
src/lib/**                     data layer, runner, model router, registre, lifecycle
  │                            (server-only)
  ├──► PostgREST ──► Postgres `aigent` sur GPU1
  └──► LangGraph Agent Server (127.0.0.1:2024 en dev)
```

## Frontières de confiance — trois, séparées exprès

| Surface | Appelant | Credential |
|---|---|---|
| `/api/agent-ops/**` | opérateur ou automatisation d'Aigent | cookie de session HMAC (`auth.ts`) **ou** `x-amc-key` |
| `/api/runtime-telemetry` | un agent déployé dans un repo **consommateur** | son propre jeton `AIGENT_RUNTIME_TELEMETRY_TOKEN` — **jamais** `AMC_API_KEY` |
| `/api/runtime/v1/**` | un produit consommateur lisant ses agents | son propre jeton `AIGENT_RUNTIME_API_TOKEN` (`bearer-token-auth.ts`) |

L'endpoint de télémétrie est monté **hors** de `/api/agent-ops/**` volontairement :
le handler déployé chez un consommateur est un appelant plus étroit et moins
fiable qu'un opérateur, donc il a son jeton et sa garde. Son payload est traité
comme contrôlé par un attaquant de bout en bout — plafond 16 Ko, forme Zod
stricte, scan de motifs de secrets, et **rien n'est renvoyé en écho**, pas même
sur erreur.

Deux points à ne pas arrondir :

- **Le proxy ne garde que `/api/agent-ops/**`.** Une route mutante posée ailleurs
  n'est gardée par rien : soit elle reste sous ce préfixe, soit elle apporte sa
  propre authentification explicite — c'est ce que font, délibérément, les deux
  surfaces runtime ci-dessus.
- **Le fail-closed est total, dans tous les environnements.** `auth.ts` ne porte
  **aucun** secret de session par défaut, **aucun** mot de passe admin de repli,
  **aucun** bypass — ni en dev, ni en test, ni en production. Sans secret
  configuré, la frappe de session lève.

  > Corrigé le 2026-08-03. Ce document décrivait des fallbacks « dev-only » qui
  > n'existent plus : la doctrine annonçait une posture **plus faible** que le
  > code réel. Invariant propriétaire : `AGENTS.md` § Authentification.

- **Les pages ne sont pas couvertes par le proxy.** Une surface qui lit des
  données sans passer par une route API doit porter sa propre vérification de
  session.

## Carte des répertoires

| Chemin | Contenu |
|---|---|
| `src/app/page.tsx`, `layout.tsx`, `globals.css` | racine de l'App Router ; `globals.css` active Tailwind |
| `src/components/` | composants UI — reconstruction en cours, un bloc à la fois |
| `src/app/api/agent-ops/` | API opérateur / automatisation — la majorité des routes |
| `src/app/api/runtime/v1/` | API runtime côté consommateur (7 routes) |
| `src/app/api/runtime-telemetry/` | ingestion de télémétrie depuis les agents déployés |
| `src/app/api/auth/login/` | frappe de session (rate-limitée, constant-time) |
| `src/lib/agent-mission-control/` | data layer, runner, model router, outils, lifecycle. Tout en `server-only` |
| `src/lib/agent-mission-control/registry/` | registre canonique runtimes + outils — l'autorité |
| `src/lib/agent-mission-control/market/` | domaine trading, **read-only**, aucun chemin d'écriture |
| `src/lib/runs-console/` | métriques, filtres et séries temporelles des runs — testé, sans lecteur depuis le reset |
| `src/langgraph/` | le `StateGraph` `agent_builder`, son registre d'outils, son client PostgREST autonome |
| `src/proxy.ts` | la garde d'identité |
| `supabase/migrations/` | schéma versionné du périmètre `aigent` |
| `scripts/` | gates (`check-*.mjs`), provisioning, exports opérationnels |
| `deploy/` | configuration conteneurs : `app/`, `db/` (PostgREST), `langgraph/` |
| `tests/unit/` | suite offline (dans `verify`) |
| `tests/live/` | suite opt-in — tape GPU1 + OpenAI, coûte de l'argent, jamais dans `verify` |

Les répertoires `src/app/admin/`, `src/app/(site)/` et le fichier `src/theme.css`
**n'existent plus** ; `check:no-legacy-front` refuse leur retour, ainsi que celui
de l'ancien arbre `src/components/console|agent-ops|views|shell|marketing`.
`src/components/` lui-même est autorisé : le front s'y reconstruit.

## Deux chemins d'exécution, un contrat

1. **LangGraph Agent Server** — le **seul runtime produit exécutable**
   (`runtime: 'langgraph'`, imposé à la création, à l'exécution, dans le contrat
   canonique et dans le registre). Human-in-the-loop : un outil exigeant
   confirmation met le graphe en pause, le run est persisté en
   `needs-confirmation`, et une route dédiée le reprend.
2. **Boucle model-router directe** (`model-router.ts`) — non streamée, résout le
   provider par copilot. Depuis que la garde d'exécution refuse tout runtime
   autre que `langgraph`, ce chemin n'est plus atteint que par les runners de
   test et de benchmark.

Les deux montent les outils du copilot depuis le même registre canonique. Les
providers réellement câblés (`openai`, `google` avec tool-use, `local` en opt-in)
et le seul non câblé (`mistral`) sont dans `docs/current-capabilities.md` ; le
piège de l'assistant LangGraph manquant est dans `AGENTS.md`.

## Données

Postgres `aigent` sur GPU1, atteint via **PostgREST** avec une clé service-role,
côté serveur uniquement. RLS deny-by-default. **Il n'existe aucune source de
données mock** pour l'authoring ou les runs : sans le backend et sans les
credentials du provider sélectionné, ces chemins renvoient `503` /
`ProviderUnavailableError`. Voir `docs/BACKEND-GPU1.md`.

Une nouvelle table doit **activer RLS** et **granter explicitement à
`service_role`** : le grant « on all tables » ne couvre pas le futur, et des
tables ont déjà vécu sans RLS pour cette raison.

## Front end

Next.js App Router (**ruptures d'API par rapport aux versions antérieures — lis
`node_modules/next/dist/docs/` avant de toucher au code framework**), React,
TypeScript, **Tailwind v4**, Headless UI, Heroicons.

Tailwind v4 se branche par un unique plugin PostCSS (`postcss.config.mjs`) : il
n'y a **pas** de `tailwind.config.js`, et une éventuelle config de thème vivrait
dans `@theme` au sein de `src/app/globals.css`.

Les règles qui gouvernent les surfaces vivent dans `DESIGN_DOCTRINE.md` : Design
System obligatoire en production, jetons `--aig-*` comme autorité sémantique,
réutilisation du kit avant création, états obligatoires, accessibilité, preuves
visuelles. Composer, Lab et Prototype restent des zones d'exploration, isolées de
la production.
