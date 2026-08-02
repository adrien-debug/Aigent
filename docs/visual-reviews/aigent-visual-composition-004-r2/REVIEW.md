# AIGENT-VISUAL-COMPOSITION-004 — REWORK R2

## Périmètre recomposé

- ` /runs`
- ` /`
- ` /runtime?tab=telemetry`
- ` /agents`
- ` /agents/[copilotId]` (route ouverte et inspectée en validation)

## Surfaces supprimées / aplaties

- `/runs`
  - suppression de la logique "rangs de boîtes" (`RankTitle` + sections dédiées Flux/Détail/Contexte).
  - suppression des sous-cartes `RunsActivityCard` et `RunsHealthCard` (remplacées par `RunsActivityCanvas` et `RunsTerminalStrip` intégrés à la scène).
  - fusion du flux, de l’activité et du détail dans une seule scène 2/3–1/3.
- `/`
  - suppression du pattern `QuietSection` répété (flux, projets, événements importants).
  - intégration des zones secondaires dans une grille unique avec séparateurs légers.
- `/runtime?tab=telemetry`
  - suppression des wrappers `Panel` successifs pour santé/fleet/provenance/événements.
  - passage à des sections intégrées avec titres + hairline + contenu.
- `/agents`
  - suppression des boîtes imbriquées de "répartition runtime" et "provenance état".
  - conservation de la scène flotte + liste, avec densité réduite et lecture continue.

## Surfaces conservées et justification fonctionnelle

- `aig-stage` conservé comme surface maîtresse (une scène dominante par écran).
- `aig-inset` conservé seulement quand il porte une fonction de scroll/flux de données.
- `aig-panel` conservé là où il sert de conteneur interactionnel explicite (ex: détails longs).
- séparateurs `aig-hairline` utilisés pour structurer sans créer de nouvelles cartes.

## Hardcodes couleur retirés (routes possédées)

- suppression des nouveaux hardcodes introduits en R1 (`rgb(...)`, `stroke-white/*`, `bg-white/*`, `border-white/*`, `text-white`) dans:
  - `src/components/runs/runs-native-visuals.tsx`
  - `src/components/runs/runs-screen.tsx`
  - `src/components/cockpit/overview-screen.tsx`
  - `src/components/agents/roster-screen.tsx`
  - `src/components/runtime/tab-telemetry.tsx`

## Observations visuelles (captures ouvertes)

- Les vues ont été recapturées et relues depuis:
  - `runs-desktop-1440x900.png`
  - `runs-mobile-375x812.png`
  - `overview-desktop-1440x900.png`
  - `runtime-telemetry-desktop-1440x900.png`
  - `agents-desktop-1440x900.png`
  - `contact-sheet.png`
- Le widget de session Cursor reste visible en surimpression dans les captures (limitation environnement de capture).

## Console navigateur

- `console-errors.json`: 0 erreur console sur `/runs`, `/`, `/runtime?tab=telemetry`, `/agents`.

