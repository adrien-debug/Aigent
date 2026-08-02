# Phase 1 — Matière visuelle : réétalonnage de l'échelle graphite

> Exécution de l'étape 1 de `docs/visual-reviews/direction-composition-cockpit.md`.
> **Périmètre : la couche matière uniquement.** Aucun écran refait, aucun
> composant déplacé, aucun `Panel`/badge/carte touché — ces suppressions
> appartiennent aux phases 3 à 5 et ne sont **pas** dans cette passe.
>
> Date : 2026-08-02 · Branche : `mission/aigent-matiere-phase1`

---

## 1. Fichier modifié

**Un seul** : [`src/app/globals.css`](../../../src/app/globals.css) — 67 insertions, 13 suppressions.

`git diff --name-only` ne retourne rien d'autre. Zéro `.tsx` touché.

---

## 2. Valeurs avant / après

### Les 6 jetons du périmètre

| Jeton | Avant | Après | sRGB avant → après |
|---|---|---|---|
| `--aig-subtle` (canvas) | `oklch(0.16 0.006 264)` | `oklch(0.165 0.006 264)` | `rgb(12,13,16)` → `rgb(13,14,17)` |
| `--aig-base` (scène) | `oklch(0.19 0.006 264)` | `oklch(0.243 0.007 264)` | `rgb(18,20,23)` → `rgb(30,32,35)` |
| `--aig-raised` (élevé) | `oklch(0.24 0.008 264)` | `oklch(0.298 0.009 264)` | `rgb(29,31,35)` → `rgb(43,45,50)` |
| `--aig-line-soft` | `oklch(0.27 0.008 264)` | `oklch(0.342 0.009 264)` | `rgb(36,38,42)` → `rgb(54,56,61)` |
| `--aig-line` | `oklch(0.32 0.008 264)` | `oklch(0.408 0.01 264)` | `rgb(49,51,55)` → `rgb(71,74,79)` |
| `aig-inset` (creux) | `color-mix(… subtle 82%, black)` | `oklch(0.203 0.006 264)` | `rgb(7,7,9)` → `rgb(21,23,26)` |

### Deux valeurs hors des 6, modifiées — et pourquoi

Signalées explicitement parce qu'elles sortent du périmètre littéral demandé.

**`--aig-text-faint` : `oklch(0.58)` → `oklch(0.645)`.** Remonter les surfaces
sans remonter ce gris tertiaire l'aurait fait passer sous AA 4.5 sur les quatre
rangs. Il était **déjà** à 3.84 sur `raised` — défaut préexistant, mesuré. Le
laisser en place aurait transformé une amélioration de hiérarchie en régression
d'accessibilité sur 61 usages, dont « rien à mesurer », le libellé que la
phase 2 doit précisément neutraliser.

**Le pied du dégradé de `aig-stage`** : le stop final mixait vers
`--aig-subtle` (le canvas). Sans conséquence tant que canvas et scène étaient
quasi confondus ; sur l'échelle réétalonnée l'écart devient réel. **Mesuré au
pixel** avant correction : le coin bas-droit de la scène tombait à
`rgb(16,18,21)`, soit **sous le creux qu'elle porte** (`rgb(21,23,26)`). La
scène passait donc sous son propre contenu — inversion de rang en bas de chaque
écran. Le dégradé encadre désormais `--aig-base` au lieu de le quitter :
`rgb(28,29,33)` au même point.

### Ce qui n'a PAS bougé — vérifié par mesure

| Invariant | Vérification |
|---|---|
| 5 `--aig-severity-*` | `rgb(13,168,127)` · `(190,133,15)` · `(232,69,95)` · `(61,130,238)` · `(142,99,238)` — **identiques** |
| Accent cuivre | `rgb(219,144,98)` — **identique** |
| Teinte / chroma | 264 partout, chroma 0.006–0.010 — **identité graphite conservée** |
| Rayons, élévations, layout | non touchés |
| Palette | aucune couleur nouvelle ; seule l'amplitude change |

---

## 3. Mesures

Instrumentées dans Chromium (`playwright`), tokens résolus en sRGB via canvas.
Script rejouable : [`measure.mjs`](measure.mjs) · données brutes :
[`mesures-avant.json`](mesures-avant.json) / [`mesures-apres.json`](mesures-apres.json).

### 3.1 La correction obligatoire

| | Avant | Après |
|---|---|---|
| creux plus sombre que le canvas | **oui** ❌ | **non** ✅ |
| creux plus sombre que la scène | oui ✅ | oui ✅ |

Ordre des clartés perceptuelles après correction, strictement croissant :

```
canvas 0.1640  <  creux 0.2038  <  scène 0.2427  <  élevé 0.2972
```

### 3.2 Séparation entre rangs

**Le juge est ΔL (clarté perceptuelle OKLCH), pas le ratio WCAG.** Le ratio de
contraste est conçu pour du texte et sature dans les très basses luminances : à
`rgb(13)` contre `rgb(21)` il affiche 1.08 alors que l'écart est parfaitement
visible à l'œil. Le ratio reste publié ci-dessous, et il reste le bon juge pour
le texte (§3.3).

| Marche | ΔL avant | ΔL après | Cible ≥ 0.035 |
|---|---|---|---|
| canvas → creux | 0.0296 | **0.0398** | ✅ |
| creux → scène | 0.0607 | **0.0389** | ✅ |
| scène → élevé | 0.0485 | **0.0545** | ✅ |

L'échelle est désormais **régulière** : avant, la marche canvas→creux (0.0296)
faisait la moitié de creux→scène (0.0607), et dans le mauvais sens.

Ratios WCAG entre surfaces, pour mémoire :

| | Avant | Après |
|---|---|---|
| canvas → scène | 1.053 | **1.182** |
| creux → élevé | 1.220 | **1.303** |
| `line-soft` vs scène | 1.217 | **1.392** |
| `line` vs scène | 1.458 | **1.835** |

### 3.3 Contraste texte (AA = 4.5)

| | Avant | Après | |
|---|---|---|---|
| `text` sur canvas / creux / scène / élevé | 15.83 / 16.40 / 15.03 / 13.44 | 15.72 / 14.63 / 13.30 / 11.22 | ✅ |
| `muted` sur canvas / creux / scène / élevé | 7.51 / 7.78 / 7.13 / 6.38 | 7.46 / 6.94 / 6.31 / 5.33 | ✅ |
| `faint` sur canvas | 4.52 | **5.88** | ✅ |
| `faint` sur creux | 4.68 | **5.47** | ✅ |
| `faint` sur scène | 4.29 | **4.97** | ✅ |
| `faint` sur élevé | **3.84** | **4.20** | ⚠️ voir §6 |
| `accent` sur scène | 7.19 | 6.36 | ✅ |

Sévérités sur la scène, toutes au-dessus de 4.0 après changement (good 5.38 ·
warn 5.09 · bad 4.24 · running 4.38 · blocked 4.02).

### 3.4 Dark mode

Le produit est dark-first : `<html class="dark">` avec `color-scheme: dark`, et
les jetons sont déclarés une seule fois sous `:root` — il n'existe pas de bloc
`prefers-color-scheme: light` dans `globals.css`.

**Vérifié**, pas supposé : mesure rejouée dans un contexte navigateur
`colorScheme: 'light'`. Les valeurs résolues sont **identiques** aux valeurs en
`dark`, avant comme après. Aucune divergence introduite.

---

## 4. Captures

18 fichiers dans [`captures/`](captures/) — 3 écrans × 3 viewports × avant/après.

| Écran | 1440×900 | 1280×800 | 375×812 |
|---|---|---|---|
| `/runtime` | `*-runtime-1440x900.png` | `*-runtime-1280x800.png` | `*-runtime-375x812.png` |
| `/projects` | `*-projects-1440x900.png` | `*-projects-1280x800.png` | `*-projects-375x812.png` |
| `/agents/[id]` | `*-agent-detail-1440x900.png` | `*-agent-detail-1280x800.png` | `*-agent-detail-375x812.png` |

Préfixe `before-` / `after-`. Captures en `deviceScaleFactor: 2`, thème dark.

**Critère principal — la hiérarchie est-elle évidente sans bordure ?** Sur les
captures `after`, le rail latéral (canvas), la scène et le creux se distinguent
par leur **valeur** : masquer les liserés ne fait plus disparaître la structure.
Avant, à 1.04 d'écart, seule la bordure séparait.

**Réserve d'honnêteté** : ce jugement est visuel, porté sur les captures
ci-jointes. Aucune gate de ce repo ne mesure le rendu.

---

## 5. Tests et gates

| | Résultat |
|---|---|
| `npm run check` (17 gates) | ✅ vert — dont `check:production-visual-authority` et `check:ui-kit-integrity` |
| `npm test` | ✅ **2351 passés**, 184 fichiers, 1 *expected fail* |
| `npm run build` | ✅ succès |

`globals.css` est **exclu par conception** de `check:production-visual-authority`
(« fichier global de jetons ») : la gate n'a donc rien mesuré ici, elle a
seulement confirmé qu'aucun écran ne contourne les jetons. Une gate verte prouve
ce qu'elle mesure, pas que l'écran est bon — la preuve de cette passe est la
capture, pas la gate.

L'avertissement `no-shadow` sur `builder/workspace.tsx:688` est **préexistant**
et sans rapport avec cette passe.

Effet de bord vérifié : `src/components/visualizations/visualizations.css`
aliase `--aig-*` (`--viz-base: var(--aig-base, …)`). Les enveloppes de
visualisation suivent donc automatiquement la nouvelle échelle — c'était
l'intention documentée du fichier. Les valeurs après la virgule sont un repli
mort, non mis à jour volontairement : les toucher créerait la divergence que ce
mécanisme évite.

---

## 6. Risques restants

**1. `faint` sur `raised` reste à 4.20, sous AA 4.5.** Défaut **préexistant**
(3.84 avant), amélioré mais non résolu. Le corriger complètement exigeait
`L≈0.665`, ce qui rapprochait `faint` de `muted` à 0.045 de clarté — les deux
rangs typographiques se confondaient. J'ai préféré conserver la hiérarchie de
texte à trois niveaux et documenter l'écart. Concerne le texte tertiaire posé
sur une surface `raised` (cas minoritaire). **Non corrigé, assumé, à trancher
si tu veux l'inverse.**

**2. Les surfaces `raised` sont plus claires qu'avant** (`rgb(43,45,50)` contre
`rgb(29,31,35)`). Voulu — c'est le rang « élevé ». Mais `aig-raised` est
aujourd'hui employé à des fins décoratives dans plusieurs écrans (l'audit le
note comme défaut) : ces usages deviennent **plus visibles** qu'avant. La
phase 3 les supprime ; d'ici là, quelques badges et jetons ressortent davantage.

**3. Écrans non capturés.** `/`, `/runs`, `/qualification`, `/livraison`,
`/learning`, `/actions`, `/builder`, `/lab` héritent de la nouvelle échelle sans
capture avant/après dédiée. Le changement étant purement tokenisé et l'ordre des
rangs vérifié globalement, le risque est faible — mais il n'est pas nul et il
n'est pas mesuré.

**4. Les panneaux Grafana embarqués** (iframes en `theme=dark`, non pilotables
depuis Aigent) sont désormais entourés d'enveloppes plus claires. Le contraste
enveloppe/iframe augmente : c'est l'intention (le commentaire d'origine dit
qu'un fond trop sombre « écraserait » ces panneaux), mais aucune capture réelle
d'un panneau Grafana vivant n'a été prise — le Lab n'était pas peuplé.

**5. Le `--aig-scrim`** dérive de `--aig-subtle`, qui a très peu bougé
(`0.16` → `0.165`). Effet sur les modales : négligeable, non capturé.

---

## 7. Ce que cette passe ne fait pas

Explicitement hors périmètre, conformément à la consigne :

- aucune suppression de `Panel`, badge ou carte ;
- aucune neutralisation des états dramatiques (« Lancement bloqué » en rouge sur
  un statut `unavailable` reste tel quel — c'est la **phase 2**) ;
- aucun changement de layout, de densité ou de composition ;
- aucun nouveau composant, aucun nouveau design system.
