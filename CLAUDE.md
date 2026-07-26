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

## UI — ce qui garde réellement le design system

> **Storybook n'est PAS installé dans ce workspace (26/07/2026).** Le câblage précédent
> était creux de bout en bout — hook PreToolUse désactivé, 0 story, 0 test, et un
> `test:storybook-unit` qui se terminait par `|| true` donc ne pouvait pas échouer tout
> en occupant une ligne de `npm run check`. Le tout a été **supprimé**, pas caché :
> scripts, hook et marqueur `.storybook-consulted` n'existent plus.

Le design system est gardé par des outils qui échouent pour de vrai :

- `npm run check:ds` — mono-accent (`#A7FB90`) + zinc, contrastes AA vérifiés.
- `npm run check:catalyst` — primitives `src/components/ui/` obligatoires sur
  `src/app/admin/**`, `src/components/agent-ops/**`, `src/components/views/**`,
  `src/components/shell/**`. Zéro natif, spacing sur l'échelle fixe.
- `npm run check:views`, `check:render-truth`, `check:status-truth` — vérité affichée.

Le design system de ce workspace lui est PROPRE : ne pas importer les tokens/palette
d'un autre projet. Si Storybook est installé un jour, il faudra de vraies stories et une
gate a11y bloquante **avant** de réécrire une règle ici — une règle ne vaut que si un
outil la fait respecter.

## Anti-fuite de secrets — pre-commit actif

`npm run hooks:install` câble `core.hooksPath=scripts/hooks` : le hook `pre-commit`
lance `gitleaks protect --staged --redact` et **refuse** le commit si un secret est
détecté (vérifié par sonde : commit bloqué, HEAD inchangé). `npm run check:secrets`
rejoue le scan sur tout l'historique. À faire une fois après un clone.
