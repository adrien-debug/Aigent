<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> **Discipline de ce fichier** : invariants courts pour agents, rien d'autre. Le détail par
> mission (roster complet, exports, canvas) vit dans
> `docs/missions/AGENTS-history-2026-07.md` — le consulter AVANT de toucher un domaine listé.

<!-- BEGIN:doctrine-hierarchy -->
## Hiérarchie de doctrine

1. `CLAUDE.md` — git, merge, push, déploiement, sécurité opérationnelle.
2. `AGENTS.md` (ce fichier) — workflow agent, ports, architecture, Catalyst, vérité runtime.
3. Gates exécutables (`npm run check`) — arbitre final : une gate rouge gagne sur toute phrase de
   doctrine.
4. Mission courante.

Il n'existe aujourd'hui aucune doctrine visuelle de dashboard : P006 a supprimé l'ancien front
(`src/components/agent-ops/**`, `src/components/views/**`, `src/components/shell/**` et leur
doctrine `DESIGN-DOCTRINE.md`), et `/admin` + `/admin/runs` sont des placeholders neutres en
attente de reconstruction. Une nouvelle doctrine visuelle ne s'écrit qu'au moment où un vrai écran
se reconstruit — jamais par anticipation.

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
## UI (gate : `npm run check:no-legacy-front`)
- `/admin` et `/admin/runs` sont des **placeholders neutres** (P006) : pas de carte, pas de
  shell, pas de navigation, pas de données. La reconstruction visuelle du dashboard n'a pas
  commencé — n'y ajoute rien par anticipation.
- **Marketing** (`src/app/(site)/`, `src/components/marketing/`) → blocs Tailwind Plus pris tels
  quels, restylés sur les tokens du projet (`accent-*`/`zinc`). Vitrine statique, doctrine
  inchangée par la démolition du dashboard.
- **Un seul accent : `accent` (vert tendre, `#A7FB90`, `src/theme.css`).** Tout le reste est `zinc`.
  (`src/app/globals.css` n'est qu'un stub qui `@import "../theme.css"`.)
- **Les primitives Catalyst vivent dans `src/components/ui/`** — kit minimal, uniquement les
  primitives réellement consommées par une route vivante (`npm run quality:dead` échoue sur une
  primitive orpheline). Aucun composant "pour plus tard", aucun design system parallèle. Les
  primitives nécessaires au futur dashboard seront réintroduites depuis la source officielle au
  moment où elles seront réellement utilisées — pas avant.
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
- **Endpoint LangGraph** : `agent-server-endpoint.mjs` refuse un endpoint distant hors production.
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
