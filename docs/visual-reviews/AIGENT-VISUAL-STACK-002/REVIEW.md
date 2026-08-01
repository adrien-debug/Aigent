# AIGENT-VISUAL-STACK-002 — revue visuelle (rework)

**SHA du rendu Aigent** : `527a6fc`
**Arbre propre avant capture** : oui (`cleanBeforeCapture: true`)
**Verdict du harnais** : `PASS`
**Console** : 0 erreur, 0 avertissement, 0 exception non capturée

Le commit qui porte ces preuves est le descendant direct de `527a6fc` : il
n'ajoute que des artefacts, aucun code.

## Ce que ce rework a corrigé

### 1. La composition mobile était illisible, et aucune gate ne le voyait

À 375 px, la grille `6.5rem / contenu / actions` laissait ~120 px à la colonne
centrale. Résultat constaté sur la capture v1 : « LangGraph Agent Server » cassé
sur trois lignes avec « Ouvrir » superposé par-dessus, « adresse connue, sonde en
échec » éclaté **un mot par ligne**, « Configurer » sortant du panneau.

**Rien de tout cela ne produisait d'overflow au niveau du document.** La page ne
débordait pas — elle était simplement illisible. C'est la limite exacte de
l'assertion « zéro overflow horizontal » : elle mesure le scroll du document,
pas la lisibilité d'une composition.

Correction : empilement vertical sur mobile (statut+identité, puis fonction,
puis contrôle+action), grille dense conservée dès `sm:`.

### 2. Le hint du panneau se coupait

« 6 sur 7 joignable(s) au dernier passage » s'affichait « … au dernier passa ».
Le hint de `Panel` est `shrink-0 truncate` : il refuse de rétrécir et coupe.
Raccourci en « 6/7 joignables ». Le détail temporel reste sur chaque ligne.

### 3. Trois descriptions mentaient sur le livré

| Outil | Avant | Après |
|---|---|---|
| Grafana | « Santé de l'infrastructure : serveurs et GPU » | dashboard des runs d'agents (le dashboard ne mesure aucune machine) |
| Langfuse | « Qualité, **coûts** et latence » | traces d'exécution : étapes, statuts, durées (le smoke ne produit aucun coût) |
| n8n | « notifications, synchronisations » | veille de santé de flotte sur métriques réelles |

### 4. Le bouton « Configurer » ne configurait rien

C'était un `<Button disabled>` portant sa procédure dans un `title` — invisible
au tactile, précisément là où l'écran est le plus contraint. Remplacé par la
mention non interactive « Configuration externe ». La procédure vit dans le
disclosure « Détail », atteignable partout.

### 5. LangSmith Studio — une affirmation antérieure était fausse

La revue précédente affirmait que Studio exigeait une session graphique et ne
pouvait donc pas afficher le graphe. **La capture montre le contraire** :
Studio ouvre `agent_builder`, rend les cinq nœuds et leurs arêtes, et se déclare
« Connected » contre `127.0.0.1:2024`.

La limite réelle est plus étroite, et Studio l'énonce lui-même dans un bandeau :
le tracing in-Studio exige `langgraph-api ≥ 0.11.0` quand le serveur rapporte
`1.4.2`. Aucun run n'a été soumis — ce serait un appel LLM facturé.

Statut inchangé : **`CONNECTED`, pas `VERIFIED`**. Studio sait LIRE le graphe,
c'est prouvé ; qu'il en OBSERVE une exécution ne l'est pas.

## Nouvelles assertions du harnais

Ajoutées parce que les précédentes laissaient passer les défauts ci-dessus :

- **géométrie mobile** — largeur utile réelle de chaque ligne (comparée à celle
  du conteneur), hauteur du nom (>44 px = cassure mot à mot), action entièrement
  dans le panneau, action de largeur non nulle ;
- **contenu hors cadre** — tout élément dont la boîte sort du panneau ;
- **troncature** — tout élément dont le `scrollWidth` dépasse le `clientWidth`.

**Sonde négative jouée** : l'ancienne grille fixe restaurée déclenche
simultanément « ligne large de 247px seulement », « nom cassé sur 60px de haut »
et « contenu hors du panneau ». Retirée, tout repasse au vert.

Une seconde sonde (`console.error` injecté) avait déjà prouvé que le harnais
échoue sur les erreurs console : 9 erreurs, verdict `FAIL`.

## Captures Aigent (10)

| Fichier | Surface | Viewport | État |
|---|---|---|---|
| `canvas-desktop-1440x900.png` | Canvas | 1440×900 | graphe réel |
| `canvas-laptop-1280x800.png` | Canvas | 1280×800 | graphe réel |
| `canvas-mobile-375x812.png` | Canvas | 375×812 | graphe réel |
| `canvas-node-selected-inspector-desktop-1440x900.png` | Canvas | 1440×900 | nœud sélectionné, inspecteur ouvert |
| `canvas-node-selected-inspector-mobile-375x812.png` | Canvas | 375×812 | idem, surface mobile |
| `canvas-empty-1440x900.png` | Canvas | 1440×900 | graphe vide (simulé côté navigateur) |
| `canvas-unavailable-1440x900.png` | Canvas | 1440×900 | graphe indisponible (simulé) |
| `canvas-layout-persisted-1440x900.png` | Canvas | 1440×900 | disposition persistée après rechargement |
| `visual-tooling-desktop-1440x900.png` | Console | 1440×900 | 7 outils, grille dense |
| `visual-tooling-mobile-375x812.png` | Console | 375×812 | 7 outils, **composition corrigée** |

Zéro débordement horizontal sur les dix.

## Captures externes (4)

| Fichier | Ce qui est prouvé |
|---|---|
| `grafana-dashboard.png` | dashboard peuplé : **38 runs, 15 couples, 72.7 %, p95 20.6 s**, répartition 24/9/5, tableau par agent, latences par agent |
| `langfuse-trace.png` | **deux traces de smoke visibles** dans le projet `Aigent (local)`, colonne `Usage 0 → 0` — la preuve visuelle du zéro appel facturé |
| `n8n-execution.png` | historique réel : 5 exécutions `Succeeded` (#2, #3, #5, #6, #7) **et** l'échec franc #4 — les deux chemins |
| `langsmith-graph.png` | **graphe `agent_builder` rendu par Studio**, état « Connected », bandeau de limite de tracing visible |

Chaque capture est précédée d'une assertion sur le CONTENU : le harnais échoue
si la valeur réelle 38 est absente de Grafana, si la trace de smoke n'apparaît
pas dans Langfuse, si aucune exécution réussie n'est visible dans n8n. Une image
d'écran vide n'est une preuve de rien.

## Obsidian — non capturé, limitation démontrée

Trois captures étaient exigées (vault, deux Canvas, Base). Elles n'ont pas été
produites. La démonstration de l'obstacle et la checklist manuelle en 5 points
sont dans `obsidian-manual-checklist.md`.

En résumé : le vault de mission n'est pas enregistré dans `obsidian.json` (trois
autres vaults le sont, dont un ouvert), l'URI `obsidian://open` répond
**« Vault not found »**, et l'enregistrer modifierait la configuration d'une
application hors du périmètre de cette mission. Une première capture montrant
cette boîte d'erreur a été **supprimée** plutôt que livrée sous un nom trompeur.

Ce qui est prouvé sans capture : `npm run check:vault` — 28 notes, 2 Canvas
(29 nœuds, 26 arêtes), 1 Base, 74 liens, **toutes les arêtes et tous les liens
résolus**, aucun secret. Sonde négative jouée sur cette gate également.

Statut : `INSTALLED`, non vérifié graphiquement.

## Les sept outils

`RUNNING` · `VERIFIED` · `CONNECTED` · `CONNECTED` · `CONNECTED` · `CONNECTED` · `INSTALLED`

Aucun service sondé n'atteint `VERIFIED` — le harnais échoue si c'est le cas.
Le seul `VERIFIED` est le Canvas, dont la preuve est produite dans la page même.
