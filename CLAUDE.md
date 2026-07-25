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

## Storybook — passage obligatoire avant toute modif UI

> **STATUT (2026-07-25) : hook DÉ-ACTIVÉ tant que Storybook n'est pas installé.**
> Le câblage était creux (aucun Storybook à consulter) et bloquait les édits UI sans
> rien faire respecter. La règle ci-dessous redevient active après `npx storybook@latest
> init` + réactivation du hook dans `.claude/settings.json`. **En attendant, le design
> system reste réellement gardé par `npm run check:ds` + `npm run check:catalyst`** (ce
> sont EUX l'outil qui fait respecter la règle, cf. doctrine « une règle ne vaut que si
> un outil la fait respecter »).

Storybook est la source de vérité visuelle du design system de CE projet (kit local,
tokens locaux — indépendant de tout autre workspace). **Avant toute modification UI,
frontend, composant, layout ou Design System** :

1. lancer Storybook (`npm run storybook`) ;
2. identifier la story concernée + le vrai composant React + le token source ;
3. reproduire le problème dans Storybook ;
4. modifier la SOURCE produit, jamais uniquement la story ;
5. vérifier variantes + viewports ;
6. `npm run storybook:consult` (débloque la passe UI 15 min pour le hook) ;
7. `npm run test:storybook` (a11y en `error` = bloquant) avant de livrer.

Le hook `scripts/hooks/storybook-gate.mjs` (PreToolUse) REFUSE toute édition d'un fichier
UI tant que Storybook n'a pas été consulté — la règle passe par un outil, pas par la bonne
volonté. Le design system de ce workspace lui est PROPRE : ne pas importer les tokens/palette
d'un autre projet.
