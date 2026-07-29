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

## UI — état après démolition (P006/P007)

Storybook n'est pas installé dans ce workspace. L'ancien dashboard visuel
(`src/components/agent-ops/**`, `src/components/views/**`, `src/components/shell/**`) et sa
doctrine (`DESIGN-DOCTRINE.md`) ont été supprimés par P006, ainsi que toutes les gates qui ne
protégeaient que ce visuel (`check:ds`, `check:contrast`, `check:catalyst`, `check:danger`,
`check:views`). `/admin` et `/admin/runs` sont des placeholders neutres.

Ce qui garde encore quelque chose aujourd'hui :

- `npm run check:no-legacy-front` — aucune des couches supprimées ne peut être réimportée, aucun
  `/admin-v2` ne peut réapparaître.
- `npm run check:render-truth`, `check:status-truth` — vérité affichée (mesure/absence, pas de
  vocabulaire de statut hors `labels.ts`), désormais scopées sur `src/app/admin/**` (et
  `src/lib/runs-console/**` pour la première) puisque les autres dossiers scannés n'existent plus.
- `npm run check:agent-truth` — vérité runtime, hors périmètre visuel.

Le design system de ce workspace lui est PROPRE : ne pas importer les tokens/palette
d'un autre projet. Une nouvelle doctrine visuelle ne s'écrit qu'au moment où un vrai écran se
reconstruit, avec une gate qui la fait respecter — jamais une simple phrase dans un `.md`.

## Anti-fuite de secrets — pre-commit actif

`npm run hooks:install` câble `core.hooksPath=scripts/hooks` : le hook `pre-commit`
lance `gitleaks protect --staged --redact` et **refuse** le commit si un secret est
détecté (vérifié par sonde : commit bloqué, HEAD inchangé). `npm run check:secrets`
rejoue le scan sur tout l'historique. À faire une fois après un clone.
