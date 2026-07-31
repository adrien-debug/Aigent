---
tags: [aigent, agent-review, supervision]
source: aigent
date: {{reviewDate}}
agent_id: {{agentId}}
version_id: {{versionId}}
status: {{status}}
---

# Revue d'agent — {{agentName}}

## Identité

| Champ | Valeur |
| --- | --- |
| Agent | `{{agentId}}` |
| Version | `{{versionId}}` |
| Runtime | {{runtime}} |
| Statut Aigent | {{status}} |
| Revue faite le | {{reviewDate}} |

## Synthèse bornée

> Trois lignes maximum. Ce champ est une observation d'opérateur, pas un dump.
> Il ne reçoit jamais un prompt, une sortie de modèle brute ni un payload.

{{summary}}

## Signaux mesurés

| Signal | Valeur | Couverture |
| --- | --- | --- |
| Runs sur la fenêtre | {{runCount}} | {{runWindow}} |
| Taux de succès | {{successRate}} | {{successCoverage}} |
| Coût mesuré (USD) | {{costUsd}} | {{costCoverage}} |

Une valeur `unknown` signifie **non mesurée**, jamais zéro. La colonne
« Couverture » dit sur combien de runs la valeur porte réellement.

## Preuves — la donnée vit dans Aigent

- Fiche agent : `/agents/{{agentId}}`
- Runs : `/runs`
- Apprentissage : `/learning`
- Actions ouvertes : `/actions`

Ces routes sont derrière l'authentification Aigent. Cette note porte des
pointeurs, jamais une copie du contenu.

## Décision d'opérateur

- [ ] Rien à faire
- [ ] Ouvrir une proposition d'amélioration
- [ ] Escalader

Notes : {{operatorNotes}}
