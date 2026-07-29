<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> **Discipline de ce fichier** : invariants techniques courts pour agents, rien d'autre.
> — Ce qui EXISTE et dans quel état → `README.md` et `docs/current-capabilities.md`.
> — Pourquoi la plateforme existe → `docs/product-vision.md`.
> — Comment elle est structurée → `docs/architecture.md`.
> — Ce qui manque → `docs/known-gaps.md`.
> — Détail par mission (roster complet, exports, canvas) → `docs/missions/AGENTS-history-2026-07.md`
>   (archivé : décrit un état passé, à ne pas lire comme la doctrine courante).

<!-- BEGIN:doctrine-hierarchy -->
## Hiérarchie de doctrine

1. `CLAUDE.md` — git, merge, push, déploiement, sécurité opérationnelle.
2. `AGENTS.md` (ce fichier) — workflow agent, ports, architecture, Catalyst, vérité runtime.
3. Gates exécutables (`npm run check`) — arbitre final : une gate rouge gagne sur toute phrase de
   doctrine.
4. Mission courante.

L'état produit réel (ce qui est câblé, partiel, backend-only, non branché) n'est PAS de la
doctrine : il vit dans `README.md` et `docs/current-capabilities.md`, avec un fichier de preuve
par ligne. Ne le recopie pas ici.

Une règle vit dans **un seul** de ces fichiers ; ailleurs on y renvoie, on ne la recopie pas.
Contradiction entre deux fichiers → la plus récente et la plus spécifique gagne, et l'écart se
corrige dans le fichier propriétaire. N'ouvre jamais une quatrième doctrine.

**Aucune règle Cursor n'est versionnée dans ce repository** — ni `.cursor/`, ni `.cursor/rules/`,
ni `.cursorrules`, ni `.cursorignore`. Cursor suit donc ces trois fichiers. Une règle Cursor
ajoutée plus tard doit rester cohérente avec eux et ne peut ni les contredire ni les remplacer.
<!-- END:doctrine-hierarchy -->

<!-- BEGIN:dev-port-rule -->
## Port de dev — ABSOLU

Le dev Aigent tourne sur le port **3210**, jamais **3000**. Cette machine fait
tourner beaucoup d'autres serveurs Next (Kyc, Netpool, hearst-comput…) qui se
disputent le 3000 : s'y mettre, c'est écraser le travail d'un chantier voisin ou
se faire écraser par lui. Règle absolue : ne JAMAIS lancer le dev sur 3000, ne
JAMAIS tuer un serveur sur 3000 (il n'est pas à nous). `scripts/dev-stack.mjs`
résout le port depuis `AIGENT_DEV_PORT` (défaut 3210) et abandonne si le port
est pris par un process non identifié comme le sien.
<!-- END:dev-port-rule -->

<!-- BEGIN:catalyst-ui-rules -->
## UI — console reconstruite et active (gate : `npm run check:no-legacy-front`)

- **La console `/admin` est reconstruite et vivante.** Six routes réelles :
  `/admin` · `/admin/runs` · `/admin/agents` · `/admin/agents/[id]` · `/admin/projects` ·
  `/admin/projects/[id]/builder`. Les écrans vivent dans `src/components/console/`, encadrés
  par `console-shell.tsx` (rail 216/248px + topbar 52px). Toute page admin monte le shell
  elle-même : `src/app/admin/layout.tsx` est un pass-through par construction (un layout serveur
  n'a pas de pathname, donc ne peut pas fournir `activeHref`).
- **Le rail porte exactement quatre entrées** : Overview, Runs, Projects, Agents. Le builder se
  rejoint depuis l'écran Projects — il exige un id de projet, donc pas de lien fabriqué. **Aucun
  contrôle mort** : un bouton grisé vers un écran inexistant est une publicité pour du vide.
- **Routes SUPPRIMÉES et interdites par la gate** : `factory`, `performance`, `settings`,
  `telemetry`, `not-found.tsx` sous `src/app/admin/`, et tout `/admin-v2`. Seule exception
  commissionnée : `src/app/admin/error.tsx`, la frontière d'erreur du segment `/admin`.
  Les couches démolies (`src/components/agent-ops/**`, `views/**`, `shell/**`) ne peuvent pas
  être réimportées.
- **Un seul accent : `accent` (vert tendre, `#A7FB90`, `src/theme.css`).** Tout le reste est `zinc`.
  (`src/app/globals.css` n'est qu'un stub qui `@import "../theme.css"`.) Ne jamais importer les
  tokens/palette d'un autre projet : le design system de ce workspace lui est PROPRE.
- **Une seule police : Satoshi Variable, pour TOUT.** `--font-sans` et `--font-mono` résolvent
  tous deux vers elle (`src/theme.css`) : une classe `font-mono` est un choix d'alignement
  (`tabular-nums`), pas un changement de famille. Geist Mono n'est plus chargée.
- **Les primitives Catalyst vivent dans `src/components/ui/`** — kit minimal, uniquement les
  primitives réellement consommées par une route vivante (`npm run quality:dead` échoue sur une
  primitive orpheline). Aucun composant "pour plus tard", aucun design system parallèle.
- **Marketing** (`src/app/(site)/`, `src/components/marketing/`) → blocs Tailwind Plus pris tels
  quels, restylés sur les tokens du projet. Vitrine statique, périmètre distinct de la console.
- **Les gates de design system n'existent plus** (`check:ds`, `check:contrast`, `check:catalyst`,
  `check:danger`, `check:views` ont été supprimées avec l'ancien dashboard et n'ont jamais été
  réécrites pour la console actuelle). Une nouvelle règle visuelle ne vaut que si une gate la
  fait respecter — jamais une simple phrase dans un `.md`. Trou connu :
  `docs/known-gaps.md` §7.

## Vérité affichée (gates : `check:render-truth`, `check:status-truth`)

- **Une valeur non mesurée voyage `null` + un état, JAMAIS `0`.** Absence de mesure ≠ mesure
  nulle ; absence de run ≠ 0 % de succès ; lecture échouée ≠ flotte vide et saine. Un read
  raté rend `null`, jamais `[]`. Dictionnaire complet : `docs/metrics-canon.md`.
- **Une affirmation d'écran ne porte que sur ce qui a été mesuré.** Pas de « toutes les sources
  répondent » adossé à trois lectures scopées sur la page. Le vocabulaire de statut sort de
  `labels.ts`, nulle part ailleurs.
- **Le rôle `danger` est réservé à une panne**, pas à une condition ordinaire. Un agent `draft`,
  en pause ou archivé n'est pas exécutable **par conception** — un rail rouge en permanence ne
  peut plus alerter de rien.
<!-- END:catalyst-ui-rules -->

## Invariants agents & runtime (détail : docs/missions/AGENTS-history-2026-07.md)

- **Roster TradeAgent canonique** (AIGENT-RESET-022, 22/07) : 4 agents dans `proj-tradeagent`,
  provider `openai`, modèle `gpt-5.4` — Market Intelligence + Portfolio Risk Guardian (`active`,
  prouvés par run), Execution Supervisor + Performance Analyst (`draft`). Provisioning :
  `scripts/provision-tradeagent-roster.mjs`. Reset : `scripts/reset-agent-platform.mjs`
  (dry-run par défaut).
- **`active` signifie PROUVÉ** : `--activate` exige un run `completed`, zéro tentative unsafe,
  modèle vérifié. Jamais un simple changement de statut.
- **LangGraph est OBLIGATOIRE pour tous les agents** — `runtime: 'langgraph'`, sans exception.
- **Piège LangGraph — c'est l'ASSISTANT qui manque, pas le runtime.** Un copilot en `langgraph`
  SANS assistant provisionné tourne contre le graphe nu et hérite des 5 outils génériques legacy :
  il répond « pas de données » avec `tool_call_count=0` en paraissant sain. La cause n'est pas le
  runtime (formulation antérieure, fausse) mais l'absence d'assistant. **Ordre obligatoire** :
  `scripts/ensure-langgraph-assistants.ts` (transporte outils/prompt/modèle dans
  `config.configurable`) PUIS `runtime: 'langgraph'`. Flipper le runtime seul recrée le bug.
- **Endpoint LangGraph** : `src/langgraph/agent-server-endpoint.mjs` refuse un endpoint distant hors production.
  En dev, `LANGGRAPH_API_URL` doit viser le serveur local (`http://127.0.0.1:2024`) — `.env.local`
  pointe sur `agent.hearst.app`, donc surcharger la variable pour tout script de provisioning.
- **La description d'un outil EST son contrat d'entrée** : le runner l'envoie au modèle sans
  schéma JSON. Les schémas Zod attendent `pair` (pas `symbol`) — sans description explicite,
  chaque appel échoue.
- **Garde d'exécution** (AIG-…-GATE-020) : `POST /api/agent-ops/copilots/:id/run` relit l'agent
  canonique et refuse fail-closed (seul `active` + `unresolvedToolIds` vide autorise un run ;
  503/404/409 sinon). Ne jamais recalculer le statut dans une route.
- **Factory métier read-only** : trading (`src/lib/agent-mission-control/market/`) n'a AUCUN
  chemin d'écriture réel (ordres/comptes/ERP). Donnée absente → UNAVAILABLE avec provenance,
  jamais inventée ; montants/prix en décimales lossless, jamais float. Sentinel (trading) =
  BLOCKED terminal.
- **Runtime multi-provider — ne pas régresser en « OpenAI-only »** : le model-router direct route
  vers `openai`/`google`/`local` (vLLM, opt-in explicite) ; LangGraph idem via
  `src/langgraph/model-provider.mjs` ; `mistral` déclaré non câblé (erreur typée, jamais de
  fallback muet). Détail : `docs/agent-authoring.md` §3.
- **Matérialisation OpenAI d'agents = étape facturée, jamais exécutée sans accord** (§8 global).

## Frontières de confiance — trois, séparées exprès

- `/admin/**` → cookie de session HMAC (`auth.ts`). `/api/agent-ops/**` → session **ou**
  `x-amc-key`. Fail-closed : pas de `AMC_SESSION_SECRET`, tout est refusé (`src/proxy.ts`).
- **`/api/runtime-telemetry` est monté HORS de `/api/agent-ops/**` volontairement** : l'appelant
  est un agent déployé chez un consommateur, pas un opérateur. Il s'authentifie avec SON propre
  jeton (`AIGENT_RUNTIME_TELEMETRY_TOKEN`), **jamais** `AMC_API_KEY`. Payload traité comme
  hostile : plafond 16 Ko, schéma Zod strict, scan de motifs de secrets, et rien n'est renvoyé
  en écho — pas même un `err.message`.
- `/api/runtime/v1/**` → API du consommateur (lecture de ses agents, POST de ses runs), jeton
  bearer dédié (`bearer-token-auth.ts`).
- **Échappatoire dev uniquement** : `AMC_DEV_BYPASS_AUTH=1` + `NODE_ENV !== 'production'`
  saute la session sur les PAGES `/admin/**`. Jamais en build de production, jamais sur l'API.

## Shipping & télémétrie

- **Une écriture GitHub réelle exige DEUX verrous** : `confirm: true` dans le corps **et**
  `GITHUB_PUSH_ENABLED=1` dans l'environnement. Sinon c'est un dry-run — et c'est le défaut
  correct pour une écriture distante destructive.
- **Après provisioning, Aigent ne fait que POUSSER des agents.** Les gestes activate / rebind /
  deploy-version appartiennent au workspace consommateur (`consumer-bootstrap.ts`).
- **La télémétrie est un canal unique pour deux sources** : les runs rapportés par les agents
  déployés ET les runs internes d'Aigent (`runner.ts` → `emitInternalRunTelemetry`), plus les
  événements de cycle de vie (promotion / shadow / replay). Une seule table,
  `runtime_telemetry_events`.
- **Aujourd'hui la télémétrie est en écriture quasi pure** : seul `summarizeRuntimeTelemetry`
  (par agent) est lu, par la boucle d'amélioration. Le résumé flotte et le diagnostic de santé
  n'ont aucun appelant en production. Ne pas écrire l'inverse : `docs/known-gaps.md` §2.

<!-- HEARST-GOVERNANCE:START -->
## Gouvernance — ordre de lecture obligatoire
Ce projet est rattaché à la gouvernance centrale Hearst via `.hearst/governance.json`
(repo `Hearst-Corporation/governance`, ref figée au SHA canonique). Avant toute intervention,
lire dans cet ordre :

1. `.hearst/governance.json`
2. doctrine globale
3. règles globales
4. doctrine projet (`doctrine/projects/agent-mission-control.md` dans le repo governance)
5. règles projet (`rules/projects/agent-mission-control.md` dans le repo governance)
6. AGENTS.md / CLAUDE.md local (ce fichier)
7. mission active

Les règles locales complètent — sans les affaiblir — la doctrine et les règles globales.
<!-- HEARST-GOVERNANCE:END -->
