# R5 — reprise du travail interrompu (3 corrections de layout)

Observation datée du **2026-08-02**, mesurée sur `http://127.0.0.1:3987` (dev,
cache `.next` vidé et serveur redémarré avant mesure). Ce document est une
observation, pas une règle.

Base : `b15cf17` (branche `mission/aigent-visual-composition-004`, après
fast-forward sur les 5 commits poussés par le worktree `factory-006`).

## Ce qui a été mesuré — pas seulement regardé

Viewport `1280x800`, Chromium piloté. Mesures DOM réelles
(`getComputedStyle` + `getBoundingClientRect`), pas une lecture de capture.

### 1. `/learning` — badge « Aucune mesure » borné à son contenu ✅

`Unavailable compact` est un bloc qui centre son contenu : posé seul il
s'étirait sur toute la largeur et sa marque flottait au milieu du paragraphe.
Un conteneur `inline-block` le borne sans toucher au composant partagé.

| mesure | valeur |
|---|---|
| largeur du wrapper `inline-block` | **118 px** |
| largeur de la colonne parente | 370 px |
| borné au contenu | **oui** |

### 2. `/delivery` — panneau latéral au second rang dès `lg` ✅

Le passage `xl:` → `lg:` fait tenir le canal de livraison à côté du corps dès
1024 px au lieu de 1280 px, avec `self-stretch` pour aligner les deux creux.

| mesure | valeur |
|---|---|
| `flex-direction` de la rangée à 1280 px | **row** |
| côte à côte | **oui** |
| largeurs (corps / panneau) | 439 px / 448 px |

### 3. `/runtime?tab=telemetry` — scroll NON contenu ❌ (correction insuffisante)

L'édition **supprime une vraie anomalie** : un conteneur intermédiaire
(`m-3` + enfant `h-full`) cassait la chaîne de hauteur flex. Le creux est
désormais lui-même le scroller. Vérifié : l'ancien wrapper n'est plus dans le
DOM.

**Mais l'objectif annoncé — « box fixe, data qui scrolle dedans » — n'est PAS
atteint.** Mesures après correction :

| mesure | valeur |
|---|---|
| le DOCUMENT défile | **oui** (4014 px pour 800 px de viewport) |
| hauteur du creux | 3730 px |
| le creux défile | **non** (`scrollHeight == clientHeight`) |

Identique avant/après la correction. Le nombre a bougé (4237 → 3730 px), la
containment non.

**Cause racine — au-dessus de l'écran runtime, pas dedans.** Toute la chaîne du
shell est en `min-h-svh` sans plafond ni `overflow-hidden` :

```
html      min-h-svh   → height 4014px
body      min-h-svh   → height 4014px
div shell min-h-svh   → height 4014px
main      min-h-svh   → height 4014px   (app-shell.tsx:297)
```

`min-height` pose un **plancher**, jamais un **plafond**. Les ancêtres grandissent
donc avec le contenu, et le `flex-1 min-h-0` de l'écran runtime remplit
correctement… un parent non borné. La containment est mathématiquement juste
mais ancrée dans le vide.

**Conséquence** : aucun écran ne peut tenir un zéro-scroll depuis l'intérieur
tant que le shell est en `min-h-svh`. Le corriger veut dire passer le shell en
`h-svh overflow-hidden` — un geste **structurant sur toutes les routes**, hors
périmètre d'une reprise de travail interrompu (`CLAUDE.md` §3, §8). Non fait,
signalé.

## Console

0 erreur, 0 warning sur `/runtime`, `/learning`, `/delivery`.

## Ce que ce document ne prouve pas

Un seul viewport (`1280x800`) et trois routes. Aucun jugement de pixels, de
hiérarchie visuelle ni de responsive complet. Aucune gate de ce dépôt ne mesure
le rendu.
