---
type: carte
mis_a_jour: 2026-08-01
source: src/lib/agent-mission-control/
---

# Parcours de qualification

Le chemin réel d'un agent, de sa création à son amélioration. Relevé dans
`src/lib/agent-mission-control/` le 2026-08-01.

## Étapes

| # | Étape | Ce qui se passe | Câblé ? |
|---|---|---|---|
| 1 | **Création** | architect → manifest → matérialisation compensable | oui |
| 2 | **Qualification** | tests ciblés, auto-eval | oui |
| 3 | **Benchmark** | suites de référence, scores persistés | oui |
| 4 | **Shadow** | exécution en parallèle du courant, sans servir | oui |
| 5 | **Replay** | rejeu d'historique contre la version candidate | oui |
| 6 | **Gate** | release gate, 9 contrôles live | oui |
| 7 | **Promotion** | RPC transactionnelle `promote_copilot_version` | oui |
| 8 | **Apprentissage** | boucle d'amélioration V2 depuis la télémétrie | oui |

## Ce que `active` signifie

`active` veut dire **prouvé**, jamais « quelqu'un a changé un statut ». L'activation
exige les trois : un run `completed`, zéro tentative unsafe, un modèle vérifié.

## La garde d'exécution

`POST /api/agent-ops/copilots/:id/run` est **fail-closed**. Un run n'est autorisé
que si les trois conditions tiennent :

1. `status === 'active'`
2. `unresolvedToolIds` est vide
3. `runtime === 'langgraph'`

Sinon → 409 avec les raisons concrètes. S'y ajoutent 503 (backend ou credentials
absents), 404 (agent inconnu), 409 (double soumission), 409 (version périmée).

## Ce qu'Aigent ne sait pas

Après provisioning, Aigent ne fait que **pousser** des agents. Les gestes
activate / rebind / deploy-version appartiennent au workspace consommateur.

C'est la raison structurelle pour laquelle `active_in_consumer` reste le littéral
`'unknown'` — Aigent n'a **aucun canal de lecture** vers l'état d'activation d'un
workspace consommateur. Ce n'est pas une lacune à combler par une supposition.

Voir [[Architecture Aigent]] · [[Registre des runs]]
