# Décisions d'architecture — où elles vivent

> Ce dépôt n'utilise **pas** de dossier d'ADR numérotés. Ce fichier documente la
> convention réelle ; il n'ouvre **aucune** cinquième doctrine.

## Où une décision est enregistrée

Une décision d'architecture durable est enregistrée **dans le fichier de
gouvernance qui la possède**, pas dans un ADR séparé :

- runtime, frontières de confiance, authentification, données, migrations →
  `AGENTS.md` (et la décision fondatrice « Aigent est le runtime gouverné
  canonique » → **`PRODUCT_DOCTRINE.md` §3**) ;
- surfaces et design → `DESIGN_DOCTRINE.md` ;
- méthode de travail → `CLAUDE.md`.

Le **détail daté** d'une décision (contexte, alternatives, preuve) vit dans
l'**historique git** de la mission qui l'a prise — jamais comme règle active. La
`docs/CURRENT_FUNCTIONAL_CHECKLIST.md` en garde la trace d'état.

## Quand enregistrer une décision

Enregistrer une décision lorsqu'elle :

- modifie une **frontière architecturale** (client/serveur, domaine, trust) ;
- introduit une **dépendance structurante** ;
- change une **source de vérité** ;
- remplace un **service central** (stockage, authentification, runtime) ;
- change le **déploiement** ;
- impose une **convention durable** à plusieurs domaines.

## Règle

Modifier une décision de gouvernance exige une **mission de gouvernance dédiée**
(`CLAUDE.md` §9). Une mission de code ne la change pas au passage. Toute
modification durable de l'architecture **met à jour, dans la même mission**, le
fichier de gouvernance propriétaire correspondant.
