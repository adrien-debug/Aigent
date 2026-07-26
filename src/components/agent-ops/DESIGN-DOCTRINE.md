# Agent Ops — Design Doctrine (contrat interne, ne pas importer au runtime)

Console admin **premium dark mission control**. Dark-first (classe `dark` posée sur `<html>`,
variant Tailwind v4 `@custom-variant dark`). Toujours écrire les classes AVEC les variantes
`dark:` de Catalyst (les composants Catalyst gèrent light+dark ; l'app force dark).

## Sources (doctrine stricte)
- **Primitives** (`@/components/ui/*`) = primitives UNIQUES. Liste exacte, **19 fichiers** :
  Avatar, Badge, Button, Dialog, Divider, Fieldset, Heading/Subheading, Input, Link,
  Navbar, Panel, Section, Select, Sidebar, SidebarLayout, Switch, Table, Text, Textarea.
  17 viennent du kit Catalyst ; **`panel` et `section` sont maison** — les plans de surface et la
  carte-à-en-tête du dashboard n'existent pas dans Catalyst. `Surface` **n'existe plus** : elle a
  été scindée en `panel` (les plans : `surfaceRaised`/`surfaceSunken`/`surfaceOverlay`) et
  `section` (`surfaceSectionClass` + `SectionHeader`). INTERDIT de recréer une primitive qui
  existe déjà ici.
- **Une primitive n'entre dans `src/components/ui/` qu'avec un consommateur réel dans le même
  commit.** Alert, Dropdown, Pagination, DescriptionList et TableFit ont été importés puis
  supprimés faute d'usage : ne les réintroduis pas sans l'écran qui les consomme.
  Le dossier `src/components/catalyst/` **n'existe plus** — le kit a été déplacé vers
  `src/components/ui/` par le refactor `353a1ed` (cf. AGENTS.md) ; c'est ce chemin, et lui seul,
  que scanne `check:catalyst`.
- **Tous les tokens vivent dans `src/theme.css`.** `src/app/globals.css` n'est PLUS qu'un stub de
  5 lignes qui `@import "../theme.css"`, gardé uniquement pour que le `import './globals.css'` de
  `src/app/layout.tsx` continue de résoudre. N'y ajoute jamais un token, une règle ou un `@theme` :
  la source unique est `src/theme.css`.
- **application-ui-v4** = patterns admin (shells, tables, stats, tabs, feeds, action panels,
  page headings) → à ADAPTER, jamais coller brut.
- **ecommerce-v4** = uniquement rythmes transactionnels (order detail/summary, progress,
  history) pour benchmarks / run detail / promotion / replay / coûts.
- **marketing-v4** = uniquement bento/stats/feature/CTA pour overview, empty states, onboarding,
  architecture strip — TOUJOURS re-tonalisé dark admin, jamais un look landing page.
- Jamais 3 familles visuelles dans une même section. Jamais de placeholder/texte/image des packs.

## Surfaces & profondeur (AIG-DS-SURFACE-001)

Cinq plans, chacun un vrai pas de luminance — la profondeur vient de la COULEUR
d'abord, ring et shadow ne font que renforcer. Deux plans adjacents ne portent
jamais la même valeur.

| Plan | Token / classe | Usage |
|------|----------------|-------|
| 0 — App | `bg-surface-app` (`#09090b`) | Fond de page, derrière le workspace |
| 1 — Workspace | `bg-surface-workspace` (`#111114`) | La carte `<main>` du `SidebarLayout` |
| 2 — Raised | `surfaceRaised` / `surfaceSectionClass` (`#1a1a1e`) | Panneaux : charts, tables, listes, KPI |
| 3 — Sunken | `surfaceSunken` / `surfaceItemClass` (`#0d0d10`) | Insets : en-têtes de table, filtres, zones de tracé |
| 4 — Overlay | `surfaceOverlay` (`#232327`) | Dialog, dropdown, command palette, drawer mobile |

**Deux familles de tokens surface coexistent encore dans `src/theme.css`.** Les cinq plans ci-dessus
sont la famille **canonique**. La famille historique — `surface-canvas`, `surface-primary`,
`surface-secondary`, `surface-interactive`, `surface-elevated`, `surface-focus`,
`surface-foreground` — est **encore consommée** (respectivement 3, 3, 2, 7, 4, 4 fichiers hors
`src/theme.css` ; `surface-foreground` n'est lu que par la règle `body`). Elle reste donc en
**compatibilité transitoire** :
- Aucun nouveau composant ne l'utilise. Toute nouvelle surface prend un des cinq plans.
- Un composant existant qui la consomme migre quand on le touche pour une autre raison, jamais
  dans un commit dédié à la migration seule.
- Sa suppression est une **dette ouverte**, pas un acquis : ne pas écrire qu'elle a été éliminée
  tant que `src/theme.css` la déclare.

Règles :
- **Jamais** un panneau de la même couleur que la surface qui le porte.
- Pas de `dark:shadow-none` : le sombre a besoin d'ombre portée + highlight 1px.
- Les tokens `--color-surface-*` sont des tokens `@theme` consommés en CLASSES
  (`bg-surface-raised`), pas en `var()` — une recherche `var(--…)` ne les trouve pas.
- KPI strips : `AgentKpiBand` avec `separators` — une seule surface divisée par des
  hairlines, jamais N blocs de texte flottants.
- Empty states : bordure dashed légère sur canvas, pas une carte secondary pleine.
- Tables : `border-b border-white/5` sur `<thead>`, pas de wash noir lourd.

Détail : `docs/surface-usage.md`.
- Hover ligne de table : `hover:bg-white/2.5`
- Pas de glassmorphism, pas d'ombres lourdes, pas de néon.

## Couleur — accent unique + rouge danger réservé (la couleur n'est JAMAIS le seul indicateur : toujours un label)
- **UNE seule teinte chromatique décorative** : `accent` = **vert tendre** (`#A7FB90` = **500**),
  échelle `accent-50…950` pleinement saturée, enregistrée dans `src/theme.css` (`@theme`) — signature
  « operator console » du mission-control sur fond zinc sombre. TOUTE surface de couleur décorative
  (badges, états positifs, charts, meters, nav, boutons non destructifs) est une **nuance de cette
  teinte**. `zinc` est le SEUL neutre. La **seule** autre teinte est le **rouge danger** ci-dessous —
  sémantique, jamais décorative.
- **Rouge danger — la SEULE exception, sémantique et non décorative (AIGENT-UI-TRUTH-026).** Une
  seule teinte hors accent : le rouge, réservé à l'**échec** et à la **destruction** (bannières
  d'erreur, états terminaux `failed`/`degraded`, confirmations destructrices). Jamais une série de
  chart, jamais un hover, jamais une décoration. Consommé via les rôles nommés `--state-danger-*`
  de `src/theme.css` : `--state-danger-soft` et `--state-danger-line` sont dérivés en
  `color-mix(in oklab, --state-danger-base …, transparent)` (comme les washes/hairlines accent) ;
  `--state-danger-text`/`--state-danger-solid`/`--state-danger-solid-line` sont des valeurs hex
  fixes, pinnées pour l'AA. Toujours un rôle nommé — jamais une opacité rouge écrite à la main. Comme l'accent, **la couleur ne porte jamais le sens seule** : un LABEL (et sur la
  bannière un marqueur non chromatique) le dit toujours. Le gate `check-danger-role` échoue si un
  échec ou une destruction porte l'accent au lieu du rouge.
- **Rôles accent nommés — OBLIGATOIRES, zéro opacité accent ad-hoc.** Valeurs réelles de
  `src/theme.css`, toutes en `color-mix(in oklab, …, transparent)` sauf mention contraire, toutes
  consommées — zéro token orphelin :
  - `--accent-soft` — `accent-600` à **10 %** — wash léger : hover, nav/état au repos.
  - `--accent-surface` — `accent-600` à **15 %** — fond d'élément sélectionné/actif, header de
    carte/table.
  - `--accent-line` — `accent-700` à **40 %** — hairline / bordure accent.
  - `--accent-line-strong` — `accent-700` à **60 %** — ring de sélection (état choisi).
  - `--accent-node-active` — `accent-600` à **80 %** — bordure de nœud actif, canvas My Team.
  - `--accent-node-selected` — `accent-800` **plein** (pas de mix) — ring de nœud sélectionné.
  Les deux tokens `node` sont réservés au canvas `project-team/` : ne les consomme pas ailleurs.
  **INTERDIT** d'écrire une opacité accent à la main (`bg-accent-500/5`, `/10`, `/15`, `/20`,
  `accent-400/10`, `ring-accent-500/20`, etc.) : si le besoin correspond à l'un des rôles
  ci-dessus, on consomme le token (`bg-[var(--accent-x)]` / `ring-[var(--accent-x)]`, cf.
  `improve-workbench.tsx` = référence d'usage). Une opacité accent qui ne correspond à AUCUN
  rôle n'est pas improvisée : on l'ajoute comme nouveau token nommé dans `src/theme.css` (avec son
  commentaire de rôle) plutôt que de la laisser en valeur libre dans un composant. Focus clavier
  = `outline-accent-500` de Catalyst (déjà un seul ring, jamais un token de rôle). Statut =
  **LABEL + point/fill accent solide** (couleur pleine, pas un wash translucide de fond).
- **Zéro autre teinte décorative** : jamais indigo/amber/rose/blue/violet/lime/orange/emerald… La
  seule teinte hors accent est le **rouge danger** (`--state-danger-*`), strictement sémantique
  (échec/destruction). Le sens (pass/warn/actif) est porté par le **LABEL** + l'**intensité** de la
  nuance accent, pas par le hue ; seuls échec et destruction sortent vers le rouge.
- **Échelle d'intensité des badges** (clés `Badge`) : `accent` (soft) → `accentStrong` → `accentSolid`.
  - actif / pass / prod healthy → `accent` ; attention/dégradé → `accentStrong` ; alerte accent forte → `accentSolid`.
    Échec et destruction ne sont PAS de l'accent : ils prennent le rouge danger (`--state-danger-*`) —
    jamais un badge `accentSolid` vert pour un `failed`. **`degraded` est le point de collision de
    ces deux phrases** — voir « Arbitrage NON TRANCHÉ » ci-dessous, ne l'applique pas au jugé.
  - risque low→critical : `accent → accent → accentStrong → accentSolid` (escalade par remplissage).
  - neutre (draft/paused/skip/running/archived) **et métadonnée runtime** (quel moteur) → `zinc`.
- **Boutons** : action primaire = `<Button color="accent">` (solide accent) ; action **destructive** =
  rôle rouge `--state-danger-*` (fond `--state-danger-solid`, cf. `delete-project-dialog.tsx` /
  `agent-detail/release-panel.tsx`), jamais l'accent. Le label dit toujours l'action.
- **Charts** : succès/mesure positive = tokens `--chart-success*` (repointés sur accent) ; série neutre = zinc.
- Texte : titres `text-white`, corps `text-zinc-300/400`, méta `text-zinc-500`. Jamais de hex en dur,
  jamais de teinte hors `accent`/`zinc` — sauf le rouge danger `--state-danger-text` sur un message
  d'échec/destruction. Accent via classes solides (`text-accent-400`,
  `bg-accent-500`) ou via les tokens de rôle `--accent-*` ci-dessus — jamais une opacité
  accent écrite à la main.

## Arbitrage NON TRANCHÉ — `degraded` : vert, rouge, ou zinc ? (décision d'Adrien, en attente)

**Ce bloc ne prescrit rien.** Il constate une contradiction interne de ce fichier et son reflet
dans le code, pour qu'aucun agent ne « résolve » la tension en choisissant seul et en présentant
son choix comme de la doctrine. Tant que ce bloc existe, **ne modifie ni le rendu de `degraded`
ni les deux phrases en tension** : le fichier est propriétaire de la règle, et la règle est
ouverte.

Ce que ce fichier dit aujourd'hui, aux deux endroits, sans que l'un renvoie à l'autre :
- §Couleur — « le rouge, réservé à l'**échec**… états terminaux `failed`/`degraded` » ; et
  l'échelle de badges, deux lignes plus bas — « attention/**dégradé** → `accentStrong` », c'est-à-dire
  **de l'accent vert**. Un même état classé à la fois dans la teinte réservée à l'échec et dans
  l'échelle décorative accent.
- §Composants — « Statuts lifecycle/stage (copilot status, version stage, run status) = **texte
  muet zinc**, jamais de pilule ». Ce qui interdit *les deux* précédents pour un statut de
  lifecycle, `degraded` compris — mais sans dire si `degraded` est un statut de lifecycle ou un
  incident.

Ce que le CODE fait aujourd'hui — deux écrans, deux réponses opposées, chacun cohérent avec une
phrase différente de ce fichier :
- `src/components/views/agents/agents-list-view.tsx` — `STATE_BADGE.degraded = 'accentStrong'` :
  un **badge vert**, plus une pastille zinc. C'est l'application littérale de la ligne « dégradé →
  `accentStrong` ». Son commentaire assume le compromis : le design étant mono-accent, les états
  sont séparés par la DENSITÉ et le LABEL, pas par le hue.
- `src/components/views/projects/project-detail-view.tsx` — `CopilotStatusTone` classe `degraded`
  en `danger` : **texte rouge** `--state-danger-text`. Son commentaire argumente que `degraded`
  signifie « l'agent déclare des outils sans handler enregistré, il ne PEUT pas tourner » (cf.
  AGENTS.md, garde d'exécution) — donc un échec, pas un avertissement doux.

La question à trancher, qui n'est pas une question de couleur mais de sémantique :
**`degraded` est-il un incident terminal (l'agent ne peut pas tourner → rouge, comme `failed`),
ou un état de cycle de vie que l'opérateur observe (→ zinc muet, comme `draft`/`paused`) ?**
Les trois issues possibles, et ce qu'elles coûtent :
1. **Incident** → rouge partout ; il faut alors retirer « dégradé → `accentStrong` » de l'échelle
   accent, et exclure `degraded` de la règle « lifecycle = zinc muet ».
2. **Lifecycle** → zinc muet partout ; il faut alors retirer `degraded` de la liste rouge du
   §Couleur, et corriger `project-detail-view.tsx`.
3. **Palier intermédiaire assumé** (ni sain ni mort) → il lui faut un rôle nommé à lui, décidé
   avec la palette ; « vert `accentStrong` » ne peut pas rester ce rôle par défaut tant que le
   §Couleur classe `degraded` avec l'échec.

Aucune de ces issues n'est retenue ici. **Décision d'Adrien.** Une fois tranchée : écrire la
réponse dans ce fichier UNIQUEMENT, aligner les deux vues, puis étendre `check:danger` pour que la
gate refuse le rendu perdant — sinon la contradiction reviendra.

## Typo & espacement
- **UNE police pour TOUT — Satoshi Variable, chiffres et KPI compris.** La règle qui tenait les
  valeurs chiffrées/tabulaires en monospace (Geist Mono) est **levée** : `--font-mono` résout
  désormais vers Satoshi (`src/theme.css`), donc chaque `font-mono` du dashboard rend en Satoshi. Les
  classes `font-mono`/`tabular-nums` restent autorisées (alignement des chiffres via font-features)
  mais ne changent plus de famille. Détail : README → « Typography ».
- Échelle d'espace : 4/8/12/16/24/32/48 uniquement (`gap-2/3/4/6/8`, `p-4/6`, `space-y-6/8`).
- 2–3 tailles de texte par écran. Titres : Catalyst `Heading`/`Subheading`. Corps `text-sm`.
- Données chiffrées, IDs, JSON, versions : `font-mono tabular-nums` (rend en Satoshi Variable — cf. règle ci-dessus).
- **Deux micro-paliers sous `text-xs`, tous deux DÉCLARÉS — il n'y en a pas de troisième.**
  L'échelle de texte du dashboard est `text-[10px]` → `text-[11px]` → `text-sm` → `text-lg/xl/2xl`
  (`text-xs` = 12px est le corps méta). Toute autre taille arbitraire (`text-[9px]`, `text-[13px]`,
  `text-[15px]`…) est INTERDITE.
  - **`text-[10px]` — overline / micro-eyebrow** (label de stat KPI, eyebrow de `PageHeader`,
    `<dt>` majuscule, header de table) : toujours la constante partagée `eyebrowClass`, qui vit
    dans `src/components/shell/page-header.tsx` (ré-exportée par `agent-ops/surface-card.tsx` pour
    compatibilité — importe la source, pas le ré-export). Valeur réelle aujourd'hui
    `text-[10px] font-medium uppercase tracking-widest text-zinc-400`. Ne jamais la réécrire à la
    main, ni la faire varier selon un flag de layout. Toujours uppercase + tracking : à 10px, du
    texte de phrase est illisible.
    *L'ancienne « contradiction ouverte » de ce fichier (commentaire disant `zinc-400`, constante
    livrant `zinc-500`) est TRANCHÉE : la constante est passée à `zinc-400`, mesuré ≥ 6,11:1 sur
    les cinq plans (table dans le commentaire de `page-header.tsx`).* Attention : les overlines
    écrites à la main ailleurs n'héritent PAS du correctif — `check:contrast` en trouve encore à
    `text-[10px] … text-zinc-500` (4,02:1) sur `/admin` et `/admin/settings`.
  - **`text-[11px]` — palier DÉCLARÉ, pas toléré** : 13 usages dans le périmètre dashboard
    (3 autres en marketing, hors portée de ce fichier). Rôle unique : **métadonnée secondaire
    dense** qui doit rester lisible mais céder le pas au `text-xs` de la même ligne — deuxième
    ligne d'une cellule de table, `font-mono` d'ID/provenance/hash, initiales d'avatar, `<pre>` de
    config. Toujours en casse normale (l'uppercase à cette taille appartient au palier 10px).
    N'ouvre pas un 11px pour un texte que l'opérateur doit LIRE : ça, c'est `text-xs` minimum.
    Contrairement au 10px, ce palier n'a **pas** de constante partagée — il est écrit à la main,
    et aucun outil ne le garde aujourd'hui.
- **Grand chiffre KPI** (`AgentKpiBand`, valeurs) : `font-mono font-light tabular-nums` (rend en
  Satoshi Variable, cf. règle police unique), taille `text-2xl/8` (hero) alignée sur le `Heading`
  H1, `text-xl/7` (compact), `text-lg/6` (small). `font-light` est **réservé à ce seul rôle** — le
  « grand chiffre fin » — jamais ailleurs.
- Dense mais lisible : tables `text-sm`, méta `text-xs`.

## Cascade — un `className` d'appelant ne gagne PAS (règle propriétaire de ce fichier)

Toutes les primitives de `src/components/ui/` composent leurs classes en
`clsx(defaults, …, className)`. Ça donne l'illusion qu'un appelant peut surcharger un défaut en
passant la classe concurrente. **C'est faux, et c'est un no-op silencieux.**

La formulation exacte est déjà dans `src/components/ui/section.tsx` (commentaire de
`surfaceSectionHeaderStructureClass`) — elle est remontée ici parce qu'elle vaut pour TOUTE
primitive, pas seulement pour le header de `Section` :

> A local `className="px-4"` does NOT override the default `px-6`: two utilities of the same
> property have the same specificity, so the winner is the one Tailwind emits LAST in the
> stylesheet (`.px-4` line 3232 < `.px-6` line 3240) — never the one written last in the class
> attribute.

Conséquences, non négociables :
- **Ce qui tranche est l'ordre dans la FEUILLE COMPILÉE, pas l'ordre dans l'attribut `class`.**
  L'ordre d'émission de Tailwind est le sien, pas le tien : tu ne peux pas le prévoir depuis
  l'appelant, donc tu ne peux pas raisonner « ma classe est après, elle gagne ».
- Une propriété que l'appelant doit pouvoir changer se pilote par une **prop discrète** dont la
  primitive choisit la valeur (ex. `density` sur `SectionHeader` → `SURFACE_HEADER_DENSITY`), pas
  par un `className` concurrent. Une seule des deux valeurs est alors émise : plus de course.
- `className` sur une primitive reste légitime pour **ajouter** une propriété que le défaut ne
  pose pas (`mt-*`, `truncate`, `min-w-0`, une couleur là où la primitive n'en pose aucune).
  Il est illégitime pour **remplacer** une propriété déjà posée par le défaut.
- Si un override est vraiment inévitable, la seule échappatoire honnête est un `!` explicite
  (`pl-4!`) — visible dans le diff, donc discutable en revue. Un `px-4` nu qui ne fait rien ne
  l'est pas.
- Corollaire de test : « j'ai passé la classe, ça a l'air bon » n'est pas une vérification. La
  seule preuve est le style calculé au rendu.

## Composants — API partagée (contrat, importer depuis `@/components/agent-ops/...`)
- Statuts lifecycle/stage (copilot status, version stage, run status) = **texte muet zinc**, jamais
  de pilule : `RunStatusText { status }` (run-detail-panel) est la référence du pattern ; les
  libellés de stage passent par `versionStageLabels` (version-stage-text) et les labels de statut
  copilot vivent inline. **Exception non résolue** : `degraded` — cf. « Arbitrage NON TRANCHÉ »
  ci-dessus ; cette phrase et l'échelle de badges du §Couleur ne sont pas d'accord sur lui.
- `RuntimeBadge { runtime: AgentRuntime }` — `Badge zinc`
- `ToolBadge { name: string; risk?: ToolRiskLevel }` — zinc, `font-mono`, dot accent-300→600 selon risque
- `AgentSectionCard { title, description?, actions?, children, className?, contentClassName? }`
- `AgentBentoCard { eyebrow?, title, description?, children?, className? }`
- `ArchitectureStrip { steps: { name, detail?, status?: 'ok'|'warn'|'off' }[] }`
- **Shell** = `SidebarLayout` (`@/components/ui/sidebar-layout`, design system Kyc) +
  `AigentSidebar`. UN SEUL shell pour tout `/admin`, monté dans `src/app/admin/layout.tsx`.
  Sidebar pleine `w-64` en desktop, `Dialog` Headless en mobile, un seul `<main>`, un seul
  scroll (celui du document). L'ancien `AgentControlShell` (rail 64px) est supprimé.

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

## Project Builder — layout chat-first (contrat)
Trois zones, **zéro duplication d'actions** entre elles :

1. **Bandeau repo (haut, pleine largeur)** — `ProjectRepoIntelligence` /
   `ProjectRepoIntelligenceActions` (project-repo-intelligence) : statut scan,
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
- Le page header (`AdminPageHeader` — H1 Catalyst `text-2xl/8`) porte
  titre/description ; le chat header ne les répète pas au-delà d'une ligne d'aide opérateur.

## Data — LIVE uniquement (plus aucun mock dans l'app)
- Toute donnée vient de `@/lib/agent-mission-control/data` (async, server-only, PostgREST gpu1
  base `aigent`). **Fail-closed** : sans backend configuré, les getters *throw* et le
  boundary `/admin/error.tsx` propose un retry — l'app ne fabrique JAMAIS de donnée.
- L'app **n'importe jamais** `seed-fixtures` (garde CI `check:ds`, qui échoue sur tout import
  depuis `src/app` ou `src/components`). `seed-fixtures.ts` ne sert qu'au script de seed
  (`scripts/seed-amc.ts`) pour peupler la vraie base.
- Labels d'affichage (enum → texte) dans `./labels` (constantes UI, pas de la data).
- Les pages (server components) fetchent et passent des props sérialisables. Zéro `Math.random()`
  dans le rendu ; jamais importer `data.ts` depuis un composant client (clé service_role).
