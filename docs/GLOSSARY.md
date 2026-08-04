# GLOSSARY — vocabulaire d'Aigent

> Définitions courtes des termes propres au projet, pour lever les ambiguïtés. La
> définition normative d'un concept vit dans son fichier propriétaire
> (`PRODUCT_DOCTRINE.md`, `AGENTS.md`, `docs/architecture.md`) ; ce glossaire y
> renvoie, il ne le remplace pas.

## Produit & rôles

- **Aigent** — le plan de contrôle **et** le runtime gouverné canonique. Voir
  `PRODUCT_DOCTRINE.md`.
- **Control plane** — décide ce qui existe et ce qui a le droit de tourner
  (authoring, qualification, release, promotion). Ne s'exécute pas lui-même.
- **Runtime gouverné** — exécute les agents, et seulement ce que le control plane
  a autorisé. Chez Aigent = le serveur LangGraph.
- **Produit consommateur** — produit tiers qui appelle le runtime d'Aigent et
  possède l'utilisateur final, l'interface et les données métier. Ne possède ni
  l'identité de l'agent, ni sa preuve.
- **Opérateur** — la personne qui possède la flotte d'agents (pas un marketplace,
  pas du multi-tenant grand public).
- **Copilot** — un agent du catalogue (identité + versions). Synonyme d'« agent »
  dans ce dépôt.
- **La boucle** — `create → qualify → execute → observe → improve`.

## Cycle de vie (lifecycle)

- **Manifeste** — sortie structurée de l'architecte : prompt, outils, routes,
  actions interdites, politique de confirmation, plafond de coût. Pas de la prose.
- **Architecte** — l'étape qui transforme une description en langage naturel en
  manifeste (modèle via l'OpenAI SDK).
- **Qualify / Qualification** — tests + benchmarks + shadow + replay + release
  gate. Un agent devient `active` parce qu'un **run réel l'a prouvé**.
- **Release gate** — série de vérifications live avant qu'une version soit
  promouvable.
- **Promotion** — passage d'une version au statut de version de production, via la
  **RPC transactionnelle** `promote_copilot_version` (jamais un simple update).
- **Shadow** — exécution d'une version candidate en parallèle sans l'exposer.
- **Replay** — rejeu d'un corpus de runs contre une version candidate.
- **Improve / V2** — Aigent lit l'historique et propose une V2 gouvernée :
  analyser → proposer → matérialiser un brouillon → comparer → **décision
  humaine**. Une V2 ne s'auto-promeut **jamais**.
- **Corpus aval (downstream)** — jeu de preuves versionné par un **SHA-256
  canonique** ; la même empreinte est exigée sur qualification, shadow, replay,
  proposition et comparaison V1/V2. Hash absent/différent → `INSUFFICIENT_EVIDENCE`.

## Runtime & exécution

- **LangGraph** — le framework de graphe d'agents ; **seul runtime produit
  exécutable**.
- **`agent_builder`** — le `StateGraph` déclaré dans `langgraph.json`
  (`src/langgraph/agent-builder-graph.mjs`).
- **Agent Server** — le serveur officiel LangGraph qui sert le graphe (dev :
  `127.0.0.1:2024`). Porte le human-in-the-loop.
- **HITL (human-in-the-loop)** — un outil exigeant confirmation met le graphe en
  pause (`interrupt`) ; le run est persisté en `needs-confirmation` et une route
  dédiée le reprend.
- **Garde d'exécution (execution guard)** — fail-closed : un run n'est autorisé
  que si **les trois** conditions tiennent (statut actif, aucun outil non résolu,
  runtime `langgraph`).
- **Assistant (LangGraph)** — instance provisionnée du graphe pour un copilot. Un
  copilot `langgraph` **sans assistant** tourne contre le graphe nu et répond
  « pas de données » en paraissant sain (piège documenté, `AGENTS.md`).
- **Model-router** — `src/lib/agent-mission-control/model-router.ts` : résout le
  provider par copilot. Providers câblés : `openai`, `google` (Gemini, tool-use),
  `local` (vLLM, opt-in). `mistral` = **erreur typée** (non câblé).
- **Registre canonique** — `src/lib/agent-mission-control/registry/` : autorité
  unique des runtimes et des outils (gardée par `check:registry-integrity`/`parity`).

## Frontières de confiance & données

- **`src/proxy.ts`** — garde d'identité (convention Next `proxy` ; **pas** de
  `middleware.ts`). Intercepte toutes les surfaces sauf une allowlist.
- **`/api/agent-ops/**`** — surface opérateur/automatisation (cookie de session
  HMAC **ou** header `x-amc-key`).
- **`/api/runtime/v1/**`** — surface produit consommateur (jeton par installation
  ou jeton runtime legacy).
- **`/api/runtime-telemetry`** — ingestion depuis un agent déployé chez un tiers
  (jeton de télémétrie dédié ; payload traité comme **hostile**).
- **`/api/runtime-telemetry/consumer`** — 4ᵉ frontière : **installation**
  consommateur identifiée, jeton **par installation** haché SHA-256 au repos,
  révocable.
- **Installation consommateur** — enregistrement liant `project_id`,
  `copilot_id`, `version_id`, `delivery_event_id` à un jeton révocable ; seule une
  ligne `version_verified=true` peut alimenter `active_in_consumer`.
- **PostgREST** — la couche HTTP devant Postgres `aigent` (GPU1), clé
  service-role, **server-only**.
- **RLS** — Row-Level Security ; toute nouvelle table l'active + grante
  explicitement `service_role`.
- **Télémétrie** — canal unique, une seule table, pour **deux sources** : runs
  rapportés (consommateur) et runs internes. La provenance est distinguée **à la
  lecture**.
- **Truth-of-measure / vérité des données** — une valeur non mesurée reste `null`
  (jamais coercée en `0`) ; un compteur de sécurité non mesuré ne vaut jamais `0`.
  Dictionnaire : `docs/metrics-canon.md`.

## Surfaces & design

- **Jetons `--aig-*`** — autorité sémantique unique des couleurs sur les surfaces
  de production (`src/theme/`).
- **Kit UI** — `src/components/ui/`, 14 primitives (code du repo, issu d'un fork
  Catalyst réaligné). À réutiliser avant toute création.
- **Catalyst** — kit Tailwind Plus **vendoré** (`vendor/catalyst-ui-kit/`) servant
  de source de fork ; non importé directement en production.
- **App shell** — `src/components/app-shell.tsx` (rail + zone de travail).
- **Lab / Composer / Prototype** — zones d'**exploration** libres, isolées de la
  production, données déclarées fabriquées (`DESIGN_DOCTRINE.md` §9).
- **Preuve visuelle** — capture datée obligatoire à toute modification d'une
  surface de production (aucune gate ne mesure le rendu).

## Gates & outillage

- **Gate** — vérification statique branchée dans `package.json`. Une gate verte
  prouve **uniquement** ce qu'elle mesure.
- **`npm run check`** — 19 gates statiques hors-ligne. **`npm run verify`** ajoute
  knip + tests + build.
- **Gate live / commande d'exploitation** — script qui interroge le backend ;
  hors de `check` (s'auto-skipperait sans backend). Ex. `check:tool-rows`.
- **knip** — détecteur de code mort (`npm run quality:dead`).
- **oxlint** — linter rapide (`lint:fast`), en plus d'`eslint`.

## Infrastructure & environnement

- **GPU1** — hôte local exposant le périmètre Postgres `aigent` derrière
  PostgREST (voir `docs/BACKEND-GPU1.md`).
- **Port 3987** — port de dev d'Aigent. Les ports **3000 / 3001 / 3210** sont
  bannis (jamais binder ni sonder ; gate `check:dev-port`).
- **Learning Runtime** — contrat client vers un moteur H-Supervised
  (`learning-runtime.ts`) ; états `live | partial | unavailable | not_configured`.
  Aucun moteur ne répond aujourd'hui → `not_configured`.
- **Pont Obsidian** — `obsidian-bridge.ts` génère des URI `obsidian://` ; ne touche
  jamais un filesystem de vault.
- **Langfuse** — observabilité LLM self-hosted (`deploy/observability/`).
- **Tunnel Cloudflare** — expose l'instance locale en public (voir mémoire projet /
  `deploy/`).
