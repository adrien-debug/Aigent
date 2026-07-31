---
tags: [aigent, run-incident, supervision]
source: aigent
date: {{incidentDate}}
agent_id: {{agentId}}
run_id: {{runId}}
version_id: {{versionId}}
severity: {{severity}}
status: {{status}}
---

# Incident de run — {{agentName}}

## Identité

| Champ | Valeur |
| --- | --- |
| Run | `{{runId}}` |
| Agent | `{{agentId}}` |
| Version | `{{versionId}}` |
| Démarré le | {{startedAt}} |
| Statut du run | {{status}} |
| Sévérité | {{severity}} |

## Ce qui a échoué — synthèse bornée

> Une description factuelle et courte. **Jamais** la trace complète, jamais le
> prompt, jamais la sortie du modèle, jamais le payload d'outil. Ces éléments
> restent dans Aigent, derrière l'authentification.

{{failureSummary}}

## Classification

| Champ | Valeur |
| --- | --- |
| Catégorie | {{failureCategory}} |
| Outil concerné | {{toolId}} |
| Étape | {{failedStep}} |
| Tentatives unsafe | {{unsafeAttempts}} |

## Preuves

- Run dans Aigent : `/runs`
- Fiche agent : `/agents/{{agentId}}`
- Actions ouvertes : `/actions`

## Suite

- [ ] Incident isolé, aucune action
- [ ] Récurrent — ouvrir `improvement-proposal`
- [ ] Bloquant — l'agent ne doit plus tourner

Notes : {{operatorNotes}}
