# Migration cockpit → Catalyst obligatoire

> Décision produit du 2026-07-31 : Catalyst est le design system unique.
> Ce document est le tableau de décision demandé avant migration, et reste
> ensuite la trace de ce qui a été fait et pourquoi.
>
> **Passe 2 (même jour)** — la première passe n'avait branché que `Avatar`,
> `Badge` et `Divider` : une insertion ponctuelle, pas une migration. Le shell,
> la sidebar, la barre supérieure, les panneaux, les listes et le flux étaient
> restés maison. La passe 2 reconstruit l'architecture visuelle sur les
> composants officiels — voir « Passe 2 » en fin de document.

## Constat de départ

- Aucun fichier du repo n'importait Catalyst avant cette mission
  (`grep -rl "from '@/components/ui/"` hors `src/components/ui/` lui-même
  → zéro résultat).
- Le cockpit est **exclusivement sombre** (`color-scheme: dark` global,
  `src/app/globals.css`), piloté par trois familles de tokens CSS
  (`--surface-*`, `--text-*`, `--accent-*`) plus les couleurs de statut de
  `src/lib/cockpit/status.ts` (hex, consommées littéralement par Recharts).
- Catalyst (`src/components/ui/`) est câblé **light-mode-first** avec
  variantes `dark:` explicites (`text-zinc-950 dark:text-white`), et
  `Badge`/`Button` exposent une palette **fermée** de 16 couleurs Tailwind
  nommées — sans accès aux tokens du produit ni aux hex de sévérité validés
  vision des couleurs.

## Tableau de décision — passe 1 (dépassé sur 3 lignes)

> ⚠️ Les lignes `RunStream`, `Heading`/`Subheading`/`Text` et `TopBar` de ce
> tableau concluaient à **skip** / **keep**. La passe 2 a tranché l'inverse :
> elles sont désormais migrées (voir « Tableau de migration appliqué » plus
> bas). Le tableau ci-dessous est conservé comme trace du raisonnement initial.

| Composant cockpit actuel | Équivalent Catalyst | Action | Justification |
|---|---|---|---|
| `EntityAvatar` (`primitives.tsx`) | `Avatar` (`ui/avatar.tsx`) | **replace** | `Avatar` accepte `initials`, `className` libre, structure SVG monogramme identique au besoin. Aucune perte. |
| Séparateurs `border-b`/`border-t` ponctuels | `Divider` (`ui/divider.tsx`) | **compose** | `Divider` prend `className` librement ; utilisé où un filet horizontal autonome a du sens (pas dans les rails de liste, qui restent structurels). |
| `Chip` (statut avec diode+libellé) | `Badge` (`ui/badge.tsx`) | **replace + extend** | `Badge` couvre la forme (pastille + libellé) mais sa palette fermée (`red`\|`zinc`\|... Tailwind) ne peut pas exprimer `var(--accent-main)` ni les hex de `status.ts`. Palette étendue directement dans `ui/badge.tsx` (fichier canonique) avec les tokens produit, plutôt que dégrader vers Tailwind générique ou contourner par `className`. |
| Lien d'action `OPEN PR →` (`action-queue.tsx`) | `Button`/`TextLink` (`ui/button.tsx`, `ui/link.tsx`) | **replace** | `TextLink` (`ui/text.tsx`) convient au lien texte-souligné ; pas besoin d'étendre `Button` pour ce cas, la forme est un lien pas un bouton plein. |
| `Panel` / `PanelHeader` (surface + header de section) | — | **keep-as-domain-component** | Catalyst n'a pas de notion de « panneau borné en hauteur avec header à accent ». C'est un composant structurel du cockpit (contrat : hauteur bornée par la grille, jamais grandit avec la donnée). Reconstruit pour utiliser `Divider` sous le header au lieu d'une bordure ad hoc. |
| `Unavailable` / `AbsentMark` | — | **keep-as-domain-component** | Vocabulaire d'absence de mesure (`unread` vs `no-data`) : logique métier réelle (`AGENTS.md` § Vérité des données), Catalyst n'a rien d'équivalent. |
| `Led` (diode d'état, optionnellement pulsante) | — | **keep-as-domain-component** | Pas d'équivalent Catalyst ; c'est un indicateur temps réel, pas un composant de formulaire/contenu. |
| `Rail` (barre de sévérité verticale sur une ligne de liste) | — | **keep-as-domain-component** | Idem — vocabulaire propre au cockpit, aucune surface Catalyst ne le couvre. |
| `SegmentMeter` / `BarMeter` / `ArcGauge` | — | **keep-as-domain-component** | Visualisations de proportion bornée (n/total) explicitement dans le périmètre « composants métier autorisés » de la mission. |
| `MetricValue` / `MetricDot` / `CompactMetricBadge` | `Text`, `Badge` | **compose** | `MetricValue` reconstruit sur `Text` pour le texte courant (avec `className` pour la taille mono dense — cas légitime, Catalyst n'a pas de variante « chiffre dense tabulaire »). `CompactMetricBadge` fusionné dans `Badge` étendu (palette produit) plutôt que dupliqué. |
| `EntityRow` (rail + avatar + identité + métriques) | — | **keep-as-domain-component** | Composition métier (topologie de ligne agent/projet), pas un composant Catalyst générique — mais reconstruit pour consommer `Avatar` et `Badge` en interne au lieu de ses propres avatars/badges ad hoc. |
| `RunStream` (grille tabulaire 6 colonnes) | `Table` (`ui/table.tsx`) | **keep-as-domain-component**, header via primitives locales | La sémantique `<table>` de Catalyst ne porte pas nativement le rail de sévérité par ligne ; le flux garde sa grille CSS mais réutilise `Badge`/`Led`/`AbsentMark`. |
| `ActionQueue` — header | `PanelHeader` (déjà factorisé) | **keep** | Pas de changement : déjà sur la primitive interne, migration Badge appliquée au compteur. |
| `Heading`/`Subheading`/`Text` génériques | — | **skip** | Tailles fixes (`text-2xl/8`, `text-base/6`) incompatibles avec la densité mono 9–14px du cockpit entier ; les remplacer forcerait soit un redesign non demandé, soit un `className` qui écrase систематiquement la classe de base — exactement le combat de spécificité interdit par la mission. `Text` reste utilisée UNIQUEMENT là où sa taille par défaut convient déjà (aucun cas identifié dans le cockpit dense actuel). |
| `KpiStrip`/`Cell` | — | **keep-as-domain-component** | Instrument bandeau à cellules avec graphique de proportion intégré ; pas de composant Catalyst équivalent. Migré pour utiliser `Badge`/`Avatar` où pertinent (aucun cas trouvé — pas d'avatar ni de badge dans les cellules KPI). |
| `TopBar` | `Navbar`? | **skip** | `Navbar` Catalyst est un composant de navigation top-level avec sa propre structure de `NavbarSection`/`NavbarItem` pensée pour des liens de nav, pas pour une barre d'état système (mark, compteurs télémétrie, chips). Remigrer casserait plus qu'il ne simplifierait sans bénéfice réel — utilise déjà `Chip`→`Badge` en interne. |

## Ce qui change concrètement

1. **`src/components/ui/badge.tsx`** (fichier Catalyst canonique) : palette
   `colors` étendue avec les tokens produit (`accent`, `success`, `warning`,
   `danger`, `neutral`) en plus des 16 couleurs Tailwind existantes —
   aucune couleur existante retirée, usage externe non cassé.
2. **`primitives.tsx`** : `Chip` et `CompactMetricBadge` sont supprimés,
   remplacés par des usages de `Badge`. `EntityAvatar` devient un thin
   wrapper autour de `Avatar` (ajoute uniquement l'état actif/inactif).
   `Rail`, `Led`, `Unavailable`, `AbsentMark`, meters, `Panel`/`PanelHeader`
   restent (composants métier légitimes), `PanelHeader` utilise `Divider`.
3. **`rows.tsx`, `run-stream.tsx`, `action-queue.tsx`, `kpi-strip.tsx`,
   `topbar.tsx`** : consomment `Avatar`/`Badge`/`TextLink` au lieu du
   markup ad hoc équivalent.
4. Aucune donnée, route, calcul, ou comportement zéro-scroll modifié.

---

## Passe 2 — migration de l'architecture visuelle

### Voie retenue : B (Catalyst intégral, thème produit)

Catalyst est *light-mode-first* et non dense : `SidebarItem`, `NavbarItem`,
`Text`, `Subheading`, `TableCell` posent tous `text-zinc-950 dark:text-white`,
`text-base/6 sm:text-sm/5`, `py-2.5`, `fill-zinc-500`. Utilisés tels quels, le
cockpit perdait sa densité (9–14 px → 14–16 px) et son accent cyan, et le
zéro-scroll devenait intenable sur les listes.

Le choix acté est donc : **mêmes composants Catalyst partout, densité et
couleurs du produit portées DANS `src/components/ui/`** — le fichier canonique
reste l'unique endroit où l'on décide de l'apparence d'un composant. Aucun
`!important`, aucun `className` de combat sur les appels, aucun fork.

### Tableau de migration appliqué

| Zone | Avant | Après (Catalyst officiel) | Action |
|---|---|---|---|
| Shell | `app-shell.tsx` flex maison + `Dialog` Headless brut | `Sidebar` · `SidebarHeader` · `SidebarBody` · `SidebarFooter` · `SidebarSection` · `SidebarItem` · `SidebarLabel` | compose |
| Nav (6 entrées) | `NavLink` maison, 5× `href="#"` | `SidebarItem` — `href` réel pour le cockpit, **`disabled` (bouton)** pour les écrans non construits | replace |
| Tiroir mobile | `Dialog`/`DialogPanel` bruts | `Headless.Dialog` + `Sidebar*` + `NavbarItem` (même mécanique que `MobileSidebar` de Catalyst) | compose |
| Barre supérieure | flex maison + `Chip`/`Count` | `Navbar` · `NavbarSection` · `NavbarSpacer` · `NavbarDivider` + `Text`/`Strong` + `Badge` | replace |
| Flux d'exécution | grille CSS 6 colonnes maison | `Table` · `TableHead` · `TableBody` · `TableRow` · `TableHeader` · `TableCell` (`dense`, `bounded`) | replace |
| En-tête de panneau | `<h2>` maison + bordure | `Subheading` + `Divider` | replace |
| Lignes agents/projets | `<span>` typographiques maison | `Avatar` + `Badge` + `Strong`/`Text` dans `EntityRow` | compose |
| File d'action | `<a>` + `<p>` maison | `Link` + `Badge` + `Strong`/`Text` | replace |
| KPI | `<span>`/`<p>` maison | sémantique `dl`/`dt`/`dd` + `Text` | compose |

### Pourquoi `SidebarLayout` n'est pas utilisé

`SidebarLayout` impose `min-h-svh`, des paddings de page (`p-6`/`lg:p-10`), un
`max-w-6xl` et un `<main>` qui grandit avec son contenu. Le cockpit tient dans
le viewport sans jamais scroller au niveau de la page et porte une colonne de
décision à droite. On compose donc **les mêmes composants** (`Sidebar*`,
`NavbarItem`, `Headless.Dialog`) dans une coquille à hauteur bornée : c'est de
la composition, pas un layout concurrent.

### Extensions portées dans `src/components/ui/`

- `badge.tsx` — palette produit (`accent`/`info`/`success`/`warning`/`danger`/
  `special`/`neutral`) + prop `dense`.
- `table.tsx` — prop `bounded` : en-tête fixe, corps défilant dans la hauteur du
  panneau. Sans elle, la table grandit avec la donnée et casse le zéro-scroll.
- `sidebar.tsx` / `navbar.tsx` — densité et couleurs du produit ; état
  `data-disabled` explicite pour les entrées sans écran.
- `text.tsx` / `heading.tsx` / `divider.tsx` — échelle typographique du cockpit.

### Points de la demande, traités

3. **`href="#"` supprimés** — vérifié au DOM : `a[href="#"]` = 0 ; les 5 entrées
   sans écran sont des `<button disabled>` porteurs de « — écran à venir ».
4. **`/admin`** — aucun lien dans le front et la route n'existe pas
   (`src/app/` = `api`, `logout`, `page.tsx`). Les occurrences restantes sont
   des commentaires ou des données métier du workspace *consommateur*.
7. **Doublons de classes** — `min-h-0` : `Panel` le porte désormais seul, les
   appelants passent `padded={false}` au lieu de le répéter ;
   `font-semibold`/`font-normal` simultanés corrigés dans `MetricValue`.
9. **Signaux redondants** — le statut d'un agent n'est plus dit que par le rail
   (sévérité) **et** un `Badge` qui porte couleur + mot. La diode et la teinte
   d'avatar ont été retirées de `AgentRow`. Sur `ProjectRow`, le badge `n/total`
   est un compte et non un statut : la teinte d'avatar y reste le seul signal
   d'activité, donc non redondante.
10. **`$$0.00`** — non reproduit : le DOM rend `$0.00`. Le `$$` n'apparaît que
    dans le payload RSC sérialisé (`self.__next_f.push`), où Next.js échappe un
    `$` initial en `$$`. `formatUsd` ne produit qu'un seul `$`. Rien à corriger.

---

## Passe 3 — voie A : intégrité de Catalyst d'abord

### Ce qui n'allait pas en passe 2

La passe 2 portait la densité et les couleurs du produit **dans**
`src/components/ui/` : 215 lignes modifiées sur 7 fichiers du kit
(`sidebar`, `navbar`, `text`, `heading`, `table`, `badge`, `divider`).
Techniquement c'était la voie B ; concrètement c'était un **fork silencieux** —
exactement ce que la décision produit interdit. Un `SidebarItem` dont toutes
les classes ont été réécrites n'est plus un composant Catalyst, c'est une
coquille locale portant un nom Catalyst.

### Ce qui a été fait

1. **`src/components/ui/` restauré à l'identique.** Vérifié fichier par fichier
   par empreinte SHA-256 : les 27 fichiers du kit sont identiques à la
   référence officielle. Zéro ligne modifiée.
2. **Voie A appliquée à tout l'écran** : les surfaces utilisent les composants
   Catalyst avec leur **apparence native** (densité et palette du kit). Le
   cockpit a perdu sa densité mono, son cyan et son aspect « poste de
   contrôle » — c'est assumé, ce sont des sujets de composition produit à
   traiter ensuite, pas des raisons de modifier le kit.
3. **Mode sombre natif** : `@custom-variant dark` dans `globals.css` + classe
   `dark` sur `<html>`. En Tailwind v4, `dark:` suit `prefers-color-scheme` par
   défaut ; sans ce variant, les classes `dark:` de Catalyst ne s'appliquent
   pas et le kit rend en clair — c'est ce qui pousse à le repeindre.
4. **Zéro-scroll reconstruit par le LAYOUT seul** : hauteurs bornées
   (`h-full min-h-0`) dans le shell et `overflow-y-auto` sur les conteneurs de
   panneau. Aucune prop ajoutée à `Table` (la passe 2 avait ajouté `bounded`).

### Composants Catalyst utilisés, par surface

| Surface | Composants Catalyst officiels |
|---|---|
| Shell (`app-shell.tsx`) | `Sidebar`, `SidebarHeader`, `SidebarBody`, `SidebarFooter`, `SidebarSection`, `SidebarHeading`, `SidebarItem`, `SidebarLabel`, `NavbarItem`, `Text` |
| Barre d'état (`topbar.tsx`) | `Navbar`, `NavbarSection`, `NavbarSpacer`, `NavbarDivider`, `Badge`, `Text`, `Strong` |
| Panneaux (`primitives.tsx`) | `Subheading`, `Divider`, `Text` |
| Flux d'exécution (`run-stream.tsx`) | `Table`, `TableHead`, `TableBody`, `TableRow`, `TableHeader`, `TableCell`, `Badge`, `Text`, `Strong` |
| Rosters (`rows.tsx`) | `Avatar`, `Badge`, `Text`, `Strong` |
| File d'action (`action-queue.tsx`) | `Link`, `Badge`, `Subheading`, `Divider`, `Text`, `Strong` |
| KPI (`kpi-strip.tsx`) | `Heading`, `Text` |
| Graphe (`charts.tsx`) | `Badge`, `Divider`, `Text`, `Strong` |
| Page (`page.tsx`) | `Text` |

### Composants hors Catalyst restants, et pourquoi

Tous dans `src/components/cockpit/primitives.tsx`. Aucun n'a d'équivalent dans
le kit ; aucun ne duplique un composant Catalyst.

| Composant | Justification métier |
|---|---|
| `Panel` | Surface à hauteur **bornée** : elle ne grandit jamais avec sa donnée, c'est la donnée qui défile dedans. C'est le contrat qui tient le zéro-scroll. Catalyst n'a pas de notion de carte bornée. Son en-tête est composé de `Subheading` + `Divider` + `Text`. |
| `Unavailable` / `AbsentMark` | L'absence de mesure comme état de premier rang, avec la distinction « lecture échouée » / « rien à mesurer » (AGENTS.md § Vérité des données). Un `Badge` gris dirait « zéro », pas « non mesuré ». |
| `Led` | Témoin d'activité temps réel (pulsation). Aucun équivalent Catalyst. |
| `Rail` | Barre de sévérité en tête de ligne — encodage visuel de gravité, pas un séparateur. `Divider` ne le couvre pas. |
| `ArcGauge`, `BarMeter`, `SegmentMeter` | Visualisations de proportion bornée (n sur total). Dataviz explicitement autorisée. |
| `initialsOf` | Fonction pure (monogramme), pas un composant. |
| `HourlyRunsChart` (`charts.tsx`) | Histogramme Recharts. Dataviz. |
| `Mark` (`app-shell.tsx`) | Logotype SVG du produit. |

### La gate qui empêche la récidive

`npm run check:catalyst-integrity` (dans la chaîne `npm run check`, donc en CI)
compare l'empreinte SHA-256 des 27 fichiers du kit à
`scripts/catalyst-kit.sha256.json`. Toute modification, ajout ou suppression
fait échouer la gate.

Sondée dans les deux sens avant livraison : rouge sur un fichier altéré
(`MODIFIÉ src/components/ui/badge.tsx`, exit 1), verte sur kit intact (exit 0).

Elle protège le **kit**, pas son usage : elle ne détecte pas un écran qui
combattrait Catalyst depuis l'extérieur (`className` agressifs). C'est une
limite assumée, écrite dans l'en-tête du script.
