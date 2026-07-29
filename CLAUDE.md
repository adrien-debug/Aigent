<!-- BEGIN:deploy-policy -->
PROD_AUTODEPLOY: unknown

Cette valeur déclenche uniquement une **vérification courte** avant push, jamais un blocage.

Si aucun mécanisme d'auto-déploiement réel n'est démontré, un push explicitement demandé par Adrien
est **autorisé et doit être exécuté**.

La seule présence de fichiers CI, Vercel, Railway, Docker ou d'un ancien hook supposé ne constitue
**pas** une preuve d'auto-déploiement. Il faut une étape de déploiement réellement câblée.

Ne jamais bloquer indéfiniment un push sur une simple valeur `unknown`.
<!-- END:deploy-policy -->

@AGENTS.md

> **Périmètre de ce fichier : git, sécurité opérationnelle, déploiement.** Les invariants
> techniques (port, runtime, design, vérité runtime) vivent dans `AGENTS.md` ; l'état produit
> réel dans `README.md` et `docs/current-capabilities.md`. Une règle vit dans UN seul fichier.

## Git — branche et intégration

- **On travaille sur `main`.** Pas de branche longue, pas de branche de confort.
- **Un sous-agent travaille dans un worktree isolé**, jamais dans le working tree d'un autre.
  Deux agents n'écrivent jamais dans le même arbre en même temps.
- **L'intégration dans `main` est immédiate** dès que le travail est prêt et validé — on ne
  laisse pas une branche mûrir.
- **`stage → commit → push` se déroulent d'un trait.** Le push direct de `main` après
  validation est le livrable normal, pas une demande séparée.
- **Staging nommé.** Jamais `git add -A` ni `git add .` quand d'autres agents modifient le
  repo en parallèle : on stage les fichiers qu'on a écrits, nommément.
- Ne jamais réécrire (`reset` / `rebase` / `amend` / `force`) un commit qui appartient à un
  autre agent actif.
- **Jamais `git push --force` sur `main`.**

## Validation avant push

Une vérification **ciblée et rapide**, pas une suite complète : ce qui touche au périmètre
modifié. `npm run check` (statique) suffit dans la plupart des cas ; `npm run verify` quand le
changement touche le build ou le rendu. La liste des gates est dans
`docs/current-capabilities.md`, et une gate rouge gagne sur toute phrase de doctrine
(précédence énoncée dans `AGENTS.md`).

Ne jamais faire passer une gate artificiellement (`@ts-ignore`, `as any` posés pour masquer).
Ne jamais annoncer « ça marche » sans l'avoir constaté — « codé, non vérifié » est une réponse
acceptable, une affirmation fausse ne l'est pas.

## Déploiement

**Le déploiement est une étape distincte du push, et il exige un ordre explicite d'Adrien.**
`push ≠ deploy`. Aucun agent ne déploie de sa propre initiative, quelle que soit la qualité du
travail livré.

Aucune migration destructive, aucun `drop`, aucun reset de base prod, aucun écrasement de
secret prod sans plan et accord explicite préalable.

## Secrets

- Un secret ne s'affiche pas, ne se logge pas, ne se committe pas, ne se met pas dans un
  prompt. Dans le code, une clé se lit via `process.env`.
- Si tu croises un secret en clair, ne le recopie nulle part.
- Ne jamais committer `.env.local`.

### Anti-fuite de secrets — pre-commit actif

`npm run hooks:install` câble `core.hooksPath=scripts/hooks` : le hook `pre-commit`
lance `gitleaks protect --staged --redact` et **refuse** le commit si un secret est
détecté (vérifié par sonde : commit bloqué, HEAD inchangé). `npm run check:secrets`
rejoue le scan sur tout l'historique. À faire une fois après un clone.
