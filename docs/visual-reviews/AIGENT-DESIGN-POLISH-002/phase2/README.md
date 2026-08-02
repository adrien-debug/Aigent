# AIGENT-DESIGN-POLISH-002 — Phase 2 : neutraliser les absences dramatisées

> Suite de la Phase 1 (matière). **Aucun jeton de matière touché ici.**
> Date : 2026-08-02 · Branche : `mission/aigent-design-polish-002-phase2`

---

## 1. La règle appliquée

| Nature | Rendu | Exemples traités |
|---|---|---|
| **Fait mesuré ET négatif** | rouge `severity-bad` | outil déclaré sans handler, runtime non-LangGraph, run échoué |
| **Absence de mesure / configuration** | **neutre** (graphite, `text-muted`) | `unavailable`, `not configured`, aucun run, aucune télémétrie |

La distinction existait **déjà dans le modèle de données** — `evidence-model.ts`
sépare rigoureusement `pass` / `fail` / `missing` / `unknown` / `unavailable`, et
`atoms.tsx` rend `missing` en ambre, jamais en rouge. Elle était **écrasée au
pixel** par un verdict binaire. Cette passe rétablit au rendu ce que le modèle
affirmait déjà.

---

## 2. Fichiers modifiés

5 fichiers, +199 / −31.

| Fichier | Rôle |
|---|---|
| [`agents/evidence-model.ts`](../../../../src/components/agents/evidence-model.ts) | **+78** — classification de la nature d'un obstacle (`blockerNature`, `serviceVerdict`) |
| [`agents/detail-screen.tsx`](../../../../src/components/agents/detail-screen.tsx) | verdict à trois issues au lieu de deux ; chaque obstacle porte sa propre nature |
| [`cockpit/primitives.tsx`](../../../../src/components/cockpit/primitives.tsx) | `Unavailable` : ligne compacte par défaut, `block` en opt-in |
| [`runtime/tab-telemetry.tsx`](../../../../src/components/runtime/tab-telemetry.tsx) | `not_configured` : `red` → `zinc` |
| [`app/not-found.tsx`](../../../../src/app/not-found.tsx) | `block` explicite (l'absence EST le contenu de la page) |

**Fichiers interdits — non touchés, vérifié** : `globals.css`, shell, backend,
API, `src/lib/**`. `git diff --name-only` ne retourne aucun d'eux.

---

## 3. États avant / après

### Cas 1 — Agent `unavailable` (absence)

`/agents/copilot-agent-builder-copilot-12775a21`

| | Avant | Après |
|---|---|---|
| Titre | « **Lancement bloqué** » | « **Indisponible** » |
| Couleur du titre | `severity-bad` (rouge) | graphite neutre |
| Sous-titre | *(aucun)* | « Aucune mesure runtime disponible pour cet agent. » |
| Ligne d'état | « 1 obstacle(s) concret(s) **empechent un lancement** » en rouge | « 1 prérequis non mesuré(s) — **rien n'a échoué, rien n'a été lu.** » en neutre |
| Boîte d'obstacle | `aig-panel-raised` + liseré rouge + détail rouge | `aig-inset` (creux) + détail `text-muted` |
| Occurrences de « Lancement bloqué » | 1 | **0** (vérifié par `curl`) |

### Cas 2 — Agent `degraded` avec outils non résolus (blocage prouvé)

`/agents/copilot-gold-trading-high-risk-copilot-…`

**Inchangé, volontairement.** Titre « Lancement bloqué » en rouge, « 2
obstacle(s) concret(s) », boîtes surélevées à liseré rouge, noms des trois
outils sans handler. C'est le seul rouge de l'écran.

Nuance ajoutée : **chaque obstacle porte désormais SA nature**. Dans cet agent,
`3 declared tools cannot run` (prouvé) est rouge, et un prérequis non résolu qui
l'accompagnerait resterait neutre. Peindre toute la liste en rouge parce qu'un
seul élément est prouvé aurait été la même faute à une échelle plus fine.

### Cas 3 — Télémétrie non configurée

`/runtime` (onglet Télémétrie)

| | Avant | Après |
|---|---|---|
| Badge « canal non configuré » | **rouge** | **zinc** (neutre) |
| Texte explicatif | conservé | **conservé mot pour mot** |

Le résumé disait déjà « This says nothing about whether delivered agents are
running » — le rouge **contredisait le texte** juste à côté de lui.

### La règle de classification

```
proven  →  unresolved-tools, runtime-not-langgraph, status:degraded
absent  →  missing-version, missing-provider, missing-model,
           status:unavailable, status:inactive, + TOUT code inconnu
```

Le **défaut est `absent`** : un code d'obstacle non répertorié n'hérite jamais du
rouge par accident. On n'invente pas une panne qu'on n'a pas prouvée.

### Cas 4 — Composant `Unavailable`

| | Avant | Après |
|---|---|---|
| Forme par défaut | boîte `min-h-32` (128 px), liseré pointillé, contenu centré | **ligne** : libellé + explication, aucun cadre |
| Forme `block` | *(inexistante)* | opt-in explicite, réservée aux zones où l'absence EST le contenu |

47 sites d'appel bénéficient du nouveau défaut sans modification. Seul
`not-found.tsx` reçoit `block` — une 404 doit occuper sa page.

---

## 4. Captures

18 fichiers dans [`captures/`](captures/) — 3 cas × 3 viewports × avant/après.

| Cas | 1440×900 | 1280×800 | 375×812 |
|---|---|---|---|
| 1 · agent unavailable | ✓ | ✓ | ✓ |
| 2 · agent degraded | ✓ | ✓ | ✓ |
| 3 · runtime non configuré | ✓ | ✓ | ✓ |

**La preuve principale** — `after-1-agent-unavailable-1440x900.png` et
`after-2-agent-degraded-1440x900.png` côte à côte : titre neutre + boîte en
creux d'un côté, titre rouge + boîtes surélevées à liseré rouge de l'autre. La
différence se lit **sans ouvrir le code**, et sans lire les libellés.

---

## 5. Validations

| Commande | Résultat |
|---|---|
| `npm run check` (17 gates) | ✅ 0 erreur |
| `npm run test` | ✅ **2351 passés**, 184 fichiers, 1 *expected fail* |
| `npm run build` | ✅ |
| `npm run verify` (check + knip + tests + build) | ✅ |
| `npm run check:secrets` | ✅ 1185 commits, aucune fuite |

**Un test a échoué en cours de route, et il avait raison.**
`tests/unit/cost-truth.test.ts` impose que le mot d'absence ne soit épelé
qu'**une seule fois** dans `src/` — j'avais écrit `'Indisponible'` en littéral
dans le verdict. Corrigé en consommant `UNAVAILABLE_LABEL`. C'est exactement la
divergence que cet invariant existe pour empêcher, et il l'a attrapée.

Les avertissements de lint (`no-shadow`, `no-array-sort`, `no-img-element`) sont
**préexistants** et sans rapport avec cette passe.

---

## 6. Critères d'acceptation

| Critère | Statut |
|---|---|
| aucun `unavailable` rendu en rouge | ✅ 0 occurrence de « Lancement bloqué », aucun `severity-bad` |
| aucun `not configured` rendu comme panne | ✅ badge zinc, texte conservé |
| les vrais blocages restent rouges | ✅ cas 2 inchangé, seul rouge de l'écran |
| aucun texte métier perdu | ✅ tous les libellés vérifiés au rendu réel |
| captures montrant la différence sans lire le code | ✅ |

Sur le texte métier : `Status is unavailable, not active` et `3 declared tools
cannot run` n'apparaissent pas en `grep` littéral dans `src/` parce qu'ils sont
**générés par template** dans `agent-detail.ts` (couche données, non touchée).
Vérifiés présents **au rendu réel** par `curl`.

---

## 7. Risques restants

**1. `blockerNature` classe par `code`, une chaîne.** Si `agent-detail.ts` ajoute
un obstacle prouvé sans l'inscrire dans `PROVEN_BLOCKER_CODES`, il sera rendu
**neutre** — une vraie panne affichée calmement. Le défaut penche volontairement
vers la prudence (ne pas inventer de panne), mais c'est un couplage par
convention, **non tenu par une gate**. Un test d'invariant sur ce mapping serait
le bon garde-fou ; il n'existe pas.

**2. `status:inactive` est classé `absent`.** Un agent configuré jamais activé
affiche « Indisponible » et non « Inactif ». Défendable — l'activation n'a jamais
eu lieu, rien n'a échoué — mais c'est un choix de vocabulaire discutable, à
trancher si tu préfères un troisième mot.

**3. La forme compacte de `Unavailable` n'a été vue qu'aux endroits capturés.**
41 des 47 sites d'appel héritent du nouveau défaut sans capture dédiée : un
`Unavailable` qui remplissait seul une zone haute y laissera un vide plus grand
qu'avant. Aucun cas visible sur les 3 écrans capturés, mais non exhaustif.

**4. Autres écrans non traités.** `/qualification`, `/livraison`, `/learning`
portent des rendus d'absence propres, non audités ici. Le comptage source
suggère des cas similaires — hors périmètre de cette passe.

**5. Aucune gate ne mesure ces règles.** La preuve est la capture. Un futur écran
peut réintroduire un rouge sur une absence sans qu'aucune gate ne bronche.

---

## 8. Ce que cette passe ne fait pas

Phase 3 et suivantes, **non commencées** : aucune suppression de `Panel`, de
badge ou de carte, aucun aplatissement de profondeur, aucun changement de
collection. La mission s'arrête ici.
