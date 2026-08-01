# AIGENT-VISUAL-STACK-002 — revue visuelle

**SHA du rendu** : `b3b534f32245ed157457ca47445c342f96ce75ed`
**Arbre propre avant capture** : oui (`cleanBeforeCapture: true`)
**Verdict du harnais** : `PASS`
**Console** : 0 erreur, 0 avertissement, 0 exception non capturée

Le commit qui porte ces preuves est le descendant direct de `b3b534f` : il
n'ajoute que des artefacts, aucun code. Les captures correspondent donc bien au
dernier changement fonctionnel.

## Ce que le harnais vérifie, et qu'il échoue vraiment

Sonde négative jouée avant livraison : un `console.error` injecté dans
`graph-canvas.tsx` a produit **9 erreurs console et un verdict `FAIL`**. La
sonde a été retirée, le build refait, et la capture finale repasse `PASS`. Le
harnais mesure donc réellement quelque chose.

Il échoue aussi sur : arbre git sale, débordement horizontal, Canvas sans nœud
ou sans arête, inspecteur qui ne s'ouvre pas, statut d'outil hors vocabulaire.

## Captures

| Fichier | Surface | Viewport | État |
|---|---|---|---|
| `canvas-desktop-1440x900.png` | Canvas | 1440×900 | graphe réel |
| `canvas-laptop-1280x800.png` | Canvas | 1280×800 | graphe réel |
| `canvas-mobile-375x812.png` | Canvas | 375×812 | graphe réel |
| `canvas-node-selected-inspector-desktop-1440x900.png` | Canvas | 1440×900 | nœud `__start__` sélectionné, inspecteur ouvert |
| `canvas-node-selected-inspector-mobile-375x812.png` | Canvas | 375×812 | idem, surface mobile |
| `canvas-empty-1440x900.png` | Canvas | 1440×900 | graphe vide (simulé côté navigateur) |
| `canvas-unavailable-1440x900.png` | Canvas | 1440×900 | graphe indisponible (simulé) |
| `canvas-layout-persisted-1440x900.png` | Canvas | 1440×900 | disposition personnalisée après rechargement |
| `visual-tooling-desktop-1440x900.png` | Console outillage | 1440×900 | 7 outils |
| `visual-tooling-mobile-375x812.png` | Console outillage | 375×812 | 7 outils |

**Zéro débordement horizontal** sur les dix captures, tous viewports confondus.

## États dégradés — sans toucher au serveur partagé

`canvas-empty` et `canvas-unavailable` sont produits en interceptant la réponse
réseau **côté navigateur**, jamais en éteignant l'Agent Server : il est partagé
avec d'autres chantiers de la machine. C'est une simulation assumée, déclarée
ici et dans le manifeste — pas un état de production maquillé.

## Persistance de disposition

Vérifiée par le harnais, pas déclarée : `{"moved":true,"persisted":true,"reset":true}`.
Un nœud est déplacé, la page rechargée, la position retrouvée, puis le reset
restaure la disposition canonique.

## Les sept outils

Statuts constatés au rendu : `RUNNING`, `VERIFIED`, `CONNECTED`, `CONNECTED`,
`CONNECTED`, `CONNECTED`, `INSTALLED`.

| Outil | État | Pourquoi ce plafond |
|---|---|---|
| LangGraph Agent Server | `RUNNING` | répond, mais l'appel se heurte au mur d'auth (fail-closed) |
| Canvas Aigent | `VERIFIED` | seul `VERIFIED` légitime : sa preuve est produite dans cette page, et le harnais échoue si le graphe manque |
| Langfuse | `CONNECTED` | répond et accepte l'appel |
| Grafana | `CONNECTED` | idem |
| n8n | `CONNECTED` | idem |
| LangSmith Studio | `CONNECTED` | **jamais `VERIFIED`** — voir ci-dessous |
| Obsidian | `INSTALLED` | vault versionné et validé ; l'application de bureau n'a aucun port à sonder |

**Aucun service sondé n'atteint `VERIFIED`** — le harnais échoue si c'est le
cas. Un 200 prouve qu'un service répond, pas qu'il fait son travail.

## LangSmith Studio — la limite assumée

Studio plafonne à `CONNECTED`. Ce qui est prouvé : le serveur sert 20 assistants
tous en `agent_builder`, expose le graphe réel (5 nœuds, 6 arêtes), ses schémas,
et satisfait le contrat CORS de Studio. Ce qui ne l'est pas : que Studio
**affiche** ce graphe.

Deux obstacles, ni contournés ni maquillés :

1. Studio est une application tierce hébergée sur `smith.langchain.com`, exigeant
   une session graphique LangSmith.
2. Studio hébergé ne fournit pas nativement l'en-tête `x-agent-key` qu'exige
   notre serveur fail-closed.

Détail dans `docs/langsmith-studio.md`.

## Ce qui n'est pas capturé ici

Les preuves des services hors navigateur ne sont pas des captures d'écran mais
des sorties vérifiables, rejouables :

- **Langfuse** — `node scripts/smoke-langfuse.mjs` : aller-retour complet
  (ingestion → relecture par l'API), 9/9 contrôles, `llmCallsBilled: 0`.
- **Grafana** — dashboard `aigent-runs` provisionné, datasource saine, valeurs
  réelles servies via le proxy Grafana (`runs=38`, `succès=72.7 %`).
- **n8n** — exécutions #3, #5, #6, #7 en base, 5/5 nœuds verts, verdict métier
  réel (`ATTENTION — taux de succès 72.7 % sous le plancher de 80 %`).
- **Obsidian** — `npm run check:vault` : 28 notes, 2 Canvas (29 nœuds, 26
  arêtes), 1 Base, 74 liens, toutes les arêtes et tous les liens résolus.

Obsidian étant une application de bureau, aucune capture automatique n'en est
produite : le vault est vérifié par sa structure, pas par une photo de fenêtre.
