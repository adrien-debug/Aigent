# Runtime Registry API v1 — Real Estate Agent

Contrat de registre runtime **v1** exposé par Aigent sous `src/app/api/runtime/v1/**`,
consommé machine-à-machine par le runtime déployé du projet consommateur
**Real Estate Agent** (`projectKey = "real-estate-agent"`). Ce document décrit
le contrat ; l'implémentation actuelle est un **squelette** — routes
typées, auth fail-closed active, tableau vide / 404 propre partout (aucun
agent réel n'existe encore en base pour ce projet).

## 1. Authentification service-to-service (fail-closed)

- **Frontière de confiance dédiée.** `/api/runtime/v1/**` n'est PAS gardé par
  `src/proxy.ts` (qui protège `/api/agent-ops/**` — et uniquement lui — avec la
  session admin / `AMC_API_KEY`) et n'est pas non plus le canal telemetry
  best-effort (`/api/runtime-telemetry`, `AIGENT_RUNTIME_TELEMETRY_TOKEN`).
  C'est une troisième frontière, plus étroite : un runtime consommateur
  déployé qui lit le registre et pilote des runs — pas un opérateur AMC.
- **Token dédié : `AIGENT_RUNTIME_API_TOKEN`.** Jamais `AMC_API_KEY`, jamais
  `AIGENT_RUNTIME_TELEMETRY_TOKEN`. Envoyé en `Authorization: Bearer <token>`
  (ou `x-aigent-runtime-token` en fallback).
- **Fail-closed, avant tout accès DB.** Chaque route appelle
  `requireRuntimeApiAuth(request)` (`src/lib/agent-mission-control/
  runtime-api-types.ts`) en toute première instruction du handler :
  - `AIGENT_RUNTIME_API_TOKEN` absent en config → `503` (pas configuré, pas
    une erreur de l'appelant).
  - Token manquant ou invalide → `401` générique. Le token fourni n'est
    **jamais** loggé ni renvoyé dans la réponse.
  - Comparaison en temps constant (`timingSafeEqual` maison, même pattern
    que `runtime-telemetry/route.ts`) pour ne pas fuiter la longueur/le
    préfixe du token via le timing.
  - Aucun secret client : le token vit uniquement côté serveur runtime
    consommateur, jamais exposé à un navigateur.

## 2. Projet / tenant / acteur obligatoires

- **`projectKey`** est un segment d'URL obligatoire sur la route de listing
  (`/projects/:projectKey/agents`) et un champ implicite sur toute ressource
  dérivée (`PublishedAgent.projectKey`, `RuntimeRun.projectKey`). Aucune
  route ne peut répondre sans `projectKey` résolu — pas de scope implicite
  "tous projets".
- **Acteur** : le token `AIGENT_RUNTIME_API_TOKEN` identifie le *runtime*
  appelant (un service, pas un utilisateur final). Une évolution future à
  tokens par-tenant (un token par `projectKey`) reste compatible avec ce
  contrat sans changer les routes — seul `requireRuntimeApiAuth` évoluerait.
- **Aucune fuite inter-projets** : la validation de forme `isValidProjectKey`
  /`isValidAgentId`/`isValidRunId` (regex bornée `^[a-z0-9-]{1,200}$`, même
  convention que `agent-ops/projects/[id]`) rejette toute valeur malformée
  avant tout accès store. Quand l'implémentation réelle sera branchée, toute
  requête sur `agentId`/`runId` DOIT re-vérifier que la ressource appartient
  au `projectKey` (ou au projet dérivé de la ressource) résolu par le token
  — un agent/run d'un autre projet retourne `404`, jamais `403` (ne pas
  confirmer l'existence d'une ressource hors scope).

## 3. Corrélation — `requestId`

- Chaque requête entrante DOIT porter un `requestId` (header `x-request-id`
  généré côté runtime appelant si absent, ou généré côté Aigent en fallback).
  Il est propagé :
  - dans tout log serveur émis par la route,
  - dans `RuntimeRun.requestId` à la création du run,
  - dans le corps `RuntimeErrorBody.requestId` de toute erreur structurée,
  pour permettre de recoller un incident entre les logs du runtime
  consommateur et ceux d'Aigent.

## 4. Idempotency key — `POST /agents/:agentId/runs`

- Header `Idempotency-Key` obligatoire recommandé sur la création de run
  (le runtime consommateur peut retry un timeout réseau sans dupliquer
  l'exécution). Stocké sur `RuntimeRun.idempotencyKey`.
- Contrat cible : une deuxième requête `POST` avec la même `Idempotency-Key`
  (+ même `agentId`) dans une fenêtre de rétention (24h) retourne le run
  existant (`200`) au lieu d'en créer un second (`201`). Absence de clé →
  toujours un nouveau run (`201`), pas de dédup implicite.

## 5. Statuts de version d'agent

`PublishedAgent.status` (type exact dans
`src/lib/agent-mission-control/runtime-api-types.ts`) :

| Statut | Sens |
|---|---|
| `specification` | Contrat défini, rien de matérialisé |
| `draft` | En cours de construction, non testé |
| `testing` | Bench/tests en cours, pas encore de trafic réel |
| `production` | Sert du trafic réel |
| `paused` | Existait en production, désactivé temporairement |
| `unavailable` | Ne peut pas être exécuté (config manquante, dépendance down) |

Le registre ne renvoie **que** des agents matérialisés — un agent en
`specification` côté Aigent (roster défini, rien de codé) n'apparaît pas
tant qu'il n'a pas au moins une ligne réelle en base. Pour Real Estate
Agent aujourd'hui : liste vide (`GET .../agents` → `{ ok: true, agents: [] }`),
lookup individuel → `404`.

## 6. Streaming vs polling (documenté, pas implémenté)

- **Run creation** (`POST /agents/:agentId/runs`) répond `201` avec le run à
  l'état `queued` — jamais de streaming synchrone sur la création elle-même.
- **Suivi de run** : deux modes prévus, tous deux au-dessus du même stockage
  d'événements ordonnés :
  - **Polling** (implémenté par le squelette actuel dans sa forme finale) :
    `GET /runs/:runId/events?after=<sequence>` — retourne les événements
    dont `sequence > after`, triés par `sequence` croissante. Le runtime
    consommateur poll à intervalle court (1-2s) tant que
    `RuntimeRun.status` est `queued`/`running`/`waiting_on_input`.
  - **Streaming** (extension future, pas dans ce squelette) : `GET
    /runs/:runId/events` avec `Accept: text/event-stream` bascule sur SSE,
    même forme d'événement, poussée au fil de l'eau. Le contrat de forme
    d'événement (`RuntimeRunEvent`) est identique dans les deux modes pour
    que le client n'ait rien à distinguer côté parsing.
- Le choix polling-par-défaut est délibéré : évite une connexion longue à
  gérer côté infra tant que le volume de runs réels est faible.

## 7. Interruptions HITL (Human-In-The-Loop)

- Un run peut passer à l'état `waiting_on_input` quand le graphe LangGraph
  sous-jacent atteint un point de confirmation (`confirmationPolicy` de
  l'agent, ex. action sensible nécessitant validation humaine côté runtime
  consommateur).
- `GET /runs/:runId` expose alors `status: "waiting_on_input"` et l'event
  log (`GET /runs/:runId/events`) contient l'événement décrivant *quoi*
  confirmer (forme dépendante de l'agent, opaque au contrat générique —
  `RuntimeRunEvent.data: unknown`).
- `POST /runs/:runId/resume` reprend l'exécution avec la décision de
  l'acteur humain en corps de requête. Un `resume` sur un run qui n'est pas
  `waiting_on_input` est un `409` (conflit d'état) dans la forme finale —
  le squelette actuel retourne `404` tant qu'aucun run n'existe réellement.
- Un run qui n'est jamais résolu (pas de `resume` reçu) reste
  `waiting_on_input` indéfiniment côté contrat — l'expiration/timeout de
  ce statut est une politique du runtime consommateur, pas de ce registre.

## 8. Télémétrie

- Ce contrat de registre est distinct du canal télémétrie applicatif
  existant (`POST /api/runtime-telemetry`, voir
  `src/app/api/runtime-telemetry/route.ts` — événements start/complete/fail
  d'un agent générique déployé, best-effort, `AIGENT_RUNTIME_TELEMETRY_TOKEN`).
  Les deux canaux restent séparés : le registre expose l'état *interrogeable*
  d'un run (poll/HITL), la télémétrie est un flux d'événements *fire-and-forget*
  pour observabilité (latence, tokens, erreurs catégorisées).
- Un run créé via `POST /agents/:agentId/runs` DEVRAIT, côté implémentation
  finale, émettre en parallèle des événements sur le canal télémétrie
  existant (mêmes champs `runId`/`agentId`/`projectId` pour recoller les
  deux flux via `requestId`), sans que l'un ne dépende de l'autre pour
  fonctionner.

## 9. Coût

- `RuntimeRun` ne porte pas aujourd'hui de champ coût dédié dans ce
  squelette v1 — le coût par run (tokens LLM, appels outils facturés) est
  capturé côté canal télémétrie (`usage.inputTokens`/`outputTokens`/
  `totalTokens`, voir schema `runtime-telemetry/route.ts`), pas dupliqué
  ici. Une évolution v1.1 pourrait agréger un résumé de coût sur
  `GET /runs/:runId` en lecture seule (jamais en écriture depuis ce
  contrat) une fois le besoin réel confirmé côté Real Estate Agent.

## 10. Résultat structuré / erreur structurée

- **Succès** : chaque réponse `200`/`201`/`202` a la forme
  `{ ok: true, ...ressource(s) }`. `RuntimeRun.output: unknown` porte le
  résultat structuré de l'agent une fois `status: "completed"` — la forme
  exacte dépend du `outputSchema` déclaré par le `PublishedAgent`
  correspondant, validé Zod côté producteur avant persistance (jamais
  validé/interprété générique par ce registre).
- **Erreur** : toute réponse d'erreur suit
  `{ error: string }` au niveau HTTP top-level (cohérent avec le reste du
  repo — voir `agent-ops/missions/[missionRunId]/route.ts`,
  `runtime-telemetry/route.ts`), et `RuntimeRun.error: RuntimeErrorBody`
  (`{ code, message, requestId }`) une fois qu'un run est `status: "failed"`
  pour l'inspection via `GET /runs/:runId`. Dans les deux cas : **jamais**
  de `err.message`/stack trace brut d'une dépendance interne (PostgREST,
  LangGraph, provider LLM) renvoyé au runtime consommateur — message
  générique côté réponse, détail complet en `console.error` serveur
  uniquement (même pattern que `isPgrestTimeout`/`PgrestError.detail` dans
  `postgrest.ts`).

## 11. Aucune fuite inter-projets — récapitulatif

- Chaque ressource (`PublishedAgent`, `RuntimeRun`) porte un `projectKey`
  explicite dérivé du token/scope de l'appelant, jamais du corps de la
  requête pour la lecture (`GET`) — un `projectKey` fourni en payload sur
  une route de lecture par id (`agentId`/`runId`) est ignoré, seul le
  scope résolu par le serveur fait foi.
- Lookup d'un `agentId`/`runId` hors du `projectKey` résolu → `404`
  générique (jamais `403`, pour ne pas confirmer l'existence de la
  ressource ailleurs).
- Aucune route de ce contrat n'accepte de lister/traverser au-delà d'un
  `projectKey` — pas de route "tous les agents tous projets".

## 12. Routes (squelette v1 — état actuel)

| Méthode | Route | État squelette |
|---|---|---|
| `GET` | `/api/runtime/v1/projects/:projectKey/agents` | `{ ok: true, agents: [] }` (aucun agent matérialisé) |
| `GET` | `/api/runtime/v1/agents/:agentId` | `404` (aucun agent matérialisé) |
| `POST` | `/api/runtime/v1/agents/:agentId/runs` | `404` sur l'agent cible |
| `GET` | `/api/runtime/v1/runs/:runId` | `404` (aucun run store branché) |
| `POST` | `/api/runtime/v1/runs/:runId/resume` | `404` (aucun run store branché) |
| `GET` | `/api/runtime/v1/runs/:runId/events` | `404` (aucun run store branché) |

Chaque route valide l'auth (§1) puis la forme de l'id (`isValidProjectKey`/
`isValidAgentId`/`isValidRunId`, `src/lib/agent-mission-control/
runtime-api-types.ts`) avant toute réponse. Aucune donnée inventée, aucun
agent mock — le branchement au store réel arrive avec la matérialisation
(facturée, hors périmètre de ce squelette — voir AGENTS.md §"Matérialisation
OpenAI").

## 13. Configuration requise

| Var | Rôle |
|---|---|
| `AIGENT_RUNTIME_API_TOKEN` | Bearer token service-to-service pour `/api/runtime/v1/**`. Absent → toutes les routes répondent `503`. |
