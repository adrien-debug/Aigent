# Migration cockpit → Catalyst obligatoire

> Décision produit du 2026-07-31 : Catalyst est le design system unique.
> Ce document est le tableau de décision demandé avant migration, et reste
> ensuite la trace de ce qui a été fait et pourquoi.

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

## Tableau de décision

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
