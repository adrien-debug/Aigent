---
tags: [aigent, evaluation-decision, supervision]
source: aigent
date: {{decisionDate}}
agent_id: {{agentId}}
version_id: {{versionId}}
decision: {{decision}}
---

# Décision d'évaluation — {{agentName}}

## Objet

| Champ | Valeur |
| --- | --- |
| Agent | `{{agentId}}` |
| Version évaluée | `{{versionId}}` |
| Version en place | `{{currentVersionId}}` |
| Décision | **{{decision}}** |
| Prise le | {{decisionDate}} |
| Par | {{decidedBy}} |

## Ce qui a été mesuré

| Check | Résultat | Couverture |
| --- | --- | --- |
| Suite de tests | {{testResult}} | {{testCoverage}} |
| Benchmark | {{benchmarkScore}} | {{benchmarkCoverage}} |
| Release gate | {{releaseGateResult}} | {{releaseGateCoverage}} |
| Tentatives unsafe | {{unsafeAttempts}} | {{unsafeCoverage}} |

Un compteur `unknown` est une mesure **absente**. Une mesure absente n'autorise
pas une promotion : elle la bloque, exactement comme un échec.

## Motif de la décision — synthèse bornée

> Le raisonnement de l'opérateur, court. Pas de prompt, pas de diff complet,
> pas de sortie de modèle.

{{rationale}}

## Preuves

- Fiche agent : `/agents/{{agentId}}`
- Runs de qualification : `/runs`
- Apprentissage : `/learning`
- Actions ouvertes : `/actions`

## Conséquence

- [ ] Version promue
- [ ] Version rejetée
- [ ] En attente d'une mesure manquante
