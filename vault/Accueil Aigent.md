---
type: accueil
mis_a_jour: 2026-08-01
mission: AIGENT-VISUAL-STACK-002
---

# Accueil — vault Aigent

Point d'entrée du vault de connaissance opérationnelle d'Aigent. Ce vault n'est
pas la documentation du produit (elle vit dans `docs/` et `README.md`) : c'est
l'espace de travail où les missions, agents, runs et décisions sont reliés entre
eux pour être navigables.

> **Règle de vérité.** Tout chiffre écrit ici est daté et provient d'une
> observation réelle. Une donnée non mesurée est notée « non mesuré », jamais
> remplacée par un zéro. Si un chiffre paraît vieux, il l'est : recoupe-le avec
> le code et la base avant de t'en servir.

## Cartes

- [[Architecture Aigent]] — les composants réels et leurs liens
- [[Parcours de qualification]] — de la création à l'apprentissage
- Canvas : `architecture/Architecture Aigent.canvas`
- Canvas : `architecture/Parcours de qualification.canvas`

## Registres

- [[Registre des agents]] — les 20 assistants réellement provisionnés
- [[Registre des missions]] — missions GitHub et leur état
- [[Registre des runs]] — télémétrie et preuves

## Modèles

Les templates vivent dans `templates/` :

- [[Modèle — mission]]
- [[Modèle — agent]]
- [[Modèle — run]]
- [[Modèle — incident]]
- [[Modèle — décision]]
- [[Modèle — apprentissage]]
- [[Modèle — rework]]

## Base

`Agents.base` — vue filtrable des notes d'agent, alimentée par les propriétés
YAML des notes de `agents/`.

## Ouvrir ce vault

```
Obsidian → Ouvrir un dossier comme coffre → <repo>/vault
```

Le vault est versionné dans le repository. Ce qui reste **local et ignoré** :
`.obsidian/workspace*`, les caches et l'état de fenêtre — ils changent à chaque
ouverture et n'ont aucune valeur partagée.
