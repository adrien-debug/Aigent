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
3. `src/components/agent-ops/DESIGN-DOCTRINE.md` — surfaces, tokens, composants UI, échelle typo,
   règle de cascade des `className`, responsive, tables, empty states, et les **arbitrages design
   non tranchés**. Portée : le périmètre dashboard complet, celui que scanne `check:catalyst` —
   `src/app/admin/**`, `src/components/agent-ops/**`, `src/components/views/**`,
   `src/components/shell/**`.
4. Gates exécutables (`npm run check`) — arbitre final : une gate rouge gagne sur toute phrase de
   doctrine.
5. Mission courante.

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
## UI (gate : `npm run check:catalyst`)
- **Dashboard** (`src/app/admin/`, `src/components/agent-ops/`, `src/components/views/`,
  `src/components/shell/`) → **primitives Catalyst
  uniquement** (`src/components/ui/`). Zéro `<button>`/`<input>`/`<select>`/`<textarea>`/
  `<table>` natif. Un contrôle au style entièrement custom (toggle, tuile sélectionnable, croix
  de suppression dans un badge) utilise `Headless.Button` (`@headlessui/react`) plutôt qu'un
  `<button>` brut — même sémantique clavier/focus/disabled que `Button` Catalyst, sans hériter
  de son padding/couleur par défaut.
- **Marketing** (`src/app/(site)/`, `src/components/marketing/`) → blocs Tailwind Plus pris tels
  quels, restylés sur les tokens du projet (`accent-*`/`zinc`). Pas de primitive Catalyst ici —
  convention volontaire, le marketing est une vitrine statique.
- **Un seul accent : `accent` (vert tendre, `#A7FB90`, `src/theme.css`).** Tout le reste est `zinc`.
  (`src/app/globals.css` n'est qu'un stub qui `@import "../theme.css"`.)
  Les autres couleurs que `<Button color>` accepte sont interdites hors `components/ui/`.
- Besoin d'une section/écran dashboard ? → **lis** `~/.claude/tailwind-blocks/application-ui/`
  pour la structure, puis monte-la avec les primitives Catalyst. Ne colle jamais le JSX brut d'un
  bloc dans le dashboard.
- **Graphiques : Recharts, jamais de SVG maison.** Doctrine globale §Graphiques — Recharts est le
  moteur standard, ECharts l'étage data-science (gros volumes, heatmap/sankey/treemap, zoom-brush).
  Les wrappers vivent dans `src/components/agent-ops/dashboard-charts/chart-primitives.tsx`
  (`'use client'` — Recharts mesure le DOM) ; le bucketing reste SERVEUR dans `chart-frame.tsx`.
  Couleurs via les tokens `--chart-*` de `src/theme.css`, jamais un hex littéral. Une barre de
  progression HTML (`<div>` à largeur %) n'est pas un graphique et n'a pas besoin de Recharts.
- **Les primitives vivent dans `src/components/ui/`** — le kit a été déplacé de
  `components/catalyst/` (qui n'existe plus) vers `components/ui/` par le refactor `353a1ed`
  (architecture en couches theme/ui/shell/views) ; c'est ce chemin, et lui seul, que scanne
  `check:catalyst`. `sidebar-layout` + `sidebar` + `navbar` = LE shell admin ; `panel` + `section`
  = la grammaire de plans (primitives maison, ex-`surface` supprimé). **La liste exacte, la règle
  du consommateur réel et le contrat de chaque primitive vivent dans
  `src/components/agent-ops/DESIGN-DOCTRINE.md` §Sources** — ne les recopie pas ici, c'est
  précisément la duplication qui avait laissé ce fichier annoncer un compte périmé.
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
