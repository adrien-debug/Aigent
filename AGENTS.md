# AGENTS.md — invariants techniques d'Aigent

> **Discipline de ce fichier** : les invariants techniques qui, s'ils sont violés,
> cassent le produit ou produisent un mensonge. Rien d'autre.
>
> — Méthode de travail, git, sécurité, déploiement → `CLAUDE.md`.
> — Ce qui existe et dans quel état → `README.md`, `docs/current-capabilities.md`.
> — Pourquoi la plateforme existe → `docs/product-vision.md`.
> — Comment elle est structurée → `docs/architecture.md`.
> — Ce qui manque → `docs/known-gaps.md`.
>
> **Gouvernance 100 % locale.** `CLAUDE.md` + `AGENTS.md` + les gates de
> `package.json` sont l'intégralité des règles de ce projet. Aucun repository
> distant, aucune doctrine externe, aucun plugin, aucun SHA de gouvernance,
> aucune commande de synchronisation n'entre ici. On peut comprendre et
> développer Aigent hors ligne à partir de ce seul repository.
>
> **L'état produit n'est pas de la doctrine.** Les rosters, les comptes d'agents,
> ce qui est câblé ou partiel changent toutes les semaines : ça vit dans `docs/`,
> pas ici. Ne recopie pas d'état volatile dans ce fichier, et ne mets pas de
> numéro de ligne dans une règle — une ancre `fichier:ligne` est morte au premier
> refactor et transforme un invariant vrai en affirmation fausse.

## Ce qu'est Aigent

Le plan de contrôle où des agents LLM sont créés, qualifiés, livrés, observés et
améliorés. Aigent n'est pas le produit que touche l'utilisateur final : les agents
qu'il produit tournent dans des produits **consommateurs**, ces produits
rapportent leurs runs ici, et Aigent transforme cet historique en V2 gouvernées.

```
   create → qualify → ship ──► PRODUIT CONSOMMATEUR exécute l'agent
      ↑                                    │
      └──── improve ◄──── télémétrie ◄─────┘
```

Tout est server-only et **fail-closed** : sans le backend live et sans les
credentials du provider choisi, les chemins de données et d'exécution renvoient
`503` / `ProviderUnavailableError`. **Il n'existe aucun chemin mock** pour
l'authoring ni pour les runs.

## Next.js — lis la doc avant de coder

Ce n'est pas le Next.js de ton entraînement : cette version a des ruptures d'API,
de conventions et de structure. Lis le guide pertinent dans
`node_modules/next/dist/docs/` avant d'écrire du code framework, et tiens compte
des avis de dépréciation. En particulier : la garde d'identité est `src/proxy.ts`
(convention `proxy`) — **il n'y a pas de `middleware.ts`**.

## Port de dev — 3987

Le dev Aigent tourne sur le port **3987**. Cette machine fait tourner beaucoup
d'autres serveurs Next ; le 3000 a toujours été disputé, et le **3210 est mort le
2026-07-30** (un autre chantier s'y est installé et a squatté Aigent). Le 3987 est
choisi hors de la bande 3000-3400 où ils vivent tous.

- Ne jamais lancer le dev d'Aigent sur **3000, 3001 ou 3210** — les trois ports
  bannis par `scripts/check-dev-port.mjs`.
- Ne jamais tuer un process sur l'un de ces ports : il ne nous appartient pas.
- Ne jamais s'y reconnecter « juste pour vérifier » : ce qui répond là est le
  chantier de quelqu'un d'autre, et le lire comme si c'était Aigent produit un
  diagnostic faux.

`scripts/dev-stack.mjs` résout le port depuis `AIGENT_DEV_PORT` (défaut 3987) et
refuse de tuer un listener qu'il ne peut pas prouver être son propre serveur
(double preuve : `cwd` **et** commande). LangGraph tourne sur `:2024`.

## Frontend — reset assumé, futur libre

Gate : `npm run check:no-legacy-front`.

- **Aucun front historique** : pas de `src/components/`, pas de console `/admin`,
  pas de marketing `(site)/`, pas de `src/theme.css`, pas de dossier `design/`.
- **Surface actuelle** : trois fichiers — `src/app/page.tsx` (placeholder
  technique « Frontend reset complete »), `src/app/layout.tsx`,
  `src/app/globals.css`. Rien d'autre.
- **API et runtime intacts** : `src/app/api/**`, `src/lib/**`, `src/langgraph/**`
  et `src/proxy.ts` restent la voie d'accès produit jusqu'à reconstruction.
- **Free design** : aucune règle de ce repository n'impose de design system, de
  kit, de palette, de tokens, de typographie, de navigation ni de Storybook, et
  **aucune gate visuelle n'est active**. Le futur front arrivera en blocs séparés
  — ne l'anticipe pas ici. Voir `CLAUDE.md` §8.

Conséquence sur les gates : tant que le front est vide, une gate qui prétend
auditer des composants ne mesure rien. Elle doit le **dire**, pas afficher un ✓.

## Frontières de confiance — trois, séparées exprès

| Surface | Appelant | Credential |
|---|---|---|
| `/api/agent-ops/**` | opérateur, ou automatisation d'Aigent | cookie de session HMAC (`auth.ts`) **ou** header `x-amc-key` |
| `/api/runtime-telemetry` | un agent déployé chez un **consommateur** | son propre jeton `AIGENT_RUNTIME_TELEMETRY_TOKEN` |
| `/api/runtime/v1/**` | un produit consommateur lisant ses agents | son propre jeton `AIGENT_RUNTIME_API_TOKEN` (`bearer-token-auth.ts`) |

- **`src/proxy.ts` ne garde que `/api/agent-ops/**`** (son `matcher`). Une route
  mutante placée ailleurs n'est gardée par **rien** : soit elle reste sous ce
  préfixe, soit elle apporte sa propre authentification explicite — c'est ce que
  font, délibérément, les deux surfaces runtime ci-dessus.
- **`/api/runtime-telemetry` est monté HORS de `/api/agent-ops/**` volontairement** :
  l'appelant est un agent déployé chez un tiers, pas un opérateur. Il s'authentifie
  avec SON jeton, **jamais** `AMC_API_KEY`. Son payload est traité comme hostile :
  plafond 16 Ko, schéma Zod strict, scan de motifs de secrets, et **rien n'est
  renvoyé en écho** — pas même un `err.message`.
- **Les valeurs de jetons ne sont jamais partagées** entre ces trois surfaces ;
  seule la mécanique d'extraction et de comparaison constant-time est mutualisée.
- **Fail-closed en production.** Nuance à connaître : `auth.ts` porte des
  fallbacks **dev-only** (secret de session et mot de passe admin par défaut,
  `authConfigured()` vrai) **inertes dès `NODE_ENV === 'production'`**. En dev,
  sans `AMC_SESSION_SECRET`, une session reste donc frappable via
  `POST /api/auth/login`. N'énonce jamais ce fail-closed sans le qualificatif
  « en production ».

## Vérité des données

- **Une valeur non mesurée reste `null`**, jamais coercée en `0` dans les
  agrégations et les contrats. Une absence de run n'est pas 0 % de succès ; une
  absence de score n'est pas un score de 0 ; une API injoignable n'est pas saine.
  Dictionnaire : `docs/metrics-canon.md`.
- **Aucun provider ni modèle par défaut fabriqué** dans le contrat canonique
  (`available-agents.ts`) : non résolu → `null` + `unavailableFields`, jamais
  `'openai'` ni `'gpt-…'`. Tenu par `check:agent-truth`.
- **Pas de faux zéro dans la trace de cycle de vie**, et `active_in_consumer`
  reste le littéral `'unknown'` — Aigent n'a aucun canal de lecture vers l'état
  d'activation d'un workspace consommateur. Tenu par `check:lifecycle-truth`.
- **La télémétrie ne fabrique pas de provider** : un provider manquant reste
  `null` plutôt que d'être deviné — un provider inventé produirait un coût de 0,
  c'est-à-dire un mensonge.

Ces gates sont **étroites** : `check:lifecycle-truth` ne couvre qu'un fichier, et
aucune ne scanne les agrégations de `dashboard-overview.ts` / `agent-detail.ts` /
`data.ts`, là où la règle compte le plus. La règle y tient par discipline, pas par
gate — ne prétends pas l'inverse.

## Invariants agents & runtime

- **LangGraph est le seul runtime produit exécutable.** Imposé à quatre endroits
  indépendants : la création (le schéma n'accepte que le littéral `langgraph`), la
  garde d'exécution, le contrat canonique (`executable`), et le registre des
  runtimes (`langgraph` est le seul `creatable`).
- **Piège LangGraph — c'est l'ASSISTANT qui manque, pas le runtime.** Un copilot
  en `langgraph` SANS assistant provisionné ne tombe pas en erreur : il tourne
  contre le graphe nu, hérite des outils génériques legacy, et répond « pas de
  données » avec `tool_call_count = 0` **en paraissant sain**. **Ordre
  obligatoire** : `scripts/ensure-langgraph-assistants.ts` (qui transporte
  outils / prompt / modèle dans `config.configurable` **et persiste
  `copilots.assistant_id`**) PUIS le flip de runtime. Flipper le runtime seul
  recrée le bug. **Aucune gate ne détecte un assistant manquant** — c'est une
  discipline de script, pas une garantie automatique.
- **Garde d'exécution — `POST /api/agent-ops/copilots/:id/run` est fail-closed.**
  Un run n'est autorisé que si **les trois** conditions tiennent : `status` vaut
  `active`, `unresolvedToolIds` est vide, **et** `runtime === 'langgraph'`. Sinon
  409 avec les raisons concrètes. S'y ajoutent 503 (backend ou credentials
  absents, catalogue indisponible), 404 (agent inconnu), 409 (double soumission en
  cours) et 409 (version qui ne sert plus). **Ne recalcule jamais le statut dans
  une route** : il vient de `getAvailableAgent`, la même dérivation que le
  catalogue.
- **`active` signifie PROUVÉ** : l'activation exige un run `completed`, zéro
  tentative unsafe et un modèle vérifié. Jamais un simple changement de statut.
- **Endpoint LangGraph** : `src/langgraph/agent-server-endpoint.mjs` refuse un
  endpoint distant hors production **et** un endpoint local en production. En dev,
  `LANGGRAPH_API_URL` doit viser `http://127.0.0.1:2024` — `.env.local` pointe sur
  un hôte distant, donc **surcharge la variable dans tout script de
  provisioning**, sinon il lève.
- **La description d'un outil porte le contrat que le schéma ne peut pas dire.**
  Sur le chemin LangGraph — le seul chemin produit — chaque outil est bâti avec un
  vrai schéma Zod : la forme des arguments est bien transmise au modèle. Mais tout
  ce que la forme n'exprime pas — quand appeler l'outil, ce que fait un appel sans
  argument, ce que signifie un champ — ne vit que dans la description. Cas réel
  documenté : une description muette a fait refuser au modèle un « liste les
  projets » que l'appel sans argument satisfaisait déjà. (Sur le chemin direct
  model-router, réservé aux runners de test/benchmark, le schéma envoyé est vide :
  là, la description est 100 % du contrat.)
- **Runtime multi-provider — ne pas régresser en « OpenAI-only »** : le
  model-router direct route vers `openai`, `google` (Gemini, tool-use inclus) et
  `local` (vLLM, opt-in explicite) ; le graphe LangGraph fait de même via
  `src/langgraph/model-provider.mjs`. **`mistral` est le seul provider non câblé** :
  erreur typée, jamais de fallback muet. Détail : `docs/agent-authoring.md` §3.
- **Factory métier read-only** : le domaine trading
  (`src/lib/agent-mission-control/market/`) n'a **aucun** chemin d'écriture réel
  (ordres, comptes, ERP). Donnée absente → verdict `UNAVAILABLE` avec provenance,
  jamais inventée. Un `BLOCKED` de Sentinel est **terminal** : aucun chemin de
  code ne laisse un autre agent le renverser.
- **Matérialisation d'agents chez un provider = étape facturée**, jamais exécutée
  sans accord explicite (`CLAUDE.md` §3).

## Shipping & télémétrie

- **Une écriture GitHub réelle exige DEUX verrous** : `confirm: true` dans le
  corps **et** `GITHUB_PUSH_ENABLED=1` dans l'environnement. Sinon c'est un
  dry-run — et c'est le défaut correct pour une écriture distante destructive.
- **Après provisioning, Aigent ne fait que POUSSER des agents.** Les gestes
  activate / rebind / deploy-version appartiennent au workspace consommateur
  (`consumer-bootstrap.ts`). C'est la raison structurelle pour laquelle
  `active_in_consumer` reste `unknown`.
- **La télémétrie est un canal unique pour deux sources** : les runs rapportés par
  les agents déployés ET les runs internes d'Aigent (`runner.ts` →
  `emitInternalRunTelemetry`), plus les événements de cycle de vie. Une seule
  table, `runtime_telemetry_events`.
- Les agrégations (`summarizeRuntimeTelemetry`, `summarizeFleetRuntimeTelemetry`,
  `diagnoseTelemetryHealth`, `listRecentRuntimeTelemetryEvents`) sont des
  **données prêtes sans UI** tant que le front n'est pas reconstruit. État chiffré
  et nuances : `docs/known-gaps.md`, propriétaire unique de cette ligne.

## Gates — celles qui tournent vraiment

**`package.json` fait foi.** `npm run check` exécute, dans l'ordre :

`typecheck` · `lint:fast` (oxlint) · `lint` (eslint) · `check:no-legacy-front` ·
`check:agent-truth` · `check:lifecycle-truth` · `check:registry-parity` ·
`check:registry-integrity` · `check:dev-port` · `check:render-truth` ·
`check:secrets` (gitleaks) · `audit:dead`.

`npm run verify` ajoute `quality:dead` (knip), `test` (vitest, suite offline) et
`build`.

**Cette chaîne est entièrement statique et hors ligne.** Les deux gates qui
interrogent la base live — `check:tool-rows` et `check:tool-definitions` — en sont
volontairement sorties : sans backend elles s'auto-skippent (donc elles ne
mesuraient rien en CI, précisément là où elles prétendaient protéger) et elles
rendaient `npm run check` dépendant du réseau. Ce sont des **commandes
d'exploitation**, à lancer explicitement pour auditer la base. Leur option
`--fix` **écrit en base** : ne la passe jamais par réflexe.

Hors chaîne également : `check:rsc-boundary` (prête, se réarme seule dès qu'un
module `'use client'` apparaît ; annonce honnêtement « 0 composants client »
aujourd'hui) et `test:live` (opt-in, tape GPU1 + OpenAI, coûte de l'argent).

**Une gate verte est une information étroite** : elle dit « la règle que
j'implémente n'est pas violée », jamais « l'écran est bon ». La carte des angles
morts est dans `scripts/README-gates.md` — la colonne « ne garantit PAS » est la
colonne utile. Une gate qui n'a rien pu mesurer doit le **dire** ; un ✓ silencieux
sur zéro cible est un mensonge.

## Sources de vérité, dans l'ordre

1. Le **code et les contrats** du repository — l'autorité finale sur les faits.
2. Les **gates** de `package.json` — l'autorité sur ce qui est réellement vérifié.
3. `CLAUDE.md` et `AGENTS.md` — les règles.
4. `README.md`, `docs/current-capabilities.md`, `docs/known-gaps.md` — l'état
   produit : daté, faillible, à recouper avec le code.
5. Les documents de `docs/` portant un bandeau d'archive — des **observations
   datées**, jamais des règles.

Contradiction entre deux fichiers → le plus spécifique et le plus récent gagne, et
l'écart se corrige dans le fichier propriétaire. N'ouvre jamais une troisième
doctrine.
