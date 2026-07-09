# Agent Ops — Design Doctrine (contrat interne, ne pas importer au runtime)

Console admin **premium dark mission control**. Dark-first (classe `dark` posée sur `<html>`,
variant Tailwind v4 `@custom-variant dark`). Toujours écrire les classes AVEC les variantes
`dark:` de Catalyst (les composants Catalyst gèrent light+dark ; l'app force dark).

## Sources (doctrine stricte)
- **Catalyst** (`@/components/catalyst/*`) = primitives UNIQUES : Button, Badge, Table, Dialog,
  Dropdown, Fieldset, Input, Textarea, Select, Switch, Checkbox, DescriptionList, SidebarLayout,
  Sidebar, Navbar, Heading/Subheading, Text, Alert, Pagination, Divider, Avatar, Link.
  INTERDIT de recréer une primitive qui existe dans Catalyst.
- **application-ui-v4** = patterns admin (shells, tables, stats, tabs, feeds, action panels,
  page headings) → à ADAPTER, jamais coller brut.
- **ecommerce-v4** = uniquement rythmes transactionnels (order detail/summary, progress,
  history) pour benchmarks / run detail / promotion / replay / coûts.
- **marketing-v4** = uniquement bento/stats/feature/CTA pour overview, empty states, onboarding,
  architecture strip — TOUJOURS re-tonalisé dark admin, jamais un look landing page.
- Jamais 3 familles visuelles dans une même section. Jamais de placeholder/texte/image des packs.

## Surfaces & profondeur (graphite/zinc, élévation par couches)
- Fond app : `bg-zinc-950`
- Carte / panneau : `bg-zinc-900 ring-1 ring-white/10 rounded-xl`
- Surface imbriquée / code / matrice : `bg-zinc-950/50 ring-1 ring-white/5 rounded-lg`
- Header de carte : `border-b border-white/5 px-6 py-4`, corps `px-6 py-5` (ou `p-6`)
- Hover ligne de table : `hover:bg-white/2.5`
- Pas de glassmorphism, pas d'ombres lourdes, pas de néon.

## Couleur — sémantique STRICTE (la couleur n'est JAMAIS le seul indicateur : toujours un label)
- **green/emerald** : actif, succès, pass, prod healthy (`text-green-400`, Badge color="green")
- **amber** : warning, dégradé, attention requise
- **rose/red** : danger, fail, action destructive, unsafe
- **blue / violet / indigo** : UNIQUEMENT runtime & tracing (runtime badges, liens LangSmith)
- **zinc** : neutre, draft, paused, skip
- **lime → amber → orange → rose** : échelle de risque low → medium → high → critical
- Texte : titres `text-white`, corps `text-zinc-300/400`, méta `text-zinc-500`. Jamais de hex en dur.

## Typo & espacement
- Échelle d'espace : 4/8/12/16/24/32/48 uniquement (`gap-2/3/4/6/8`, `p-4/6`, `space-y-6/8`).
- 2–3 tailles de texte par écran. Titres : Catalyst `Heading`/`Subheading`. Corps `text-sm`.
- Données chiffrées, IDs, JSON, versions : `font-mono tabular-nums`.
- Dense mais lisible : tables `text-sm`, méta `text-xs`.

## Composants — API partagée (contrat, importer depuis `@/components/agent-ops/...`)
- `StatusBadge { status: CopilotStatus }` — dot + label
- `RuntimeBadge { runtime: AgentRuntime }` — famille blue/violet uniquement
- `RiskBadge { risk: ToolRiskLevel }` — lime/amber/orange/rose
- `ToolBadge { name: string; risk?: ToolRiskLevel }` — zinc, `font-mono`
- `TestResultBadge { result: TestResultStatus }` — pass=green, fail=rose, error=orange, skip=zinc, running=blue
- `AgentSectionCard { title, description?, actions?, children, className?, contentClassName? }`
- `AgentMetricCard { label, value, delta?, trend?: 'up'|'down'|'flat', hint? }`
- `AgentBentoCard { eyebrow?, title, description?, children?, className? }`
- `AgentPageHeader { title, description?, meta?, actions? }`
- `ArchitectureStrip { steps: { name, detail?, status?: 'ok'|'warn'|'off' }[] }`
- `AgentControlShell { children }` — SidebarLayout Catalyst, UN SEUL shell pour tout /admin.

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

## Data
- Tout vient de `@/lib/agent-mission-control/mock-data` (typé par `types.ts`). Zéro fetch,
  zéro appel externe, zéro `Math.random()` dans le rendu.
