<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> **Discipline de ce fichier** : invariants courts pour agents, rien d'autre. Le détail par
> mission (roster complet, exports, canvas, accounting factory) vit dans
> `docs/missions/AGENTS-history-2026-07.md` — le consulter AVANT de toucher un domaine listé.

<!-- BEGIN:doctrine-hierarchy -->
## Hiérarchie de doctrine

1. `CLAUDE.md` — git, merge, push, déploiement, sécurité opérationnelle.
2. `AGENTS.md` (ce fichier) — workflow agent, ports, architecture, Catalyst, vérité runtime.
3. `src/components/agent-ops/DESIGN-DOCTRINE.md` — surfaces, tokens, composants UI, iconographie,
   responsive, tables, empty states. Portée : `src/app/admin/**` et `src/components/agent-ops/**`.
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
- **Dashboard** (`src/app/admin/`, `src/components/agent-ops/`) → **primitives Catalyst
  uniquement** (`src/components/catalyst/`). Zéro `<button>`/`<input>`/`<select>`/`<textarea>`/
  `<table>` natif. Un contrôle au style entièrement custom (toggle, tuile sélectionnable, croix
  de suppression dans un badge) utilise `Headless.Button` (`@headlessui/react`) plutôt qu'un
  `<button>` brut — même sémantique clavier/focus/disabled que `Button` Catalyst, sans hériter
  de son padding/couleur par défaut.
- **Marketing** (`src/app/(site)/`, `src/components/marketing/`) → blocs Tailwind Plus pris tels
  quels, restylés sur les tokens du projet (`accent-*`/`zinc`). Pas de primitive Catalyst ici —
  convention volontaire, le marketing est une vitrine statique.
- **Un seul accent : `accent` (vert tendre, `#A7FB90`, `src/app/globals.css`).** Tout le reste est `zinc`.
  Les autres couleurs que `<Button color>` accepte sont interdites hors `components/catalyst/`.
- Besoin d'une section/écran dashboard ? → **lis** `~/.claude/tailwind-blocks/application-ui/`
  pour la structure, puis monte-la avec les primitives Catalyst. Ne colle jamais le JSX brut d'un
  bloc dans le dashboard.
- **18 primitives** dans `src/components/catalyst/` (avatar, badge, button, dialog, divider,
  fieldset, heading, input, link, navbar, select, sidebar, sidebar-layout, surface, switch,
  table, text, textarea). `sidebar-layout` + `sidebar` + `navbar` = LE shell admin, `surface` =
  la grammaire de plans. N'ajoute une primitive que si elle a un consommateur réel : alert,
  dropdown, pagination, description-list et table-fit ont été importés puis supprimés faute
  d'usage.
<!-- END:catalyst-ui-rules -->

## Invariants agents & runtime (détail : docs/missions/AGENTS-history-2026-07.md)

- **Roster TradeAgent canonique** (AIGENT-RESET-022, 22/07) : 4 agents dans `proj-tradeagent`,
  provider `openai`, modèle `gpt-5.4` — Market Intelligence + Portfolio Risk Guardian (`active`,
  prouvés par run), Execution Supervisor + Performance Analyst (`draft`). Provisioning :
  `scripts/provision-tradeagent-roster.mjs`. Reset : `scripts/reset-agent-platform.mjs`
  (dry-run par défaut).
- **`active` signifie PROUVÉ** : `--activate` exige un run `completed`, zéro tentative unsafe,
  modèle vérifié. Jamais un simple changement de statut.
- **Piège LangGraph** : jamais `runtime: 'langgraph'` pour un agent à outils marché — les outils
  du manifest ne sont jamais montés (l'agent répond « pas de données » avec `tool_call_count=0`
  en paraissant sain). Utiliser `openai-assistants`.
- **La description d'un outil EST son contrat d'entrée** : le runner l'envoie au modèle sans
  schéma JSON. Les schémas Zod attendent `pair` (pas `symbol`) — sans description explicite,
  chaque appel échoue.
- **Garde d'exécution** (AIG-…-GATE-020) : `POST /api/agent-ops/copilots/:id/run` relit l'agent
  canonique et refuse fail-closed (seul `active` + `unresolvedToolIds` vide autorise un run ;
  503/404/409 sinon). Ne jamais recalculer le statut dans une route.
- **Factories métier read-only** : trading (`src/lib/agent-mission-control/market/`) et
  accounting (`…/finance/`) n'ont AUCUN chemin d'écriture réel (ordres/comptes/ERP). Donnée
  absente → UNAVAILABLE avec provenance, jamais inventée ; montants/prix en décimales lossless,
  jamais float. Sentinel (trading) et `securite-fournisseurs`/`controleur-general` (finance) =
  BLOCKED terminal.
- **Runtime multi-provider — ne pas régresser en « OpenAI-only »** : le model-router direct route
  vers `openai`/`google`/`local` (vLLM, opt-in explicite) ; LangGraph idem via
  `src/langgraph/model-provider.mjs` ; `mistral` déclaré non câblé (erreur typée, jamais de
  fallback muet). Les 7 AP finance tournent en local via vLLM sur le chemin direct. Détail :
  `docs/agent-authoring.md` §3.
- **Matérialisation OpenAI d'agents = étape facturée, jamais exécutée sans accord** (§8 global).
