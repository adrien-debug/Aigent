# Agent Ops — Design Doctrine (contrat interne, ne pas importer au runtime)

Console admin **premium dark mission control**. Dark-first (classe `dark` posée sur `<html>`,
variant Tailwind v4 `@custom-variant dark`). Toujours écrire les classes AVEC les variantes
`dark:` de Catalyst (les composants Catalyst gèrent light+dark ; l'app force dark).

## Sources (doctrine stricte)
- **Catalyst** (`@/components/catalyst/*`) = primitives UNIQUES : Avatar, Badge, Button, Dialog,
  Divider, Dropdown, Fieldset, Heading/Subheading, Input, Link, Select, Switch, Table, Text,
  Textarea. INTERDIT de recréer une primitive qui existe dans Catalyst. (Le reste du kit vendored
  — Alert, Checkbox, Radio, Combobox, Listbox, Pagination, DescriptionList, Sidebar*, Navbar,
  AuthLayout — a été retiré car jamais consommé ; le restaurer depuis le kit source si besoin.)
- **application-ui-v4** = patterns admin (shells, tables, stats, tabs, feeds, action panels,
  page headings) → à ADAPTER, jamais coller brut.
- **ecommerce-v4** = uniquement rythmes transactionnels (order detail/summary, progress,
  history) pour benchmarks / run detail / promotion / replay / coûts.
- **marketing-v4** = uniquement bento/stats/feature/CTA pour overview, empty states, onboarding,
  architecture strip — TOUJOURS re-tonalisé dark admin, jamais un look landing page.
- Jamais 3 familles visuelles dans une même section. Jamais de placeholder/texte/image des packs.

## Surfaces & profondeur (AIG-DS-SURFACE-001)

Trois niveaux visuels maximum sur le canvas admin :

| Niveau | Token / classe | Usage |
|--------|----------------|-------|
| 1 — Canvas | `--color-surface-canvas` | Fond page, `AdminPageHeader`, bandes KPI nues |
| 2 — Section | `surfaceSectionClass` (`surfaceCardClass`) | Panneaux fonctionnels : Projects, tables, workbench |
| 3 — Item | `surfaceItemClass` | Objets métier : ligne projet, carte agent, tuile KV |
| Nav | `surfaceNavClass` | Sidebar rail — plus léger que les sections |

Règles :
- **Jamais** section dans section dans section (secondary × 3).
- Headers de section : `surfaceSectionHeaderClass` — hairline seule, pas de `bg-black/20`.
- KPI strips : nues sur le canvas (`AgentKpiBand` sans `separators`), pas dans une carte.
- Empty states : bordure dashed légère sur canvas, pas une carte secondary pleine.
- Tables : `border-b border-white/5` sur `<thead>`, pas de wash noir lourd.

Détail : `docs/surface-usage.md`.
- Hover ligne de table : `hover:bg-white/2.5`
- Pas de glassmorphism, pas d'ombres lourdes, pas de néon.

## Couleur — MONOCHROME accent (une seule teinte, la couleur n'est JAMAIS le seul indicateur : toujours un label)
- **UNE seule teinte chromatique** : `accent` = **vert tendre** (`#A7FB90` = 300), échelle
  `accent-50…950` pleinement saturée, enregistrée dans `globals.css` (`@theme`) — signature
  « operator console » du mission-control sur fond zinc sombre. TOUT surface de couleur (badges,
  états, charts, meters, nav, boutons) est une **nuance de cette teinte**. `zinc` est le SEUL neutre.
- **Rôles accent nommés — OBLIGATOIRES, zéro opacité accent ad-hoc** (tokens dans `globals.css`,
  tous consommés — zéro token orphelin) :
  - `--accent-soft` (12%) — wash léger : hover, nav/état au repos.
  - `--accent-surface` (18%) — fond d'élément sélectionné/actif, header de carte/table.
  - `--accent-line` (40%) — hairline / bordure accent.
  - `--accent-line-strong` (55%) — ring de sélection (état choisi).
  **INTERDIT** d'écrire une opacité accent à la main (`bg-accent-500/5`, `/10`, `/15`, `/20`,
  `accent-400/10`, `ring-accent-500/20`, etc.) : si le besoin correspond à l'un des 5 rôles
  ci-dessus, on consomme le token (`bg-[var(--accent-x)]` / `ring-[var(--accent-x)]`, cf.
  `agent-control-shell.tsx` = référence d'usage). Une opacité accent qui ne correspond à AUCUN
  rôle n'est pas improvisée : on l'ajoute comme 6ᵉ token nommé dans `globals.css` (avec son
  commentaire de rôle) plutôt que de la laisser en valeur libre dans un composant. Focus clavier
  = `outline-accent-500` de Catalyst (déjà un seul ring, jamais un token de rôle). Statut =
  **LABEL + point/fill accent solide** (couleur pleine, pas un wash translucide de fond).
- **Zéro autre teinte** : jamais indigo/amber/rose/blue/violet/lime/orange/emerald… Le sens
  (pass/fail/warn/actif) est porté par le **LABEL** + l'**intensité** de la nuance, pas par le hue.
- **Échelle d'intensité des badges** (clés Catalyst) : `accent` (soft) → `accentStrong` → `accentSolid`.
  - actif / pass / prod healthy → `accent` ; attention/dégradé → `accentStrong` ; fail/critical/danger → `accentSolid`.
  - risque low→critical : `accent → accent → accentStrong → accentSolid` (escalade par remplissage).
  - neutre (draft/paused/skip/running/archived) **et métadonnée runtime** (quel moteur) → `zinc`.
- **Boutons** : action primaire ET destructive = `<Button color="accent">` (solide accent) ; le label dit l'action.
- **Charts** : succès/mesure positive = tokens `--chart-success*` (repointés sur accent) ; série neutre = zinc.
- Texte : titres `text-white`, corps `text-zinc-300/400`, méta `text-zinc-500`. Jamais de hex en dur,
  jamais de teinte hors `accent`/`zinc`. Accent via classes solides (`text-accent-400`,
  `bg-accent-500`) ou via les tokens de rôle `--accent-*` ci-dessus — jamais une opacité
  accent écrite à la main.

## Typo & espacement
- Échelle d'espace : 4/8/12/16/24/32/48 uniquement (`gap-2/3/4/6/8`, `p-4/6`, `space-y-6/8`).
- 2–3 tailles de texte par écran. Titres : Catalyst `Heading`/`Subheading`. Corps `text-sm`.
- Données chiffrées, IDs, JSON, versions : `font-mono tabular-nums`.
- Dense mais lisible : tables `text-sm`, méta `text-xs`.

## Composants — API partagée (contrat, importer depuis `@/components/agent-ops/...`)
- Statuts lifecycle/stage (copilot status, version stage, run status) = **texte muet zinc**, jamais
  de pilule : `VersionStageText { stage }` (version-stage-text) et `RunStatusText { status }`
  (run-detail-panel) sont les références du pattern ; les labels de statut copilot vivent inline.
- `RuntimeBadge { runtime: AgentRuntime }` — `Badge zinc`
- `ToolBadge { name: string; risk?: ToolRiskLevel }` — zinc, `font-mono`, dot accent-300→600 selon risque
- `AgentSectionCard { title, description?, actions?, children, className?, contentClassName? }`
- `AgentMetricCard { label, value, delta?, trend?: 'up'|'down'|'flat', hint? }`
- `AgentBentoCard { eyebrow?, title, description?, children?, className? }`
- `ArchitectureStrip { steps: { name, detail?, status?: 'ok'|'warn'|'off' }[] }`
- `AgentControlShell { children }` — shell custom (rail étroit), UN SEUL shell pour tout /admin.

## États & accessibilité (non négociable)
- Chaque écran gère : loading n/a (mocks), **empty state** (marketing feature/CTA re-tonalisé),
  états hover/focus/disabled via Catalyst.
- Focus clavier visible (Catalyst le fait — ne pas le casser).
- Tables : vrais `TableHeader` sémantiques + `sr-only` pour colonnes d'action.
- Responsive mobile-first ; les tables larges scrollent horizontalement (Catalyst Table gère
  le bleed/scroll) ; JAMAIS de scroll horizontal sur le body.
- Motion : 150–300ms max, `prefers-reduced-motion` respecté ; pas d'animation gratuite.

## Layout — règles apprises au rendu (vérifiées par screenshot, non négociables)
- **Une table doit TENIR dans sa colonne à 1440px** (viewport desktop de référence). Si elle
  déborde : retirer des colonnes (le detail panel porte le reste), raccourcir les headers,
  `max-w-* + truncate` sur les cellules longues. Le scroll horizontal de table = filet de
  sécurité mobile, PAS une excuse desktop. Jamais de texte coupé mi-mot sans ellipse.
- **Densité équilibrée dans une rangée de grille** : deux cartes côte à côte doivent avoir des
  hauteurs de contenu comparables (±25%). Une carte aux 2/3 vide face à une carte pleine = bug.
  Rééquilibrer le contenu ou `items-start`, jamais du vide étiré.
- **Zéro cellule de grille vide** : N items dans une grille de M colonnes avec N < M → utiliser
  `grid-cols-[repeat(auto-fit,minmax(280px,1fr))]` ou adapter les colonnes au count.
- **Zéro duplication d'info** entre le page header et une carte du même écran (titre/description
  une seule fois).
- **Cartes jumelles = squelette identique** : mêmes emplacements de badges, mêmes footers
  alignés (actions toujours au même coin), pour que les rangées s'alignent au pixel.
- **L'affordance dit l'état** : bouton d'action primaire disabled quand l'action est bloquée
  (jamais un solid vert cliquable sous un statut "Blocked") ; un switch verrouillé-ON se rend
  checked + disabled, pas éteint ; une donnée absente s'affiche `—` zinc, jamais `0.0%` rose.

## Project Builder — layout chat-first (contrat, 2026-07-13)
Trois zones, **zéro duplication d'actions** entre elles :

1. **Bandeau repo (haut, pleine largeur)** — `ProjectRepoIntelligenceCompact` : statut scan,
   repo map, **Suggestions** (drawer unique), retry scan. C'est le **seul** endroit pour ouvrir
   les suggestions et le repo map. Pas de second bouton Suggestions ailleurs.
2. **Chat (centre)** — fil de messages + composer minimal : textarea, Send, Example prompt.
   Pas de drawer, pas de bouton Suggestions, pas de bandeau d'approval encadré dans le scroll.
3. **Preview (droite)** — spec évolutive (flow, options, tools, policies) + **actions d'approval
   dans le header de la preview** : « Approve — create draft » et LangGraph HITL (Confirm /
   Keep discussing). Pas de CTA draft en bas du scroll preview ; pas de box d'approval dans le chat.

Règles :
- Une action = un seul emplacement (menus en haut du contexte concerné).
- Pas de box dans box dans la preview : options séparées par `divide-y`, sélection par bordure
  accent — pas de carte ring imbriquée dans la carte preview.
- Le page header (`AdminPageHeader` / `AgentPageHeader` — H1 Catalyst `text-2xl/8`) porte
  titre/description ; le chat header ne les répète pas au-delà d'une ligne d'aide opérateur.

## Data — LIVE uniquement (plus aucun mock dans l'app)
- Toute donnée vient de `@/lib/agent-mission-control/data` (async, server-only, PostgREST gpu1
  base `aigent`). **Fail-closed** : sans backend configuré, les getters *throw* et le
  boundary `/admin/error.tsx` propose un retry — l'app ne fabrique JAMAIS de donnée.
- L'app **n'importe jamais** `mock-data` (garde CI `check:ds`). `mock-data.ts` ne sert plus
  qu'au script de seed (`scripts/seed-amc.ts`) pour peupler la vraie base.
- Labels d'affichage (enum → texte) dans `./labels` (constantes UI, pas de la data).
- Les pages (server components) fetchent et passent des props sérialisables. Zéro `Math.random()`
  dans le rendu ; jamais importer `data.ts` depuis un composant client (clé service_role).
