# Direction de composition — cockpit opérateur Aigent

> **Statut** : direction artistique, à exécuter par Codex. Observations datées du
> **2026-08-02**, mesurées sur le rendu réel (`:3987`, 1680×1050), pas sur le source.
> Ce document n'est pas de la doctrine : c'est une commande de travail bornée.
>
> **Verdict d'entrée** : le Design System n'est pas le problème. Voir §6.

---

## 0. Ce qui a été réellement inspecté

| Écran | URL | Preuve |
|---|---|---|
| Aperçu | `/` | `audit-08-overview.png` |
| Runtime · Télémétrie | `/runtime` | `audit-01-runtime.png` |
| Projets | `/projects` | `audit-03-projects.png` |
| Agents (roster) | `/agents` | `audit-02-agents.png` |
| Agent détail — dégradé | `/agents/copilot-gold-trading…` | `audit-04/05/06` |
| Agent détail — indisponible | `/agents/copilot-agent-builder…` | `audit-07-agent-healthy.png` |

Mesures instrumentées dans le navigateur (`getComputedStyle` → canvas → sRGB →
ratio WCAG), pas estimées à l'œil. Elles fondent le §2.

---

## 1. Hiérarchie visuelle

### 1.1 Combien de niveaux de profondeur doivent exister

**Trois. Jamais quatre.**

```
Rang 0 — CANVAS      le document. Ne porte aucun contenu, seulement du vide.
Rang 1 — SCÈNE       la zone dominante de l'écran. UNE par page.
Rang 2 — CREUX       ce qui accueille la donnée DANS la scène (liste, flux, graphe).
```

Ce que le produit fait aujourd'hui sur `/agents/[id]` :

```
canvas → aig-stage → section → aig-inset → ligne → badge
   0        1           2          3          4       5
```

Six rangs, dont quatre portent une bordure ou un fond propre. C'est la cause
racine de la lecture « SaaS » : à profondeur égale, l'œil ne sait plus quoi lire
en premier, donc il lit tout, donc il ne lit rien.

**Règle** : la profondeur maximale d'un écran est **canvas → scène → creux**. Le
contenu d'un creux est du **texte, des lignes et des chiffres** — pas une
quatrième boîte.

### 1.2 Quelle surface porte l'information principale

**La scène (`aig-stage`), et elle seule.**

Aujourd'hui la scène est correctement posée sur `/runtime`
([runtime-screen.tsx:103](src/components/runtime/runtime-screen.tsx#L103)) — puis
son bénéfice est annulé : le creux qu'elle contient reçoit une pile de `Panel`
qui reconstruisent chacun un rang complet (fond + liseré + rayon + en-tête).
`tab-langgraph.tsx` en empile **cinq**, `delivery/detail-screen.tsx` **six**.

Le creux doit recevoir de la **donnée**, pas des panneaux. Un titre de section
dans un creux est un `<h3>` + un filet (`aig-hairline`), pas un `Panel`.

### 1.3 Quelles surfaces doivent disparaître

| Surface | Verdict | Motif |
|---|---|---|
| `Panel` **imbriqué dans** un creux ou une autre scène | **supprimer** | rang 3+ ; c'est la boîte-dans-la-boîte |
| `aig-panel-raised` en usage décoratif | **supprimer** | `raised` doit signifier « demande une action », pas « autre carte » |
| Carrousel de projets de l'Aperçu | **supprimer** | collection homogène en cartes + pagination pour 10 items |
| Cellules du bandeau KPI de l'Aperçu | **supprimer les cellules**, garder les chiffres | KPI enfermés (§1.4) |
| `Unavailable` en boîte pointillée pleine hauteur (`min-h-32`) | **dégrader en ligne** | une absence occupe aujourd'hui plus de surface qu'une mesure |
| Badges répétés à l'identique sur chaque ligne | **supprimer** | §1.4 |

`Panel` **reste légitime** en rang 1 quand une page n'a pas de scène (écrans
secondaires simples). Il ne devient jamais rang 3.

### 1.4 Où utilise-t-on encore des boîtes inutilement

Symptômes cherchés, symptômes trouvés :

**panel dans panel** — `runtime/tab-langgraph.tsx` (5 `Panel` dans le creux de la
scène), `delivery/detail-screen.tsx` (6), `projects/detail-screen.tsx` (5),
`builder/workspace.tsx` (4). **CONFIRMÉ.**

**inset dans raised** — `agents/detail-screen.tsx` : le bloc « Confiance de
release » est un creux `aig-inset` posé dans une section, contenant des lignes
qui portent chacune un badge sur fond `raised`. Trois matières empilées pour dire
une chose. **CONFIRMÉ** (`audit-05`).

**cartes répétées** — l'Aperçu rend les projets en carrousel de cartes avec
flèches de pagination, alors que `/projects` rend exactement la même collection
en liste, mieux (`audit-03` vs `audit-08`). Deux grammaires pour un même objet
métier. **CONFIRMÉ.**

**badges partout** — **172 `<Badge>`** dans `src/`, dont **21 dans le seul
`agents/detail-screen.tsx`**. Pire : dans « Outils montés », chaque ligne porte
`lecture seule` + `low` — **identiques sur toutes les lignes** (`audit-06`). Un
badge qui ne varie jamais n'est pas une information, c'est du bruit répété n
fois. **CONFIRMÉ.**

**KPI enfermés** — Aperçu : six mesures, chacune dans sa cellule bordée, dont
trois disent « AUCUNE MESURE » dans un jeton gris encadré. Le chiffre `0` de
« Runs 24 h » et le mot « AUCUNE MESURE » ont le même poids visuel que le reste.
**CONFIRMÉ** (`audit-08`).

Contre-exemple à conserver : le bandeau « SANTÉ DE LA FLOTTE » de `/agents`
(`audit-02`) pose ses chiffres **nus sur la scène**, sans cellule. C'est le bon
patron — il existe déjà dans le repo, il suffit de le généraliser.

**états trop dramatiques** — le plus grave. Sur
`/agents/copilot-agent-builder-copilot`, le statut réel est **`unavailable`**
(« Indisponible » — une mesure absente), et l'écran affiche en rouge critique,
40 px, en haut de scène :

> **Lancement bloqué** · *Status is unavailable, not active* · *A hard
> requirement is missing*

Une absence de mesure est peinte comme une panne. C'est une contradiction
frontale avec `AGENTS.md § Vérité des données` (« une valeur non mesurée reste
`null` ») : la règle est tenue dans les données et **trahie dans le rendu**.
Même défaut sur `/runtime` : `canal non configuré` — une variable d'environnement
non renseignée — s'affiche en rouge `severity-bad`, alors que le texte adjacent
explique correctement que cela ne dit rien sur la santé des agents. **CONFIRMÉ.**

---

## 2. Matière visuelle

### 2.1 Mesures réelles (pas des impressions)

Valeurs sRGB résolues et ratios de contraste WCAG mesurés dans le navigateur :

| Rôle | sRGB réel | Le fichier prétend |
|---|---|---|
| `--aig-subtle` (fond du document) | `rgb(12,13,16)` | « graphite, jamais #000 » |
| `--aig-base` | `rgb(18,20,23)` | |
| `--aig-raised` | `rgb(29,31,35)` | |
| `--aig-line-soft` | `rgb(36,38,42)` | |
| `--aig-line` | `rgb(49,51,55)` | |
| `aig-inset` (calculé) | `rgb(7,7,9)` | |

| Séparation | Ratio | Verdict |
|---|---|---|
| creux vs canvas | **1.04** | invisible |
| canvas vs base | **1.05** | invisible |
| base vs raised | **1.12** | quasi invisible |
| liseré soft vs base | **1.22** | à la limite du perceptible |
| liseré vs base | 1.46 | perceptible, c'est le seul séparateur qui travaille |

**Diagnostic** : la grammaire est juste, **ses valeurs sont trop basses d'un
palier entier**. Les cinq rôles vivent tous entre `rgb(7)` et `rgb(49)` — un
intervalle de 42 niveaux sur 255 pour porter cinq rangs de hiérarchie. C'est
pourquoi tout se lit à plat malgré une architecture correcte : **la hiérarchie
est décrite mais pas rendue.**

`aig-inset` à `rgb(7,7,9)` est **plus sombre que le canvas** et frôle le noir
absolu que le commentaire du fichier interdit explicitement (ligne 58 :
« GRAPHITE TRAVAILLÉ, JAMAIS #000 »). Le creux ne se lit pas comme un lit : il se
lit comme un trou.

### 2.2 Trop de noir

**Oui, et c'est mesuré, pas ressenti.** Le canvas est à 5 % de luminance. Un
cockpit lisible pose son canvas plus haut et réserve le très sombre au creux, pas
l'inverse. Aujourd'hui l'écran est noir *et* ses surfaces sont noires : il ne
reste aucune amplitude pour élever quoi que ce soit.

### 2.3 Effet glossy

**Absent — et c'est bien.** `aig-stage` porte un `radial-gradient` + un
`linear-gradient` très longs qui donnent de la matière sans brillance
(`globals.css:261`). Les élévations sont des `inset 0 1px` discrets. **Ne rien
changer ici.** Le problème n'est pas l'effet, c'est l'amplitude.

### 2.4 Manque de séparation

Confirmé par le §2.1 : à 1.04–1.22, les surfaces ne se séparent **que** par leur
bordure. D'où la sensation de grille de cadres. La séparation doit repasser par
la **valeur** (le fond), la bordure devenant secondaire — c'est exactement ce que
`aig-quiet` et `aig-hairline` promettent (`globals.css:282-310`) et que les
valeurs actuelles empêchent de tenir.

### 2.5 Densité

Sur `/agents/[id]` : **2343 px de contenu dans une fenêtre de 929 px** — 2,5
viewports de défilement interne pour un seul agent, dont une large part en
espacements de section et en boîtes d'absence pleine hauteur. La densité n'est
pas trop forte : **elle est mal répartie**. Les faits utiles (modèle, runtime,
version, outils non résolus) tiendraient en un écran ; ce sont les conteneurs qui
occupent la place.

### 2.6 Définition de la matière — à appliquer

Cible **relative**, à valider à l'œil sur écran calibré. L'écart entre deux rangs
successifs doit être **perceptible sans bordure** (viser ≥ 1.25 de ratio entre
rangs adjacents, contre 1.04–1.12 aujourd'hui).

```
Canvas               oklch(0.145 0.006 264)   ~rgb(11,12,15)   inchangé ou très peu
                     le vide. Ne porte jamais de contenu directement.

Surface principale   oklch(0.205 0.007 264)   ~rgb(28,30,34)   ← +1 palier
  (la SCÈNE)         porte l'information dominante. Une par écran.

Surface secondaire   oklch(0.175 0.006 264)   ~rgb(19,21,24)   ← le CREUX remonte
  (le CREUX)         accueille la donnée. Plus sombre que la scène,
                     PLUS CLAIR que le canvas — un lit, pas un trou.

Élément élevé        oklch(0.265 0.009 264)   ~rgb(40,42,47)   ← +1 palier
                     réservé à ce qui appelle une ACTION ou porte
                     une sélection. Jamais décoratif.

État critique        --aig-severity-bad  #e8455f
                     RÉSERVÉ à : un run échoué, un outil déclaré sans
                     handler, un BLOCKED Sentinel. Un fait mesuré et négatif.

État warning         --aig-severity-warn #be850f
                     une condition tenue mais dégradée.

État NON MESURÉ      --aig-text-faint (neutre) — PAS une sévérité.
                     Une absence n'est ni rouge ni ambre. C'est le rang le plus
                     BAS de la page, pas le plus haut.
```

Le dernier rang est la correction la plus importante du document : il n'existe
pas aujourd'hui, et son absence est ce qui rend l'interface anxiogène.

**Ne pas toucher** : les cinq `--aig-severity-*` (miroir de
`src/lib/cockpit/status.ts`, qui reste l'autorité — `globals.css:91-105`),
l'accent cuivre, les rayons, les élévations.

---

## 3. Pattern produit

### 3.1 Runtime

**Structure idéale** — la scène est déjà correcte, c'est son contenu qui fautif.

```
PageHeader  (titre + description de la SURFACE)          ← existe, garder
Piste d'onglets                                           ← existe, garder
┌─ aig-stage ────────────────────────────────────────────┐
│  Nom de l'onglet + intention                            │ ← existe, garder
│  ─── aig-hairline ───                                   │ ← existe, garder
│  ┌─ aig-inset (LE scroller) ─────────────────────────┐  │
│  │  BANDEAU D'ÉTAT — 1 ligne, chiffres nus           │  │ ← à créer
│  │  ─── hairline ───                                  │  │
│  │  <h3> section          données en lignes/table     │  │ ← remplacer les Panel
│  │  ─── hairline ───                                  │  │
│  │  <h3> section          données en lignes/table     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Visible en premier** : l'état du canal (configuré / non configuré) et les 4–6
chiffres de la fenêtre — runs, terminés, échoués, agents rapporteurs — **nus**,
sans cellule, sur une seule ligne.

**Doit disparaître** :
- les `Panel` internes des onglets (5 dans `tab-langgraph`, 3 dans
  `tab-repositories` et `tab-providers`, 2 dans `tab-tools` et `tab-models`) →
  remplacés par `<h3>` + `aig-hairline` ;
- le badge rouge `canal non configuré` → devient un état **neutre** avec le texte
  explicatif déjà présent, qui est correct ;
- la ligne de badges « Provenance : jetons · mesuré / coût · mesuré / erreurs ·
  absent / signaux d'outil · mesuré » → une ligne de texte, pas quatre jetons
  colorés.

### 3.2 Projects

**Décision : LISTE.** Pas de table, pas de cartes, pas de timeline.

**Justification** — objective, pas esthétique :
1. La collection est **hétérogène en densité** : 2 projets sur 10 portent des
   agents et des mesures, 8 sont vides. Une **table** impose n colonnes que 80 %
   des lignes laisseraient vides — elle donnerait à l'absence la même surface
   qu'à la donnée.
2. Les **cartes** sont exclues par la règle « collection homogène en cartes » et
   par la mesure : le carrousel de l'Aperçu affiche 3 projets sur 10 et exige
   deux clics pour voir le reste, là où la liste en montre 10 d'un coup.
3. La **timeline** supposerait que le temps est l'axe de lecture. Il ne l'est
   pas : l'opérateur cherche « quel projet a des agents et des runs », une
   question d'état, pas de chronologie.
4. La liste existante (`audit-03`) est **déjà la meilleure surface du produit**.
   Elle n'a pas besoin d'être refaite, seulement hiérarchisée.

**Correction à apporter** : les 8 projets vides ne doivent pas peser autant que
les 2 peuplés. Rang typographique réduit, `aucun agent` en `text-faint` neutre,
et surtout **pas** de `rien à mesurer` répété huit fois en colonne de droite.
Trier les projets peuplés en tête est la seule hiérarchie qui manque.

### 3.3 Agents

**Quelle information domine** — dans cet ordre, et un seul rang 1 :

1. **L'agent peut-il tourner, oui ou non, et pourquoi pas.** C'est la question
   que l'opérateur pose. Elle se répond en une phrase et une liste d'obstacles
   concrets.
2. L'identité de service : projet · runtime · version · modèle configuré ·
   modèle **prouvé** (la distinction configuré/prouvé est le cœur métier — elle
   est déjà rendue, la garder).
3. Le reste (activité, qualification, configuration) : **rangs inférieurs**.

**Comment montrer bloqué / lançable** — la règle décisive :

| Cas réel | Rendu |
|---|---|
| `status: degraded` + outils non résolus | **rouge critique** — un fait mesuré et négatif. C'est le seul cas qui mérite le rouge. |
| `status: unavailable` (donnée absente) | **neutre `text-faint`** + « Prérequis non mesuré » — jamais « Lancement bloqué » en rouge. |
| `status: inactive` | **neutre** — un agent au repos n'est pas en panne. |
| `status: active` | **vert discret**, pas un pavé — l'état sain est le silence. |

La garde d'exécution (`AGENTS.md`) exige `active` + `unresolvedToolIds` vide +
`runtime === 'langgraph'`. Le rendu doit donc distinguer **« bloqué parce qu'un
fait négatif est prouvé »** de **« pas lançable parce qu'on ne sait pas »**. Ces
deux états sont aujourd'hui peints de la même couleur, et c'est le défaut
principal de l'écran.

**Comment montrer qualification / runs / outils** :

- **Qualification** — un compteur d'avancement (`1/9 étapes`) + les blocages
  **nommés**. Les 6 lignes « Non mesuré » de `audit-05` doivent s'affaisser en
  **une** ligne : « 6 critères non mesurés — aucune qualification lancée ».
  Six badges ambre pour dire « rien n'a été lancé » est six fois trop.
- **Runs** — une liste dense (timestamp · statut · durée · coût), ou **une ligne
  neutre** quand il n'y en a aucun. Jamais une boîte pointillée de 180 px de haut
  pour dire « aucun run ».
- **Outils** — **le nombre non résolu domine** (c'est le blocage), la liste
  résolue est secondaire et **sans badges répétés**. `lecture seule` et `low`,
  identiques sur chaque ligne, deviennent un en-tête de section :
  « 7 outils · lecture seule · risque faible ».

---

## 4. Règles interdites

À faire respecter par Codex. Chaque règle est vérifiable à l'œil sur une capture.

```
INTERDIT

STRUCTURE
1.  Plus de deux niveaux de surface sous le canvas (scène → creux). Un troisième
    fond, liseré ou rayon dans un creux est interdit.
2.  Un `Panel` à l'intérieur d'un `aig-stage`, d'un `aig-inset` ou d'un autre
    `Panel`. Une section dans un creux = <h3> + `aig-hairline`.
3.  Deux `aig-stage` sur un même écran.
4.  Une collection homogène rendue en cartes. Une collection est une LISTE
    (ou une table si et seulement si toutes les lignes portent les mêmes colonnes
    remplies).
5.  Un carrousel, une pagination ou des flèches pour une collection de moins de
    ~25 items.

MESURES
6.  Un KPI enfermé dans une boîte individuelle. Les chiffres se posent nus sur
    leur surface, séparés par l'espace ou un filet — jamais par une cellule.
7.  Une jauge, une barre ou un graphe rendu sur une donnée absente.
8.  Un `0` affiché là où la valeur est `null`. (Déjà tenu côté données —
    le rendu ne doit pas le défaire.)

ÉTATS
9.  Une absence de configuration ou de mesure affichée comme une erreur
    critique. `unavailable`, `non mesuré`, `non configuré`, `aucun run` sont
    NEUTRES (`--aig-text-faint`). Le rouge est réservé à un fait mesuré et
    négatif.
10. Une boîte d'absence (`Unavailable`) occupant plus de place que la donnée
    qu'elle remplace. Une absence est une LIGNE, pas un panneau de 180 px.
11. Un état sain rendu par un pavé coloré. Le sain est discret.

BADGES
12. Plus de DEUX badges visibles simultanément dans un même bloc de rang 2.
13. Un badge dont la valeur est identique sur toutes les lignes d'une liste :
    il remonte en en-tête de section ou disparaît.
14. Un badge pour porter une valeur qui n'est pas un état (un nom de modèle, un
    provider, un compte). Ce sont du texte.

MATIÈRE
15. Toucher aux cinq `--aig-severity-*` : leur autorité est
    `src/lib/cockpit/status.ts`, jamais le CSS.
16. Introduire une couleur, un rayon ou une ombre hors des jetons `--aig-*`.
17. Un fond plus sombre que le canvas pour une surface qui porte du contenu.
18. `#000` ou un `oklch(L)` sous 0.14 sur une surface de contenu.
```

---

## 5. Plan d'exécution

Cinq étapes, ordonnées par dépendance. **Chacune est indépendamment livrable et
réversible.** Une étape ne commence pas avant que la preuve de la précédente soit
acceptée.

---

### Étape 1 — Réétalonner la matière

**Objectif** — donner à la grammaire existante l'amplitude qui lui manque, sans
changer un seul composant. C'est la modification au meilleur rapport
effet/risque : elle touche 6 valeurs et se voit sur les 11 écrans.

**Fichiers probables** — `src/app/globals.css` uniquement (`:root` lignes 68-121,
utilitaire `aig-inset` ligne 292).

**Ce qui change** — les valeurs `--aig-base`, `--aig-raised`, `--aig-line-soft`
et le `color-mix` de `aig-inset` (qui doit cesser d'être plus sombre que le
canvas). `--aig-subtle` bouge peu ou pas. Aucun `--aig-severity-*`, aucun rayon,
aucune élévation.

**Preuve visuelle attendue** — les 6 captures de référence rejouées à
l'identique, avant/après côte à côte, + le tableau de ratios du §2.1 recalculé
par le même script.

**Critère d'acceptation** — ratio entre rangs adjacents **≥ 1.25** (contre
1.04–1.12) ; `aig-inset` **plus clair** que le canvas ; aucune surface de contenu
sous `oklch(0.14)` ; contrastes de texte maintenus ≥ 4.5 sur les trois rangs
(`text-faint` sur creux est le cas critique, aujourd'hui à 4.68 — il ne doit pas
descendre).

---

### Étape 2 — Neutraliser l'absence

**Objectif** — cesser de peindre en rouge ce qui n'est pas mesuré. Corrige la
contradiction entre `AGENTS.md § Vérité des données` et le rendu.

**Fichiers probables** — `src/components/agents/detail-screen.tsx` (bloc « État
de service »), `src/components/agents/atoms.tsx` (`RuntimeStatusBadge`),
`src/components/agents/roster-screen.tsx` (`RAIL_COLOR` : `unavailable` doit
quitter `SEVERITY.warn` pour un neutre), `src/components/cockpit/primitives.tsx`
(`Unavailable` → variante ligne), `src/components/runtime/tab-telemetry.tsx`
(`canal non configuré`).

**Preuve visuelle attendue** — capture de `/agents/copilot-agent-builder-copilot`
(statut `unavailable`) et de `/agents/copilot-gold-trading…` (statut `degraded`
avec 3 outils non résolus) **côte à côte** : les deux doivent être visiblement
différents. Plus `/runtime` onglet Télémétrie.

**Critère d'acceptation** — sur un agent `unavailable`, plus aucun pixel
`severity-bad` et plus aucune occurrence de « Lancement bloqué » ; sur un agent
`degraded` avec outils non résolus, le rouge est **conservé** et reste le seul
rouge de l'écran ; `canal non configuré` n'est plus rouge.

---

### Étape 3 — Aplatir la profondeur

**Objectif** — ramener chaque écran à canvas → scène → creux. C'est l'étape la
plus volumineuse ; elle ne change **aucune donnée affichée**, seulement les
conteneurs.

**Fichiers probables** — `src/components/runtime/tab-langgraph.tsx` (5 `Panel`),
`tab-repositories.tsx` (3), `tab-providers.tsx` (3), `tab-tools.tsx` (2),
`tab-models.tsx` (2), `src/components/projects/detail-screen.tsx` (5),
`src/components/delivery/detail-screen.tsx` (6),
`src/components/agents/detail-screen.tsx` (sections internes).

**Preuve visuelle attendue** — pour chaque onglet Runtime et chaque écran de
détail : capture avant/après, plus un comptage de profondeur (nombre de fonds
distincts empilés sur l'axe Z au point le plus profond de l'écran).

**Critère d'acceptation** — profondeur maximale mesurée = **3** (canvas, scène,
creux) sur tous les écrans inspectés ; zéro `Panel` rendu à l'intérieur d'un
`aig-stage` ou d'un `aig-inset` ; le contenu textuel est **identique** avant/après
(aucune donnée perdue en route — c'est une refonte de conteneurs, pas de contenu).

---

### Étape 4 — Dégonfler les badges

**Objectif** — passer de 172 badges à un nombre où chaque badge signifie encore
quelque chose.

**Fichiers probables** — `src/components/agents/detail-screen.tsx` (21),
`src/components/runtime/tab-langgraph.tsx` (11),
`src/components/delivery/detail-screen.tsx` (11),
`src/components/builder/workspace.tsx` (10),
`src/components/qualification/*-screen.tsx` (18 à eux deux).

**Ce qui change** — un badge constant sur toutes les lignes remonte en en-tête de
section ; un badge qui porte une valeur non-état (modèle, provider, compte)
devient du texte ; les 6 « Non mesuré » de la confiance de release s'affaissent en
une ligne récapitulative.

**Preuve visuelle attendue** — capture de la section « Outils montés » et de
« Confiance de release » (`audit-05`, `audit-06`) avant/après, + le comptage
`grep -c "<Badge"` par fichier.

**Critère d'acceptation** — au plus **2 badges** visibles simultanément dans un
bloc de rang 2 ; **zéro** badge répété à l'identique sur toutes les lignes d'une
liste ; le total `<Badge` du repo baisse d'au moins 40 %.

---

### Étape 5 — Unifier les collections

**Objectif** — une collection = une liste, une seule grammaire par objet métier.

**Fichiers probables** — `src/components/cockpit/project-carousel.tsx`
(**suppression** du carrousel — pas un masquage : handler, props, états et imports
partent avec, cf. la règle « supprimer, pas cacher »),
`src/components/cockpit/overview-screen.tsx` (bandeau KPI : retirer les cellules,
garder les chiffres), `src/components/cockpit/kpi-strip.tsx`,
`src/components/projects/list-screen.tsx` (hiérarchie peuplés/vides).

**Preuve visuelle attendue** — captures de `/` et `/projects` avant/après ; les
projets doivent se lire **de la même façon** sur les deux écrans.

**Critère d'acceptation** — plus aucun carrousel ni pagination sous 25 items ;
plus aucun KPI dans une cellule bordée ; `/` et `/projects` rendent la collection
« projet » avec la même grammaire ; les projets peuplés précèdent les vides.

---

### Vérification, à chaque étape

`npm run check` (chaîne statique complète, hors ligne) — obligatoire. Les gates
`check:production-visual-authority` et `check:ui-kit-integrity` sont concernées
par ce chantier.

**Rappel de portée** : aucune de ces gates ne mesure le rendu — elles lisent du
texte (exports, classes, marqueurs). Une gate verte ne prouve **rien** sur les
critères ci-dessus. **La preuve d'acceptation de chaque étape est la capture, pas
la gate.** Ne jamais annoncer une étape réussie sur la foi d'un `check` vert.

---

## 6. Verdict final

## **A) Suffisant — mauvais usage seulement.**

Avec une nuance chiffrée, qui n'est pas un « B » déguisé.

**Pourquoi A et pas C.** Le Design System n'a rien à refaire. La grammaire de
surface (`globals.css:238-339`) nomme exactement les bons rôles — `aig-stage`
(rang dominant, une par page), `aig-quiet` (second rang sans liseré),
`aig-inset` (le creux qui accueille), `aig-hairline` (séparer par la lumière).
C'est une pensée de composition juste, écrite avant l'audit, et qui anticipe les
défauts que l'audit trouve. `src/components/runtime/runtime-screen.tsx` **la met
correctement en œuvre**. Le problème est que onze écrans ne la suivent pas et
retombent sur `Panel`, la brique de rang unique.

**Pourquoi A et pas B.** Aucune règle ne manque au niveau du système. Les deux
règles qui semblent manquer — « une absence n'est pas une sévérité », « deux
rangs maximum » — sont déjà écrites, ailleurs et en toutes lettres :
`AGENTS.md § Vérité des données` pour la première, le commentaire de
`globals.css:238-256` pour la seconde. Elles ne sont pas absentes : elles ne sont
pas **appliquées au rendu**. Ce document les rapatrie en règles visuelles
exécutables (§4) ; il n'en invente aucune.

**La nuance chiffrée, à ne pas confondre avec une réfutation.** Un seul élément
du système est objectivement défaillant, et c'est un défaut de **valeurs**, pas de
**structure** : l'échelle de luminance est trop compressée pour rendre visible la
hiérarchie qu'elle décrit (1.04 à 1.22 entre rangs adjacents — §2.1). Six
constantes CSS à réétalonner, aucune architecture à revoir. C'est l'étape 1, et
c'est le seul endroit où je touche au DS lui-même.

**Preuve que A est le bon diagnostic** — deux surfaces du produit atteignent déjà
la cible avec le système actuel, sans aucune extension : le bandeau « Santé de la
flotte » de `/agents` (chiffres nus, rails de sévérité, zéro cellule) et la liste
`/projects`. Un système incapable de produire le résultat visé n'aurait pas pu
les produire. Ce qui manque n'est pas de la matière : c'est de la **discipline
d'usage**, et elle s'obtient par les interdits du §4.

---

### Ce que ce document ne prétend pas

- **Aucune mesure de rendu n'existe en gate.** Tout ce qui précède est vérifié à
  l'œil sur captures. Les critères du §5 sont conçus pour être vérifiables ainsi.
- Les captures sont datées du **2026-08-02** sur données de dev locales. Un
  jeu de données différent (agents actifs, runs peuplés) déplacerait certains
  constats de densité — **pas** ceux de profondeur, de matière ni de sévérité,
  qui sont structurels.
- Je n'ai pas inspecté `/qualification`, `/livraison`, `/learning`, `/actions`,
  `/builder` ni `/lab` au pixel. Le comptage source (`<Panel>`, `<Badge>`)
  suggère fortement les mêmes défauts — l'étape 3 et l'étape 4 les listent à ce
  titre, sans preuve visuelle propre. **À confirmer par capture avant
  exécution sur ces écrans.**
