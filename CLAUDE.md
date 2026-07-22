<!-- BEGIN:deploy-policy -->
PROD_AUTODEPLOY: unknown

Chaîne de déploiement non démontrée (pas de `vercel.json` ni de `.vercel/`; un `ci.yml` existe mais son
rôle de gate de déploiement n'a pas été vérifié). Tant que la valeur n'est pas établie : **STOP avant
`push origin main`** sur ce repo. Merge local et push d'une branche de travail restent autorisés.
État git au 2026-07-22 : le conflit `src/app/admin/agents/page.tsx` (deux sessions front en
parallèle) est **résolu** au commit `36d8f81` "refactor(ui): reconcile parallel Aigent frontend
rebuilds", poussé sur `feature/aigent-kyc-front-rebuild-001` (= head de la PR #11, MERGEABLE).
Aucun merge en cours, aucun worktree en écriture.

La divergence `Runtime` vs `Provider`+`Model` est **tranchée** : la colonne `Runtime` fusionnée de
`feature/aigent-front-rebuild-013` (`75daee7`) est retenue — les deux colonnes séparées avaient des
breakpoints différents (`xl` vs `lg`), donc entre lg et xl le modèle s'affichait sans son provider.
Le point de statut par densité (actif/inactif/dégradé/indisponible) de la branche courante est
conservé : le DS est mono-accent, la couleur ne peut pas être le seul canal. La branche `013` est
donc entièrement intégrée et peut être supprimée.

**Reste bloquant : le merge de la PR #11 dans `main`.** `ci.yml` ne contient aucune étape de
déploiement et il n'y a ni `vercel.json` ni `.vercel/` — mais `PROD_AUTODEPLOY` reste `unknown`
(un hook hors repo n'est pas exclu). Le merge attend un accord explicite d'Adrien.
<!-- END:deploy-policy -->

@AGENTS.md
