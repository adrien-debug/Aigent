# AIGENT-DS-SURFACES-001 — direction claire : revue visuelle

> Preuves de la mission #94. Base : PR #92 (`mission/apercu-composition-plate`).
> #92 fixe la composition, #94 fixe le langage visuel — la composition livrée
> par #92 n'est pas refaite ici.

## Ce qui a changé

Le produit était graphite de bout en bout : rail sombre dans un document sombre.
Il devient un **document clair portant un unique îlot sombre**, le rail de
navigation. La hiérarchie ne vient plus de l'ombre mais de la **clarté** et du
**liseré**.

## Tokens — avant / après

Deux échelles coexistent, avec **exactement les mêmes noms de jetons** : aucun
composant n'a à savoir laquelle est active.

| Jeton | Avant (`:root`, graphite) | Après (`:root`, clair) | Après (`.aig-dark`, îlot) |
|---|---|---|---|
| `--aig-subtle` (surface 0) | `oklch(0.165 0.006 264)` | `oklch(0.982 0.0015 264)` | `oklch(0.135 0.005 264)` |
| `--aig-base` (surface 1) | `oklch(0.243 0.007 264)` | `oklch(1 0 0)` | `oklch(0.243 0.007 264)` |
| `--aig-raised` (surface 2) | `oklch(0.298 0.009 264)` | `oklch(0.955 0.002 264)` | `oklch(0.298 0.009 264)` |
| `--aig-line-soft` | `oklch(0.342 0.009 264)` | `oklch(0.915 0.003 264)` | inchangé |
| `--aig-text` | `oklch(0.93 0.004 264)` | `oklch(0.255 0.006 264)` | inchangé |
| `--aig-accent` | `oklch(0.72 0.11 52)` | `oklch(0.545 0.132 52)` | inchangé |

**L'accent cuivre est assombri sur fond clair, pas remplacé.** La teinte de la
sidebar (clarté 0.72) tombe à ~2.2:1 sur blanc : inutilisable pour du texte ou
un anneau de focus. 0.545 la ramène au-dessus de 4.5:1 en gardant la même teinte
(52) — même identité, contraste réel.

**Aucune suppression destructive.** L'échelle graphite n'est pas supprimée, elle
est déplacée sous `.aig-dark` et reste sélectionnable telle quelle. C'est ce qui
rend l'îlot sombre possible : les deux échelles doivent coexister *dans la même
page*, pas se succéder dans le temps.

## Niveaux de surfaces

| Rang | Rôle | Séparé par |
|---|---|---|
| Surface 0 | canvas global | — |
| Surface 1 | zone de contenu | clarté |
| Surface 2 | panneau fonctionnel | clarté + liseré |
| Bordures | `line-soft` / `line` | liseré |
| Overlay | dialog, menu, drawer | la seule vraie ombre du produit |
| Sidebar | surface sombre indépendante | `.aig-dark` |

Les quatre rangs sont vérifiés **deux à deux distincts** par le harnais : deux
rangs confondus, c'est la « fatigue visuelle par gris trop proches » que la
mission interdit, et aucune gate textuelle ne la voit.

## Contrastes — mesurés au rendu, pas déclarés

Lus sur le pixel réellement affiché (`getComputedStyle` → canvas → luminance
WCAG), aux trois tailles :

| Mesure | Ratio | Seuil |
|---|---|---|
| Texte principal / zone de travail | **14.94:1** | 4.5:1 (AA) |
| Séparation sidebar / body | **19.01:1** | 3:1 |

## Fichiers touchés

| Fichier | Rôle |
|---|---|
| `src/theme/tokens.css` | deux échelles, mêmes noms de jetons |
| `src/theme/utilities.css` | utilitaires `aig-*` rebranchés sur les jetons |
| `src/app/globals.css` | `color-scheme` par scope |
| `src/app/layout.tsx` | document clair |
| `src/components/app-shell.tsx` | rail `dark aig-dark` + en-tête responsive |
| `src/components/cockpit/overview/activity-graph.tsx` | courbe passée au cuivre |
| `scripts/capture-ds-surfaces-001.mjs` | harnais de preuve (nouveau) |
| `scripts/check-theme-foundation.mjs` | gate corrigée pour deux échelles |

## Deux défauts trouvés en chemin

**1. `utilities.css` ignorait les jetons.** Les utilitaires portaient des
couleurs codées en dur (`#09090b`, `#111111`, `white`). Changer un token
n'aurait **rien** changé à l'écran : c'est la correction qui rend la mission
possible, pas un détail de propreté.

**2. En-tête écrasé à 375 px.** En `flex-wrap` sur une seule rangée, `actions`
est `shrink-0` et le titre `flex-1` : à 375 px les boutons prenaient la largeur
utile et il restait ~50 px au titre, tronqué en « A.. », pendant que l'eyebrow
se cassait sur trois lignes. **Le contrôle de débordement horizontal ne le
voyait pas** — rien ne dépassait, tout était simplement illisible. Le titre
prend désormais sa propre ligne jusqu'à `sm`.

## Gate `check:theme-foundation` — corrigée, pas contournée

Elle échouait sur 13 lignes d'un fichier correct, pour deux raisons de fond :

1. **Portée du bloc d'alias.** `slice(indexOf(...))` lisait jusqu'à la fin du
   fichier et avalait l'îlot `.aig-dark` qui suit, signalant ses littéraux —
   légitimes — comme des alias fautifs. La lecture est maintenant bornée à
   l'accolade fermante.
2. **Liste canonique.** Elle épinglait l'échelle sombre comme étant celle de
   `:root`. La règle réellement utile est la **préservation** (l'issue interdit
   « toute suppression destructive des tokens sombres ») : on vérifie désormais
   que chaque valeur existe encore, `.aig-dark` décidant où.

Sondée dans les deux sens : verte sur les deux échelles, et **toujours rouge**
si l'on supprime un token sombre.

## Console navigateur

Zéro erreur console et zéro `pageerror` sur les 9 combinaisons écran × taille.
Le harnais échoue si l'un des deux apparaît : une capture d'un écran en erreur
n'est pas une preuve.

## Tests

- 17 gates statiques vertes
- `typecheck` vert · `eslint src scripts tests` : 0 erreur, 1 warning préexistant
- **189 fichiers, 2363 tests, 0 échec**
- `build` vert

## Démonstrateur de surfaces — `/lab/surfaces`

`surface-catalog.png` existe désormais : la route `/lab/surfaces` rend un
catalogue qui pose côte à côte les six rangs de surface, les trois rangs de
texte, les six tons de sévérité, les actions, les champs, les états d'absence,
le **tableau**, les **cartes projet**, le **graphique cuivre**, l'état de
**chargement**, l'état d'**erreur** et l'**overlay** (dialog + menu), puis les
séparateurs. Elle est
rendue **dans `AppShell`**, délibérément — c'est la seule façon de contrôler la
sidebar sombre et le body clair ensemble.

Le tableau, les cartes, la courbe, le squelette et l'overlay ont été ajoutés
après une première passe : la planche couvrait les surfaces et les états, mais
pas les composants qui les portent. Trois points méritent d'être notés parce
qu'ils ne se voient pas dans le code :

- **La courbe est inerte et le dit.** Une forme fixe, légendée « aucune donnée
  réelle n'est tracée ici » : un graphique de lab qui ressemble à une mesure est
  exactement le faux zéro que `check:render-truth` interdit ailleurs.
- **L'overlay est rendu statiquement.** `Dialog` du kit est piloté par état et ne
  peut pas s'ouvrir dans une page serveur ; ce qui est démontré est la SURFACE
  (`aig-overlay` et son ombre), pas le comportement — c'est ce que la mission
  demande de calibrer.
- **Le squelette a coûté un utilitaire.** `aig-inset-fill` ne pose qu'un
  `border-radius: 0`, sans fond : employé pour un squelette, il rendait cinq
  barres **entièrement transparentes** — l'état de chargement disparaissait de
  l'écran tout en semblant codé. Mesuré au rendu (`rgba(0,0,0,0)`), corrigé par
  `aig-skeleton-bar`, qui porte un vrai aplat volontairement calme : un squelette
  trop contrasté se lit comme du contenu réel.
- **L'erreur n'existait que comme badge décoratif.** La mission exige les états
  « vide, loading, erreur, disabled » ; les trois autres avaient leur section, le
  rouge n'était qu'une pastille dans la rangée des badges. La planche démontre
  désormais les **deux registres d'erreur du produit, et le fait qu'ils ne se
  confondent pas** : l'échec de LECTURE (« je n'ai pas pu savoir » — neutre,
  `Unavailable reason="unread"`, aucun rouge, car rien n'est cassé côté opérateur
  et le peindre en incident déclencherait des gestes inutiles) et l'erreur de
  SAISIE (« corrige ceci » — actionnable, donc `--aig-severity-bad-ink`). Le
  liseré du champ porte lui aussi l'erreur : reposer sur la seule couleur du
  texte d'aide la ferait disparaître pour qui ne distingue pas le rouge.

Elle vit sous `/lab`, donc hors `NAVIGATION` et `notFound()` en production
(même garde que `/lab`) : une planche de fabrication laissée accessible en
production serait lue comme du produit.

Ce n'est **ni une gate, ni un Storybook, ni une doctrine** (`AGENTS.md` §
Frontend). Elle n'impose rien, elle montre.

## Les preuves se régénèrent — elles ne se recopient pas

Toutes les images de ce dossier sont produites par
`node scripts/capture-ds-surfaces-001.mjs`, **y compris** `surface-catalog.png`
et les fichiers `*-after-*` que la mission exige nommément. Ils étaient d'abord
copiés à la main : une preuve recopiée se périme en silence dès que l'écran
change, elle reste versionnée en montrant un état qui n'existe plus. Deux pièges
rencontrés en les intégrant au harnais :

- **`fullPage: true` ne suffisait pas.** La planche défile dans un conteneur
  interne (`overflow-y-auto`), donc le *document* ne défile pas et Playwright
  n'avait rien à étendre : la capture s'arrêtait au viewport, au tiers de la
  page. La fenêtre est maintenant redimensionnée à la hauteur réelle du contenu
  (2788 px) avant déclenchement.
- **Le scroller se trouve par mesure, pas par nom de classe.** Viser
  `.overflow-y-auto` échoue dès que l'utilitaire est composé avec d'autres
  classes — on retombe alors sur 900 px en croyant tenir la page entière.

Les `*-before-*` sont les seuls fichiers que le harnais ne touche pas : ils
montrent l'état antérieur et sont vérifiés inchangés après chaque passe.

## Versionnement des preuves — exception ciblée

`docs/visual-reviews/` est ignoré par `.gitignore`. Les preuves de cette mission
sont ré-incluses par une exception **limitée à ce seul dossier** ; le reste,
notamment les exemples Tailwind Plus vendorés, demeure hors historique.

Le motif parent a dû passer de `docs/visual-reviews/` à `docs/visual-reviews/*` :
avec un slash final, git exclut le RÉPERTOIRE et n'y descend jamais, si bien
qu'aucune négation placée ensuite ne peut ré-inclure son contenu. Vérifié dans
les deux sens — un nouveau fichier de la mission apparaît dans `git status`, un
fichier d'un autre dossier de `visual-reviews` reste ignoré.

## Audit de contraste exhaustif — 13 surfaces

Au-delà des 3 écrans du périmètre, la totalité du produit a été mesurée sur le
**fond réellement composé** (les couches translucides sont empilées, ce qu'une
remontée naïve des parents calcule faux) :

| Surface | Éléments | Échecs |
|---|---:|---:|
| `/` · fiche Agent · fiche Projet | 635 | 0 |
| `/runs` `/qualification` `/delivery` `/runtime` | 635 | 0 |
| `/learning` `/actions` `/projects` `/agents` | 324 | 0 |
| `/settings` `/builder` | 77 | 0 |
| `/lab/surfaces` | 84 | 0 |
| **Total** | **1755** | **0** |

Quatre causes de non-conformité ont dû être corrigées, toutes invisibles sur
fond sombre :

1. **`aig-quiet` consommait `--aig-scrim`** — un voile de modale employé comme
   surface. La grille de faits de la fiche Agent rendait du graphite sur fond
   sombre : **1,76:1**.
2. **Le kit passait devant le DS.** `<Text className="aig-text-muted">` produit
   deux déclarations de même spécificité ; le `text-zinc-500` de Catalyst
   gagnait et le jeton produit n'était jamais appliqué (**4,20:1**). Corrigé par
   une remontée de spécificité dans notre scope — le kit reste intact sur disque.
3. **`--aig-severity-*` employé comme couleur de TEXTE.** Ces teintes sont
   calibrées pour émettre sur graphite ; sur blanc elles tombent à **2,79:1**.
   D'où `--aig-severity-*-ink`, leur variante encre à teinte constante. Les
   aplats, rails et tracés gardent la teinte nue.
4. **Le bouton d'action principale rendait noir.** Sans `color=`, `<Button>`
   retombe sur `dark/zinc`, qui écrase `--btn-bg` à spécificité égale.

## États d'interaction — mesurés, pas supposés

74 cibles atteintes **au clavier** sur 3 écrans (`/`, fiche Agent,
`/lab/surfaces`) :

- **0 cible sans indicateur de focus**
- **0 anneau sous 3:1** (WCAG 2.4.11)
- hover distinct du repos, vérifié au pixel sur les lignes de projet

Un défaut réel trouvé ainsi : l'anneau du CTA cuivre mesurait **1:1** — un
cuivre éclairci posé sur un bouton cuivre. Il porte désormais le graphite du
texte, avec un liseré clair intérieur qui le détache du bouton.

## Limites restantes

- **Périmètre volontairement limité à 3 écrans** pour la revue visuelle
  détaillée. Les 10 autres surfaces héritent des jetons et ont été mesurées en
  contraste (0 échec), mais leur composition n'a pas été revue une par une.
- **Le graphique d'activité est plat** — un seul run réel sur la fenêtre 24 h.
  C'est la vérité des données, pas un défaut de rendu : rien n'est inventé.
- **Aucune capture d'écran des états hover / focus / disabled.** Ils sont
  **mesurés** (voir ci-dessus) mais pas photographiés : une capture d'un focus
  est un artefact fragile, la mesure est la preuve utile.
- **Le recalibrage des `Badge` Catalyst passe par des sélecteurs d'attribut de
  classe** (`[class*='text-lime-']`). C'est robuste tant que le kit garde ses
  noms de classes Tailwind ; une mise à jour amont qui les renommerait
  neutraliserait la règle en silence. Aucune gate ne le détecterait.
- Light/dark : la direction claire est prioritaire. `.aig-dark` existe et sert
  la sidebar ; aucun basculement global de mode nuit n'est livré.
