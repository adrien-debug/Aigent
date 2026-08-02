# R6 — le document est borné au viewport

Observation datée du **2026-08-02**, mesurée sur `http://127.0.0.1:3987`
(cache `.next` vidé, serveur redémarré avant mesure). Observation, pas règle.

## Le défaut, et sa cause

`/runtime` mesurait **4014 px dans un viewport de 800 px**, dont ~3730 px de
vide non défilable. La chaîne flex de l'écran était juste ; elle était **ancrée
dans le vide**. Tout le shell était en `min-h-svh` — un **plancher**, jamais un
**plafond** — donc chaque ancêtre grandissait avec son contenu et le `flex-1`
de l'écran remplissait fidèlement un parent non borné.

## La correction — une chaîne réelle

| maillon | avant | après |
|---|---|---|
| `layout.tsx` `<html>` / `<body>` | `min-h-svh` | **`h-svh overflow-hidden`** |
| `app-shell.tsx` racine | `flex min-h-svh` | **`flex h-full min-h-0 overflow-hidden`** |
| `app-shell.tsx` `<main>` | `flex min-h-svh flex-1` | **`relative flex h-full min-h-0 flex-1 overflow-hidden`** |
| `app-shell.tsx` rail | `lg:sticky lg:h-svh lg:max-h-svh` | **`lg:h-full lg:min-h-0 lg:overflow-y-auto`** |
| `PageBody` | pas de scroll | **`relative flex-1 min-h-0 overflow-y-auto`** |
| 4 écrans auto-bornés | `h-svh` | **`h-full`** (le plafond vient du shell) |

Le document est la **racine bornée** : il ne défile plus. Le scroll appartient
aux zones qui doivent réellement défiler.

## Deux défauts trouvés PAR la mesure, pas par l'œil

1. **`/delivery/[copilotId]` — 9 sections coupées, 0 scroller.** Cet écran
   recompose son corps à la main au lieu d'utiliser `PageBody` : il portait
   `min-h-0` sans `flex-1` ni `overflow-y-auto`. Tant que le document défilait,
   ça tenait par accident. Corrigé, puis **vérifié atteignable** : 3123 px de
   contenu, `reachedBottom: true`, dernier bloc visible.

2. **`/learning` — 832 px pour 800 px de viewport.** Les libellés `sr-only` de
   Catalyst sont en `position: absolute` ; sans bloc conteneur ils se
   résolvaient sur le **viewport**, échappaient au `overflow-hidden` et
   rallongeaient la zone défilable (document scrollable de 32 px). `relative`
   sur `PageBody` et `main` les ancre. Les libellés ne sont **pas** retirés :
   un lecteur d'écran les lit toujours.

## Preuve — 19 routes à 1280×800

`containment-1280x800.json` (mesure DOM : `scrollHeight`, contenu coupé sans
ancêtre défilable, erreurs console).

**19/19 routes** : document = 800 px exactement · `documentScrolls: false` ·
**0 contenu coupé** · **0 erreur console**.

`/runtime?tab=telemetry` : le creux passe de 3730 px à **516 px**, avec une
barre de défilement interne visible. Le vide fantôme a disparu.

### Multi-viewport

| viewport | routes conformes |
|---|---|
| 1440×900 | **12/12** |
| 1280×600 | **12/12** |
| 375×812 | **12/12** |

0 erreur console sur les trois.

### Corrections R5 préservées

- `/learning` : badge « Aucune mesure » toujours borné (**118 px** dans 371 px).
- `/delivery` : second rang toujours côte à côte à 1280 px (454 / 448 px).

## Ce que ce document ne prouve pas

Aucun jugement de pixels ni de hiérarchie visuelle. La containment est mesurée,
pas l'esthétique. Aucune gate de ce dépôt ne mesure le rendu.

**Défaut d'architecture connu et NON corrigé ici** : le produit porte deux
systèmes visuels superposés — les tokens `--aig-*` d'un côté, les `zinc-*` /
`white` bruts des primitives Catalyst de `src/components/ui/**` de l'autre
(**149 occurrences**). La gate `check:legacy-design-doctrine` **ne scanne pas**
`src/components/ui/**` : son « 0 violation » ne peut pas voir ce second système.
Corriger cela suppose de modifier le kit, ce qui casse par construction
`check:ui-kit-integrity` (empreinte SHA-256 des 14 fichiers) et contredit
`AGENTS.md`. Arbitrage de gouvernance requis — hors périmètre de cette mission.
