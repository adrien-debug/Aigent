---
type: registre
mis_a_jour: 2026-08-01
source: POST /assistants/search sur le serveur LangGraph local
total: 20
---

# Registre des agents

Les **20 assistants réellement provisionnés**, relevés le 2026-08-01 sur le
serveur LangGraph vivant (`POST /assistants/search`). Tous portent
`graph_id: agent_builder` — c'est le seul graphe produit exécutable.

> Cette liste est un **relevé daté**, pas un contrat. Les rosters changent
> chaque semaine : recoupe avec le serveur avant de t'en servir.

## Domaine trading / marché

- Observateur du marché de l'or
- Gold Trading High-Risk Copilot
- Portfolio Risk Guardian
- Performance Analyst
- Execution Supervisor
- TradeAgent
- Bull21
- Hearst-Defi

## Domaine métier

- Netpool
- Accounting-Agent
- Real Estate Agent
- Marketing Studio
- Hearst Power Management

## Plateforme

- Aigent Builder
- Pilot Ops Test

## Bancs d'essai (seed)

Ces agents portent délibérément des états variés pour exercer l'UI :

- seed · Dev Lab
- seed · Bravo Draft — `draft`
- seed · Charlie Unresolved — `degraded`
- seed · Delta Paused — `paused`
- seed · Echo Retired — `archived`

## Notes individuelles

Les notes détaillées vivent dans `agents/` et alimentent la base `Agents.base`.
Voir [[Modèle — agent]] pour en créer une.

Voir [[Architecture Aigent]] · [[Parcours de qualification]]
