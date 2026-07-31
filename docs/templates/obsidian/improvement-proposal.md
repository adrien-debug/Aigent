---
tags: [aigent, improvement-proposal, supervision]
source: aigent
date: {{proposalDate}}
agent_id: {{agentId}}
version_id: {{versionId}}
priority: {{priority}}
status: {{status}}
---

# Proposition d'amélioration — {{agentName}}

## Cible

| Champ | Valeur |
| --- | --- |
| Agent | `{{agentId}}` |
| Version de base | `{{versionId}}` |
| Priorité | {{priority}} |
| Statut | {{status}} |
| Proposée le | {{proposalDate}} |
| Par | {{proposedBy}} |

## Problème observé — synthèse bornée

> Ce qui ne va pas, en quelques lignes. Les preuves restent dans Aigent : cette
> note ne recopie ni prompt, ni payload, ni sortie de modèle.

{{problemSummary}}

## Signal d'appui

| Signal | Valeur | Couverture |
| --- | --- | --- |
| Runs concernés | {{affectedRunCount}} | {{observationWindow}} |
| Taux d'échec | {{failureRate}} | {{failureCoverage}} |
| Incidents liés | {{linkedIncidentCount}} | — |

## Changement proposé

> Décrire l'intention, pas le prompt. Le contenu réel de la V2 est produit et
> versionné dans Aigent, pas ici.

{{proposedChange}}

## Critère d'acceptation

{{acceptanceCriteria}}

## Preuves

- Fiche agent : `/agents/{{agentId}}`
- Runs : `/runs`
- Apprentissage : `/learning`
- Actions ouvertes : `/actions`

## Suite

- [ ] Acceptée — V2 à produire dans Aigent
- [ ] Refusée
- [ ] En attente de mesure
