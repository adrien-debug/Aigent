# SETTINGS-MOBILE-OVERFLOW — preuve de correction responsive

Mission dédiée, branche `mission/settings-mobile-overflow`, base `main`
= `b4675d35bb1c11cfdb2688305528ba9f332d9c3d`. Captures régénérées au HEAD final
de la branche.

## La cause, confirmée dans le DOM avant toute modification

Deux causes distinctes, la seconde n'apparaissant qu'une fois la première levée.

**1 — Les items de grille refusaient de rétrécir.** Mesuré à 390 px : les
`<section class="flex flex-col aig-panel">` sortaient à **658 px** avec
`min-width: auto`, enfants directs d'un parent `display: grid`.

Un item de grille (comme un item de flex) a `min-width: auto` par défaut : il
refuse de rétrécir sous la largeur intrinsèque de son contenu. Le `min-w-0` déjà
posé sur le conteneur **ne se propage pas** aux enfants — c'est chaque item qui
doit renoncer à son plancher.

**2 — Un `hint` d'en-tête intronquable.** Après correction des Panels, un seul
élément débordait encore, à **624 px** de large : le `hint` de `Panel`, rendu en
`ml-auto shrink-0 truncate`. `shrink-0` **annule** l'effet de `truncate` — la
boîte ne rétrécit pas, donc rien n'est jamais tronqué — et `ml-auto` la pousse à
droite. Une phrase longue sort du viewport.

Le débordement était **clippé**, donc ni scrollable ni tronqué proprement : des
noms de variables apparaissaient coupés sur la surface même qui sert à dire quoi
renseigner.

> **Piège de mesure.** `documentElement.scrollWidth > clientWidth` renvoie
> **faux** ici parce que le document ne scrolle pas — le débordement est clippé.
> Il faut mesurer `getBoundingClientRect().right` élément par élément, sinon on
> conclut à tort que la page est propre.

## Le correctif — au niveau le plus étroit

`min-w-0` sur les **5 `Panel` de `/settings`**, et le message des plafonds de
coût déplacé du `hint` d'en-tête vers le **corps** du panneau, où il peut passer
à la ligne.

**`Panel` n'est pas modifié.** La primitive est consommée par **31 fichiers** ;
lui imposer `min-w-0` ou changer le rendu de son `hint` toucherait onze écrans
hors du périmètre de cette mission. `src/components/ui/` et Catalyst ne sont pas
touchés non plus.

## Mesures — avant / après

| Viewport | scrollWidth / clientWidth | Éléments débordants | Verdict |
|---|---|---|---|
| **Avant** — 390×844 | 390 / 390 | **167** (max right **674 px**) | DÉBORDE |
| 390×844 | 390 / 390 | **0** | OK |
| 430×932 | 430 / 430 | **0** | OK |
| 1280×800 | 1280 / 1280 | **0** | OK |
| 1440×900 | 1440 / 1440 | **0** | OK |
| 1920×1080 | 1920 / 1920 | **0** | OK |

Étape intermédiaire mesurée : après le seul `min-w-0` sur les Panels, on passait
de 167 éléments débordants à **1** — celui du §2 ci-dessus.

## Autres contrôles

- **Refresh direct** sur `/settings` à chaque viewport (navigation complète, pas
  de transition client) : aucun débordement.
- **Focus clavier** : premier élément focusable = `BUTTON`, `outline: 2px solid`
  — visible.
- **Console** : aucune erreur, aucune erreur d'hydratation.
- **Aucun contenu tronqué** : le message des plafonds est désormais rendu en
  entier, sur plusieurs lignes.

## Captures

`settings-390.png` · `settings-430.png` · `settings-1280.png` ·
`settings-1440.png` · `settings-1920.png` — pleine page, session authentifiée,
au HEAD final de la branche.

## Ce que cette preuve NE couvre PAS

- Chrome uniquement, aux cinq viewports demandés.
- Contrastes constatés à l'œil, **non mesurés** au ratio WCAG.
- Aucun lecteur d'écran réel.
- Les autres écrans du produit ne sont pas revalidés : le correctif est local à
  `/settings` par construction.
