# `src/components/ui/` — le kit de primitives

**14 primitives, toutes consommées.** Ce dossier est du **code du repo**, pas du
vendor : il est linté, typé et modifiable comme le reste. Il vient à l'origine
d'un fork de Tailwind Plus Catalyst, mais il n'est plus réaligné sur l'amont —
cette filiation est une note historique, pas une contrainte.

## Ce qu'il contient, et qui s'en sert

| Primitive | Imports | Dépend de Headless UI pour |
|---|---:|---|
| `text` (`Text`, `Strong`) | 53 | — |
| `badge` | 31 | `Button` (variante cliquable) |
| `heading` (`Heading`, `Subheading`) | 15 | — |
| `divider` | 15 | — |
| `link` | 12 | `DataInteractive` (états `data-hover`) |
| `avatar` | 7 | `Button` (variante cliquable) |
| `button` (+ `TouchTarget`) | 5 | `Button` |
| `dialog` | 3 | **Dialog, DialogPanel, DialogBackdrop, DialogTitle** |
| `textarea` | 2 | `Textarea` |
| `navbar` | 2 | `Button` |
| `fieldset` (`Field`, `Label`, `Description`) | 2 | **Fieldset, Legend, Field, Label** |
| `checkbox` (+ `CheckboxField`) | 2 | **Checkbox, Field** |
| `table` | 1 | — |
| `sidebar` | 1 | `Button`, `CloseButton` |

## Headless UI : pourquoi il reste

`dialog`, `checkbox` et `fieldset` s'appuient sur Headless UI pour ce qui est
**coûteux et risqué à réécrire** : piège de focus, portail, restitution du focus
à la fermeture, `aria-*` et association label/champ/description. Les réécrire à
la main serait une régression d'accessibilité déguisée en simplification.

Les autres usages sont superficiels (`Headless.Button` pour les états
`data-hover`/`data-active`) et pourraient disparaître si le besoin s'en faisait
sentir. Ce n'est pas un chantier prioritaire.

## Modifier une primitive

1. La gate `check:ui-kit-integrity` fige ce dossier par empreinte SHA-256 :
   toute modification la fait échouer. **C'est voulu** — elle protège contre une
   dérive silencieuse, pas contre une modification assumée.
2. Après une modification volontaire :
   `node scripts/check-ui-kit-integrity.mjs --update`
3. **Puis ouvrir un écran qui consomme la primitive, et regarder.**

> ⚠️ Le point 3 n'est pas une politesse. Le 2026-07-31, une réécriture de ce kit
> a supprimé 2438 lignes pour en écrire 257 : `TouchTarget` s'est retrouvé vidé
> de sa cible tactile de 44 px, `Button` réduit à 4 couleurs sur les 6 réellement
> consommées. **Les 15 gates sont restées vertes, le build aussi, les 2105 tests
> aussi.** Rien de ce qui est automatisé ici ne mesure le rendu. Revert
> `5e2aa63`.

## Ce que le kit n'impose pas

Aucune palette, aucun token, aucune structure de page (`CLAUDE.md` §8). Un écran
peut utiliser ces primitives, les composer, ou s'en passer. Aucune gate ne vérifie
qu'un composant vient d'ici.
