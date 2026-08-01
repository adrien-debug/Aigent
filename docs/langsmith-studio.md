# LangSmith Studio ↔ graphe local — AIGENT-VISUAL-STACK-002

État au **2026-08-01**, vérifié contre le serveur vivant, pas contre la mémoire.

## Ce qui est prouvé

Le serveur LangGraph local sert le **vrai** graphe, et sert exactement les
endpoints que Studio consomme.

| Vérification | Commande | Résultat |
|---|---|---|
| Serveur vivant | `GET /ok` | `{"ok":true}` |
| Version | `GET /info` | LangGraph API 1.4.2, `langgraph_js_version` 1.4.7, `flags.langsmith: true` |
| Graphe réel | `POST /assistants/search` | **20 assistants, tous `graph_id: agent_builder`** |
| Topologie | `GET /assistants/:id/graph` | **5 nœuds, 6 arêtes** (voir ci-dessous) |
| Schémas | `GET /assistants/:id/schemas` | `input`/`output`/`state`/`config`/`context` présents |
| Threads | `POST /threads/search` | HTTP 200 |
| CORS pour Studio hébergé | `OPTIONS` avec `Origin: https://smith.langchain.com` | `access-control-allow-origin: *`, `allow-headers: content-type,x-agent-key` |
| Smoke sans coût | `POST /threads` → `GET state` → `DELETE` | 200 / 200 / 204, **aucun run, zéro appel LLM facturé** |

### Topologie constatée

```
__start__ ──► agent
              │
              ├──(conditionnelle)──► approval ──(conditionnelle)──► tools ──► agent
              │                          │
              │                          └──(conditionnelle)──► agent
              └──(conditionnelle)──► __end__
```

Nœuds : `__start__`, `agent`, `approval`, `tools`, `__end__`.
Six arêtes, dont quatre conditionnelles. Le nœud `approval` porte le HITL
(interrupt/resume) ; la boucle `tools → agent` est le cycle d'outillage.

## Ce qui n'est PAS prouvé — corrigé le 2026-08-01

**Une hypothèse antérieure de ce document était fausse.** Il affirmait que
Studio exigeait une session graphique et ne pouvait donc pas afficher le
graphe. La capture
`docs/visual-reviews/AIGENT-VISUAL-STACK-002/langsmith-graph.png` montre le
contraire :

- Studio ouvre le graphe **`agent_builder`** sans connexion préalable ;
- les cinq nœuds sont rendus : `__start__`, `agent`, `approval`, `tools`, `__end__` ;
- les arêtes conditionnelles sont tracées ;
- l'en-tête affiche **« Connected »** contre `http://127.0.0.1:2024` ;
- les schémas d'entrée (`ExecutedModel`, `Messages`) sont exposés.

L'obstacle `x-agent-key` supposé ne s'est pas matérialisé : Studio joint le
serveur local et lit sa topologie.

### La limite RÉELLE, plus étroite

Un bandeau de Studio l'énonce lui-même :

> Studio tracing requires langgraph-api **0.11.0** or later with session-name
> tracing enabled. Your server reports version **1.4.2**.

Deux conséquences :

1. **Le tracing in-Studio est indisponible** — les schémas de version diffèrent,
   Studio ne sait pas lire les traces de ce serveur.
2. **Aucune exécution n'a été observée.** Soumettre un run depuis Studio
   déclencherait un appel LLM facturé, hors mandat de cette mission. Le bouton
   `Submit` n'a pas été actionné.

Statut retenu : **`CONNECTED`, pas `VERIFIED`**. Studio sait LIRE le graphe —
c'est prouvé. Qu'il en OBSERVE une exécution ne l'est pas.

## Ouvrir Studio manuellement

```bash
npm run langgraph:studio
```

Ce que ça fait : ouvre
`https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`.

Prérequis :

1. le serveur local tourne (`npm run langgraph`, port 2024) ;
2. une session LangSmith active dans le navigateur ;
3. `LANGGRAPH_SERVER_SECRET` connu — le serveur est **fail-closed** et rejette
   toute requête sans `x-agent-key` (voir `src/langgraph/auth.mjs`). Studio doit
   pouvoir présenter cet en-tête, sans quoi ses appels reçoivent 401.

Le point 3 est la friction réelle : la garde d'auth maison protège le serveur
(c'est voulu, il est exposable publiquement), mais Studio hébergé n'a pas de
champ natif pour un en-tête personnalisé. Vérifier ce chemin de bout en bout
demande une session interactive.

## Sécurité — à faire

Les variables `LANGSMITH_API_KEY` et `LANGCHAIN_API_KEY` de `.env.local` ont été
exposées en clair dans un transcript d'agent le 2026-08-01 (lecture accidentelle
d'une valeur au lieu de sa seule longueur). Le fichier reste gitignoré et les
clés n'ont pas quitté la machine, mais **elles doivent être révoquées et
régénérées** sur `smith.langchain.com`.
