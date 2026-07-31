# UI Manifest — état réel du frontend Aigent

> **Nature de ce document** : observation datée du 2026-07-31, branche
> `mission/cockpit-catalyst-migration` @ `a1f6193`. Ce n'est **pas** une règle
> (cf. `CLAUDE.md` §1). Audit en lecture seule — aucun code modifié.
> Périmètre : `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`,
> `src/components/**`, `postcss.config.mjs`.

---

## 1. Structure exacte du cockpit

### Routes UI existantes — 2

| Route | Fichier | Type |
|---|---|---|
| `/` | `src/app/page.tsx` (62 l.) | Server Component, `dynamic = 'force-dynamic'` |
| *(layout)* | `src/app/layout.tsx` (27 l.) | Server Component |
| `/logout` | `src/app/logout/route.ts` | Route handler, **pas une page** |

Aucune autre page. Pas de `loading.tsx`, pas de `error.tsx`, pas de
`not-found.tsx`, pas de route groups. Le front est **un écran unique**.

### Chaîne de rendu

```
layout.tsx  <html class="dark h-full bg-zinc-950"> / <body class="h-full">
 └─ page.tsx  (async, lit getDashboardOverview(nowMs))
     ├─ SI overview === null  → AppShell nu + <Unavailable reason="unread">
     └─ SINON
         AppShell (client, 'use client')
          ├─ topbar : <TopBar overview={…}/>
          ├─ aside  : <ActionQueue items={overview.actionItems}/>
          └─ children : <CockpitOverview overview nowMs/>
```

### Grille du shell — `src/components/app-shell.tsx`

```
<div class="flex h-full overflow-hidden">
├─ Headless.Dialog        tiroir mobile (lg:hidden), mécanique MobileSidebar Catalyst
├─ <div hidden lg:block h-full min-h-0 w-64 shrink-0 border-r>   sidebar desktop
└─ <div flex min-w-0 flex-1 flex-col>                            colonne principale
    ├─ <header shrink-0 border-b px-4>  → topbar (+ burger lg:hidden)
    └─ <div flex min-h-0 flex-1>
        ├─ <main min-w-0 flex-1 overflow-hidden>   → CockpitOverview
        └─ <aside hidden w-80 shrink-0 xl:block border-l> → ActionQueue
```

`SidebarLayout` de Catalyst est **délibérément non utilisé** (commentaire l. 11-16 :
il pose `min-h-svh` et un `<main>` qui grandit avec son contenu). Le shell
réassemble les mêmes primitives (`Sidebar*`, `NavbarItem`, `Headless.Dialog`)
dans une coquille à hauteur bornée.

### Grille de l'écran — `src/components/cockpit/overview-screen.tsx`

Conteneur : `flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 xl:overflow-hidden`

| # | Panneau | Contrainte de hauteur | Scroll interne |
|---|---|---|---|
| 1 | `KpiStrip` — `<dl>` 6 cellules, `grid-cols-2 sm:3 xl:6` | `shrink-0` | non |
| 2 | `Panel "Activité 24 h"` + `HourlyRunsChart` | `min-h-[15rem] shrink-0 xl:min-h-0 xl:flex-[4] xl:shrink` | non |
| 3 | Grille rosters `xl:flex-[8] xl:grid-cols-[1.35fr_1fr]` | — | — |
| 3a | `Panel "Flux d'exécution"` → `RunStream` (Table) | `min-h-[18rem] xl:min-h-0` | `overflow-y-auto px-4` |
| 3b | `Panel "Agents en vol"` → `AgentRow[]` | `min-h-[13rem] xl:min-h-0 xl:flex-[2]` | `scroll-thin overflow-y-auto` |
| 3c | `Panel "Projets"` → `ProjectRow[]` | `min-h-[13rem] xl:min-h-0 xl:flex-[3]` | `scroll-thin overflow-y-auto` |
| 4 | bandeau `dataWarnings` (conditionnel) | `shrink-0 truncate` | non |

---

## 2. Kit Catalyst vendoré — `src/components/ui/`

### 27 fichiers, tous protégés par empreinte SHA-256

`scripts/check-catalyst-integrity.mjs` (branché dans `npm run check`, position 5)
hash chaque `.tsx`/`.ts` de `src/components/ui/` et compare à
`scripts/catalyst-kit.sha256.json` (**27 entrées**, vérifié). Toute modification,
ajout ou suppression fait échouer la gate. `--update` régénère les empreintes.

**Ce que la gate NE garantit PAS** (dit par le script lui-même) : que les écrans
utilisent réellement Catalyst, ni qu'ils ne le combattent pas depuis l'extérieur
(`className` agressifs, `!important`). Elle protège le kit, **pas son usage**.

Historique (`git log -- src/components/ui/`) : `8017913` reset du front →
`88d3025` premier cockpit → `81ab16d` → `31a1e91` → `a1f6193` (voie A : kit
intact, écran en Catalyst natif). La gate est née de la dérive du 2026-07-31 où
215 lignes du kit avaient été réécrites pour porter les couleurs du produit.

### Ce qui est RÉELLEMENT importé — 9 fichiers sur 27 (33 %)

| Fichier | # imports | Consommateurs |
|---|---|---|
| `text.tsx` | 9 | app-shell, primitives, kpi-strip, rows, run-stream, topbar, action-queue, charts, page |
| `badge.tsx` | 5 | rows, run-stream, topbar, action-queue, charts |
| `heading.tsx` | 3 | primitives (`Subheading`), kpi-strip (`Heading`), action-queue |
| `divider.tsx` | 3 | primitives, action-queue, charts |
| `navbar.tsx` | 2 | app-shell (`NavbarItem`), topbar (`Navbar`, `NavbarDivider`, `NavbarSection`, `NavbarSpacer`) |
| `table.tsx` | 1 | run-stream |
| `sidebar.tsx` | 1 | app-shell |
| `link.tsx` | 1 | action-queue |
| `avatar.tsx` | 1 | rows |

### Les 18 non importés (dormants)

`alert`, `auth-layout`, `button`, `checkbox`, `combobox`, `description-list`,
`dialog`, `dropdown`, `fieldset`, `input`, `listbox`, `pagination`, `radio`,
`select`, `sidebar-layout`, `stacked-layout`, `switch`, `textarea`.

**Fait notable** : `button.tsx` (204 l.) n'est importé **nulle part**. Le cockpit
n'a aucun bouton d'action — cohérent avec le §5 (aucun handler métier).
Tous les composants de formulaire (`input`, `select`, `textarea`, `checkbox`,
`radio`, `switch`, `combobox`, `listbox`, `fieldset`) sont dormants : **le front
n'a aucune surface d'écriture**.

---

## 3. `src/components/cockpit/**` — 7 fichiers

| Fichier | Rend | Props | Utilisé | Verdict |
|---|---|---|---|---|
| `overview-screen.tsx` (159 l.) | l'écran entier, grille + 4 zones | `{overview: DashboardOverview, nowMs: number}` | oui (page.tsx) | **conforme** — composition pure, zéro primitive dupliquée |
| `kpi-strip.tsx` (185 l.) | `<dl>` 6 cellules KPI | `{kpis: DashboardKpis, unread: boolean}` | oui | **conforme** — `Heading`+`Text` Catalyst, jauges hors kit |
| `primitives.tsx` (286 l.) | `Panel`, `Unavailable`, `AbsentMark`, `Led`, `Rail`, `SegmentMeter`, `BarMeter`, `ArcGauge`, `initialsOf` | variés | oui | **conforme, à surveiller** — voir ci-dessous |
| `rows.tsx` (129 l.) | `AgentRow`, `ProjectRow` | `{card, nowMs?}` | oui | **conforme** — `Avatar`+`Badge`+`Strong`/`Text` Catalyst, seul `Rail` hors kit |
| `run-stream.tsx` (84 l.) | `Table` Catalyst des runs | `{runs: NamedRun[], nowMs: number}` | oui | **conforme** — `Table*` officielle, scroll porté par le conteneur |
| `topbar.tsx` (79 l.) | `Navbar` Catalyst d'état télémétrie | `{overview: Pick<…, 3 champs>}` | oui | **conforme** |
| `charts.tsx` (177 l.) | `HourlyRunsChart` (Recharts), `StatusLegend` | `{buckets}` / `{slices}` | oui | **conforme** — dataviz, hors périmètre du kit. **Seul module client métier** |
| `action-queue.tsx` (95 l.) | colonne de décision, liste de `Link` | `{items: ActionItem[]}` | oui | **conforme visuellement, MAIS tous les liens sont morts** (§5) |

### Détail `primitives.tsx` — analyse doublon Catalyst

| Export | Équivalent Catalyst ? | Verdict |
|---|---|---|
| `Panel` | `Table`/`DescriptionList` n'ont pas de notion de hauteur bornée ; le kit n'a **pas** de composant carte | **autorisé** — contrat de hauteur, pas un style. Son en-tête est composé de `Subheading`+`Text`+`Divider` Catalyst |
| `Unavailable` | `Alert` existe mais est un **dialog modal** Headless, pas un état inline | **autorisé** — état de premier rang « absence », distingue `unread` / `no-data` |
| `AbsentMark` | `Badge` aurait pu servir | **limite** — 1 `<span>` de 2 lignes qui rend `UNAVAILABLE_LABEL` en texte muté. Reproductible en `<Badge color="zinc">`. Doublon très mineur, non bloquant |
| `Led` | aucun | **autorisé** — témoin d'activité, `pulse-live` |
| `Rail` | aucun | **autorisé** — barre de sévérité absolue |
| `SegmentMeter`, `BarMeter`, `ArcGauge` | aucun | **autorisé** — visualisations de proportion bornée |
| `initialsOf` | `Avatar` accepte `initials` mais ne les dérive pas | **autorisé** — fonction pure, pas un composant |

**Verdict global : aucune violation structurelle.** Zéro re-création de `Button`,
`Badge`, `Input`, `Text`, `Heading`, `Divider`, `Avatar`, `Table`. Le seul
frottement est `AbsentMark`, cosmétique.

---

## 4. `src/components/app-shell.tsx` — navigation

`'use client'` (nécessaire pour `useState(showSidebar)` et le `Headless.Dialog`).

| Entrée | `href` | Icône | État rendu |
|---|---|---|---|
| Cockpit | `/` | `Squares2X2Icon` | `SidebarItem` actif (`current`) — **lien vivant** |
| Agents | *(aucun)* | `CpuChipIcon` | `<button disabled>` + `title="Agents — écran à venir"` |
| Projets | *(aucun)* | `FolderIcon` | `<button disabled>` |
| Runs | *(aucun)* | `BoltIcon` | `<button disabled>` |
| Livraisons | *(aucun)* | `RocketLaunchIcon` | `<button disabled>` |
| Télémétrie | *(aucun)* | `SignalIcon` | `<button disabled>` |

Footer : `<Text>Écrans à venir désactivés</Text>`.

**Point fort** : la nav est honnête — aucun `href="#"`, la carte du produit est
annoncée sans feindre une navigation qui n'existe pas (commentaire l. 51-56).

`Mark` : SVG d'identité inline (losange), hors périmètre du kit — légitime.
`OpenMenuIcon` / `CloseMenuIcon` : SVG recopiés du kit Catalyst (le kit ne les
exporte pas). Duplication assumée de 2 paths.

---

## 5. Liens morts, boutons sans handler, données en dur

### 5.1 `href="#"` — **ZÉRO**

Grep exhaustif : aucun `href="#"` dans `src/components/**` ni `src/app/*.tsx`.

### 5.2 Liens morts vers `/admin` — **10 occurrences, 100 % des liens de la file d'action**

`ActionQueue` rend `<Link href={item.href}>` pour chaque item. Les `href` sont
fabriqués dans `src/lib/agent-mission-control/dashboard-overview.ts`
(`buildActionItems`, l. 530-690) :

| Ligne | `href` produit | Cible | État |
|---|---|---|---|
| 557 | `/admin` | — | **404** |
| 570 | `/admin/projects/${projectId}/builder` | — | **404** |
| 589 | `/admin` | — | **404** |
| 601 | `/admin` | — | **404** |
| 620 | `/admin/agents/${copilotId}` | — | **404** |
| 634 | `/admin/agents/${copilotId}` | — | **404** |
| 648 | `/admin/agents/${copilotId}` | — | **404** |
| 661 | `evt.prUrl` | GitHub externe | **vivant** (seul lien valide) |
| 681 | `/admin/projects/${project.id}` ou `/admin` | — | **404** |

`/admin` a été supprimé au reset du front (`8017913`) et
`check:no-legacy-front` **interdit sa réapparition**. Conséquence directe :
**la colonne de décision — le composant qui, selon son propre commentaire,
« fait d'un tableau de bord un COCKPIT » — mène systématiquement à un 404**,
sauf pour le cas `pr_open`.

C'est le défaut fonctionnel n°1 de l'écran.

### 5.3 Autres `/admin` en dur (hors chemin de rendu)

Nombreuses occurrences dans `src/lib/agent-mission-control/` (`seed-fixtures.ts`
l. 2348-2396, `project-team/data.ts` l. 452/579, `agent-builder-copilot.ts`,
`github-pr-body.ts`, `consumer-bootstrap.ts`) et des commentaires périmés
(`data.ts`, `health-measure.ts`, `runs-console/*` référencent `/admin/runs`,
`/admin/projects` comme s'ils existaient). **Hors périmètre de cet audit** mais
signalé : la doc interne du data layer décrit des écrans morts.

### 5.4 `/logout` → `/login` — **lien mort**

`src/app/logout/route.ts` : `NextResponse.redirect(new URL('/login', …))`.
`/login` a été supprimé au reset (`check:no-legacy-front` l'interdit).
La route est **orpheline** : rien dans le front ne la référence, et si elle
était atteinte elle redirigerait vers un 404.

### 5.5 Boutons sans handler — **ZÉRO**

Un seul `onClick` dans tout le front : `app-shell.tsx` l. 180, ouverture du
tiroir mobile — câblé. Les 5 `SidebarItem` sans `href` rendent un `<button
disabled>` : intentionnel et honnête, pas un bouton mort.

**Corollaire** : le cockpit n'a **aucune action opérateur**. Pas de « lancer un
run », pas de « promouvoir », pas de « approuver ». C'est un écran de lecture pure.

### 5.6 État simulé / mocké / placeholder — **ZÉRO**

Aucun `mock`, aucun tableau de données littéral, aucun `Math.random`, aucune
valeur d'exemple dans le JSX. `page.tsx` fail-close proprement :
`overview === null` → `<Unavailable reason="unread">` avec le message d'erreur.
Toutes les valeurs affichées viennent de `DashboardOverview`.

Les seules constantes en dur sont des **tables de correspondance légitimes** :
`STATUS_BADGE`, `KIND_BADGE`, `KIND_RAIL`, `KIND_LABEL`, `TELEMETRY_VIEW`,
`GOOD`/`WARN`/`BAD`, `MUTED_RAIL`.

### 5.7 Chaîne en dur discutable

`topbar.tsx` l. 75 : `<Badge color="zinc">Runtime LangGraph</Badge>` — affiché
en dur, **jamais sondé**. Le commentaire l. 6-8 l'assume : « LangGraph n'est pas
un état de santé, c'est l'invariant produit… il s'affiche en neutre, parce
qu'aucune sonde ne l'a interrogé au rendu ». Honnête, mais un opérateur peut le
lire comme un statut vert.

---

## 6. Endpoints appelés par le front — **0 sur 70**

**Aucun `fetch()`, aucune Server Action (`'use server'`), aucun `EventSource`,
aucun `useEffect` dans tout `src/components/**` et `src/app/page.tsx`.**

Le front lit la base **directement en Server Component** :

```
page.tsx → getDashboardOverview(nowMs)          [src/lib/agent-mission-control/dashboard-overview.ts]
            ├─ getCopilots / getProjects / getRecentRunsInWindow   (./data)
            ├─ getAvailableAgents                                  (./available-agents)
            ├─ pgrest('GET', 'agent_delivery_events?…')            (./postgrest)
            ├─ pgrest('GET', sandbox snapshots)
            ├─ pgrest('GET', mission runs)
            ├─ sumMeasuredHealth                                   (./health-measure)
            ├─ diagnoseTelemetryHealth                             (./telemetry-health)
            └─ isExecutable                                        (./runtime-catalogue)
```

| Métrique | Valeur |
|---|---|
| Routes API existantes | **70** (`find src/app/api -name route.ts`) |
| Routes câblées à l'UI | **0** |
| Chemin de lecture réel | data layer server-only → PostgREST |
| Chemin d'écriture depuis l'UI | **aucun** |

Conséquence : `src/proxy.ts` (matcher `/api/agent-ops/:path*`) ne garde **rien
de ce que le front utilise** — le front court-circuite entièrement la couche
API. Les 70 routes sont pilotées par scripts / consommateurs externes, pas par
l'écran.

C'est le second constat structurel majeur : **69 des 70 surfaces API (hors
`/api/auth/login`) sont sans consommateur UI.**

---

## 7. États — loading / error / empty / unavailable

| État | Existe ? | Où |
|---|---|---|
| **error / unavailable global** | ✅ | `page.tsx` l. 36-52 — `overview === null` → `<Unavailable reason="unread">` + message d'erreur. Ne dégrade pas en zéros |
| **unavailable par panneau** | ✅ | `overview-screen.tsx` — chaque panneau teste `null` séparément (`buckets`, `runs`, `agents`) |
| **empty (no-data)** | ✅ | `<Unavailable reason="no-data">` distinct de `unread`, sur les 3 rosters + la file d'action |
| **unavailable par cellule KPI** | ✅ | `kpi-strip.tsx` — `value === null` → `<Unavailable compact>` |
| **unavailable inline** | ✅ | `AbsentMark` dans les cellules de table et de roster |
| **avertissements de lecture** | ✅ | bandeau `dataWarnings` en pied d'écran |
| **loading** | ❌ **MANQUANT** | Aucun `loading.tsx`, aucun `<Suspense>`, aucun skeleton. `dynamic = 'force-dynamic'` + 6 appels PostgREST en `Promise.all` → **la page entière est bloquée pendant tout le TTFB**, écran blanc du navigateur |
| **error boundary React** | ❌ **MANQUANT** | Aucun `error.tsx`. `loadCockpit()` attrape les erreurs de `getDashboardOverview` mais **une erreur jetée pendant le rendu** de `CockpitOverview` / `AppShell` / Recharts produit l'écran d'erreur brut de Next |
| **not-found** | ❌ | Aucun `not-found.tsx` — les 404 des liens `/admin` tombent sur le défaut Next, hors du shell |

**Verdict** : la gestion de l'absence de donnée est **exemplaire** (jamais de
faux zéro, `unread` vs `no-data` toujours distingués, conforme
`AGENTS.md § Vérité des données`). La gestion de l'absence de **rendu**
(loading, error boundary, 404) est **entièrement absente**.

---

## 8. Zéro-scroll — analyse de la chaîne de hauteur

### La chaîne est complète

| Niveau | Classe | Rôle |
|---|---|---|
| `<html>` | `h-full` | ancre |
| `<body>` | `h-full` | ancre |
| shell racine | `flex h-full overflow-hidden` | **coupe tout débordement de page** |
| sidebar desktop | `h-full min-h-0 w-64 shrink-0` | borne, `SidebarBody` scrolle dedans |
| colonne principale | `flex min-w-0 flex-1 flex-col` | — |
| header | `shrink-0` | ne s'étire pas |
| zone basse | `flex min-h-0 flex-1` | **`min-h-0` = le maillon critique** |
| `<main>` | `min-w-0 flex-1 overflow-hidden` | coupe |
| `<aside>` | `hidden w-80 shrink-0 xl:block` | — |
| `CockpitOverview` | `h-full min-h-0 flex-col overflow-y-auto p-3 xl:overflow-hidden` | scroll **sous** xl, coupé **à partir de** xl |
| `Panel` | `flex min-h-0 flex-col overflow-hidden` | ne grandit jamais avec sa donnée |
| corps de `Panel` | `min-h-0 flex-1` + `overflow-y-auto` optionnel | la donnée scrolle dedans |
| `ActionQueue` | `flex h-full min-h-0 flex-col` + liste `overflow-y-auto` | header fixe, liste scrolle |

`overflow-hidden` sur le shell racine garantit qu'**aucun scroll de page ne peut
fuir**, quel que soit le contenu. C'est solide.

### Risques identifiés

| # | Risque | Sévérité |
|---|---|---|
| R1 | **Sous `xl` (< 1280 px), le scroll est délibéré** : `overflow-y-auto` + `xl:overflow-hidden` sur `CockpitOverview`. Les `min-h-[15rem]`/`[18rem]`/`[13rem]` somment ≈ 46 rem + KPI + gaps. En dessous de `xl` la page scrolle **dans `<main>`**, pas au niveau du document — le zéro-scroll est donc **une promesse desktop uniquement**, assumée | info (choix) |
| R2 | **`<aside>` disparaît sous `xl`** (`hidden xl:block`). La file d'action — la valeur de décision de l'écran — est **inaccessible** en dessous de 1280 px. Aucun repli (pas d'onglet, pas de tiroir) | **haute** |
| R3 | **Écrasement vertical entre `xl` et ~900 px de haut** : `xl:flex-[4]` (graphe) + `xl:flex-[8]` (rosters) sur un viewport court. Le `Panel` ne descend pas sous ce que son header impose (`py-3` + `Divider`) ; le `ResponsiveContainer` Recharts peut tomber à quelques dizaines de px et rendre l'histogramme illisible sans jamais déborder | moyenne |
| R4 | **Le bandeau `dataWarnings` est `shrink-0`** et s'ajoute à la colonne quand il existe. Sur un viewport court en `xl`, il vole sa hauteur au graphe et aux rosters (qui sont `flex-*`, donc compressibles). Pas de débordement, mais compression silencieuse | basse |
| R5 | **Le tiroir mobile `Headless.DialogPanel` est `fixed inset-y-0`** : conforme, aucun risque de scroll de page | — |
| R6 | `RunStream` rend **tous** les runs de la fenêtre sans virtualisation ni plafond (`runs.length` peut être grand). Le scroll est borné visuellement, mais le **coût DOM** ne l'est pas | basse |

**Conclusion §8** : la promesse zéro-scroll **tient en desktop `xl`+**, par
construction et non par accident. Le vrai problème n'est pas le scroll, c'est
**R2 : la perte totale de la file d'action sous 1280 px**.

---

## 9. Server Components vs `'use client'`

### Modules client — 11 au total, dont **2 seulement** hors kit

| Module | `'use client'` | Raison |
|---|---|---|
| `src/components/app-shell.tsx` | oui | `useState(showSidebar)` + `Headless.Dialog` |
| `src/components/cockpit/charts.tsx` | oui | Recharts mesure le DOM (`ResponsiveContainer`) |
| `src/components/ui/combobox.tsx` | oui | kit (dormant) |
| `src/components/ui/dropdown.tsx` | oui | kit (dormant) |
| `src/components/ui/listbox.tsx` | oui | kit (dormant) |
| `src/components/ui/navbar.tsx` | oui | kit — **importé** |
| `src/components/ui/sidebar-layout.tsx` | oui | kit (dormant) |
| `src/components/ui/sidebar.tsx` | oui | kit — **importé** |
| `src/components/ui/stacked-layout.tsx` | oui | kit (dormant) |
| `src/components/ui/table.tsx` | oui | kit — **importé** |
| `src/lib/agent-mission-control/consumer-bootstrap.ts` | oui | hors front (chaîne de caractères, pas une directive de rendu) |

### Server Components — 7

`layout.tsx`, `page.tsx`, `overview-screen.tsx`, `kpi-strip.tsx`,
`primitives.tsx`, `rows.tsx`, `run-stream.tsx`, `topbar.tsx`, `action-queue.tsx`.

### Frontière réelle

`AppShell` étant `'use client'`, **tout ce qu'il reçoit en `children` / `aside` /
`topbar` traverse la frontière comme props sérialisées**. Ces sous-arbres restent
bien rendus côté serveur (pattern children-as-props, correct), mais cela impose
que `DashboardOverview`, `ActionItem[]`, `AgentCard[]` soient **sérialisables** —
ils le sont (données plates). À ne pas casser.

`check:rsc-boundary` est **hors de `npm run check`** (`AGENTS.md § Gates`). Elle
se réarme dès qu'un module `'use client'` apparaît — **il y en a maintenant 2
hors kit**, donc la gate a désormais une cible et devrait être relancée pour
vérifier ce qu'elle mesure.

---

## 10. Configuration Tailwind / PostCSS

- **`postcss.config.mjs`** : plugin unique `@tailwindcss/postcss`. Pas
  d'autoprefixer (v4 l'intègre).
- **Aucun `tailwind.config.js`** — conforme à `AGENTS.md § Frontend`.
- **`src/app/globals.css`** (173 l.) : `@import 'tailwindcss'` +
  `@custom-variant dark (&:where(.dark, .dark *))` (indispensable : sans lui la
  classe `dark` sur `<html>` ne déclenche rien en v4, et Catalyst rendrait en
  clair) + `:root` de jetons + `@theme inline` + 6 `@utility`.

### Jetons et utilitaires morts

Le fichier définit un **système visuel « ultra dark, accent cyan »** presque
entièrement inutilisé par le JSX actuel — l'écran ayant migré en **apparence
Catalyst native** (`bg-white dark:bg-zinc-900`, `ring-zinc-950/5`) au commit
`a1f6193`.

| Objet | Usages dans le JSX |
|---|---|
| `@utility cockpit-substrate` | **0** |
| `@utility lip` | **0** (les 2 hits du grep sont des faux positifs : `&hellip;`, `bg-clip-padding`) |
| `@utility elev` | **0** |
| `@utility hatched` | **0** |
| `@utility scroll-thin` | 2 (`overview-screen.tsx`) |
| `@utility pulse-live` | 1 (`primitives.tsx` → `Led`) |
| `--color-base/raised/elevated/overlay/edge` | **0** (`bg-base`, `bg-raised`… jamais écrits) |
| `--color-ink / ink-dim / ink-faint` | **0** |
| `--color-accent / accent-bright / accent-soft` | **0** — l'accent cyan `#00e5d3` **n'apparaît nulle part à l'écran** |
| `body { background-color: var(--surface-base) }` | actif, mais **recouvert** par `bg-zinc-950` sur `<html>` et `bg-white dark:bg-zinc-900` sur le shell |

**≈ 100 lignes sur 173 sont du CSS mort.** Les couleurs réellement affichées sont
codées en dur ailleurs : `src/lib/cockpit/status.ts` (`#0da87f`, `#be850f`,
`#e8455f`), `kpi-strip.tsx` (`GOOD #059669`, `WARN #d97706`, `BAD #dc2626`),
`rows.tsx`, `overview-screen.tsx` (`#be850f`, `#d9a635`).

**Incohérence à noter** : deux vocabulaires de vert/ambre/rouge coexistent —
`status.ts` (`#0da87f`/`#be850f`/`#e8455f`) et `kpi-strip.tsx`
(`#059669`/`#d97706`/`#dc2626`). Le même « succès » n'a pas la même couleur
selon qu'on regarde le KPI ou le roster.

---

## 11. Synthèse — ce qui manque pour 8 routes

Routes cibles : `/`, `/runs`, `/agents`, `/projects`, `/builder`,
`/qualification`, `/delivery`, `/runtime`.

| Cible | Existe | Nav | Données prêtes ? | API prête ? |
|---|---|---|---|---|
| `/` | ✅ | actif | ✅ `getDashboardOverview` | lecture directe |
| `/runs` | ❌ | disabled | ⚠️ `src/lib/runs-console/**` existe (runs-page-data, runs-timeseries) | oui |
| `/agents` | ❌ | disabled | ✅ `available-agents.ts`, `agent-detail.ts` | `/api/agent-ops/agents`, `/copilots/*` |
| `/projects` | ❌ | disabled | ✅ `getProjects`, `project-team/data.ts` | `/api/agent-ops/projects/*` |
| `/builder` | ❌ | absent de la nav | ✅ `agent-builder-*.ts` | `/projects/[id]/builder/*` (6 routes) |
| `/qualification` | ❌ | absent de la nav | ✅ tests/benchmarks/promotion | `/copilots/[id]/qualification`, `/tests/*`, `/benchmarks/*` |
| `/delivery` | ❌ (« Livraisons ») | disabled | ✅ `delivery-events-store`, `target-repo-sandbox` | `/delivery-loop`, `/push-agent`, `/target-sandbox` |
| `/runtime` | ❌ (« Télémétrie ») | disabled | ✅ `summarizeRuntimeTelemetry`, `diagnoseTelemetryHealth` | `/api/runtime-telemetry`, `/api/runtime/v1/**` |

**7 routes sur 8 manquent.** Le data layer et les 70 routes API existent pour
toutes ; c'est **uniquement la couche de rendu** qui est absente. `/builder` et
`/qualification` ne sont même pas nommés dans la sidebar.

---

## 12. Défauts classés par sévérité

| # | Défaut | Sévérité | Fichier |
|---|---|---|---|
| D1 | **9 des 10 liens de la file d'action → 404** (`/admin/*` supprimé) | **critique** | `dashboard-overview.ts` l. 557-681, rendu par `action-queue.tsx` l. 79 |
| D2 | **0 endpoint sur 70 câblé à l'UI** ; 7 routes cibles sur 8 absentes | **critique** | — |
| D3 | **File d'action invisible sous 1280 px**, sans repli | **haute** | `app-shell.tsx` l. 189 |
| D4 | **Aucun `loading.tsx` / `<Suspense>`** — page bloquée sur 6 appels PostgREST | **haute** | `src/app/` |
| D5 | **Aucun `error.tsx`** — une erreur de rendu sort du shell | **moyenne** | `src/app/` |
| D6 | **Aucune action opérateur** — écran 100 % lecture, `button.tsx` jamais importé | **moyenne** | — |
| D7 | **`/logout` → `/login` inexistant**, route orpheline | **moyenne** | `src/app/logout/route.ts` |
| D8 | **≈ 100 l. de CSS mort** dans `globals.css` (accent cyan, 4 `@utility`, 12 jetons) | **moyenne** | `src/app/globals.css` |
| D9 | **Deux palettes de statut divergentes** (`status.ts` vs `kpi-strip.tsx`) | **basse** | `status.ts`, `kpi-strip.tsx` |
| D10 | **`Runtime LangGraph` affiché en dur**, jamais sondé | **basse** | `topbar.tsx` l. 75 |
| D11 | `AbsentMark` duplique marginalement `Badge` | **basse** | `primitives.tsx` l. 121 |
| D12 | `RunStream` sans plafond ni virtualisation | **basse** | `run-stream.tsx` |
| D13 | `check:rsc-boundary` a maintenant une cible mais reste hors de `npm run check` | **basse** | `package.json` |
| D14 | Commentaires du data layer décrivent `/admin/runs`, `/admin/projects` comme vivants | **basse** | `data.ts`, `health-measure.ts`, `runs-console/*` |

---

## Ce que cet audit N'A PAS vérifié

- **Aucun rendu réel** : pas de dev server lancé, pas de navigateur, pas de
  capture. Tout ce qui précède est de la **lecture de code**, pas une observation
  d'écran. Les affirmations de mise en page sont des **déductions** des classes
  Tailwind.
- **Aucune gate lancée** — pas de `npm run check`, pas de `typecheck`.
  L'affirmation « la gate protège 27 fichiers » vient de la lecture du script et
  du comptage du manifeste, pas d'une exécution.
- **Accessibilité, contraste, performance** : hors périmètre.
- **Comportement réel de la file d'action avec des données** : `buildActionItems`
  n'a pas été exécuté ; les `href` sont lus dans le source.
