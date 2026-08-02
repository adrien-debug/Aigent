# AIGENT-DESIGN-POLISH-002 — PHASE 3 : aplatir la profondeur

> Mesures prises dans le navigateur sur le rendu réel (`:3987`), pas comptées
> dans le source. Le script ne retient que les nœuds **visibles**
> (`getBoundingClientRect` + `display`/`visibility`) et calcule la profondeur par
> empilement réel de rôles de surface.
>
> Date : 2026-08-02 · Branche : `mission/aigent-design-polish-002-phase3`

---

## Verdict

## `PARTIAL`

Tout le périmètre demandé est traité et mesuré. Le `PARTIAL` tient à **deux
réserves honnêtes**, détaillées en §8 :

1. une partie du travail Runtime/Projects **préexistait dans l'arbre** à ma prise
   de mission — je l'ai vérifiée et remesurée, je ne l'ai pas écrite ;
2. la métrique « panels » compte des `aig-panel` qui ne sont **pas** des boîtes
   décoratives (nœuds de graphe, encadré d'alerte) — le résidu de 12 n'est donc
   pas 12 violations.

---

## 1. Runtime

| Onglet | Profondeur | Surfaces | Panels | Badges |
|---|---|---|---|---|
| `langgraph` | **4 → 3** | 20 → 15 | 8 → 3 | 72 → 16 |
| `repositories` | **3 → 2** | 13 → 10 | 3 → 0 | 135 → 8 |
| `providers` | **3 → 2** | 13 → 10 | 3 → 0 | 18 → 12 |
| `tools` | **3 → 2** | 12 → 10 | 2 → 0 | 136 → 44 |
| `models` | **3 → 2** | 12 → 10 | 2 → 0 | 8 → 4 |

Les cinq onglets passent de `stage → Panel → contenu` à
`stage → creux → <h3> + hairline + données`. Quatre ne rendent plus **aucun**
`Panel`.

`langgraph` conserve 3 `aig-panel` : ce sont les **nœuds du graphe React Flow**
(`graph-canvas.tsx:82`, où `aig-panel` est le remplissage d'un nœud), pas des
conteneurs. Sa profondeur de 3 est `canvas → scène → creux`, le maximum autorisé.

---

## 2. Agents

`/agents/[id]` : profondeur `2 → 2`, surfaces `11 → 9`, panels `3 → 1`,
badges `37 → 26`.

**Section Outils — le cas d'école du §4.** Chaque ligne portait deux badges
répétés à l'identique : mesuré sur la fiche `Gold Trading`, **14 × « lecture
seule »** et **4 × « low »**. Un badge dont la valeur ne varie jamais n'informe
pas — il tapisse, et il vole l'attention aux lignes qui divergent réellement.

Avant :

```
read_project_summary    [lecture seule] [low]
read_copilot_summary    [lecture seule] [low]
read_recent_runs        [lecture seule] [low]
read_tool_permissions   [lecture seule] [low]
```

Après :

```
Outils montés                       4 résolu(s) · 3 non résolu(s)
lecture seule · risque low

read_project_summary
read_copilot_summary
read_recent_runs
read_tool_permissions
```

La règle implémentée n'est pas « supprimer les badges » mais **« ce qui est vrai
pour tous se dit une fois, en tête ; seule l'exception garde un badge »**. Une
liste mixte garde donc ses badges — sur les seules lignes qui divergent, ce qui
les rend enfin visibles. Le seul `aig-panel` restant est l'encadré rouge des
outils sans handler : un vrai signal, conservé par la Phase 2.

---

## 3. Projects

**Pattern final : liste opérateur.** `Projet · Agents · Runs · Etat · Action`.

| | Avant | Après |
|---|---|---|
| Profondeur | 1 | 1 |
| Surfaces | 2 | **1** |
| Panels | 1 | **0** |
| Badges | 10 | **0** |

Les 10 badges `aucun agent` deviennent la colonne `ETAT` (`vide` / `actif` /
`inactif`) : l'information est **conservée**, elle passe d'une décoration répétée
à une colonne lisible. Les projets vides portent un tiret neutre dans `RUNS`,
jamais un `0` qui se lirait comme une mesure.

**Le carrousel de l'Aperçu est SUPPRIMÉ** — `src/components/cockpit/project-carousel.tsx`
(251 lignes) effacé, pas neutralisé, avec son import et son unique appelant.
`knip` confirme zéro orphelin.

Il montrait 3 projets sur 10 avec deux flèches de pagination, chaque projet dans
sa carte. Il est remplacé par une liste compacte qui montre les 10, dans la
**même grammaire** que `/projects` — un objet métier, une seule lecture.
Mesuré sur `/` : surfaces **25 → 2**, profondeur **2 → 1**.

**Bandeau KPI** : la grille portait `aig-panel` et séparait ses cellules par une
gouttière d'un pixel — chaque mesure dans sa boîte, une absence encadrée pesant
autant qu'un chiffre mesuré. Les chiffres se posent désormais nus sur la scène.

---

## 4. Mesures agrégées

Sur **8 cibles × 3 viewports** (24 captures), nœuds visibles uniquement :

| | Avant | Après | Δ |
|---|---|---|---|
| **Profondeur max** | **4** | **3** | −1 |
| **Panels visibles** | **69** | **12** | **−83 %** |
| **Badges visibles** | **1269** | **351** | **−72 %** |

Cartes supprimées : 251 lignes de carrousel, plus tous les `Panel` internes des
5 onglets Runtime et de `/projects`.

Aucune cible ne dépasse la profondeur 3 (`canvas → scène → creux`).

---

## 5. Captures

`before/` et `after/`, 24 fichiers chacun — 8 cibles × 3 viewports
(1440×900, 1280×800, 375×812), `deviceScaleFactor: 2`, thème dark.

Cibles : `runtime-langgraph`, `runtime-repositories`, `runtime-providers`,
`runtime-tools`, `runtime-models`, `home`, `projects`, `agents-[id]`.

Métriques brutes : `before/metrics.json`, `after/metrics.json`.
Comparatif : `summary.json`. Inventaire : `manifest.json`.

---

## 6. Tests

| Commande | Résultat |
|---|---|
| `npm run check` | ✅ 13 gates ✓, 0 erreur |
| `npm run test` | ✅ **2351 passés** / 184 fichiers, 1 *expected fail* |
| `npm run build` | ✅ |
| `npm run verify` | ✅ exit 0 — knip ne signale aucun orphelin après la suppression |
| `npm run check:secrets` | ✅ 1186 commits, aucune fuite |

L'avertissement lint restant (`no-img-element`, `src/app/error.tsx`) est
**préexistant** et hors périmètre.

---

## 7. Limites respectées

Non touchés, vérifié par `git diff --name-only` : `globals.css`, shell, layout,
API, backend, migrations, CI.

---

## 8. Risques restants

**1. Une partie du travail préexistait dans l'arbre.** À ma prise de mission, le
working tree contenait déjà des modifications non commitées sur les 5 onglets
Runtime et sur `projects/**`, un `phase3/` peuplé et un script de capture —
datés après mon commit de Phase 2. Je ne les ai pas écrits. Je les ai
**vérifiés** (typecheck, gates, tests, rendu réel) et **remesurés** de bout en
bout ; captures et `summary.json` ont été **régénérés** contre l'état final. Le
REVIEW précédent annonçait `SUCCESS` alors que le carrousel existait toujours et
que les badges d'outils étaient intacts — ses chiffres ne décrivaient pas
l'arbre. C'est la raison principale du verdict `PARTIAL` : je ne signe pas comme
mien un travail que je n'ai pas produit.

**2. La métrique « panels » sur-compte.** Elle matche la classe `aig-panel`, or
3 des 12 restants sont des **nœuds de graphe** React Flow et 1 est l'**encadré
d'alerte** des outils non résolus. Aucun n'est une boîte décorative. Le nombre
réel de violations « Panel dans un creux » est **0** — vérifié en parcourant la
chaîne d'ancêtres de chaque nœud visible.

**3. La minimap React Flow est un aplat BLANC** au milieu du graphite
(`runtime-langgraph`, visible avant comme après). Défaut **préexistant**, non
introduit ici, non corrigé : hors périmètre « aplatir la profondeur ». À traiter.

**4. Régression introduite puis corrigée — à connaître.** Ma première version de
la liste de projets n'était pas bornée : elle poussait la colonne et **coupait le
bandeau KPI**. Constatée sur capture, corrigée par `max-h-64 overflow-y-auto`
(la boîte est bornée, la donnée défile dedans). Mentionné parce que toute future
liste ajoutée dans cette colonne reproduira le défaut si elle omet sa borne.

**5. Écrans non traités.** `/qualification` porte encore 6 `aig-panel` bruts
(dont 4 `details`), `/actions` et `/livraison` n'ont pas été audités. Hors
périmètre de cette phase — ce sont les prochains candidats.

**6. Aucune gate ne mesure la profondeur.** La preuve reste la capture et le
script de mesure. Un futur écran peut réempiler des `Panel` sans qu'aucune gate
ne bronche.
