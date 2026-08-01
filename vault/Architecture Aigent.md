---
type: carte
mis_a_jour: 2026-08-01
source: code du repository + serveur vivant
---

# Architecture Aigent

Vérifié le 2026-08-01 contre le code et les services en fonctionnement.

## Ce qu'est Aigent

Le plan de contrôle où des agents LLM sont créés, qualifiés, livrés, observés et
améliorés. Aigent n'est pas le produit final : les agents qu'il produit tournent
chez des **consommateurs**, qui rapportent leurs runs ici.

```
create → qualify → ship ──► PRODUIT CONSOMMATEUR exécute l'agent
   ↑                                    │
   └──── improve ◄──── télémétrie ◄─────┘
```

## Composants réels

| Composant | Où | État constaté |
|---|---|---|
| Application Next | `src/app/` | port 3987 (partagé) |
| Garde d'identité | `src/proxy.ts` | garde `/api/agent-ops/**` |
| Runtime d'exécution | `src/langgraph/` | LangGraph API 1.4.2, port 2024 |
| Graphe produit | `agent_builder` | **5 nœuds, 6 arêtes** |
| Données | PostgREST | table `runtime_telemetry_events` |
| Traces | Langfuse | port 3801, projet `aigent-local` |
| Métriques | Prometheus → Grafana | ports 3804 → 3802 |
| Automatisations | n8n | port 3803 |

## Le graphe agent_builder

Topologie relevée sur le serveur vivant :

```
__start__ ──► agent ──(cond)──► approval ──(cond)──► tools ──► agent
                │                   │
                │                   └──(cond)──► agent
                └──(cond)──► __end__
```

- `agent` — le nœud de raisonnement
- `approval` — le HITL (interrupt / resume)
- `tools` — l'exécution d'outils, qui reboucle sur `agent`

## Trois frontières de confiance

Séparées exprès, avec des credentials **jamais partagés** :

1. `/api/agent-ops/**` — opérateur, cookie de session ou `x-amc-key`
2. `/api/runtime-telemetry` — agent déployé chez un tiers, jeton propre
3. `/api/runtime/v1/**` — produit consommateur, jeton propre

Voir [[Parcours de qualification]] · [[Registre des agents]]
