# AIGENT-VISUAL-STACK-001 — revue visuelle

> **Périmètre livré : le Canvas LangGraph (lot 1) et la console « Outillage
> visuel » (lot 7).** Les lots 2 à 6 — Obsidian, LangSmith Studio installé,
> Langfuse, Grafana, n8n — ne sont **pas** livrés ici. Ce document dit ce qui a
> été mesuré, et refuse de présenter comme fait ce qui ne l'a pas été.

## Verdict

**PARTIAL.** Ce qui est livré est vérifié en navigateur sur un graphe réel ;
cinq des sept lots de la mission d'origine restent à faire.

## Ce qui est réellement vérifié

| Fait | Preuve |
|---|---|
| Le Canvas rend le VRAI graphe `agent_builder` | 5 nœuds, 6 arêtes lues sur l'Agent Server local `:2024` |
| Sélection d'un nœud → inspecteur | `selection.nodeClicked = "__start__"`, `inspectorOpened = true` |
| Trois viewports sans débordement horizontal | `horizontalOverflow: false` sur 6/6 captures |
| Console propre | **0 erreur, 0 avertissement** mesurés par le harnais |
| Aucun secret dans le bundle client | recherche sur `.next/static/` : aucune VALEUR de `.env.local` |

## Le défaut trouvé — et pourquoi il compte

La première capture a produit **168 avertissements** :
`[React Flow] Couldn't create edge for source handle id: "null"`.

Le nœud personnalisé ne portait pas de `<Handle>`. Sans poignée, React Flow
**refuse chaque arête** : le graphe se rendait en nœuds flottants, sans aucun
lien — plausible à l'œil, structurellement faux.

Pendant ce temps : `typecheck` vert, `build` vert, **20 gates vertes**, 2257
tests verts. Aucune gate ne mesure le rendu. Seule la capture l'a montré.

Correction : poignées `target`/`source` sur le nœud, plus un test de régression
qui lit la source du composant (`tests/unit/graph-canvas-model.test.ts`). Après
correction : 0 avertissement.

## Ce que le Canvas n'affiche pas, exprès

La mission demandait d'afficher « le rôle, le modèle, les outils et les
politiques » de chaque nœud. **L'Agent Server ne les publie pas** :
`GET /assistants/{id}/graph` ne rend que `{id, type}` par nœud et
`{source, target, conditional}` par arête.

L'inspecteur l'écrit donc à l'écran plutôt que de fabriquer des valeurs :

> « Modèle, outils et politiques ne sont pas exposés par la topologie de l'Agent
> Server. Ils ne sont pas affichés plutôt que devinés. »

Les seuls attributs affichés par nœud sont **dérivés et donc vrais** : type
publié, terminal, degrés entrant/sortant, présence d'une sortie conditionnelle.

## Statuts réels au moment de la capture

| Outil | Statut | Fait mesuré |
|---|---|---|
| LangGraph Agent Server | `RUNNING` | HTTP 401 — répond mais refuse l'appel (authentification) |
| LangSmith Studio | `CONFIGURED` | état **dérivé** du serveur local ; l'affichage réel du graphe n'est PAS vérifié |
| Langfuse | `RUNNING` | HTTP 200 sur l'instance déjà existante (`:3001`) — **non installée par cette mission** |
| Grafana | `UNAVAILABLE` | aucune adresse configurée, jamais sondé |
| n8n | `UNAVAILABLE` | aucune adresse configurée, jamais sondé |
| Obsidian | `UNAVAILABLE` | application de bureau : **aucun port à sonder**, non mesurable depuis le serveur |

Aucun état « VERIFIED » n'existe dans cette surface. Une sonde HTTP prouve qu'un
service répond, pas qu'il fait son travail : Langfuse qui répond n'a pas pour
autant reçu une trace. Afficher un vert « vérifié » depuis un 200 serait
précisément le faux vert que la gouvernance interdit.

## Captures

| Fichier | Surface | Viewport |
|---|---|---|
| `canvas-desktop-1440x900.png` | Canvas, graphe réel | 1440×900 |
| `canvas-laptop-1280x800.png` | Canvas, graphe réel | 1280×800 |
| `canvas-mobile-375x812.png` | Canvas, graphe réel | 375×812 |
| `canvas-node-selected-inspector-1440x900.png` | nœud sélectionné + inspecteur | 1440×900 |
| `visual-tooling-desktop-1440x900.png` | console Outillage visuel | 1440×900 |
| `visual-tooling-mobile-375x812.png` | console Outillage visuel | 375×812 |

`manifest.json` porte la branche, le SHA, les routes, les viewports, les statuts
HTTP, le nombre de nœuds rendus par capture, et **la liste complète des messages
console** — pas seulement leur compteur.

### Captures demandées mais ABSENTES

- **graphe vide / graphe indisponible** : les deux états existent dans le code
  (`graph-canvas-empty`, `ProvenEmpty`) et sont couverts par les tests unitaires,
  mais aucune capture n'a été produite — les provoquer demanderait d'éteindre
  l'Agent Server partagé de la machine.
- **Obsidian vault / Canvas / Base** : lot non livré.
- **état partiellement configuré** : la capture `visual-tooling` EST cet état
  (2 outils joignables sur 6), mais elle n'a pas été produite en variante.

## Harnais de capture

`scripts/capture-visual-stack.mjs`. Navigateur **isolé** — jamais le profil
Chrome quotidien. Seul retrait dans les captures : l'overlay de développement de
Next (`nextjs-portal`), absent en production, qui masquerait le produit. Il est
déclaré dans le manifeste.

Playwright n'est **pas** une dépendance de ce dépôt et cette mission n'en ajoute
pas : le harnais le résout depuis l'environnement et échoue clairement s'il est
absent.

## Limites connues

1. Le Canvas est en **lecture seule**. Aucun chemin de mutation du manifeste
   n'existe — c'est délibéré, pas une étape manquante.
2. La disposition est **dérivée** (tri topologique déterministe), non persistée.
   Un déplacement manuel de nœud vit dans l'état React et meurt avec lui.
3. Les sondes ne franchissent pas l'authentification : un 401 est rapporté comme
   tel, pas contourné.
4. Aucune gate ne mesure le rendu. La leçon des 168 avertissements tient par un
   test de régression textuel, pas par une garantie automatique.
