# Console design system (local)

**Périmètre :** console Aigent uniquement (`/admin/**`, `src/components/console/`).

Ce n'est **pas** une doctrine Hearst globale ni un contrat interproduits. Les tokens
et primitives ci-dessous constituent l'API visuelle locale actuelle — modifiables par
une mission de design explicite. Le marketing (`src/app/(site)/`) garde son périmètre
séparé.

## Tokens (`src/theme.css`)

| Rôle | Utilitaires | Usage |
|------|-------------|-------|
| Surfaces | `surface-app`, `surface-raised`, `surface-sunken`, `surface-hover`, `surface-selected`, `surface-overlay` | Empilement des panneaux |
| Contenu | `content`, `content-muted`, `content-subtle`, `content-faint`, `content-on-accent` | Texte et icônes par rôle |
| Bordures | `line`, `line-strong` | Hairlines structurelles |
| Accent | `accent-*` (rampe verte) | Succès, CTA, courbes |
| Danger | `--state-danger-*` | Échec, destruction, alertes |
| Élévation | `--shadow-card-sm`, `--shadow-card-lg`, `--shadow-well` | Profondeur sans glow |
| Graphiques | `--chart-line`, `--chart-fill`, `--chart-grid`, `--chart-track` | SVG hand-written |

Les alias `--ds-*` et la palette cuivre ont été retirés : aucun consommateur réel dans
ce dépôt.

## Primitives partagées (`src/components/console/screen-primitives.tsx`)

| Primitive | Rôle |
|-----------|------|
| `ScreenHeader` | Titre d'écran + description + actions |
| `Section` | Panneau structuré avec en-tête |
| `KpiCard` / `Metric` | Chiffre KPI avec label |
| `PanelRow` | Ligne de liste / navigation (Next `Link` si `href`) |
| `EmptyState` | Absence mesurée, honnête |
| `ErrorState` / `DegradedBanner` | Lecture échouée ou dégradée |
| Tables | `TABLE_*` constants + `Table` Catalyst retokenisé |

## Variants de surface (`src/components/console/console-variants.ts`)

```ts
consoleSurfaceClasses('primary' | 'secondary' | 'sunken' | 'danger')
consolePanelChrome(variant)
consoleCardChrome(variant)
```

- **primary** — un seul panneau principal par zone visuelle (bordure forte + `surface-overlay`)
- **secondary** — panneau standard (`surface-raised`)
- **sunken** — lit creusé (tables, graphiques)
- **danger** — plaque d'alerte (`--state-danger-surface`)

## Typographie (`consoleTypography`)

| Rôle | Usage |
|------|-------|
| `eyebrow` | Labels uppercase compacts |
| `caption` / `captionMuted` | Meta, sous-titres |
| `bodySm` / `bodySmMedium` | Corps dense |
| `panelTitle` / `panelDescription` | En-têtes de panneau |
| `screenTitle` / `screenDescription` | En-têtes d'écran |
| `metric` | Chiffres KPI |
| `tableCaption` | Légendes de table |

## Règles d'usage

1. **Pas de chiffre inventé** — valeur non mesurée → `null` + état, jamais `0`.
2. **Pas de couleur brute** dans une nouvelle composition console — utiliser les rôles sémantiques.
3. **Pas de nouvelle surface** sans rôle (`raised`, `overlay`, `sunken`, …).
4. **Une priorité visuelle principale maximum** par zone (`priority="primary"`).
5. **L'accent n'est pas une décoration** — réservé au succès, CTA, courbes.
6. **`danger` réservé aux pannes** — pas pour un état ordinaire (draft, pause).

## Ce qui n'est pas un contrat

- Palette interproduits Hearst
- Obligation pour le marketing ou d'autres repos
- Kit Catalyst complet (`src/components/ui/`) — seules les variantes console sont retokenisées

## Gates

- `npm run check:console-design-system` — chrome centralisé, tokens dormants absents, `PanelRow` via `Link`
